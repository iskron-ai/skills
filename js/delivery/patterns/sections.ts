// Разделы AGENTS.md репо, на которые ссылаются слова ритуалов (ядро shared/sections.ts, граф
// @nks/nks-dev, узел #9351): заголовок узнаётся по роду и цитируется как стоит — шаблонных
// заголовков слово не выдумывает. Первый совпавший заголовок рода.

export const SECTIONS = {
  /** Самопроверка этапа — слово пуша. */
  check: (h: string): boolean => /самопровер|self-check|self-review/i.test(h),
  /** Жизненный цикл сессии — слово мержа, рядом с разделом мержа. */
  lifecycle: (h: string): boolean => /жизненн\S* цикл|lifecycle/i.test(h),
  /** Акты после мержа — слово мержа. */
  merge: (h: string): boolean =>
    (/мерж|merge/i.test(h) && /граф|graph/i.test(h)) || /every merge/i.test(h),
  /** Пуш в ствол — слово мержа на пуше в main/master, прежде заголовка мержа (№2720). */
  trunk: (h: string): boolean => /пуш|push/i.test(h) && /main|master|ствол/i.test(h),
  /** Правила персистентности — отказ memory-guard. */
  persist: (h: string): boolean => /персистент|persistence/i.test(h),
} as const;
