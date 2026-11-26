// Слова предела строки харнеса (граф @nks/nks-dev, узел #11416): ответ сервера длиннее
// строки, которую читает stdio-клиент харнеса, мост не пишет — отвечает этим отказом.
import type { Lang } from "../lang.ts";

export interface LineLimitWords {
  /** size и limit — мегабайты строкой, как их печатает ядро. */
  tooLong: (size: string, limit: string) => string;
}

export const LINE_LIMIT: Readonly<Record<Lang, LineLimitWords>> = {
  ru: {
    tooLong: (size, limit) =>
      `ответ сервера — ${size} МБ, больше предела строки харнеса (${limit} МБ); мост его не передал, чтобы не оборвать транспорт MCP. Ничего не сломалось: следующие вызовы идут как прежде. Вызов дошёл до сервера и исполнен — запись, если это была запись, применена; перечитай цель, прежде чем повторять. Сузь вызов: один граф вместо realm="*", fold=true, limit`,
  },
  en: {
    tooLong: (size, limit) =>
      `the server's answer is ${size} MB, over the harness's line limit (${limit} MB); the bridge did not pass it on, so as not to break the MCP transport. Nothing broke: the next calls go as before. The call reached the server and was carried out — a write, if it was one, is applied; re-read the target before retrying. Narrow the call: one graph instead of realm="*", fold=true, limit`,
  },
};
