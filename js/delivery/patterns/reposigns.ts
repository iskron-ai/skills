// Признаки выравнивания репозитория под агента (ядро shared/reposigns.ts): что iskronify
// оставляет в репо — обложку AGENTS.md (ключи — COVER), хук старта и штамп. Хук старта —
// запись SessionStart Claude Code, называющая дверь поставки, либо плагин ритуалов OpenCode
// (skills/iskronify/references/hooks.md, harness-surfaces.md); штамп — строка шаблона
// (skills/iskronify/references/agents-template.md). Соседняя поставка называет свои.

export const REPO_SIGNS = {
  /** Настройки Claude Code репо: хук старта — запись hooks.SessionStart. */
  settings: ".claude/settings.json",
  /** Команда хука старта называет дверь поставки. */
  startMark: /iskron/i,
  /** Плагин ритуалов OpenCode, который ставит iskronify. */
  rituals: ".opencode/plugins/iskron-rituals.js",
  /** Штамп iskronify в файле обложки: «(iskronify: контракт N, штамп …». */
  stamp: /\(iskronify:\s*контракт\s*`?\d+`?\s*,\s*штамп/,
} as const;
