// Пауза спутника на перезагрузку плагина OpenCode (граф nks-dev: #6625; #6550,
// правило 3). Плагин, которого перезагружают, гасит мосты субагентов, а конец
// спутника выводит его из дел и снимает место (session.ts) — так перезагрузка
// кончала бы ребёнка, чьё поручение не кончено. Запрос `iskron/suspend` до
// остановки: мост пишет запись держания места-спутника (адрес сокета и дела
// прогона) и уходит, не выходя из дел, не снимая места и занятости. Мост нового
// экземпляра возвращает место по ключу (`iskron/resume`, resume.ts) и принимает
// дела прогона — на своём конце он их и покинет.
import { scoped } from "../shared/scope.ts";
import { joinedCases, seedJoined } from "./caseexit.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
import { readHoldRecord, sessionOfBridge, writeHoldRecord } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
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
    return Promise.resolve(answer({ suspended: false, word: "места-спутника нет — паузы нет" }));
  const cases = joinedCases();
  writeHoldRecord(
    key,
    {
      realm: s.realm,
      karta: s.karta,
      name: s.name,
      url,
      statusUrl,
      client: harnessName(),
      key,
      session: sessionOfBridge() ?? undefined,
      cases,
    },
    true,
  );
  S.on = true;
  log(`satellite paused for a plugin reload: ${key}, cases ${cases.length} — place and cases kept`);
  return Promise.resolve(answer({ suspended: true, key, cases: cases.length }));
}

/** Возврат по ключу удался: дела прогона из записи паузы — этому мосту. */
export function afterResume(key: string | undefined): void {
  if (!CFG.satellite || !key) return;
  seedJoined(readHoldRecord(key)?.cases);
}
