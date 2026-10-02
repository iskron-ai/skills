// Выход спутника из дел прогона и снятие его места (граф nks-dev: #6573, #6593).
//
// Спутник входит в дела строкой запуска (iskron_case join) и выходит концом
// поручения; прогон, оборванный без выхода, оставляет место в деле истекать
// сроком — «slop» в гроссбухе. Мост видит каждый iskron_case прогона и помнит
// её join'ы; на конце прогона (session.ts, windDown) он выходит из них сам —
// после отпуска сокета и .key, до revoke места, — тем же ходом iskron_case leave. Отказ не бьёт: дело
// закроется сроком места и без нас, слово — в журнал моста.
import { scoped } from "../shared/scope.ts";
import { callTool as call } from "./call.ts";
import { CFG } from "./config.ts";
import { extraPlaces } from "./places.ts";
import { canonRealm, otherRealm } from "./realms.ts";
import { log } from "./streams.ts";
import { type Standing, state } from "./transport.ts";
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

/** Дела прогона — в запись паузы спутника (suspend.ts): новый мост выйдет из них на конце. */
export const joinedCases = (): { realm?: string; room: string }[] => [...joined.values()];

/** Дела прогона, переданные паузой прежнего моста: этот мост их и покинет на конце. */
export function seedJoined(cases: { realm?: string; room: string }[] | undefined): void {
  for (const c of cases ?? [])
    if (c?.room) joined.set(`${c.realm ? canonRealm(c.realm) : ""}#${roomNo(c.room)}`, c);
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
  if (!(await underCap(Promise.allSettled(leaves))))
    log(
      `case leave at the run's end exceeded ${LEAVE_CAP_MS} ms — the place goes, the rest lapse by term`,
    );
}

/** Места спутника — основное и в других графах; снять до releaseStanding: оно стирает места рядом. */
export const satellitePlaces = (): Standing[] =>
  CFG.satellite
    ? [state.standing, ...extraPlaces().map((p) => p.standing)].filter(
        (s): s is Standing => !!s?.name,
      )
    : [];

/**
 * Снять места-спутники на конце прогона (#6550, правило 4; #6593): закрытый
 * сокет места с доски не снимает — только revoke либо срок канала. Каждое место
 * канала, и в других графах. Зовётся после releaseStanding и выхода из дел:
 * сокет уже отпущен, и закрытие 4001 некому принять за смерть токена.
 */
export async function revokeSatellitePlaces(places: Standing[]): Promise<void> {
  if (!places.length) return;
  const revokes = places.map((s) =>
    call("iskron_channel", { action: "revoke", realm: s.realm, karta: s.karta, standing: s.name })
      .then((r) =>
        log(
          r.isError
            ? `could not revoke ${s.name} at the run's end: ${r.text.slice(0, 120)}`
            : `revoked ${s.name} in ${s.realm} at the run's end (#6593)`,
        ),
      )
      .catch((e: Error) => log(`could not revoke ${s.name} at the run's end: ${e.message}`)),
  );
  if (!(await underCap(Promise.allSettled(revokes))))
    log(
      `revoke at the run's end exceeded ${LEAVE_CAP_MS} ms — the place lapses by the channel's term`,
    );
}

/** true — успело под потолком конца прогона. */
async function underCap(work: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<"cap">((r) => (timer = setTimeout(() => r("cap"), LEAVE_CAP_MS)));
  const got = await Promise.race([work, cap]);
  clearTimeout(timer);
  return got !== "cap";
}
