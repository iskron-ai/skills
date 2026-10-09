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
      "BLOCKED: локальная память агента запрещена целиком, по директории (AGENTS.md, «Правила персистентности»). " +
      "Маршрутизируй факт: конвенции, ритуалы и команды репо → AGENTS.md; ловушки → их дом по «Раскладке» (GOTCHAS.md либо граф); факты о коде, состояние проекта, серверы и датированные долги → граф @nks/nks-dev (r5); " +
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
      // видимый отказ git (fatal:, error:, ! [rejected]) — вето на всё решение пуша: код выхода (и неизвестный), строку
      // подтверждения, равенство ссылок; вето читает весь вывод вызова — fatal:/error: соседней команды глушит и принятый пуш
      const refused = /^(?:fatal:|error:| ! \[(?:remote )?rejected\])/m.test(out);
      // пуш только меток (метка выпуска — не ветка на ревью) судит форма команды: после remote каждый refspec —
      // tag <имя>, refs/tags/…, +refs/tags/…, либо refspec'ов нет и стоит --tags; один голый refspec (без tag, :, +, refs/)
      // судит вывод — все обновлённые ссылки [new tag]; удаление (:refs/tags/…, --delete, -d), --all, --mirror,
      // --follow-tags, кавычка, $ или ` в слове, непризнанный refspec — не меточный, будит
      const tagOnly = (args) => {
        let skip = false, tags = false, broad = false;
        const pos = [];
        for (const t of args.match(/(?:\\.|'[^']*'|"(?:[^"\\]|\\.)*"|[^ '"\\])+/g) ?? []) {
          if (skip) skip = false;
          else if (/^[0-9]*(?:>>?|<|>&)$/.test(t)) skip = true;
          else if (/^[0-9]*(?:>>?|<|>&)/.test(t)) continue;
          else if (/['"\\$`]/.test(t)) broad = true;
          else if (t === "--tags") tags = true;
          else if (/^(?:--(?:all|mirror|follow-tags|delete)(?:=|$)|-d$)/.test(t)) broad = true;
          else if (/^(?:-o|--push-option|--receive-pack|--exec)$/.test(t)) skip = true;
          else if (!t.startsWith("-")) pos.push(t);
        }
        const refs = pos.slice(1);
        let name = false, ok = true;
        for (const r of refs) {
          if (name) name = false;
          else if (r === "tag") name = true;
          else if (!/^\+?refs\/tags\/[^:]+(?::refs\/tags\/[^:]+)?$/.test(r)) ok = false;
        }
        if (broad) return "no";
        if (ok && !name && (refs.length > 0 || tags)) return "tag";
        return refs.length === 1 && !tags && /^(?!refs\/|tag$)[^:+]+$/.test(refs[0]) ? "bare" : "no";
      };
      const tagsOut = /^(?=[\s\S]*\n [*] \[new tag\])(?![\s\S]*\n (?:[ +-] |\* (?!\[new tag\])))/;
      const kinds = [...cmd.matchAll(new RegExp(String.raw`(?:^|[;&|(\n] *)${push}(?=[ ;&|)\n]|$)(${arg})`, "g"))].map((m) => tagOnly(m[1]));
      const tagCmd = kinds.length > 0 && !kinds.includes("no") && (!kinds.includes("bare") || tagsOut.test(`\n${out}`));
      let quiet = false;
      if (!refused && !tagCmd && new RegExp(String.raw`^(?:${arg}[;&|(\n] *)*` + push + String.raw`(?=[ ;&|)\n]|$)(?!${arg} (?:-h|--help)(?:[ ;&|)\n]|$))` + arg + String.raw` (?:-q|--quiet)(?=[ ;&|)\n]|$)`).test(cmd) && !cmd.includes("<<")) {
        // каталог сессии, не процесса сервера; нет его — хук молчит
        const cwd = await dirOf(input.sessionID);
        if (typeof cwd === "string" && cwd) {
          const { execFileSync } = await import("node:child_process");
          const git = (...a) => { try { return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
          const head = git("rev-parse", "HEAD");
          quiet = head !== "" && head === git("rev-parse", "@{push}") && !["main", "master"].includes(git("rev-parse", "--abbrev-ref", "HEAD"));
        }
      }
      // видимый отказ мержа — вето на побудку мержа; маркера успеха не требует: gh вне терминала успех не печатает
      const held = !/^(?:[Ee]rror:|fatal:|GraphQL:|X )|not mergeable|merge failed/m.test(out);
      const note = !refused && !tagCmd && (ran(push, "-h|--help", /To [^\n]+(?:\n [!=] .*)*\n [ *+-]/) || quiet)
        ? "[iskron] пуш — не отгрузка: самопроверка, словарный проход по тексту PR, холодное ревью этапа (AGENTS.md, «Самопроверка этапа» и «Ревью и приёмка — чистым агентом против графа и диффа»)."
        : held && (ran("gh pr merge", "-h|--help|--auto|--disable-auto", /(Merged|Squashed and merged|Rebased and merged) pull request/) ||
            ran("fj pr merge", "-h|--help|--auto|--disable-auto", /Merged PR #/) || ((exit ?? 0) === 0 && pull.test(cmd)))
          ? "[iskron] мерж — акты после мержа AGENTS.md («Жизненный цикл сессии», «Мерж → граф»): протки #1506, карта, модусы по свидетельству, закрыть по оси, reconcile, фидбэк, словарь; работа по ссылке от агента — только семя и модусы поставки."
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
      "Прочти раздел «Старт» скилла-двери iskron до действий. Адреса (AGENTS.md, фронтматтер): граф @nks/nks-dev (r5), " +
      "фокус-контур #1506, роль агента #931, роль владельца #1226. " +
      "Стояние — только на вахту (слово «вахта», start, адрес места из окна, кадр), одним iskron_stand; " +
      "start <граф> <роль> <дело №N> входит в это дело. У субагента свой мост-спутник " +
      "(iskron_stand с satellite_of, join, leave — на нём); на мосту запустившего он в граф не пишет.";
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
