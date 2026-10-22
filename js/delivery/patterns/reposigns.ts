// Признаки выравнивания репозитория под агента (ядро shared/reposigns.ts): что iskronify
// оставляет в репо — обложку AGENTS.md и штамп (ключи и штамп по языкам — COVER), хук старта.
// Хук старта iskronify ставит только Claude Code (запись SessionStart с меткой) и OpenCode
// (плагин ритуалов); Codex и pi его не получают (skills/iskronify/references/hooks.md,
// harness-surfaces.md). Соседняя поставка называет свои.

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
} as const;
