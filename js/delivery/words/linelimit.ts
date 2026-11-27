// Слова предела строки харнеса (граф @nks/nks-dev, узел #11416): ответ сервера длиннее
// строки, которую читает stdio-клиент харнеса, мост не пишет — отвечает этим отказом.
// Исход в отказе: результат исполнен, отказ мог примениться частично, ошибка — нет.
import type { Lang } from "../lang.ts";

/** Что было в срезанном ответе: результат, результат-отказ (isError) или ошибка JSON-RPC. */
export type LineCut =
  { kind: "result" } | { kind: "refusal" } | { kind: "error"; code: number | string };

export interface LineLimitWords {
  /** size и limit — мегабайты строкой, как их печатает ядро. */
  tooLong: (size: string, limit: string, cut: LineCut) => string;
}

const ruVerdict = (cut: LineCut): string => {
  if (cut.kind === "result")
    return "Вызов дошёл до сервера и исполнен — запись, если это была запись, применена; перечитай цель, прежде чем повторять";
  if (cut.kind === "refusal")
    return "Сервер ответил отказом, слишком длинным, чтобы его показать: часть вызова могла примениться (пачка отказывает и после части своих записей) — перечитай цель, прежде чем повторять";
  return `Сервер ответил ошибкой JSON-RPC (код ${cut.code}), слишком длинной, чтобы её показать: этим вызовом ничего не применено`;
};

const enVerdict = (cut: LineCut): string => {
  if (cut.kind === "result")
    return "The call reached the server and was carried out — a write, if it was one, is applied; re-read the target before retrying";
  if (cut.kind === "refusal")
    return "The server answered with a refusal too long to show: part of the call may have been applied (a batch can refuse after some of its writes) — re-read the target before retrying";
  return `The server answered with a JSON-RPC error (code ${cut.code}) too long to show: nothing was applied by this call`;
};

export const LINE_LIMIT: Readonly<Record<Lang, LineLimitWords>> = {
  ru: {
    tooLong: (size, limit, cut) =>
      `ответ сервера — ${size} МБ, больше предела строки харнеса (${limit} МБ); мост его не передал, чтобы не оборвать транспорт MCP. Ничего не сломалось: следующие вызовы идут как прежде. ${ruVerdict(cut)}. Сузь вызов: один граф вместо realm="*", fold=true, limit`,
  },
  en: {
    tooLong: (size, limit, cut) =>
      `the server's answer is ${size} MB, over the harness's line limit (${limit} MB); the bridge did not pass it on, so as not to break the MCP transport. Nothing broke: the next calls go as before. ${enVerdict(cut)}. Narrow the call: one graph instead of realm="*", fold=true, limit`,
  },
};
