// Слушает ли просимое место другая сессия (решение владельца #6706): мост не
// советует take=true и не берёт сырым connect, mint или register места, которое
// может слушать живая другая сессия. «Слушает» — живой локальный сокет места,
// который держит не эта сессия, либо строка «слушает» на доске; доска не
// прочлась — мост не знает, и это не «свободно».
import { L } from "../shared/lang.ts";
import { listens, nameOf, readBoard } from "./board.ts";
import { type AskedHearing, callTool as call } from "./call.ts";
import { holdsStanding, isParked, ledKey, localSocketPathOf, wasEvicted } from "./hold.ts";
import { keyOf, readHoldRecord, sessionOfBridge } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";
import { localSocketAlive } from "./sweep.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Живой локальный сокет места держит мост другой сессии (своя сессия — её запись держания). */
export async function heldLocallyByOther(key: string): Promise<boolean> {
  if (!(await localSocketAlive(localSocketPathOf(key)))) return false;
  const me = sessionOfBridge();
  return !(me && readHoldRecord(key, true)?.session === me);
}

/** Кто слушает место: другая сессия, никто или мост не знает (доска не прочлась). */
export async function askedHearing(
  realm: string,
  karta: string,
  name: string,
): Promise<AskedHearing> {
  if (await heldLocallyByOther(keyOf(realm, karta, name))) return "other";
  const b = await call("iskron_channel", { action: "list", realm }).catch(() => null);
  const bd = b && !b.isError ? readBoard(b) : null;
  if (!bd?.recognized) return "unknown";
  return bd.entries.some((e) => e.karta === karta && nameOf(e.address) === name && listens(e))
    ? "other"
    : "free";
}

/**
 * Сырой connect, mint или register места, которое этот мост не ведёт, а слушает
 * другая сессия (или мост не знает): connect отнял бы его без take, register
 * подписал бы записи чужим местом. Отказ вслух; iskron_stand своё вернёт сам, а
 * у чужого встанет рядом.
 */
export async function rawSeatRefusal(msg: JsonRpcMessage): Promise<string | null> {
  if (msg?.method !== "tools/call" || msg.params?.name !== "iskron_channel") return null;
  const a = msg.params.arguments ?? {};
  const action = String(a.action);
  if (!["connect", "mint", "register"].includes(action)) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const karta = normKarta(a.karta ?? state.standing?.karta ?? "");
  const name = normName(a.name);
  if (!realm || !karta || ledHere(realm, karta, name)) return null;
  const hearing = await askedHearing(realm, karta, name);
  if (hearing === "free") return null;
  const seat = keyOf(realm, karta, name);
  const who =
    hearing === "other"
      ? L(`место ${seat} слушает другая сессия`, `another session listens on the seat ${seat}`)
      : L(
          `слушает ли место ${seat} другая сессия, мост не знает (доска не прочлась)`,
          `the bridge does not know whether another session listens on the seat ${seat} (the board did not read)`,
        );
  return L(
    `Отказано (мост): ${who} — ${action} ${action === "register" ? "подписал бы записи чужим местом" : "отнял бы его"}; вызов не отправлен. Встань iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`,
    `Refused (bridge): ${who} — ${action} ${action === "register" ? "would sign writes with another's seat" : "would take it"}; the call was not sent. Stand with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`,
  );
}

/** Место ведёт сам этот мост — держит, запарковал или переоткрывает свой сокет; отнятое — не его. */
export function ledHere(realm: string, karta: string, name: string): boolean {
  if (holdsStanding(realm, karta, name) || isParked(realm, karta, name)) return true;
  return ledKey() === keyOf(realm, karta, name) && !wasEvicted(realm, karta, name);
}
