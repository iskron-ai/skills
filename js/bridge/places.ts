// Места канала в других графах (граф nks-dev: #5838, отвечая #5837): одна
// сессия через один мост стоит в каждом графе, где работает. Канал держит
// места в нескольких графах — register на том же канале в другом графе
// добавляет место, hello перечисляет их все, а запись подписывается местом
// своего графа. Поэтому сокет службы один (hold.ts), а здесь — места рядом с
// тем, ради которого он взят: у каждого своя дверь для сторожа, своя запись
// держания и своя строка в повторной регистрации (standing.ts).
import { type Frame } from "../shared/channel.ts";
import { harnessName } from "./client.ts";
import { Door, type DoorHooks } from "./door.ts";
import { dropHoldRecord, keyOf, readHoldRecord, writeHoldRecord } from "./holdrecord.ts";
import { normKarta, normName, realmMatches } from "./names.ts";
import { standingLog } from "./store.ts";
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

const extras = new Map<string, Place>(); // ключ места → место с дверью

export const keyOfPlace = (s: Standing): string => keyOf(s.realm, s.karta, s.name ?? "");
export const extraPlaces = (): Place[] => [...extras.values()];

/** Место канала в этом графе (наверняка тот же граф), если мост его держит. */
export const extraIn = (realm: unknown): Place | undefined =>
  extraPlaces().find((p) => realmMatches(p.standing.realm, realm));

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
  state.places = state.places.filter((p) => !realmMatches(p.realm, s.realm));
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

/** Поставить место рядом на канал, который держит мост: своя дверь и запись держания. Возвращает ключ. */
export function addExtra(s: Standing, ch: Channel, hooks: DoorHooks): string {
  const key = keyOfPlace(s);
  const have = extras.get(key);
  if (have) return key;
  // Иное место того же графа сменяет прежнее — правило «в графе одно место» уже пройдено.
  for (const p of extraPlaces())
    if (realmMatches(p.standing.realm, s.realm)) dropExtra(p.door.key, "другое место графа", true);
  const door = new Door(key, hooks);
  door.open();
  const place = { standing: s, door };
  extras.set(key, place);
  writeRecord(place, ch);
  standingLog(`held ${key} beside the channel`);
  return key;
}

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
}

/** Вынуть место рядом, не закрывая двери, — оно становится основным (hold.ts). */
export function takeExtra(key: string): Place | undefined {
  const p = extras.get(key);
  if (!p) return undefined;
  extras.delete(key);
  state.places = state.places.filter((s) => keyOfPlace(s) !== key);
  return p;
}

export function dropAllExtras(reason: string, forget: boolean): void {
  for (const k of [...extras.keys()]) dropExtra(k, reason, forget);
  if (forget) state.places = [];
}

const nameOfAddress = (a: unknown): string => (typeof a === "string" ? a.replace(/^.*:/, "") : "");

/**
 * Чьей двери кадр: по графу кадра наверняка, иначе по адресату (to_standing),
 * если имя называет одно место рядом и не основное. Неясное — основному месту.
 */
export function extraForFrame(frame: Frame | null, primary: Standing | null): Place | undefined {
  if (!frame || !extras.size) return undefined;
  const byRealm = frame.realm != null ? extraIn(frame.realm) : undefined;
  if (byRealm || (frame.realm != null && primary && realmMatches(frame.realm, primary.realm)))
    return byRealm;
  const to = nameOfAddress(frame.to_standing);
  if (!to || to === (primary?.name ?? "")) return undefined;
  const named = extraPlaces().filter((p) => (p.standing.name ?? "") === to);
  return named.length === 1 ? named[0] : undefined;
}
