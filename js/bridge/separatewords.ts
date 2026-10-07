// Слова выбора места (separate.ts) на языке моста (shared/lang.ts, #6080):
// механика — в separate.ts; здесь только слова.
import { L } from "../shared/lang.ts";

export const SEP = {
  ownSession: (base: string): string =>
    L(
      `место ${base} держал прежний мост этой же сессии харнесса (перезапуск или компакшн) — своё место этой сессии, мост вернул его сам`,
      `the seat ${base} was held by a former bridge of this same harness session (a restart or a compaction) — this session's own seat, the bridge took it back itself`,
    ),
  beside: (base: string, name: string, own: boolean): string =>
    L(
      `место ${base} держит другая сессия — её место не трогаю и им не подписываюсь; встаю рядом на ${name} со слухом${own ? " (его держал прежний мост этой же сессии — вернул сам)" : ""}: это своё место, кадры по нему идут сюда; вытеснить ту сессию (take=true) — только словом человека`,
      `another session holds the seat ${base} — leaving its seat alone and not signing with it; standing beside as ${name} with hearing${own ? " (a former bridge of this same session held it — taken back)" : ""}: it is this session's own seat, its frames come here; evicting that session (take=true) — only on the human's word`,
    ),
  unknown: (name: string): string =>
    L(
      `Отказано (мост): доска разобрана не целиком — слушает ли место ${name} другая сессия, мост не знает; вслепую не встаю и take=true не советую. Повтори, когда доска прочтётся, либо назови другое name.`,
      `Refused (bridge): the board was not read in full — the bridge does not know whether another session listens on the seat ${name}; not standing blind and not advising take=true. Repeat when the board reads, or pass another name.`,
    ),
  noFree: (base: string): string =>
    L(
      `Отказано (мост): место ${base} держит другая сессия, и все места рядом ${base}.2…99 заняты — подписываться чужим местом без слуха мост не станет; прибери погасшие места либо назови другое name.`,
      `Refused (bridge): another session holds the seat ${base}, and every seat beside ${base}.2…99 is taken — the bridge will not sign with another's seat without hearing; clear the dead seats or pass another name.`,
    ),
};
