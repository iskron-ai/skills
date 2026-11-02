// Слова ритуалов поставки (граф @nks/nks-dev, узел #9319, раздел РИТУАЛЫ): напоминания пуша и
// мержа, которые хуки плагина Claude Code и модуль ритуалов плагина OpenCode дописывают к
// исходу вызова; разделы — шаблона AGENTS.md iskronify. Слово старта и отказ memory-guard —
// PREPARE (одни слова на хук репо и поставку).
import type { Lang } from "../lang.ts";

export interface RiteWords {
  /** Пуш открыл или обновил PR. */
  push: () => string;
  /** Мерж форжи слил PR или ствол подтянут; holon — фокус-контур обложки, если назван. */
  merge: (holon?: string) => string;
}

export const RITES: Readonly<Record<Lang, RiteWords>> = {
  ru: {
    push: () =>
      "[iskron] пуш — не отгрузка: самопроверка диффа, словарный проход по тексту PR; ревью — раз на готовую пачку (AGENTS.md, «Самопроверка этапа» и раздел о ревью). Отгрузка — мерж.",
    merge: (holon) =>
      `[iskron] мерж — акты после мержа AGENTS.md («Жизненный цикл сессии», «Мерж → граф»): протки ${holon ? `контур #${holon}` : "контур"}, продвинь карту, модусы по свидетельству, закрой по оси, reconcile, фидбэк-рефлексия, словарный проход; работа по ссылке от агента — только семя превращения и модусы поставки.`,
  },
  en: {
    push: () =>
      "[iskron] a push ships nothing: self-check the diff, a vocabulary pass over the PR text; review — once per ready batch (AGENTS.md, «Stage self-check» and the review section). Shipping is the merge.",
    merge: (holon) =>
      `[iskron] merge — the after-merge acts of AGENTS.md («Session lifecycle», «Merge → graph»): weave ${holon ? `holon #${holon}` : "the holon"}, advance the map, modes by evidence, close along the axis, reconcile, feedback reflection, vocabulary pass; work by reference from an agent — only the transformation seed and the delivery modes.`,
  },
};
