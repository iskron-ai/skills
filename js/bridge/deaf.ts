// Место без слуха (граф nks-dev: решение #6706): мост ведёт место, а его сокета
// не держит — ушёл словом (leave), отпустил сокет (мёртвый токен 4001, переоткрытие
// без hello) или открывает его тем же адресом без hello (адрес мог повернуть
// другой: контур отвечает на него 404). Сокет у мест канала общий: глохнут
// разом основное и места других графов. За это время любое из них могла взять
// другая сессия; запись, сырой register и повторная привязка после смены
// сессии подписали бы её место. Пока доска не скажет, что место графа вызова не
// слушает никто, — не подписываться: доска не прочлась или читает его слушающим
// (в окне сразу после ухода это может быть и свой закрытый сокет) — отказ
// вслух; вернуть своё или встать рядом — iskron_stand. Отнятое (4000) — evicted.ts.
import { L } from "../shared/lang.ts";
import { askedHearing } from "./hearing.ts";
import { awaitHello, isParked, ledKey } from "./hold.ts";
import { keyOf } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { otherRealm } from "./realms.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

type Place = { realm: string; karta: string | number; name?: string };

/** Ходы канала, которые записей не подписывают. */
const UNSIGNED = new Set(["list", "leave", "close", "revoke", "?"]);

/**
 * Граф, в котором вызов харнеса подписался бы местом канала; null — не
 * подписывает (не вызов тула, iskron_stand, неподписывающий ход канала, нет графа).
 */
export function signedRealm(msg: JsonRpcMessage): string | null {
  if (msg?.method !== "tools/call" || msg.params?.name === "iskron_stand") return null;
  const a = msg.params?.arguments ?? {};
  if (msg.params?.name === "iskron_channel" && UNSIGNED.has(String(a.action))) return null;
  return typeof a.realm === "string" ? a.realm : null;
}

/**
 * Места канала без слуха — привязка у сервера жива, а сокет, который мост
 * держал, ушёл (уход словом, мёртвый токен, переоткрытие без hello) или
 * открывается заново, а hello ещё нет; слух есть или сокета не было вовсе (одна привязка register) — пусто.
 */
function deafPlaces(): Place[] {
  const s = state.standing;
  if (!s) return [];
  const name = s.name ?? "";
  if (isParked(s.realm, s.karta, name) || H.unheard) return [s, ...state.places];
  const letGo = !ledKey() && H.deafKey === keyOf(s.realm, s.karta, name);
  return letGo ? [s, ...state.places, ...H.deadPlaces] : [];
}

/** Место канала без слуха, которым подписался бы вызов в этот граф; иначе null. */
export function deafPlaceIn(realm: unknown): Place | null {
  if (typeof realm !== "string") return null;
  return deafPlaces().find((p) => !otherRealm(realm, p.realm)) ?? null;
}

/** Место без слуха может слушать другая сессия (или мост не знает): подписываться им нельзя. */
export async function deafSeatTaken(
  p: Place | null = deafPlaces()[0] ?? null,
): Promise<string | null> {
  if (!p) return null;
  const name = p.name ?? "";
  const hearing = await askedHearing(p.realm, String(p.karta), name);
  if (hearing === "free") return null;
  return hearing === "other"
    ? L(
        `место ${name} без слуха (ушёл с него или токен мёртв), а доска читает его слушающим — его могла взять другая сессия`,
        `the seat ${name} has no hearing (left, or the token died), and the board reads it listening — another session may have taken it`,
      )
    : L(
        `место ${name} без слуха (ушёл с него или токен мёртв), а слушает ли его другая сессия, мост не знает`,
        `the seat ${name} has no hearing (left, or the token died), and the bridge does not know whether another session listens on it`,
      );
}

/** Вызов харнеса в граф места без слуха, которое может слушать другая сессия, — отказ вслух. */
export async function deafRefusal(msg: JsonRpcMessage): Promise<string | null> {
  const realm = signedRealm(msg);
  if (H.unheard && deafPlaceIn(realm)) await awaitHello(4000); // своё переоткрытие — дождаться его hello
  const p = deafPlaceIn(realm);
  const why = p ? await deafSeatTaken(p) : null;
  return why
    ? L(
        `Отказано (мост): ${why}; его подписью вызов не уйдёт — не отправлен. Вернись iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`,
        `Refused (bridge): ${why}; the call will not go under its signature — not sent. Stand again with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`,
      )
    : null;
}
