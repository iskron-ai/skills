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

import { tool } from "../delivery/index.ts";
import { sameDir } from "../shared/canon.ts";
import { L } from "../shared/lang.ts";
import { sessionCwd } from "../shared/scope.ts";
import { standingsDirOf } from "../shared/standings.ts";
import { type Board, type BoardEntry, listens, nameOf, readBoard } from "./board.ts";
import { type AskedHearing, callTool as call, resolveAgainstLed } from "./call.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
import { doors, holdsStanding, isParked, ledKey, localSocketPathOf, wasEvicted } from "./hold.ts";
import {
  type HoldRecord,
  holdRecordsNamed,
  keyOf,
  readHoldRecord,
  sessionOfBridge,
} from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { normKarta, normName } from "./names.ts";
import { resolveRealms, sameRealm } from "./realms.ts";
import { localSocketAlive } from "./sweep.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Роль не числом — сентинел: доска печатает роли числами, сличить его с ней нельзя. */
export const isSentinel = (karta: string): boolean => !/^\d+$/.test(karta);

/**
 * Роль вызова в форме доски: «agent» — роль места, которое мост ведёт в этом
 * графе, иначе роль, под которой это имя держала эта же сессия (запись держания
 * прежнего моста): своё место узнаётся и под сентинелом.
 */
export function seatKarta(realm: unknown, karta: unknown, name = ""): string {
  const k = normKarta(karta);
  if (k !== "agent") return k;
  const r = String(realm ?? "").trim();
  const here = (x: string): boolean => x === r || sameRealm(r, x);
  const led = [state.standing, ...state.places].find((p) => p && here(p.realm));
  if (led) return String(led.karta);
  const me = sessionOfBridge();
  const rec =
    me && name ? holdRecordsNamed(name).find((x) => x.session === me && here(x.realm)) : null;
  return rec ? normKarta(rec.karta) : k;
}

/** «agent», которого мост не разрешил в число: место не сличить ни с доской, ни с прежним держанием — отказ. */
export const unresolvedAgent = (karta: string, what: string): string | null =>
  karta !== "agent"
    ? null
    : L(
        `Отказано (мост): karta="agent" — мост не ведёт места в этом графе и не знает, какой роли это имя у этой сессии, а место под сентинелом не сличить ни с доской, ни с прежним держанием (${what} мог бы встать вторым местом или взять чужое). Назови роль числом — роль агента из AGENTS.md.`,
        `Refused (bridge): karta="agent" — the bridge leads no seat in this graph and does not know which role this session held the name under, and a seat under the sentinel matches neither the board nor a former hold (${what} could make a second seat or take another's). Name the role by number — the agent's role from AGENTS.md.`,
      );

/**
 * Написание графа места: тот же граф, записанный иначе, чем у мест, которые
 * ведёт мост, или у записей держания этого имени, берёт их написание — у места
 * один ключ, и своё под другим написанием не становится чужим. Не разрешилось — как есть.
 */
export async function seatRealm(given: unknown, asked: unknown): Promise<string> {
  const realm = typeof given === "string" ? given.trim() : "";
  const name = normName(asked);
  const known = [
    ...[state.standing, ...state.places].flatMap((p) => (p ? [p.realm] : [])),
    ...(name ? holdRecordsNamed(name).flatMap((r) => (r.realm ? [r.realm] : [])) : []),
  ];
  await resolveAgainstLed(realm); // графы сличаются в одной форме @owner/slug (#5838)
  if (!realm || !known.length || known.includes(realm)) return realm;
  await resolveRealms([realm, ...known], async () => {
    const r = await call(tool("realm"), { action: "list" });
    return r.isError ? null : r.text;
  });
  return known.find((r) => sameRealm(r, realm)) ?? realm;
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

/**
 * Запись без сессии этого харнесса из этого каталога: её держатель сессии не назвал
 * (возврат с диска до слова плагина, запись прежней сборки) — для названной сессии
 * харнесса место своё, а не другой живой сессии (#6702). Живой мост названной сессии
 * подписывает запись, как только сессию ему назовут (resume.ts); плагин называет
 * сессию мосту при его подъёме, до первого вызова тула (opencode/keep.ts), — живой
 * держатель без сессии в таком харнессе — сирота возврата, а не чья-то вахта.
 */
export const unsignedHere = (rec: HoldRecord, cwd: string): boolean =>
  !rec.session && !rec.left && rec.client === harnessName() && sameDir(rec.cwd, cwd);

/**
 * Кто держит живой локальный сокет места: сама дверь этого моста, прежний мост
 * этой сессии (её запись держания, либо запись без сессии харнесса и каталога `cwd`
 * у названной сессии), другой — или никто (сокета нет). Харнесс без имён сессий
 * своим считает только сокет этого моста: живой прежний мост той же папки — чужой.
 */
export async function localHolder(
  key: string,
  cwd?: string,
): Promise<"self" | "session" | "other" | null> {
  if (!(await localSocketAlive(localSocketPathOf(key)))) return null;
  if (doors().some((d) => d.key === key && d.ownsSocket)) return "self";
  const me = sessionOfBridge();
  const rec = me ? readHoldRecord(key, true) : null;
  if (!rec) return "other";
  return rec.session === me || (cwd != null && unsignedHere(rec, cwd)) ? "session" : "other";
}

/** Живой локальный сокет места держит мост другой сессии, прежний мост этой — или никто. */
async function heldLocally(
  realm: string,
  karta: string,
  name: string,
  cwd: string,
): Promise<"other" | "session" | null> {
  let own = false;
  for (const key of isSentinel(karta) ? keysNamed(realm, name) : [keyOf(realm, karta, name)]) {
    const h = await localHolder(key, cwd);
    if (h === "other") return "other";
    own ||= h === "session";
  }
  return own ? "session" : null;
}

/**
 * Кто слушает место: другая сессия, никто или мост не знает. Суждение то же, что у
 * iskron_stand (separate.ts): каталог — названный вызовом, иначе каталог стояния
 * или сессии; сокет прежнего моста этой сессии — своё, доска читает слушающим его (#6702).
 */
export async function askedHearing(
  realm: string,
  karta: string,
  name: string,
  cwd: string = H.standCwd ?? sessionCwd(),
): Promise<AskedHearing> {
  const local = await heldLocally(realm, karta, name, cwd);
  if (local === "other") return "other";
  if (local === "session") return "free";
  const b = await call(tool("channel"), { action: "list", realm }).catch(() => null);
  return boardHearing(b && !b.isError ? readBoard(b) : null, karta, name);
}

/**
 * Сырой connect, mint или register места, которое этот мост не ведёт, а слушает
 * другая сессия (или мост не знает): connect отнял бы его без take, register
 * подписал бы записи чужим местом. Отказ вслух; iskron_stand своё вернёт сам, а
 * у чужого встанет рядом.
 */
export async function rawSeatRefusal(msg: JsonRpcMessage): Promise<string | null> {
  if (msg?.method !== "tools/call" || msg.params?.name !== tool("channel")) return null;
  const a = msg.params.arguments ?? {};
  const action = String(a.action);
  if (!["connect", "mint", "register"].includes(action)) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const name = normName(a.name);
  // Роль не названа — та же неизвестность, что «agent»: место без роли не сличить ни с чем.
  const karta = seatKarta(realm, normKarta(a.karta) || "agent", name);
  if (!realm) return null;
  const agent = unresolvedAgent(karta, action);
  if (agent) return agent;
  if (ledHere(realm, karta, name)) return null;
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

/**
 * Место слушает сам этот мост — держит или переоткрывает свой сокет. Отнятое — не
 * его; оставленное словом (leave) — без слуха: его за это время могла взять
 * другая сессия, вернуть его — iskron_stand (deaf.ts).
 */
export function ledHere(realm: string, karta: string, name: string): boolean {
  if (holdsStanding(realm, karta, name)) return true;
  return (
    ledKey() === keyOf(realm, karta, name) &&
    !H.unheard && // вернулся тем же адресом без hello — адрес мог повернуть другой (deaf.ts)
    !wasEvicted(realm, karta, name) &&
    !isParked(realm, karta, name)
  );
}
