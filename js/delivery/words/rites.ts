// Слова ритуалов поставки (граф @nks/nks-dev, узел #9319, раздел РИТУАЛЫ): напоминания пуша и
// мержа, которые хуки плагина Claude Code и модуль ритуалов плагина OpenCode дописывают к
// исходу вызова, и слово раннего входа онбординга (#8018); разделы — заголовки AGENTS.md репо,
// узнанные по роду (patterns/sections.ts, #9351), не узнан — AGENTS.md без раздела. Слово старта и отказ memory-guard — PREPARE (одни слова на хук репо и поставку).
import type { Lang } from "../lang.ts";

export interface RiteWords {
  /** Заголовок раздела, на который ссылаются слова: стоит в теле AGENTS.md — язык слов ритуалов. */
  lifecycle: () => string;
  /** Пуш открыл или обновил PR; check — заголовок самопроверки этапа в AGENTS.md репо, если узнан (#9351). */
  push: (check?: string) => string;
  /**
   * Мерж форжи слил PR, ствол подтянут или пуш ушёл в ствол; holon — фокус-контур обложки, если
   * назван; heads — заголовки жизненного цикла и мержа в AGENTS.md репо, какие узнаны (#9351).
   */
  merge: (holon?: string, ...heads: (string | undefined)[]) => string;
  /** Старт, когда обложка называет только граф: контура и роли ещё нет — онбординг не окончен. */
  early: (graph: string) => string;
}

/** Заголовки AGENTS.md как стоят, в кавычках, через запятую; ни одного — пусто. */
const cite = (heads: (string | undefined)[]): string =>
  heads
    .filter(Boolean)
    .map((h) => `«${h}»`)
    .join(", ");

export const RITES: Readonly<Record<Lang, RiteWords>> = {
  ru: {
    lifecycle: () => "Жизненный цикл сессии",
    push: (check) =>
      `[iskron] пуш — не отгрузка: самопроверка диффа, словарный проход по тексту PR; ревью — раз на готовую пачку (AGENTS.md${check ? `, «${check}» и раздел о ревью` : ""}). Отгрузка — мерж.`,
    merge: (holon, ...heads) =>
      `[iskron] мерж — акты после мержа AGENTS.md${cite(heads) ? ` (${cite(heads)})` : ""}: протки ${holon ? `контур #${holon}` : "контур"}, продвинь карту, модусы по свидетельству, закрой по оси, reconcile, словарный проход; фидбэк-рефлексия — если её велит AGENTS.md; работа по ссылке от агента — только семя превращения и модусы поставки.`,
    early: (graph) =>
      `[iskron] обложка AGENTS.md называет граф ${graph}, контура и роли агента в ней ещё нет — продолжи онбординг: ветвь «Первый граф» скилла iskronify, с недостающего шага; номеров контура и роли не выдумывай.`,
  },
  en: {
    lifecycle: () => "Session lifecycle",
    push: (check) =>
      `[iskron] a push ships nothing: self-check the diff, a vocabulary pass over the PR text; review — once per ready batch (AGENTS.md${check ? `, «${check}» and the review section` : ""}). Shipping is the merge.`,
    merge: (holon, ...heads) =>
      `[iskron] merge — the after-merge acts of AGENTS.md${cite(heads) ? ` (${cite(heads)})` : ""}: weave ${holon ? `holon #${holon}` : "the holon"}, advance the map, modes by evidence, close along the axis, reconcile, vocabulary pass; feedback reflection — if AGENTS.md calls for it; work by reference from an agent — only the transformation seed and the delivery modes.`,
    early: (graph) =>
      `[iskron] the AGENTS.md cover names graph ${graph}, with no holon and agent role in it yet — continue the onboarding: the «First graph» branch of the iskronify skill, from the missing step; do not invent holon or role numbers.`,
  },
};
