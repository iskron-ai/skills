# Поверхности харнессов — куда реально ложатся ритуалы

iskronify доставляет **ритуалы** (ориентация на старте сессии, push → обновление графа, память вне локальных хранилищ). Каждый харнесс запускает их по-своему, и пути файлов не взаимозаменяемы. Прошивай поверхности используемого харнесса; никогда не пиши конфиг формата, о котором гадаешь.

| Харнесс | Читает | Нужен файл-указатель | Поверхность автоматизации |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | **да** — `CLAUDE.md` = `@AGENTS.md` | хуки в `.claude/settings.json` |
| Codex CLI | `AGENTS.md` | нет | `[hooks]` в `config.toml` |
| OpenCode | `AGENTS.md` | нет | плагины в `.opencode/plugins/` |

Определи до выбора: `.claude/` или кэш плагинов → Claude Code; `opencode.json` / `.opencode/` → OpenCode; `.codex/` или `~/.codex/` → Codex. Истинным может быть не одно — прошей каждый присутствующий харнесс; тело `AGENTS.md` общее.

## Claude Code

Читает `CLAUDE.md`, не `AGENTS.md` — отсюда однострочный указатель (`@AGENTS.md`-импорт; Шаг 7). Хуки живут в `.claude/settings.json`, коммитятся. Ролевые файлы суб-агентов: `.claude/agents/` (см. `delegation.md`). JSON хуков, события и команда memory-guard расписаны в Шаге 4 скилла.

## Codex CLI

**Читает `AGENTS.md` нативно — файл-указатель не создавать.** Обнаружение идёт от корня проекта вниз до cwd и мержит каждый найденный `AGENTS.md` поверх пользовательского `~/.codex/AGENTS.md`. `AGENTS.override.md` — локальный оверрайд с приоритетом над `AGENTS.md` той же директории: естественный дом машинно-локальных заметок; коммитить его нельзя.

**Формат хуков — открытый вопрос, и здесь он назван, а не замят.** Ниже стоит `[hooks]` в `config.toml`; строки самого бинаря Codex (0.149.0-alpha.4.1, наблюдены `strings` на этой машине) вместо этого показывают путь `hooks/hooks.json` и жалобы вида «failed to parse hooks config». Свидетельства расходятся, и косвенное не бьёт прямое: прежде чем писать хуки этому харнессу, **сверься с его собственной поверхностью** — `codex --help`, `codex doctor`, его доки той версии, что стоит у тебя, — и поправь эту секцию тем же ходом. Пример ниже держи указателем на форму, не свидетельством о пути.

Хуки объявляются под `[hooks]` в `config.toml` (проектный конфиг, с пользовательскими оверрайдами) массивами таблиц — группа-матчер, затем её команды:

```toml
[[PreToolUse]]
matcher = "^Bash$"

[[PreToolUse.hooks]]
type = "command"
command = "bash ./scripts/guard.sh"
command_windows = "powershell -File .\\scripts\\guard.ps1"
timeout = 10
statusMessage = "checking"
```

События: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`. Каждая команда получает JSON на stdin: `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`.

`SessionStart` несёт ещё и **source** — `startup`, `resume`, `clear`, `compact` — и именно против source матчится `matcher`. Ориентации-на-старте обычно нужны только `startup` и `resume`; матч всех четырёх пере-запускает ритуал после каждой компакции.

Маппинг ритуалов: ориентация → `SessionStart`; memory-guard → `PreToolUse` по пишущему тулу; push → граф → `PostToolUse` по shell-тулу.

## OpenCode

**Читает `AGENTS.md` нативно — без указателя.** Дополнительные файлы правил перечисляются в `instructions` в `opencode.json` (проект) или `~/.config/opencode/opencode.json` (глобально), глобы разрешены — используй это, чтобы переиспользовать существующие файлы правил, а не копировать их в `AGENTS.md`.

Файла хуков нет. Эквивалент — **плагин**: JS/TS-файл в `.opencode/plugins/` (проект) или `~/.config/opencode/plugins/` (глобально), автозагружаемый на старте. Плагин экспортирует async-функцию, возвращающую обработчики:

```js
export const MemoryGuard = async ({ project, client, $, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      // throwing blocks the call — this is the guard mechanism
      if (input.tool === "write" && isLocalMemoryPath(output.args.filePath))
        throw new Error("local agent memory is forbidden for project state")
    },
    event: async ({ event }) => {
      if (event.type === "session.created") { /* orient reminder */ }
    },
  }
}
```

`tool.execute.before` / `tool.execute.after` оборачивают вызовы тулов — **throw из `before` и есть блокировка**: memory-guard здесь — throw, не код выхода. Остальное приходит через `event`, включая `session.created`, `session.idle`, `session.compacted`, `file.edited`, `permission.asked`.

Маппинг ритуалов: ориентация → `event` на `session.created`; memory-guard → `tool.execute.before` с throw; push → граф → `tool.execute.after` по shell-тулу. Ролевые файлы суб-агентов: `.opencode/agents/` (см. `delegation.md`).

## Чек-лист перепроверки (мейнтейнерам)

Перепроверяй при апгрейдах харнессов, как interop-референс:

- **Claude Code** — путь settings, имена хук-событий, синтаксис импорта в `CLAUDE.md`.
- **Codex** — список событий `[hooks]` и форма TOML, source'ы `SessionStart`, имена файлов `AGENTS.md` / `AGENTS.override.md` и порядок их мержа.
- **OpenCode** — имена директорий плагинов (`.opencode/plugins/`), список событий, всё ли ещё `tool.execute.before` блокирует throw-ом.
- Харнесс, обретший или потерявший поверхность, меняет то, что iskronify может обещать: сначала обнови таблицу, затем Шаг 4.
