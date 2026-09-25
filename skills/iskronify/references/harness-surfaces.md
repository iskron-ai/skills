# Поверхности харнессов — куда реально ложатся ритуалы

iskronify доставляет **ритуалы** (ориентация на старте сессии, пуш — холодное ревью этапа, мерж — обновление графа, память вне локальных хранилищ). Каждый харнесс запускает их по-своему, и пути файлов не взаимозаменяемы. Прошивай поверхности используемого харнесса; никогда не пиши конфиг формата, о котором гадаешь.

| Харнесс | Читает | Нужен файл-указатель | Поверхность автоматизации |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | **да** — `CLAUDE.md` = `@AGENTS.md` | хуки в `.claude/settings.json` |
| Codex CLI | `AGENTS.md` | нет | `hooks.json` в CODEX_HOME — вне worktree, не прошивается; ритуалы держит проза AGENTS.md |
| OpenCode | `AGENTS.md` | нет | плагин в `.opencode/plugins/` проекта |

Определи до выбора: `.claude/` или кэш плагинов → Claude Code; `opencode.json` / `.opencode/` → OpenCode; `.codex/` или `~/.codex/` → Codex. Истинным может быть не одно — прошей каждый присутствующий харнесс; тело `AGENTS.md` общее.

## Claude Code

Читает `CLAUDE.md`, не `AGENTS.md` — отсюда однострочный указатель (`@AGENTS.md`-импорт; Шаг 7). Хуки живут в `.claude/settings.json`, коммитятся. Ролевые файлы суб-агентов: `.claude/agents/` (см. `delegation.md`). JSON хуков, события и команда memory-guard расписаны в Шаге 4 скилла.

## Codex CLI

**Читает `AGENTS.md` нативно — файл-указатель не создавать.** Обнаружение идёт от корня проекта вниз до cwd и мержит каждый найденный `AGENTS.md` поверх пользовательского `~/.codex/AGENTS.md`. Пользовательский файл поведение агента не настраивает (Шаг 1). `AGENTS.override.md` — локальный оверрайд с приоритетом над `AGENTS.md` той же директории: естественный дом машинно-локальных заметок; коммитить его нельзя.

**Сперва найди CODEX_HOME, и не считай, что это `~/.codex`.** На 0.149.0-alpha.4.1 настоящий дом лежал в `~/Library/Application Support/orca/codex-runtime-home/home`, а `~/.codex` существовал рядом и хуков не держал вовсе. Спрашивай сам харнесс: `codex doctor` печатает CODEX_HOME строкой, вместе с путём до `config.toml`.

**Хуки CODEX_HOME — вне worktree, и iskronify их не прошивает** (Шаг 1): они машинно-локальны, и ритуалы Codex держит проза «Жизненный цикл сессии» в AGENTS.md. У 0.151 в бинаре есть источник хуков `project` с доверием проекту, но путь файла проекта своими руками не наблюдался — наблюдай на своей версии прежде, чем прошивать; до тех пор ниже — форма, по которой читать и чинить уже стоящее.

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

Маппинг ритуалов: ориентация → `SessionStart`; memory-guard → `PreToolUse` по пишущему тулу; пуш и мерж → `PostToolUse` по shell-тулу, одной строкой каждый.

## OpenCode

**Читает `AGENTS.md` нативно — без указателя.** Дополнительные файлы правил перечисляются в `instructions` в `opencode.json` проекта (глобальный `~/.config/opencode/opencode.json` поведение агента не настраивает — Шаг 1), глобы разрешены — используй это, чтобы переиспользовать существующие файлы правил, а не копировать их в `AGENTS.md`.

Файла хуков нет. Эквивалент — **плагин**: JS/TS-файл в `.opencode/plugins/` проекта — ритуалы кладутся только туда; глобальный `~/.config/opencode/plugins/` держит лишь поставленный плагин поставки, не ритуалы репо (Шаг 1). Плагин автозагружается на старте — по разу на каждую локацию сервиса. **Форма — OpenCode 2 (`@opencode/plugin` 2.0.4): default-экспорт объекта `{ id, setup(ctx) }`.** Прежняя форма 1.x — экспорт async-функции, возвращающей карту хуков `"tool.execute.before"` — загрузчиком 2.x отвергается (`Plugin must export a default definition with an id and an effect or setup function`; в логе сервиса — `failed to load plugin … SchemaError(Missing key at ["default"])`), и ритуалы молча не действуют. Импортов плагину не нужно: всё приходит в `ctx`.

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
    // пуш и мерж: после shell-вызова дописать одну строку в результат — пуш
    // не отгрузка (холодное ревью этапа), мерж — четыре акта AGENTS.md.
    // Будит исход, не форма: справка и --auto не будят; код выхода говорит за команду,
    // только когда она последняя в цепочке или стоит перед &&, иначе — строка подтверждения в выводе.
    // Поля result только для чтения — заменяется сам result; content — строка или массив частей.
    await ctx.tool.hook("execute.after", (input) => {
      if (input.tool !== "bash" || input.status !== "completed") return;
      const cmd = String(input.input?.command ?? "");
      const c = input.result.content;
      const out = typeof c === "string" ? c : (c ?? []).map((p) => p.text ?? "").join("\n");
      const exit = input.result.metadata?.exit; // ключ не сверен живьём; нет его — держится форма хвоста
      const arg = String.raw`(?:>&|[^;&|)\n])*`;
      const at = (head, noop) => String.raw`(?:^|[;&|(\n] *)${head}(?=[ ;&|)\n]|$)(?!${arg} (?:${noop})(?:[ ;&|)\n]|$))`;
      const ran = (head, noop, said) =>
        new RegExp(at(head, noop)).test(cmd) &&
        (((exit ?? 0) === 0 && new RegExp(at(head, noop) + arg + String.raw`\s*(?:&&|$)`).test(cmd)) || said.test(out));
      const pull = /(checkout|switch) (main|master)[^;|]*&& *git( -C \S+)* pull([ ;&|)]|$)/;
      const note = ran(String.raw`(?:env +)?(?:[A-Za-z_]+=\S+ +)*git(?: -C \S+)* push`, "-h|--help", /To \S+\n [ *+=!-]/)
        ? "[iskron] пуш — не отгрузка: самопроверка, словарный проход по тексту PR, холодное ревью этапа."
        : ran("gh pr merge", "-h|--help|--auto|--disable-auto", /(Merged|Squashed and merged|Rebased and merged) pull request/) || pull.test(cmd)
          ? "[iskron] мерж — четыре акта AGENTS.md: проткать, модусы, закрыть по оси, reconcile."
          : "";
      if (!note) return;
      input.result = {
        ...input.result,
        content: typeof c === "string" ? `${c}\n\n${note}` : [...(c ?? []), { type: "text", text: note }],
      };
    });
    // ориентация: слово в новую сессию — ctx.event.subscribe даёт async-итерируемое событий;
    // отказ цикла пишется в stderr сервиса, а не глотается: молчащий ритуал хуже отсутствующего.
    const ac = new AbortController();
    (async () => {
      for await (const ev of await ctx.event.subscribe({ signal: ac.signal })) {
        if (ev.type === "session.created")
          await ctx.session.prompt({ sessionID: ev.data.sessionID, text: "Прочти раздел «Старт» скилла-двери iskron…", delivery: "queue" });
      }
    })().catch((e) => console.error("[iskron-rituals] ориентация остановилась:", e));
    return () => ac.abort(); // cleanup при выгрузке плагина
  },
};
```

`ctx.tool.hook("execute.before", …)` / `("execute.after", …)` оборачивают вызовы тулов — **throw из `execute.before` и есть блокировка**: memory-guard здесь — throw, не код выхода; в `execute.after` у завершившегося вызова (`status: "completed"`) заменяется поле `result` целиком (его собственные поля только для чтения). Формы сверены с типами пакета 2.0.4 (`@opencode/plugin` → `dist/promise/tool.d.ts`, `plugin.d.ts`; событие `session.created` — `@opencode/schema`, `session-event.d.ts`: `data.sessionID`, `data.projectID`, `data.location`); живой прогон ритуалов на 2.x в этой поставке не делался — сверяй по типам при апгрейде. TUI у серверного плагина нет: слово человеку идёт промптом в сессию или в stderr сервиса. Ключ фронтматтера `slash: true` парсер 2.x отбрасывает: команды палитры «/» регистрирует плагин через `ctx.command.transform`.

Маппинг ритуалов: ориентация → `ctx.event.subscribe` на `session.created`; memory-guard → `ctx.tool.hook("execute.before")` с throw; пуш и мерж → `ctx.tool.hook("execute.after")` по shell-тулу. Ролевые файлы суб-агентов: `.opencode/agents/` (см. `delegation.md`).

## Чек-лист перепроверки (мейнтейнерам)

Перепроверяй при апгрейдах харнессов, как interop-референс:

- **Claude Code** — путь settings, имена хук-событий, синтаксис импорта в `CLAUDE.md`.
- **Codex** — список событий `[hooks]` и форма TOML, source'ы `SessionStart`, имена файлов `AGENTS.md` / `AGENTS.override.md` и порядок их мержа.
- **OpenCode** — имена директорий плагинов (`.opencode/plugins/`), форма плагина (`{ id, setup(ctx) }`), имена хуков `ctx.tool.hook("execute.before" | "execute.after")` и что throw из `execute.before` всё ещё блокирует, форма события `session.created` в `@opencode/schema`.
- Харнесс, обретший или потерявший поверхность, меняет то, что iskronify может обещать: сначала обнови таблицу, затем Шаг 4.
