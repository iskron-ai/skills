# Поверхности харнессов — куда реально ложатся ритуалы

iskronify доставляет **ритуалы** (ориентация на старте сессии, пуш — холодное ревью этапа, мерж — обновление графа, память вне локальных хранилищ). Каждый харнесс запускает их по-своему, и пути файлов не взаимозаменяемы. Прошивай поверхности используемого харнесса; никогда не пиши конфиг формата, о котором гадаешь.

| Харнесс | Читает | Нужен файл-указатель | Поверхность автоматизации |
|---|---|---|---|
| Claude Code | `CLAUDE.md` | **да** — `CLAUDE.md` = `@AGENTS.md` | хуки в `.claude/settings.json` |
| Codex CLI | `AGENTS.md` | нет | `hooks.json` в CODEX_HOME — вне worktree, не прошивается; ритуалы держит проза AGENTS.md |
| OpenCode | `AGENTS.md` | нет | плагин в `.opencode/plugins/` проекта |

Определи до выбора: `.claude/` или кэш плагинов → Claude Code; `opencode.json` / `.opencode/` → OpenCode; `.codex/` или `~/.codex/` → Codex. Истинным может быть не одно — прошей каждый присутствующий харнесс; тело `AGENTS.md` общее.

## Claude Code

Читает `CLAUDE.md`, не `AGENTS.md` — отсюда однострочный указатель (`@AGENTS.md`-импорт; Шаг 7). Хуки живут в `.claude/settings.json`, коммитятся. Ролевые файлы суб-агентов: `.claude/agents/` (см. `delegation.md`). Хуки и их события названы в Шаге 4 скилла; JSON, фильтры и команда memory-guard — `hooks.md`.

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
    // свой каталог: у тул-хука во входе только sessionID — каталог сессии
    // (SessionInfo.location.directory, 2.0.4) сверяется с каталогом экземпляра (ctx.location).
    // Молчит только известно чужая сессия: неизвестный каталог не глушит guard молча.
    // Каталоги сравниваются канонизированными: одна папка приходит то /private/tmp/…, то /tmp/… —
    // realpath, при ошибке исходная строка, без завершающего разделителя.
    const { realpath } = await import("node:fs/promises");
    const canon = async (p) => {
      if (typeof p !== "string" || !p) return p;
      const r = await realpath(p).catch(() => p);
      return r.replace(/(?<=.)[\\/]+$/, "");
    };
    const own = await canon(ctx.location?.directory);
    const dirOf = async (sessionID) => {
      const info = await ctx.session.get({ sessionID }).catch(() => null);
      return canon(info?.location?.directory ?? info?.data?.location?.directory);
    };
    const mine = async (sessionID) => {
      const dir = await dirOf(sessionID);
      return !own || typeof dir !== "string" || !dir || dir === own;
    };
    // сервер заводит экземпляр плагина на каждое написание каталога (/tmp/… и /private/tmp/…), после canon
    // оба считают сессию своей — слово однократно на процесс: общий для экземпляров набор,
    // ключ — sessionID приветствия, id вызова (callID) напоминания; нет ключа — не дедуплицируется,
    // иначе первый вызов без id занял бы ключ undefined и заглушил все следующие
    const said = (globalThis.__iskronRitualsSaid ??= new Set());
    const once = (key) => key == null || (!said.has(key) && !!said.add(key));
    // тул оболочки на 2.0.24 — shell; bash — для прежних версий
    const isShell = (tool) => ["shell", "bash"].includes(tool);
    // memory-guard: бросок из execute.before блокирует вызов; правило пути — то же, что у guard'а Claude Code:
    // относительный — от каталога сессии; путь раскрывается по компонентам слева направо, как realpath -m:
    // существующая ссылка заменяется своей целью, и та раскрывается дальше, «..» применяется к уже
    // раскрытому префиксу, несуществующий хвост — текстом. Больше 40 переходов, цикл или ссылка, лежащая
    // в памяти, — отказ (закрыто на отказ); память узнаётся и по ~/.claude/projects за ссылкой, и без учёта
    // регистра (на APFS и Windows MEMORY и .Claude — та же папка)
    const { lstatSync, readlinkSync } = await import("node:fs");
    const { dirname, isAbsolute, join, parse } = await import("node:path");
    const { homedir } = await import("node:os");
    const slash = (p) => p.replaceAll("\\", "/");
    const parts = (p) => p.slice(parse(p).root.length).split(/[\\/]+/);
    // раскрытый путь; null — не раскрыт (предел, цикл, ссылка не читается) или ссылка лежит в памяти
    const real = (p, inMemory = () => false) => {
      let r = parse(p).root, rest = parts(p), hops = 0;
      while (rest.length) {
        const c = rest.shift();
        if (!c || c === ".") continue;
        if (c === "..") { r = dirname(r); continue; }
        const q = join(r, c);
        let link = false;
        try { link = lstatSync(q).isSymbolicLink(); } catch { /* нет такого — хвост текстом */ }
        if (!link) { r = q; continue; }
        let l = "";
        try { l = readlinkSync(q); } catch { /* не читается — не раскрыт */ }
        if (++hops > 40 || !l || inMemory(q)) return null;
        if (isAbsolute(l)) r = parse(l).root;
        rest = [...parts(l), ...rest];
      }
      return r;
    };
    const home = join(homedir(), ".claude", "projects");
    const projects = slash(real(home) ?? home).toLowerCase();
    const inMemory = (p) => {
      const x = `${slash(p)}/`.toLowerCase();
      return /\/\.claude\/projects\/.*\/memory\//.test(x) || (x.startsWith(`${projects}/`) && /\/memory\//.test(x.slice(projects.length)));
    };
    const isLocalMemoryPath = (p, base) => {
      const abs = isAbsolute(String(p)) ? String(p) : `${base || process.cwd()}/${p}`;
      const r = real(abs, inMemory);
      return r === null || inMemory(abs) || inMemory(r);
    };
    // отказ — маршрут, как у guard'а Claude Code: iskronify подставляет «Граф» фронтматтера AGENTS.md
    // и заголовок его раздела о персистентности, как он стоит в файле, — угловых скобок в плагине репо не остаётся;
    // текст — на языке AGENTS.md (английский — в hooks.md, «Memory-guard»)
    const REFUSAL =
      "BLOCKED: локальная память агента запрещена целиком, по директории (AGENTS.md, «<Раздел персистентности>»). " +
      "Маршрутизируй факт: конвенции, ритуалы и команды репо → AGENTS.md; ловушки → их дом по «Раскладке» (GOTCHAS.md либо граф); факты о коде, состояние проекта, серверы и датированные долги → граф <Граф>; " +
      "факт пользователя вне проекта, включая факты машины → личный граф человека @handle/mind (minding).";
    // пути вызова: write и edit — поле path (filePath прежних версий); patch (apply_patch) — заголовки
    // patchText «*** Add File: », «*** Update File: », «*** Delete File: » и цель «*** Move to: »
    const pathsOf = (input) =>
      ["patch", "apply_patch"].includes(input.tool)
        ? [...String(input.input?.patchText ?? "").matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)].map((m) => m[1].trim())
        : ["write", "edit"].includes(input.tool) ? [input.input?.path ?? input.input?.filePath ?? ""] : [];
    await ctx.tool.hook("execute.before", async (input) => {
      const paths = pathsOf(input);
      if (!paths.length) return;
      const base = (await dirOf(input.sessionID)) || own;
      if (!paths.some((p) => isLocalMemoryPath(p, base))) return;
      if (!(await mine(input.sessionID))) return;
      throw new Error(REFUSAL);
    });
    // пуш и мерж: после shell-вызова дописать одну строку в результат — пуш
    // не отгрузка (холодное ревью этапа), мерж — акты после мержа AGENTS.md.
    // Будит исход, не форма: справка и --auto не будят; код выхода говорит за команду,
    // только когда она последняя в цепочке или стоит перед &&, иначе — строка подтверждения в выводе.
    // Поля result только для чтения — заменяется сам result; content — строка или массив частей.
    await ctx.tool.hook("execute.after", async (input) => {
      if (!isShell(input.tool) || input.status !== "completed") return;
      const cmd = String(input.input?.command ?? "");
      const c = input.result.content;
      const out = typeof c === "string" ? c : (c ?? []).map((p) => p.text ?? "").join("\n");
      const exit = input.result.metadata?.exit; // ключ не сверен живьём; нет его — держится форма хвоста
      const arg = String.raw`(?:>&|\\.|'[^']*'|"(?:[^"\\]|\\.)*"|[^;&|)\n'"\\])*`; // кавычки — целиком: флаг в них текст
      const at = (head, noop) => String.raw`(?:^|[;&|(\n] *)${head}(?=[ ;&|)\n]|$)(?!${arg} (?:${noop})(?:[ ;&|)\n]|$))`;
      const ran = (head, noop, said) =>
        new RegExp(at(head, noop)).test(cmd) &&
        (((exit ?? 0) === 0 && new RegExp(at(head, noop) + arg + String.raw`\s*(?:&&|$)`).test(cmd)) || said.test(out));
      const env = String.raw`(?:env +)?(?:[A-Za-z_]+=\S+ +)*`;
      const pull = new RegExp( // подтяжка ствола — командой; до pull цепочка через &&, ; или перевод строки
        at(String.raw`${env}git(?: -C \S+)* (?:checkout|switch)`, "-h|--help") + String.raw` (?:main|master)(?=[ ;&|)\n]|$)` +
          String.raw`(?:${arg}(?:&&|;|\n))+ *${env}git(?: -C \S+)* pull(?=[ ;&|)\n]|$)`,
      );
      const push = String.raw`(?:env +)?(?:[A-Za-z_]+=\S+ +)*git(?: -C \S+)* push`;
      // тихий пуш (-q/--quiet) не печатает «To <remote>» и по выводу неотличим от отказа: судит состояние git —
      // команда от начала строки через цельные кавычки, без <<, HEAD непуст и равен @{push}, ветка не main и не master
      let quiet = false;
      if (new RegExp(String.raw`^(?:${arg}[;&|(\n] *)*` + push + String.raw`(?=[ ;&|)\n]|$)(?!${arg} (?:-h|--help)(?:[ ;&|)\n]|$))` + arg + String.raw` (?:-q|--quiet)(?=[ ;&|)\n]|$)`).test(cmd) && !cmd.includes("<<")) {
        // каталог сессии, не процесса сервера; нет его — хук молчит
        const cwd = await dirOf(input.sessionID);
        if (typeof cwd === "string" && cwd) {
          const { execFileSync } = await import("node:child_process");
          const git = (...a) => { try { return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
          const head = git("rev-parse", "HEAD");
          quiet = head !== "" && head === git("rev-parse", "@{push}") && !["main", "master"].includes(git("rev-parse", "--abbrev-ref", "HEAD"));
        }
      }
      const tagsOnly = /^(?=[\s\S]*\n [*] \[new tag\])(?![\s\S]*\n (?:[ +-] |\* (?!\[new tag\])))/; // метка выпуска — не ветка на ревью
      const note = (ran(push, "-h|--help", /To [^\n]+(?:\n [!=] .*)*\n [ *+-]/) && !tagsOnly.test(out)) || quiet
        ? "[iskron] пуш — не отгрузка: самопроверка, словарный проход по тексту PR, холодное ревью этапа."
        : ran("gh pr merge", "-h|--help|--auto|--disable-auto", /(Merged|Squashed and merged|Rebased and merged) pull request/) ||
            ran("fj pr merge", "-h|--help", /Merged PR #/) || ((exit ?? 0) === 0 && pull.test(cmd))
          ? "[iskron] мерж — акты после мержа AGENTS.md: протки, карта, модусы по свидетельству, закрыть по оси, reconcile, фидбэк, словарь; работа по ссылке от агента — только семя и модусы поставки."
          : "";
      if (!note || !(await mine(input.sessionID)) || !once(input.id)) return;
      input.result = {
        ...input.result,
        content: typeof c === "string" ? `${c}\n\n${note}` : [...(c ?? []), { type: "text", text: note }],
      };
    });
    // ориентация: слово в новую сессию — ctx.event.subscribe даёт async-итерируемое событий;
    // поток общий для сервиса на машину и несёт сессии всех каталогов — слово только в сессию
    // своего: каталог события совпадает с каталогом этого экземпляра (ctx.location), и только
    // корневой (без parentID) — дочерние сессии (субагенты и служебные) пропускаются.
    // Сбой промпта одной сессии ловится на месте; отказ цикла пишется в stderr сервиса.
    // Слово — то же, что хук SessionStart Claude Code: адреса из фронтматтера AGENTS.md этого репо;
    // iskronify подставляет слоты «Граф», «Фокус-контур», «Роль агента», «Роль владельца» при прогоне,
    // угловых скобок в плагине репо не остаётся.
    const START =
      "Прочти раздел «Старт» скилла-двери iskron до действий. Адреса (AGENTS.md, фронтматтер): граф <Граф>, " +
      "фокус-контур #<Фокус-контур>, роль агента #<Роль агента>, роль владельца #<Роль владельца>. " +
      "Стояние — только на вахту, одним iskron_stand.";
    const ac = new AbortController();
    (async () => {
      for await (const ev of await ctx.event.subscribe({ signal: ac.signal })) {
        if (ev.type !== "session.created" || !own || (await canon(ev.data?.location?.directory)) !== own) continue;
        if (typeof ev.data?.parentID === "string" || !once(ev.data?.sessionID)) continue;
        try {
          await ctx.session.prompt({ sessionID: ev.data.sessionID, text: START, delivery: "queue" });
        } catch (e) {
          console.error("[iskron-rituals] ориентация сессии не дошла:", e);
        }
      }
    })().catch((e) => console.error("[iskron-rituals] ориентация остановилась:", e));
    return () => ac.abort(); // cleanup при выгрузке плагина
  },
};
```

`ctx.tool.hook("execute.before", …)` / `("execute.after", …)` оборачивают вызовы тулов — **throw из `execute.before` и есть блокировка**: memory-guard здесь — throw, не код выхода; в `execute.after` у завершившегося вызова (`status: "completed"`) заменяется поле `result` целиком (его собственные поля только для чтения). Формы сверены с типами пакета 2.0.4 (`@opencode/plugin` → `dist/promise/tool.d.ts`, `plugin.d.ts`; событие `session.created` — `@opencode/schema`, `session-event.d.ts`: `data.sessionID`, `data.projectID`, `data.location`, необязательный `data.parentID`); живьём на 2.0.24 (изолированный `opencode serve`, два каталога, проектный плагин в одном) наблюдены область хуков и потока и список тулов: оболочка — `shell` (образец держит и `bash` прежних версий), запись — `write` и `edit`, путь во входе — `path` (образец читает и `filePath`); тул `patch` (псевдоним `apply_patch`) несёт пути в `patchText` заголовками `*** Add File:`, `*** Update File:`, `*** Delete File:` и `*** Move to:` — прочитано в бинаре 2.0.24, прогоном guard на `patch` не наблюдался; прогон самого образца показал приветствие корневой сессии своего каталога — дважды, по экземпляру на каждое написание каталога, отсюда общий набор однократности на `globalThis`; с ним приветствие ровно одно и только корню своего каталога, чужому корню и дочерней сессии нет. Guard: `write` по памяти своей сессии отказан, обычный файл и память чужой сессии проходят. Напоминание на настоящем `git push` — одна строка в своей сессии, в чужой нет. Не наблюдены напоминание после мержа и тул `edit` — сверяй по типам и строке `REALITY.md` при апгрейде. TUI у серверного плагина нет: слово человеку идёт промптом в сессию или в stderr сервиса. Ключ фронтматтера `slash: true` парсер 2.x отбрасывает: команды палитры «/» регистрирует плагин через `ctx.command.transform`.

**Поток событий общий для сервиса OpenCode на машину**: проектный плагин лежит в `.opencode/plugins/` своего рабочего дерева, но `ctx.event.subscribe` несёт создание сессий всех каталогов, открытых в сервисе. Ориентация без условия на каталог кладёт адреса этого `AGENTS.md` первым словом в чужие сессии, и агент там встаёт под чужой ролью. Поэтому образец сверяет `ev.data.location.directory` события с `ctx.location.directory` экземпляра плагина (`ctx.location` — `@opencode/plugin` 2.0.4, `plugin.d.ts`) и молчит, когда каталога экземпляра нет. Приветствие получает только корневая сессия (`data.parentID` не строка; поле — `session-event.d.ts`, `Created.data`): дочерние сессии (субагенты и служебные) пропускаются — слово туда либо тратит ход модели, либо уходит в уже удалённую сессию; поэтому же промпт обёрнут в try/catch — отказ одной сессии иначе бросает из `await` и гасит весь цикл ориентации. Область `ctx.tool.hook` типы 2.0.4 не называют (у `Hooks` нет опции области, во входе `execute.before`/`execute.after` — `sessionID` без каталога, `dist/promise/tool.d.ts`, `registration.d.ts`); на 2.0.24 наблюдено: tool-хуки срабатывают только для сессий каталога экземпляра; поток событий общий. Условие `mine` в тул-хуках образца остаётся поясом поверх наблюдённого — дёшево и держит, если область сменится в другой версии: каталог сессии из `ctx.session.get` сверяется с тем же `ctx.location.directory`, и хук молчит, только когда оба известны и разошлись (неизвестный каталог guard не глушит). Каталоги сравниваются после `realpath` (при ошибке — исходная строка) без завершающего разделителя: одна и та же папка приходит то `/private/tmp/…`, то `/tmp/…`, и сырое сравнение отсекло бы собственную сессию.

Маппинг ритуалов: ориентация → `ctx.event.subscribe` на `session.created` своего каталога; memory-guard → `ctx.tool.hook("execute.before")` с throw по `write`/`edit`; пуш и мерж → `ctx.tool.hook("execute.after")` по тулу оболочки (`shell` на 2.0.24, прежде `bash`) — оба только для сессий своего каталога; приветствие и напоминание — однократно на процесс сервиса при наличии id сессии или вызова; без id каждый экземпляр каталога говорит сам (два написания каталога — два слова), guard — без однократности (двойной отказ безвреден). Ролевые файлы суб-агентов: `.opencode/agents/` (см. `delegation.md`).

## Чек-лист перепроверки (мейнтейнерам)

Перепроверяй при апгрейдах харнессов, как interop-референс:

- **Claude Code** — путь settings, имена хук-событий, синтаксис импорта в `CLAUDE.md`.
- **Codex** — список событий `[hooks]` и форма TOML, source'ы `SessionStart`, имена файлов `AGENTS.md` / `AGENTS.override.md` и порядок их мержа.
- **OpenCode** — имена директорий плагинов (`.opencode/plugins/`), форма плагина (`{ id, setup(ctx) }`), имена хуков `ctx.tool.hook("execute.before" | "execute.after")` и что throw из `execute.before` всё ещё блокирует, форма события `session.created` в `@opencode/schema` и `ctx.location` экземпляра, по которому ориентация отсекает чужие каталоги.
- Харнесс, обретший или потерявший поверхность, меняет то, что iskronify может обещать: сначала обнови таблицу, затем Шаг 4.
