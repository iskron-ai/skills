// Выход спутника из дел прогона (граф nks-dev: #6573).
//
// Спутник входит в дела строкой запуска (iskron_case join) и выходит концом
// поручения; прогон, оборванный без выхода, оставляет место в деле истекать
// сроком — «slop» в гроссбухе. Мост видит каждый iskron_case прогона и помнит
// её join'ы; на конце прогона (session.ts, windDown) он выходит из них сам,
// пока место живо, — тем же ходом iskron_case leave. Отказ не бьёт: дело
// закроется сроком места и без нас, слово — в журнал моста.
import { callTool as call } from "./call.ts";
import { CFG } from "./config.ts";
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Дела прогона: ключ — граф плюс номер, как их назвал join. */
const joined = new Map<string, { realm?: string; room: string }>();

/** Успешный ход iskron_case прогона: join запоминает дело, leave снимает. */
export function noteCaseEntry(name: unknown, args: unknown, reply: JsonRpcMessage): void {
  if (reply.result?.isError || (name !== "iskron_case" && name !== "iskron_room")) return;
  const a = (args ?? {}) as Record<string, unknown>;
  if (a.action !== "join" && a.action !== "leave") return;
  const room = typeof a.room === "string" ? a.room.trim() : "";
  if (!room || (a.action === "join" && room.startsWith("-"))) return;
  const realm = typeof a.realm === "string" ? a.realm : undefined;
  const key = `${realm ?? ""}#${room}`;
  if (a.action === "join") joined.set(key, { realm, room });
  else joined.delete(key);
}

/**
 * Выйти из дел прогона — на конце прогона спутника, прежде чем место уйдёт
 * (#6573). Только мост-спутник: место сессии переживает её и возвращается.
 */
export async function leaveJoinedCases(): Promise<void> {
  if (!CFG.satellite || !joined.size) return;
  const cases = [...joined.values()];
  joined.clear();
  for (const c of cases) {
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
  }
}
