// Слова ритуалов поставки (граф @nks/nks-dev, узел #9319, раздел РИТУАЛЫ): напоминания пуша и
// мержа, которые хуки плагина Claude Code и модуль ритуалов плагина OpenCode дописывают к
// исходу вызова, и слово раннего входа онбординга (#8018); разделы — шаблона AGENTS.md
// iskronify. Слово старта и отказ memory-guard — PREPARE (одни слова на хук репо и поставку).
import type { Lang } from "../lang.ts";

export interface RiteWords {
  /** Заголовок раздела, на который ссылаются слова: стоит в теле AGENTS.md — язык слов ритуалов. */
  lifecycle: string;
  /** Пуш открыл или обновил PR. */
  push: () => string;
  /** Мерж форжи слил PR или ствол подтянут; holon — фокус-контур обложки, если назван. */
  merge: (holon?: string) => string;
  /** Старт, когда обложка называет только граф: контура и роли ещё нет — онбординг не окончен. */
  early: (graph: string) => string;
}

export const RITES: Readonly<Record<Lang, RiteWords>> = {
  ru: {
    lifecycle: "Жизненный цикл сессии",
    push: () =>
      "[iskron] пуш — не отгрузка: самопроверка диффа, словарный проход по тексту PR; ревью — раз на готовую пачку (AGENTS.md, «Самопроверка этапа» и раздел о ревью). Отгрузка — мерж.",
    merge: (holon) =>
      `[iskron] мерж — акты после мержа AGENTS.md («Жизненный цикл сессии», «Мерж → граф»): протки ${holon ? `контур #${holon}` : "контур"}, продвинь карту, модусы по свидетельству, закрой по оси, reconcile, словарный проход; фидбэк-рефлексия — если её велит AGENTS.md; работа по ссылке от агента — только семя превращения и модусы поставки.`,
    early: (graph) =>
      `[iskron] обложка AGENTS.md называет граф ${graph}, контура и роли агента в ней ещё нет — продолжи онбординг: ветвь «Первый граф» скилла iskronify, с недостающего шага; номеров контура и роли не выдумывай.`,
  },
  en: {
    lifecycle: "Session lifecycle",
    push: () =>
      "[iskron] a push ships nothing: self-check the diff, a vocabulary pass over the PR text; review — once per ready batch (AGENTS.md, «Stage self-check» and the review section). Shipping is the merge.",
    merge: (holon) =>
      `[iskron] merge — the after-merge acts of AGENTS.md («Session lifecycle», «Merge → graph»): weave ${holon ? `holon #${holon}` : "the holon"}, advance the map, modes by evidence, close along the axis, reconcile, vocabulary pass; feedback reflection — if AGENTS.md calls for it; work by reference from an agent — only the transformation seed and the delivery modes.`,
    early: (graph) =>
      `[iskron] the AGENTS.md cover names graph ${graph}, with no holon and agent role in it yet — continue the onboarding: the «First graph» branch of the iskronify skill, from the missing step; do not invent holon or role numbers.`,
  },
};
