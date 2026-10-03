// Места канала в других графах (граф nks-dev: #5838, отвечая #5837): одна
// сессия через один мост стоит в каждом графе, где работает. Канал держит
// места в нескольких графах — register на том же канале в другом графе
// добавляет место, hello перечисляет их все, а запись подписывается местом
// своего графа. Поэтому сокет службы один (hold.ts), а здесь — места рядом с
// тем, ради которого он взят: у каждого своя дверь для сторожа, своя запись
// держания и своя строка в повторной регистрации (standing.ts).
import { type Frame } from "../shared/channel.ts";
import { L } from "../shared/lang.ts";
import { scoped } from "../shared/scope.ts";
import { harnessName } from "./client.ts";
import { type ChannelEvent, Door, type DoorHooks } from "./door.ts";
import { dropHoldRecord, keyOf, readHoldRecord, writeHoldRecord } from "./holdrecord.ts";
import { handoverReason } from "./holdstate.ts";
import { normKarta, normName } from "./names.ts";
import { canonRealm, learnRealm, sameRealm } from "./realms.ts";
import { standingLog } from "./store.ts";
import { emit } from "./streams.ts";
import { type Standing, state } from "./transport.ts";

export interface Place {
  standing: Standing;
  door: Door;
}

/** Адреса канала, на котором стоят места, — пишутся в запись держания каждого. */
export interface Channel {
  url: string;
  statusUrl: string | null;
  cwd?: string | null;
}

const extras = scoped(() => new Map<string, Place>()); // ключ места → место с дверью (у сессии)

export const keyOfPlace = (s: Standing): string => keyOf(s.realm, s.karta, s.name ?? "");
export const extraPlaces = (): Place[] => [...extras.values()];

/** Место канала в этом графе (наверняка тот же граф), если мост его держит. */
export const extraIn = (realm: unknown): Place | undefined =>
  extraPlaces().find((p) => sameRealm(p.standing.realm, realm));

/** Место именно с этими тремя именами среди мест других графов. */
export function extraOf(realm: unknown, karta: unknown, name: unknown): Place | undefined {
  const p = extraIn(realm);
  return p &&
    String(p.standing.karta) === normKarta(karta) &&
    (p.standing.name ?? "") === normName(name)
    ? p
    : undefined;
}

/** Запомнить место другого графа для повторной регистрации — одно на граф. */
export function rememberPlace(s: Standing): void {
  state.places = state.places.filter((p) => !sameRealm(p.realm, s.realm));
  state.places.push(s);
}

function writeRecord(p: Place, ch: Channel, status?: string): void {
  const s = p.standing;
  writeHoldRecord(p.door.key, {
    realm: s.realm,
    karta: s.karta,
    name: s.name ?? "",
    url: ch.url,
    statusUrl: ch.statusUrl,
    status: status ?? readHoldRecord(p.door.key)?.status,
    cwd: ch.cwd ?? readHoldRecord(p.door.key)?.cwd,
    client: harnessName(),
    key: p.door.key,
  });
}

/** Адрес места рядом из хэндла основного места (канал один, хэндл тот же) — помечен выведенным. */
function deriveAddress(p: Place, primaryAddress: string | null | undefined): void {
  const handle = primaryAddress?.match(/^(.*):/)?.[1];
  if (!handle || !p.standing.name) return;
  p.door.address = `${handle}:${p.standing.name}`;
  p.door.addressDerived = true;
}

/**
 * Поставить место рядом на канал, который держит мост: своя дверь и запись держания. Возвращает ключ.
 * `primaryAddress` — адрес основного места: из него выводится @handle:name места рядом;
 * основное ещё без адреса — у места рядом его нет до hello, что назовёт его само.
 */
export function addExtra(
  s: Standing,
  ch: Channel,
  hooks: DoorHooks,
  primaryAddress: string | null = null,
): string {
  const key = keyOfPlace(s);
  const have = extras.get(key);
  if (have) return key;
  // Иное место того же графа сменяет прежнее — правило «в графе одно место» уже пройдено.
  for (const p of extraPlaces())
    if (sameRealm(p.standing.realm, s.realm))
      dropExtra(p.door.key, L("другое место графа", "another seat of the graph"), true);
  const door = new Door(key, hooks);
  const place = { standing: s, door };
  deriveAddress(place, primaryAddress);
  door.open();
  extras.set(key, place);
  writeRecord(place, ch);
  standingLog(`held ${key} beside the channel`);
  besideWord({
    kind: "beside",
    key,
    place: { realm: s.realm, karta: String(s.karta), name: s.name ?? "" },
  });
  return key;
}

// Слово харнесу о месте рядом (beside, beside-gone): по нему тонкий мост знает места
// сессии — при смене демона они теряются громко (lostplaces.ts). Не held и не released:
// те — об основном месте, и плагин OpenCode судит по ним о держании.
const besideWord = (data: ChannelEvent): void =>
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", logger: "iskron-channel", data },
  });

/** Канал сменил адреса (переоткрыт тем же местом): записи мест рядом — за ним. */
export function repointExtras(ch: Channel): void {
  for (const p of extraPlaces()) writeRecord(p, ch);
}

/** Занятость, принятая доской для места рядом, — в его запись держания. */
export function rememberExtraStatus(key: string, ch: Channel, text: string): void {
  const p = extras.get(key);
  if (p) writeRecord(p, ch, text || "");
}

/** Отпустить место рядом: дверь закрыта; `forget` стирает запись и строку повторной регистрации. */
export function dropExtra(key: string, reason: string, forget: boolean): void {
  const p = extras.get(key);
  if (!p) return;
  extras.delete(key);
  p.door.close();
  if (forget) {
    dropHoldRecord(key);
    state.places = state.places.filter((s) => keyOfPlace(s) !== key);
  }
  standingLog(`released ${key}: ${reason}${forget ? " (record dropped)" : ""}`);
  // Смена демона снимает места не по слову агента: тонкий мост должен их помнить.
  if (!handoverReason()) besideWord({ kind: "beside-gone", key, text: reason });
}

export function dropAllExtras(reason: string, forget: boolean): void {
  for (const k of [...extras.keys()]) dropExtra(k, reason, forget);
  if (forget) state.places = [];
}

const nameOfAddress = (a: unknown): string => (typeof a === "string" ? a.replace(/^.*:/, "") : "");
const all = (primary: Place | null): Place[] => [...(primary ? [primary] : []), ...extraPlaces()];
const unresolved = (realm: string): boolean => !canonRealm(realm).startsWith("@");

/**
 * hello перечисляет места канала: {realm @owner/slug, standing @handle:name,
 * standing_id, karta_seq}. Каждое узнанное — id своей двери (по нему кадр и
 * занятость находят место); граф места, записанный rN или слагом, заодно
 * узнаёт свою каноническую форму, если имя и роль называют одно место hello.
 */
export function learnFromHello(hello: Frame | null, primary: Place | null): void {
  const listed = Array.isArray(hello?.standings) ? hello.standings : [];
  for (const p of all(primary)) {
    const same = listed.filter(
      (e) =>
        nameOfAddress(e.standing) === (p.standing.name ?? "") &&
        (e.karta_seq == null || String(e.karta_seq) === String(p.standing.karta)),
    );
    const mine = same.filter((e) => sameRealm(e.realm, p.standing.realm));
    const e =
      mine.length === 1
        ? mine[0]
        : unresolved(p.standing.realm) && same.length === 1
          ? same[0]
          : null;
    if (!e) continue;
    if (e.realm && unresolved(p.standing.realm)) learnRealm(p.standing.realm, e.realm);
    if (typeof e.standing_id === "string" && e.standing_id) p.door.standingId = e.standing_id;
    if (typeof e.standing === "string" && e.standing) {
      p.door.address = e.standing;
      p.door.addressDerived = false;
    }
  }
}

/** Места, которым адресован кадр (id места — одно, если оно известно, и тогда id узнаётся); null — кадр без адреса. */
function fitsOf(frame: Frame, places: Place[]): Place[] | null {
  const id = typeof frame.to_standing_id === "string" ? frame.to_standing_id : "";
  const byId = id ? places.find((p) => p.door.standingId === id) : undefined;
  if (byId) return [byId];
  const to = nameOfAddress(frame.to_standing);
  if (!id && !to && frame.realm == null && frame.karta_seq == null) return null;
  const fits = places.filter(
    (p) =>
      (frame.realm == null || sameRealm(frame.realm, p.standing.realm)) &&
      (!to || to === (p.standing.name ?? "")) &&
      (frame.karta_seq == null || String(frame.karta_seq) === String(p.standing.karta)),
  );
  if (fits.length === 1 && id && !fits[0].door.standingId) fits[0].door.standingId = id;
  return fits;
}

/**
 * Кадр спула смены демона, адресованный месту, которого мост не держит (место
 * рядом не вернулось, #6586): кому он — ключ места из повторной регистрации,
 * иначе адрес кадра. Null — кадр основного места, места рядом или без адреса.
 */
export function strayOf(frame: Frame | null, primary: Place): string | null {
  if (frame?.type !== "message" || fitsOf(frame, all(primary))?.length !== 0) return null;
  const back = state.places.find((s) => frame.realm != null && sameRealm(s.realm, frame.realm));
  return back
    ? keyOfPlace(back)
    : `${String(frame.to_standing ?? "—")}, ${L("граф", "graph")} ${String(frame.realm ?? "—")}`;
}

/**
 * Чьей двери кадр (#5838): по to_standing_id — id места; иначе по графу, адресу
 * и роли кадра, если они называют ровно одно место (и тогда id места узнаётся).
 * Кадр без адреса — слово канала, основному месту. Адрес есть, а места нет или
 * их несколько — основному месту со словом об этом, не молча.
 */
export function routeFrame(frame: Frame | null, primary: Place): { door: Door; note?: string } {
  if (!frame || !extras.size) return { door: primary.door };
  const fits = fitsOf(frame, all(primary));
  if (!fits) return { door: primary.door };
  if (fits.length === 1) return { door: fits[0].door };
  const id = typeof frame.to_standing_id === "string" ? frame.to_standing_id : "";
  return {
    door: primary.door,
    note: L(
      `ДЕЛАТЕЛЬ: кадр ${String(frame.id ?? "?")} (to_standing_id ${id || "—"}, ${frame.to_standing ?? "—"}, граф ${frame.realm ?? "—"}) ` +
        `не сопоставлен ни одному месту моста (${fits.length ? "подходят несколько" : "не подходит ни одно"}) — отдан основному месту ${primary.door.key}; сверь адрес кадра.`,
      `DOER: frame ${String(frame.id ?? "?")} (to_standing_id ${id || "—"}, ${frame.to_standing ?? "—"}, graph ${frame.realm ?? "—"}) ` +
        `matches no seat of the bridge (${fits.length ? "several fit" : "none fits"}) — given to the main seat ${primary.door.key}; check the frame's address.`,
    ),
  };
}
