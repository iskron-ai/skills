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

**Сперва найди CODEX_HOME, и не считай, что это `~/.codex`.** На 0.149.0-alpha.4.1 настоящий дом лежал в `~/Library/Application Support/orca/codex-runtime-home/home`, а `~/.codex` существовал рядом и хуков не держал вовсе. Спрашивай сам харнесс: `codex doctor` печатает CODEX_HOME строкой, вместе с путём до `config.toml`.

**Хуки объявляются в `hooks.json` в CODEX_HOME — файлом JSON, не секцией TOML.** `config.toml` при этом тоже несёт слово `hooks`, и на нём легко обмануться: там стоят таблицы `[hooks.state."<путь до hooks.json>:<событие>:0:0"]` — служебное состояние, ключом которого служит путь к самому hooks.json. Это следствие хуков, а не место, где их заводят: правка `config.toml` хука не создаёт.

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

Файла хуков нет. Эквивалент — **плагин**: JS/TS-файл в `.opencode/plugins/` (проект) или `~/.config/opencode/plugins/` (глобально), автозагружаемый на старте — по разу на каждую локацию сервиса. **Форма — OpenCode 2 (`@opencode/plugin` 2.0.4): default-экспорт объекта `{ id, setup(ctx) }`.** Прежняя форма 1.x — экспорт async-функции, возвращающей карту хуков `"tool.execute.before"` — загрузчиком 2.x отвергается (`Plugin must export a default definition with an id and an effect or setup function`; в логе сервиса — `failed to load plugin … SchemaError(Missing key at ["default"])`), и ритуалы молча не действуют. Импортов плагину не нужно: всё приходит в `ctx`.

```js
// .opencode/plugins/iskron-rituals.js — OpenCode 2
export default {
  id: "iskron-rituals",
  async setup(ctx) {
    // memory-guard: бросок из execute.before блокирует вызов
    await ctx.tool.hook("execute.before", (input) => {
      const path = input.input?.filePath ?? input.input?.path ?? "";
      if (["write", "edit"].includes(input.tool) && isLocalMemoryPath(path))
        throw new Error("local agent memory is forbidden for project state");
    });
    // push → граф: после shell-вызова с git push дописать напоминание в результат
    await ctx.tool.hook("execute.after", (input) => {
      if (input.tool !== "bash" || input.status !== "completed") return;
      if (!/git push/.test(String(input.input?.command ?? ""))) return;
      input.result.content = `${input.result.content}\n\n[iskron] пуш — не мерж; после мержа: ткачество, модусы, закрытие по оси, reconcile.`;
    });
    // ориентация: слово в новую сессию — ctx.event.subscribe даёт async-итерируемое событий
    const ac = new AbortController();
    (async () => {
      for await (const ev of await ctx.event.subscribe({ signal: ac.signal })) {
        if (ev.type === "session.created")
          await ctx.session.prompt({ sessionID: ev.properties.info.id, text: "Прочти раздел «Старт» скилла-двери iskron…", delivery: "queue" });
      }
    })().catch(() => {});
    return () => ac.abort(); // cleanup при выгрузке плагина
  },
};
```

`ctx.tool.hook("execute.before", …)` / `("execute.after", …)` оборачивают вызовы тулов — **throw из `execute.before` и есть блокировка**: memory-guard здесь — throw, не код выхода; в `execute.after` у завершившегося вызова (`status: "completed"`) поле `result` изменяемо. Форма события `session.created` и его `properties` — сверяй по типам пакета при апгрейде (`@opencode/schema/event`): названо по типам 2.0.4, живой прогон ритуалов на 2.x в этой поставке не делался. TUI у серверного плагина нет: слово человеку идёт промптом в сессию или в stderr сервиса. Ключ фронтматтера `slash: true` парсер 2.x отбрасывает: команды палитры «/» регистрирует плагин через `ctx.command.transform`.

Маппинг ритуалов: ориентация → `ctx.event.subscribe` на `session.created`; memory-guard → `ctx.tool.hook("execute.before")` с throw; push → граф → `ctx.tool.hook("execute.after")` по shell-тулу. Ролевые файлы суб-агентов: `.opencode/agents/` (см. `delegation.md`).

## Чек-лист перепроверки (мейнтейнерам)

Перепроверяй при апгрейдах харнессов, как interop-референс:

- **Claude Code** — путь settings, имена хук-событий, синтаксис импорта в `CLAUDE.md`.
- **Codex** — список событий `[hooks]` и форма TOML, source'ы `SessionStart`, имена файлов `AGENTS.md` / `AGENTS.override.md` и порядок их мержа.
- **OpenCode** — имена директорий плагинов (`.opencode/plugins/`), список событий, всё ли ещё `tool.execute.before` блокирует throw-ом.
- Харнесс, обретший или потерявший поверхность, меняет то, что iskronify может обещать: сначала обнови таблицу, затем Шаг 4.
