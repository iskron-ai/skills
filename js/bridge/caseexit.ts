// Выход спутника из дел прогона (граф nks-dev: #6573).
//
// Спутник входит в дела строкой запуска (iskron_case join) и выходит концом
// поручения; прогон, оборванный без выхода, оставляет место в деле истекать
// сроком — «slop» в гроссбухе. Мост видит каждый iskron_case прогона и помнит
// её join'ы; на конце прогона (session.ts, windDown) он выходит из них сам,
// пока место живо, — тем же ходом iskron_case leave. Отказ не бьёт: дело
// закроется сроком места и без нас, слово — в журнал моста.
import { scoped } from "../shared/scope.ts";
import { callTool as call } from "./call.ts";
import { CFG } from "./config.ts";
import { canonRealm, otherRealm } from "./realms.ts";
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Все выходы конца прогона — под одним потолком: харнес гасит мост по короткой отсрочке. */
const LEAVE_CAP_MS = Number(process.env.ISKRON_CASE_LEAVE_MS) || 1_500;

/** Дела прогона — у сессии (демон держит многих): ключ — граф и номер без знака. */
const joined = scoped(() => new Map<string, { realm?: string; room: string }>());

/** «#102», «№102», « 102 » — один номер; id дела — как есть. */
const roomNo = (room: string): string => room.replace(/^[#№]\s*/, "");

/** Успешный ход iskron_case прогона: join запоминает дело, leave снимает. */
export function noteCaseEntry(name: unknown, args: unknown, reply: JsonRpcMessage): void {
  if (reply.result?.isError || (name !== "iskron_case" && name !== "iskron_room")) return;
  const a = (args ?? {}) as Record<string, unknown>;
  if (a.action !== "join" && a.action !== "leave") return;
  const room = typeof a.room === "string" ? a.room.trim() : "";
  if (!room || (a.action === "join" && room.startsWith("-"))) return;
  const realm = typeof a.realm === "string" ? a.realm : undefined;
  const no = roomNo(room);
  // Тот же номер в графе, не известном как другой (r5 и @nks/nks-dev до hello), — то же дело.
  for (const [k, c] of joined)
    if (roomNo(c.room) === no && !otherRealm(c.realm, realm)) joined.delete(k);
  if (a.action === "join") joined.set(`${realm ? canonRealm(realm) : ""}#${no}`, { realm, room });
}

/**
 * Выйти из дел прогона — на конце прогона спутника, прежде чем место уйдёт
 * (#6573): разом и под общим потолком — невышедшее закроется сроком места.
 * Только мост-спутник: место сессии переживает её и возвращается.
 */
export async function leaveJoinedCases(): Promise<void> {
  if (!CFG.satellite || !joined.size) return;
  const cases = [...joined.values()];
  joined.clear();
  const leaves = cases.map(async (c) => {
    try {
      const r = await call("iskron_case", { action: "leave", ...c });
      log(
        r.isError
          ? `could not leave case ${c.room} at the run's end: ${r.text.slice(0, 120)}`
          : `left case ${c.room} at the run's end (#6573)`,
      );
    } catch (e) {
      log(`could not leave case ${c.room} at the run's end: ${(e as Error).message}`);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<"cap">((r) => (timer = setTimeout(() => r("cap"), LEAVE_CAP_MS)));
  const got = await Promise.race([Promise.allSettled(leaves), cap]);
  clearTimeout(timer);
  if (got === "cap")
    log(
      `case leave at the run's end exceeded ${LEAVE_CAP_MS} ms — the place goes, the rest lapse by term`,
    );
}
