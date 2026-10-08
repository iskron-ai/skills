// Слова выбора места (граф @nks/nks-dev, узел #6706): своё место прежнего моста
// сессии, место рядом и отказы, когда встать некуда или доска не прочлась.
import type { Lang } from "../lang.ts";

export interface SeparateWords {
  ownSession: (base: string) => string;
  /**
   * own — место рядом держал прежний мост этой же сессии; kin — base держит живая сессия
   * своего имени (та же роль, тот же дом гранта): проба словом, по молчанию take (#6976).
   */
  beside: (base: string, name: string, own: boolean, kin: boolean) => string;
  unknown: (name: string) => string;
  noFree: (base: string) => string;
}

export const SEPARATE: Readonly<Record<Lang, SeparateWords>> = {
  ru: {
    ownSession: (base) =>
      `место ${base} держал прежний мост этой же сессии харнесса (перезапуск или компакшн) — своё место этой сессии, мост вернул его сам`,
    beside: (base, name, own, kin) =>
      `место ${base} держит ${kin ? "другая живая сессия твоего имени (та же роль, та же учётка)" : "другая сессия"} — её место не трогаю и им не подписываюсь; встаю рядом на ${name} со слухом${own ? " (его держал прежний мост этой же сессии — вернул сам)" : ""}: это своё место, кадры по нему идут сюда; ` +
      (kin
        ? `спроси её словом — iskron_channel(action="send", standing=${base}, text="жив? что держишь?") — и жди ответа до 5 минут: ответила — договоритесь, её дела не бери; молчит — iskron_stand(name=${base}, take=true) и войди в её дела (iskron_case(action="mine", standing=${base})); человека не спрашивай`
        : "вытеснить ту сессию (take=true) — только словом человека"),
    unknown: (name) =>
      `Отказано (мост): доска разобрана не целиком — слушает ли место ${name} другая сессия, мост не знает; вслепую не встаю и take=true не советую. Повтори, когда доска прочтётся, либо назови другое name.`,
    noFree: (base) =>
      `Отказано (мост): место ${base} держит другая сессия, и все места рядом ${base}.2…99 заняты — подписываться чужим местом без слуха мост не станет; прибери погасшие места либо назови другое name.`,
  },
  en: {
    ownSession: (base) =>
      `the seat ${base} was held by a former bridge of this same harness session (a restart or a compaction) — this session's own seat, the bridge took it back itself`,
    beside: (base, name, own, kin) =>
      `${kin ? "another live session of your own name (the same role, the same account)" : "another session"} holds the seat ${base} — leaving its seat alone and not signing with it; standing beside as ${name} with hearing${own ? " (a former bridge of this same session held it — taken back)" : ""}: it is this session's own seat, its frames come here; ` +
      (kin
        ? `ask it by word — iskron_channel(action="send", standing=${base}, text="alive? what do you hold?") — and wait up to 5 minutes for the answer: it answered — agree, do not take its cases; it is silent — iskron_stand(name=${base}, take=true) and enter its cases (iskron_case(action="mine", standing=${base})); do not ask the human`
        : "evicting that session (take=true) — only on the human's word"),
    unknown: (name) =>
      `Refused (bridge): the board was not read in full — the bridge does not know whether another session listens on the seat ${name}; not standing blind and not advising take=true. Repeat when the board reads, or pass another name.`,
    noFree: (base) =>
      `Refused (bridge): another session holds the seat ${base}, and every seat beside ${base}.2…99 is taken — the bridge will not sign with another's seat without hearing; clear the dead seats or pass another name.`,
  },
};
