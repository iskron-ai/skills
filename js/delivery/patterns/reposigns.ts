// Признаки выравнивания репозитория под агента (ядро shared/reposigns.ts): что iskronify
// оставляет в репо — обложку AGENTS.md (ключи — COVER), хук старта и штамп. Хук старта
// iskronify ставит только Claude Code (запись SessionStart с меткой) и OpenCode (плагин
// ритуалов); Codex и pi его не получают (skills/iskronify/references/hooks.md,
// harness-surfaces.md); штамп — строка шаблона
// (skills/iskronify/references/agents-template.md). Соседняя поставка называет свои.

export const REPO_SIGNS = {
  /** Настройки Claude Code репо: хук старта — запись hooks.SessionStart. */
  settings: ".claude/settings.json",
  /**
   * Метка хука старта iskronify: строка зовёт «Старт» двери iskron — «iskron door» в
   * английской проекции (hooks.md), «двери iskron» / «скилла-двери iskron» в русской
   * (harness-surfaces.md). Прочее имя продукта в команде (iskron_orient, чужой набор) — не метка.
   */
  startMark: /\biskron door\b|двер[иь]\s+iskron\b/i,
  /** Плагин ритуалов OpenCode, который ставит iskronify. */
  rituals: ".opencode/plugins/iskron-rituals.js",
  /** Штамп iskronify в файле обложки: «(iskronify: контракт N, штамп …». */
  stamp: /\(iskronify:\s*контракт\s*`?\d+`?\s*,\s*штамп/,
} as const;
