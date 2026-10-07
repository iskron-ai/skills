// Слушает ли место другая сессия (решение владельца #6706) — одно знание о месте
// на все пути: совет take=true в отказе «место одно на мост», сырой connect,
// mint и register, выбор места рядом в iskron_stand. «Слушает» — живой локальный
// сокет места, который держит не эта сессия, либо строка «слушает» на доске.
// Доска не прочлась или разобрана не целиком (счёт мест в шапке не сошёлся с
// разобранным, а место среди разобранных не найдено) — мост не знает, кто
// слушает: это не «свободно», ни совета take=true, ни прохода без take.
// Роль-сентинел (agent, me, realm-owner) — не число доски: «agent» берёт роль
// места, которое мост ведёт в этом графе, иначе место ищется под любой ролью.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { L } from "../shared/lang.ts";
import { standingsDirOf } from "../shared/standings.ts";
import { type Board, type BoardEntry, listens, nameOf, readBoard } from "./board.ts";
import { type AskedHearing, callTool as call } from "./call.ts";
import { CFG } from "./config.ts";
import { holdsStanding, isParked, ledKey, localSocketPathOf, wasEvicted } from "./hold.ts";
import { keyOf, readHoldRecord, sessionOfBridge } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";
import { sameRealm } from "./realms.ts";
import { localSocketAlive } from "./sweep.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Роль не числом — сентинел: доска печатает роли числами, сличить его с ней нельзя. */
export const isSentinel = (karta: string): boolean => !/^\d+$/.test(karta);

/** Роль вызова в форме доски: «agent» — роль места, которое мост ведёт в этом графе. */
export function seatKarta(realm: unknown, karta: unknown): string {
  const k = normKarta(karta);
  if (k !== "agent") return k;
  const r = String(realm ?? "").trim();
  const led = [state.standing, ...state.places].find(
    (p) => p && (p.realm === r || sameRealm(r, p.realm)),
  );
  return led ? String(led.karta) : k;
}

/** Строка доски — это место: то же имя и та же роль (сентинел — любая). */
export const ofSeat = (e: BoardEntry, karta: string, name: string): boolean =>
  (isSentinel(karta) || e.karta === karta) && nameOf(e.address) === name;

/** Что доска знает о месте. */
export function boardHearing(bd: Board | null, karta: string, name: string): AskedHearing {
  if (!bd?.recognized) return "unknown";
  const at = bd.entries.filter((e) => ofSeat(e, karta, name));
  if (at.some(listens)) return "other";
  const unread = bd.declared != null && bd.declared !== bd.entries.length;
  return unread && (at.length === 0 || isSentinel(karta)) ? "unknown" : "free";
}

/** Ключи мест графа под этим именем у любой роли, что лежат в каталоге гранта. */
function keysNamed(realm: string, name: string): string[] {
  const dir = standingsDirOf(CFG.authDir);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".key"))
      .map((f) => readFileSync(join(dir, f), "utf8").trim())
      .filter((k) => {
        const m = /^.*?--(.+)--/.exec(k);
        return !!m && keyOf(realm, m[1], name) === k;
      });
  } catch {
    return [];
  }
}

/** Живой локальный сокет места держит мост другой сессии (своя сессия — её запись держания). */
async function heldLocallyByOther(realm: string, karta: string, name: string): Promise<boolean> {
  const me = sessionOfBridge();
  for (const key of isSentinel(karta) ? keysNamed(realm, name) : [keyOf(realm, karta, name)])
    if (
      (await localSocketAlive(localSocketPathOf(key))) &&
      !(me && readHoldRecord(key, true)?.session === me)
    )
      return true;
  return false;
}

/** Кто слушает место: другая сессия, никто или мост не знает. */
export async function askedHearing(
  realm: string,
  karta: string,
  name: string,
): Promise<AskedHearing> {
  if (await heldLocallyByOther(realm, karta, name)) return "other";
  const b = await call("iskron_channel", { action: "list", realm }).catch(() => null);
  return boardHearing(b && !b.isError ? readBoard(b) : null, karta, name);
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
  const karta = seatKarta(realm, a.karta ?? state.standing?.karta ?? "");
  const name = normName(a.name);
  if (!realm || !karta || ledHere(realm, karta, name)) return null;
  const hearing = await askedHearing(realm, karta, name);
  if (hearing === "free") return null;
  const seat = keyOf(realm, karta, name);
  const who =
    hearing === "other"
      ? L(`место ${seat} слушает другая сессия`, `another session listens on the seat ${seat}`)
      : L(
          `слушает ли место ${seat} другая сессия, мост не знает (доска не прочлась или разобрана не целиком)`,
          `the bridge does not know whether another session listens on the seat ${seat} (the board did not read, or not all of it)`,
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
