// Пауза спутника и её запись (граф nks-dev: #6625; #6550, правило 3; дело №151).
// Конец спутника выводит его из дел и снимает место (runend.ts); пауза держит их до
// моста, который вернёт место по ключу записи (resume.ts) и примет дела прогона.
// Видов два. `suspend` — слово харнеса (`iskron/suspend`, suspend.ts): возврат ждётся
// окном паузы. `handover` — передача демона преемнику при живом тонком мосте
// (daemon.ts): мост ушёл или умер в окне передачи — возвращать некому, и прогон
// кончается, как без паузы (runend.ts, endUnreturnedPause).
import { scoped } from "../shared/scope.ts";
import { joinedCases } from "./caseexit.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
import { sessionOfBridge, writeHoldRecord } from "./holdrecord.ts";
import { H } from "./holdstate.ts";
import { log } from "./streams.ts";
import { state } from "./transport.ts";

export type PauseKind = "suspend" | "handover";

export const P = scoped(() => ({
  kind: null as PauseKind | null,
  /** ответ паузы — повторному запросу (пауза уже стоит, место отпущено) */
  answer: null as { key: string; cases: number } | null,
  /** адрес, который повернул connect перевзвода (и проигравший потолок — тоже) */
  turned: null as { url: string; statusUrl: string | null } | null,
  /** адрес, записанный в запись паузы последним */
  written: "",
  write: null as (() => void) | null,
  connect: null as Promise<unknown> | null,
}));

/** Мост ушёл на паузу: его конец — не конец прогона (session.ts). */
export const suspended = (): boolean => P.kind !== null;

/** Ключ места на паузе передачи — или null (паузы нет, либо харнес её подтвердил). */
export const handoverPauseKey = (): string | null =>
  P.kind === "handover" ? (P.answer?.key ?? null) : null;

/**
 * Передача демона преемнику, а мост спутника жив (daemon.ts): место, дела и занятость
 * ждут его в новой сессии; сокет места не паркуется и не перевзводится — его держит
 * передача до вытеснения преемником (handoff.ts), окно простоя — прежнее.
 */
export function pauseForHandover(why: string): void {
  if (P.kind) return;
  const key = pauseRecord("handover");
  if (key)
    log(
      `satellite paused for the daemon handover (${why}): ${key}, cases ${P.answer?.cases ?? 0} — place and cases kept`,
    );
}

/**
 * Запись паузы места-спутника: адрес сокета и дела прогона — свежие на каждой записи
 * (вход в дело, ответивший после паузы, ложится при переписи на конце). Ключ — или null.
 */
export function pauseRecord(kind: PauseKind): string | null {
  const s = state.standing;
  const { currentKey: key, currentUrl: url, currentStatusUrl: statusUrl } = H;
  if (!CFG.satellite || !s?.name || !key || !url) return null;
  const write = () => {
    const at = P.turned ?? { url, statusUrl };
    const cases = joinedCases();
    P.written = at.url;
    P.answer = { key, cases: cases.length };
    writeHoldRecord(
      key,
      {
        realm: s.realm,
        karta: s.karta,
        name: s.name ?? "",
        url: at.url,
        statusUrl: at.statusUrl,
        client: harnessName(),
        key,
        session: sessionOfBridge() ?? undefined,
        cases,
      },
      true,
    );
  };
  P.write = write;
  write(); // прежний адрес — сразу: мост, погашенный посреди перевзвода, оставит запись
  P.kind = kind;
  return key;
}
