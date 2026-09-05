# Поверхности харнессов — куда реально ложатся ритуалы

iskronify доставляет **ритуалы** (ориентация на старте сессии, push → обновление графа, память вне локальных хранилищ). Каждый харнесс запускает их по-своему, и пути файлов не взаимозаменяемы. Прошивай поверхности используемого харнесса; никогда не пиши конфиг формата, о котором гадаешь.

| Харнесс | Читает | Нужен файл-указатель | Поверхность автоматизации |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | **да** — `CLAUDE.md` = `@AGENTS.md` | хуки в `.claude/settings.json` |
| Codex CLI | `AGENTS.md` | нет | `hooks.json` в CODEX_HOME |
| OpenCode | `AGENTS.md` | нет | плагины в `.opencode/plugins/` |

Определи до выбора: `.claude/` или кэш плагинов → Claude Code; `opencode.json` / `.opencode/` → OpenCode; `.codex/` или `~/.codex/` → Codex. Истинным может быть не одно — прошей каждый присутствующий харнесс; тело `AGENTS.md` общее.

## Claude Code

Читает `CLAUDE.md`, не `AGENTS.md` — отсюда однострочный указатель (`@AGENTS.md`-импорт; Шаг 7). Хуки живут в `.claude/settings.json`, коммитятся. Ролевые файлы суб-агентов: `.claude/agents/` (см. `delegation.md`). JSON хуков, события и команда memory-guard расписаны в Шаге 4 скилла.

## Codex CLI

**Читает `AGENTS.md` нативно — файл-указатель не создавать.** Обнаружение идёт от корня проекта вниз до cwd и мержит каждый найденный `AGENTS.md` поверх пользовательского `~/.codex/AGENTS.md`. `AGENTS.override.md` — локальный оверрайд с приоритетом над `AGENTS.md` той же директории: естественный дом машинно-локальных заметок; коммитить его нельзя.

**Сперва найди CODEX_HOME, и не считай, что это `~/.codex`.** Замерено на 0.149.0-alpha.4.1: настоящий дом лежал в `~/Library/Application Support/orca/codex-runtime-home/home`, а `~/.codex` существовал рядом и хуков не держал вовсе. Спрашивай сам харнесс: `codex doctor` печатает CODEX_HOME строкой, вместе с путём до `config.toml`.

**Хуки объявляются в `hooks.json` в CODEX_HOME — файлом JSON, не секцией TOML.** Наблюдено чтением живого файла на той же версии. `config.toml` при этом тоже несёт слово `hooks`, и на нём легко обмануться: там стоят таблицы `[hooks.state."<путь до hooks.json>:<событие>:0:0"]` — служебное состояние, ключом которого служит путь к самому hooks.json. Это следствие хуков, а не место, где их заводят: правка `config.toml` хука не создаёт.

Форма — событие, затем группы, в каждой список команд:

```json
{
  "hooks": {
    "PreToolUse": [
      { "hooks": [ { "type": "command", "command": "bash ./scripts/guard.sh", "timeout": 10 } ] }
    ]
  }
}
```

События, прочитанные в живом файле, — восемь и в CamelCase: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`. (В ключах `[hooks.state]` те же события пишутся snake_case — `pre_tool_use`; не перепутай регистры, объявление берёт CamelCase.) У команды наблюдены три поля: `type`, `command`, `timeout`. Ключа `matcher` в этом файле не было — из чего следует, что он необязателен, а не то, что его не бывает: сузить хук по тулу проверяй на своей версии, прежде чем на это опираться. Каждая команда получает JSON на stdin: `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`.

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
