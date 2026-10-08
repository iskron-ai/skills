// Слова выбора места (граф @nks/nks-dev, узел #6706): своё место прежнего моста
// сессии, место рядом и отказы, когда встать некуда или доска не прочлась.
import type { Lang } from "../lang.ts";

/**
 * Кто держит base, когда мост встал рядом (#6976): live — живой мост другой сессии этого
 * дома гранта (та же роль, та же учётка); record — запись другой сессии этого дома, её мост
 * здесь не отвечает; board — только доска: роль та же, учётку сверяет делатель; null — неизвестно.
 */
export type Kin = "live" | "record" | "board" | null;

export interface SeparateWords {
  ownSession: (base: string) => string;
  /** own — место рядом держал прежний мост этой же сессии. */
  beside: (base: string, name: string, own: boolean, kin: Kin) => string;
  unknown: (name: string) => string;
  noFree: (base: string) => string;
}

const probeRu = (base: string): string =>
  `спроси её словом — iskron_channel(action="send", standing=${base}, text="жив? что держишь?") — и жди ответа до 5 минут: ответила — договоритесь, её дела не бери; молчит — iskron_stand(name=${base}, take=true) и войди в её дела (iskron_case(action="mine", standing=${base})); человека не спрашивай`;

const probeEn = (base: string): string =>
  `ask it by word — iskron_channel(action="send", standing=${base}, text="alive? what do you hold?") — and wait up to 5 minutes for the answer: it answered — agree, do not take its cases; it is silent — iskron_stand(name=${base}, take=true) and enter its cases (iskron_case(action="mine", standing=${base})); do not ask the human`;

const HOLDER_RU: Record<NonNullable<Kin>, string> = {
  live: "другая живая сессия твоего имени (та же роль, та же учётка)",
  record:
    "другая сессия твоего имени (та же роль, та же учётка; её мост здесь не отвечает — жива ли, скажет проба)",
  board: "другая сессия той же роли",
};

const HOLDER_EN: Record<NonNullable<Kin>, string> = {
  live: "another live session of your own name (the same role, the same account)",
  record:
    "another session of your own name (the same role, the same account; its bridge does not answer here — the probe tells whether it is alive)",
  board: "another session of the same role",
};

export const SEPARATE: Readonly<Record<Lang, SeparateWords>> = {
  ru: {
    ownSession: (base) =>
      `место ${base} держал прежний мост этой же сессии харнесса (перезапуск или компакшн) — своё место этой сессии, мост вернул его сам`,
    beside: (base, name, own, kin) =>
      `место ${base} держит ${kin ? HOLDER_RU[kin] : "другая сессия"} — её место не трогаю и им не подписываюсь; встаю рядом на ${name} со слухом${own ? " (его держал прежний мост этой же сессии — вернул сам)" : ""}: это своё место, кадры по нему идут сюда; ` +
      (kin === "board"
        ? `учётку держателя сверь по доске с адресом своего места: та же — ${probeRu(base)}; другая — вытеснить ту сессию (take=true) только словом человека`
        : kin
          ? probeRu(base)
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
      `${kin ? HOLDER_EN[kin] : "another session"} holds the seat ${base} — leaving its seat alone and not signing with it; standing beside as ${name} with hearing${own ? " (a former bridge of this same session held it — taken back)" : ""}: it is this session's own seat, its frames come here; ` +
      (kin === "board"
        ? `check the holder's account on the board against your own seat's address: the same — ${probeEn(base)}; another — evicting that session (take=true) only on the human's word`
        : kin
          ? probeEn(base)
          : "evicting that session (take=true) — only on the human's word"),
    unknown: (name) =>
      `Refused (bridge): the board was not read in full — the bridge does not know whether another session listens on the seat ${name}; not standing blind and not advising take=true. Repeat when the board reads, or pass another name.`,
    noFree: (base) =>
      `Refused (bridge): another session holds the seat ${base}, and every seat beside ${base}.2…99 is taken — the bridge will not sign with another's seat without hearing; clear the dead seats or pass another name.`,
  },
};
