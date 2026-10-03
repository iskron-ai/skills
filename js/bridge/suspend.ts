// Пауза спутника на перезагрузку плагина OpenCode (граф nks-dev: #6625; #6550,
// правило 3). Плагин, которого перезагружают, гасит мосты субагентов, а конец
// спутника выводит его из дел и снимает место (session.ts) — так перезагрузка
// кончала бы ребёнка, чьё поручение не кончено. Запрос `iskron/suspend` до
// остановки: мост пишет запись держания места-спутника (адрес сокета и дела
// прогона) и уходит, не выходя из дел, не снимая места и занятости. Мост нового
// экземпляра возвращает место по ключу (`iskron/resume`, resume.ts) и принимает
// дела прогона — на своём конце он их и покинет.
import { L } from "../shared/lang.ts";
import { scoped } from "../shared/scope.ts";
import { callTool as call } from "./call.ts";
import { joinedCases, seedJoined } from "./caseexit.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
import { parkStanding } from "./hold.ts";
import {
  HOLD_RECORD_MAX_AGE_MS,
  readHoldRecord,
  sessionOfBridge,
  writeHoldRecord,
} from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { placeFields } from "./placefields.ts";
import { sleep } from "./store.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

const S = scoped(() => ({ on: false }));

/** Мост ушёл на паузу: его конец — не конец прогона (session.ts). */
export const suspended = (): boolean => S.on;

/** `iskron/suspend` — только спутнику, держащему место; ответ — ключ записи паузы. */
export function localSuspend(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "iskron/suspend") return null;
  const answer = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: msg.id, result });
  const s = state.standing;
  const { currentKey: key, currentUrl: url, currentStatusUrl: statusUrl } = H;
  if (!CFG.satellite || !s?.name || !key || !url)
    return Promise.resolve(
      answer({
        suspended: false,
        word: L("места-спутника нет — паузы нет", "no satellite seat — nothing to pause"),
      }),
    );
  const cases = joinedCases();
  const write = () =>
    writeHoldRecord(
      key,
      {
        realm: s.realm,
        karta: s.karta,
        name: s.name ?? "",
        url: H.currentUrl ?? url,
        statusUrl: H.currentStatusUrl ?? statusUrl,
        client: harnessName(),
        key,
        session: sessionOfBridge() ?? undefined,
        cases,
      },
      true,
    );
  write(); // прежний адрес — сразу: мост, погашенный посреди перевзвода, оставит запись
  S.on = true;
  return rearmForPause(s).then((rearmed) => {
    if (rearmed) write();
    log(
      `satellite paused for a plugin reload: ${key}, cases ${cases.length} — place and cases kept, idle window ${rearmed ? `${PAUSE_TTL_S} s` : "unchanged"}`,
    );
    return answer({ suspended: true, key, cases: cases.length });
  });
}

/**
 * Окно простоя места на паузе — срок записи держания (#6550 п.3; #147 [140]): окно
 * спутника (SATELLITE_TTL_S, 300 с) погасило бы место перезагрузки дольше пяти минут.
 * ttl задаёт только connect, а он переиздаёт сокет и вытесняет живой (4000) — поэтому
 * сперва уход с сокета, затем connect; новый адрес держит мост и пишет запись. Отказ
 * или потолок — окно прежнее, место ждёт им.
 */
const PAUSE_TTL_S = Math.floor(HOLD_RECORD_MAX_AGE_MS / 1000);
const REARM_CAP_MS = 1_000;

async function rearmForPause(s: { realm: string; karta: string | number; name?: string | null }) {
  const name = s.name ?? "";
  if (!parkStanding(L("пауза спутника", "satellite pause"))) return false;
  const args = {
    action: "connect",
    realm: s.realm,
    karta: s.karta,
    name,
    ...placeFields({ realm: s.realm, karta: String(s.karta), name }),
    ttl_seconds: PAUSE_TTL_S,
  };
  const r = await Promise.race([
    call("iskron_channel", args),
    sleep(REARM_CAP_MS).then(() => null),
  ]);
  if (!r || r.isError) log(`satellite pause: idle window not re-armed — ${r?.text ?? "no answer"}`);
  return !!r && !r.isError && H.currentUrl !== null && !!H.holder;
}

/** Возврат по ключу удался: дела прогона из записи паузы — этому мосту. */
export function afterResume(key: string | undefined): void {
  if (!CFG.satellite || !key) return;
  seedJoined(readHoldRecord(key)?.cases);
}
