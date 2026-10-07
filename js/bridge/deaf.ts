// Место без слуха (граф nks-dev: решение #6706): мост ведёт место, а его сокета
// не держит — ушёл словом (leave) или токен мёртв (4001). За это время место
// могла взять другая сессия; запись, сырой register и повторная привязка после
// смены сессии подписали бы её место. Пока доска не скажет, что его не слушает
// никто, — не подписываться: доска не прочлась или читает его слушающим (в окне
// сразу после ухода это может быть и свой закрытый сокет) — отказ вслух; вернуть
// своё или встать рядом — iskron_stand. Отнятое (4000) — evicted.ts.
import { L } from "../shared/lang.ts";
import { askedHearing } from "./hearing.ts";
import { diedOn, isParked, ledKey } from "./hold.ts";
import { otherRealm } from "./realms.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Ходы канала, которые записей не подписывают. */
const UNSIGNED = new Set(["list", "leave", "close", "revoke", "?"]);

/** Ведёт ли мост место без слуха: ушёл словом или сокет отпущен мёртвым токеном. */
function deafSeat(): { realm: string; karta: string; name: string } | null {
  const s = state.standing;
  if (!s) return null;
  const name = s.name ?? "";
  return isParked(s.realm, s.karta, name) || (!ledKey() && diedOn(s.realm, s.karta, name))
    ? { realm: s.realm, karta: String(s.karta), name }
    : null;
}

/** Место без слуха может слушать другая сессия (или мост не знает): подписываться им нельзя. */
export async function deafSeatTaken(): Promise<string | null> {
  const seat = deafSeat();
  if (!seat) return null;
  const hearing = await askedHearing(seat.realm, seat.karta, seat.name);
  if (hearing === "free") return null;
  return hearing === "other"
    ? L(
        `место ${seat.name} без слуха (ушёл с него или токен мёртв), а доска читает его слушающим — его могла взять другая сессия`,
        `the seat ${seat.name} has no hearing (left, or the token died), and the board reads it listening — another session may have taken it`,
      )
    : L(
        `место ${seat.name} без слуха (ушёл с него или токен мёртв), а слушает ли его другая сессия, мост не знает`,
        `the seat ${seat.name} has no hearing (left, or the token died), and the bridge does not know whether another session listens on it`,
      );
}

/** Вызов харнеса в граф места без слуха, которое может слушать другая сессия, — отказ вслух. */
export async function deafRefusal(msg: JsonRpcMessage): Promise<string | null> {
  const s = state.standing;
  if (msg?.method !== "tools/call" || !s || !deafSeat()) return null;
  const tool = msg.params?.name;
  const a = msg.params?.arguments ?? {};
  if (tool === "iskron_stand") return null;
  if (tool === "iskron_channel" && UNSIGNED.has(String(a.action))) return null;
  const realm = a.realm;
  if (typeof realm !== "string" || [s, ...state.places].every((p) => otherRealm(realm, p.realm)))
    return null;
  const why = await deafSeatTaken();
  return why
    ? L(
        `Отказано (мост): ${why}; его подписью вызов не уйдёт — не отправлен. Вернись iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`,
        `Refused (bridge): ${why}; the call will not go under its signature — not sent. Stand again with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`,
      )
    : null;
}
