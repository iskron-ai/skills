// Подкоманда prepare: подготовка репо шагом моста без модели (граф @nks/nks-dev, узел #9319;
// форма обложки — #9316). Слова отказов, заготовки REALITY.md, хука старта и сообщения
// memory-guard (образец — skills/iskronify/references/hooks.md), и что осталось модели.
import type { Lang } from "../lang.ts";

/** Адреса обложки, которыми говорит хук старта; граф — всегда. */
export interface PrepareAddr {
  graph: string;
  holon?: string;
  role?: string;
}

/** Что осталось модели — по ключу пункта ответа. */
export type PrepareLeft =
  | "cover.graph"
  | "cover.holon"
  | "cover.agent_role"
  | "cover.contract"
  | "cover.flat"
  | "cover.repeat"
  | "CLAUDE.md"
  | "hook.start"
  | "hook.guard"
  | "hook.push"
  | "hook.merge"
  | "opencode.rituals";

export interface PrepareWords {
  usage: () => string;
  badArg: (flag: string, value: string) => string;
  notRepo: (dir: string) => string;
  foreign: (file: string) => string;
  unparsed: (file: string) => string;
  /** Заготовка REALITY.md целиком; caseNo — номер дела выравнивания, если назван. */
  reality: (caseNo?: string) => string;
  /** Текст хука старта; в echo '…' его кладёт ядро, экранируя апострофы. */
  start: (a: PrepareAddr) => string;
  /** Сообщение memory-guard; graph — rN обложки (полного адреса без сети нет). */
  guard: (graph: string) => string;
  /** keys — названные дважды ключи обложки, для cover.repeat. */
  left: (item: PrepareLeft, keys?: string) => string;
  /** Стоящий хук-скрипт, который prepare не узнал как хук этого рода: своего рядом не пишет. */
  unread: (item: PrepareLeft, hook: string) => string;
  /** Метка строки текстового ответа: сделано, уже стояло, осталось модели. */
  head: (kind: "done" | "kept" | "left") => string;
}

// Ритуал, который репо держит своим, а несёт поставка: снять — переход контракта 39 (#9319);
// ветки иных родов (гейт мержа nks-mcp, #6688, риск #7601) переход оставляет.
const RITE_RU = (what: string, where: string): string =>
  `свой ${what} в ${where} — ритуалы несёт поставка, а при своём она молчит: сними его, а в скрипте с ветками иных родов — лишь ветку этого (переход Шага 4 iskronify)`;
const RITE_EN = (what: string, where: string): string =>
  `the repo's own ${what} in ${where} — the delivery carries the rituals and keeps silent beside its own: take it off, and in a script with branches of other kinds only this one's branch (the transition of iskronify Step 4)`;
const PLUGIN_RU =
  "свой плагин ритуалов в .opencode/plugins — ритуалы несёт поставка, а при нём она молчит: сними его, а если он несёт ветки иных родов (гейт мержа и подобное) — сними в нём лишь старт, пуш, мерж и memory-guard, остальное оставь файлом с именем без «ritual» (переход Шага 4 iskronify)";
const PLUGIN_EN =
  "the repo's own rituals plugin in .opencode/plugins — the delivery carries the rituals and keeps silent beside it: take it off, and if it carries branches of other kinds (a merge gate and the like) take off only start, push, merge and the memory guard and keep the rest in a file named without «ritual» (the transition of iskronify Step 4)";

export const PREPARE: Readonly<Record<Lang, PrepareWords>> = {
  ru: {
    usage: () =>
      "использование: prepare [--dir <репо>] [--graph rN] [--holon N] [--agent-role N] [--contract N] [--stamp ГГГГ-ММ-ДД] [--case N] [--json] [--lang en|ru]\n",
    badArg: (flag, value) => `${flag}: «${value}» — не та форма; справка — prepare --help`,
    notRepo: (dir) => `${dir} — не git-репозиторий: готовить нечего, ничего не записано`,
    foreign: (file) =>
      `${file} несёт обложку другой поставки — смену поставки решает человек, ничего не записано`,
    unparsed: (file) => `${file} не разбирается — ничего не записано`,
    reality: (caseNo) =>
      `# Reality — против чего проверяется заявка\n\nНосители ещё не установлены${caseNo ? `; дело выравнивания №${caseNo}` : ""}. До их установления поведенческие заявки не принимаются.\n`,
    start: ({ graph, holon, role }) =>
      `Прочти раздел «Старт» двери iskron до действий и закончи его готовностью, не чтением. Адреса — обложка iskron: в AGENTS.md: граф ${graph}${holon ? `, фокус-контур #${holon}` : ""}${role ? `, роль агента #${role}` : ""}. Стояние — на вахту или перед первой записью в граф или дело, одним iskron_stand; читающая сессия места не занимает. start <граф> <роль> <дело №N> — вход в это дело; субагент встаёт своим мостом-спутником (iskron_stand с satellite_of) и на мосту позвавшего в граф не пишет.`,
    guard: (graph) =>
      `BLOCKED: локальная память агента запрещена целиком, по директории (AGENTS.md, «Правила персистентности»). Маршрутизируй факт: конвенции, ритуалы и команды репо → AGENTS.md; ловушки → их дом по «Раскладке» (GOTCHAS.md либо граф); факты о коде, состояние проекта, серверы и датированные долги → граф ${graph}; факт пользователя вне проекта, включая факты машины → личная память через minding. Директория заморожена на стабе-запрете.`,
    left: (item, keys) =>
      ({
        "cover.repeat": `ключ ${keys} стоит во фронтматтере AGENTS.md дважды — строгий YAML его отвергает, AGENTS.md не тронут: оставь одно значение и повтори prepare`,
        "cover.graph": "граф не назван — --graph rN (iskron_realm action=list), такт 1 iskronify",
        "cover.holon":
          "контур не назван — --holon N: поиск контура по атрибуту repository или его заведение",
        "cover.agent_role":
          "роль не названа — --agent-role N: стюард контура (iskron_search steward_of) или её заведение",
        "cover.contract": "контракт не назван — --contract N последним вызовом прогона (Шаг 7)",
        "cover.flat":
          "прежняя плоская обложка стоит рядом с блоком — слоты-суждения перенеси в «Проект», плоские ключи сними",
        "CLAUDE.md":
          "CLAUDE.md — свой файл, не указатель: содержимое влей в AGENTS.md и замени указателем (Шаг 7)",
        "hook.start": RITE_RU("хук старта", ".claude/settings.json"),
        "hook.guard": "memory-guard ждёт графа в обложке — повтори prepare с --graph",
        "hook.push": RITE_RU("хук пуша", ".claude/settings.json"),
        "hook.merge": RITE_RU("хук мержа", ".claude/settings.json"),
        "opencode.rituals": PLUGIN_RU,
      })[item],
    unread: (item, hook) =>
      item === "hook.guard"
        ? `стоит «${hook}», и prepare не узнал, memory-guard ли это, — своего рядом не поставил: прочти скрипт; это он — ничего не делай, нет — допиши по Шагу 4 iskronify (references/hooks.md)`
        : `стоит «${hook}», и prepare не узнал, хук старта ли это: прочти скрипт; это он — сними (старт несёт поставка, а при своём она молчит), нет — ничего не делай`,
    head: (kind) => ({ done: "сделано", kept: "уже стоит", left: "модели" })[kind],
  },
  en: {
    usage: () =>
      "usage: prepare [--dir <repo>] [--graph rN] [--holon N] [--agent-role N] [--contract N] [--stamp YYYY-MM-DD] [--case N] [--json] [--lang en|ru]\n",
    badArg: (flag, value) => `${flag}: "${value}" is not the right form; see prepare --help`,
    notRepo: (dir) => `${dir} is not a git repository: nothing to prepare, nothing written`,
    foreign: (file) =>
      `${file} carries another delivery's cover — switching deliveries is the person's call, nothing written`,
    unparsed: (file) => `${file} does not parse — nothing written`,
    reality: (caseNo) =>
      `# Reality — what a claim is checked against\n\nCarriers are not established yet${caseNo ? `; alignment case №${caseNo}` : ""}. Until they are, behavioral claims are not accepted.\n`,
    start: ({ graph, holon, role }) =>
      `Read the Start section of the iskron door before acting and finish it as readiness, not reading. Addresses are the iskron: cover of AGENTS.md: graph ${graph}${holon ? `, focus holon #${holon}` : ""}${role ? `, agent role #${role}` : ""}. Standing on watch or before the first write to the graph or a case, one call: iskron_stand; a reading session takes no seat. start <graph> <role> <case №N> enters that case; a subagent stands on its own satellite bridge (iskron_stand with satellite_of) and does not write to the graph on the bridge of its caller.`,
    guard: (graph) =>
      `BLOCKED: local agent memory is forbidden entirely, by directory (AGENTS.md, «Persistence rules»). Route the fact: repo conventions, rituals and commands → AGENTS.md; gotchas → their home by «Layout» (GOTCHAS.md or the graph); code facts, project state, servers and dated duties → the graph ${graph}; a user's fact outside the project, machine facts included → personal memory through minding. The directory stays frozen at its prohibition stub.`,
    left: (item, keys) =>
      ({
        "cover.repeat": `the key ${keys} stands twice in the front matter of AGENTS.md — strict YAML refuses it, AGENTS.md is untouched: keep one value and run prepare again`,
        "cover.graph": "no graph named — --graph rN (iskron_realm action=list), iskronify tact 1",
        "cover.holon":
          "no holon named — --holon N: find the holon by its repository attribute or create it",
        "cover.agent_role":
          "no role named — --agent-role N: the holon's steward (iskron_search steward_of) or create it",
        "cover.contract": "no contract named — --contract N in the run's last call (Step 7)",
        "cover.flat":
          "the former flat cover stands beside the block — move judgment slots into «Project», drop the flat keys",
        "CLAUDE.md":
          "CLAUDE.md is a file of its own, not a pointer: merge its content into AGENTS.md and replace it with the pointer (Step 7)",
        "hook.start": RITE_EN("start hook", ".claude/settings.json"),
        "hook.guard":
          "memory-guard waits for a graph in the cover — run prepare again with --graph",
        "hook.push": RITE_EN("push hook", ".claude/settings.json"),
        "hook.merge": RITE_EN("merge hook", ".claude/settings.json"),
        "opencode.rituals": PLUGIN_EN,
      })[item],
    unread: (item, hook) =>
      item === "hook.guard"
        ? `"${hook}" stands, and prepare could not tell whether it is the memory-guard — none of its own was put beside it: read the script; if it is, do nothing, if not, add it by iskronify Step 4 (references/hooks.md)`
        : `"${hook}" stands, and prepare could not tell whether it is the start hook: read the script; if it is, take it off (the delivery carries the start and keeps silent beside its own), if not, do nothing`,
    head: (kind) => ({ done: "done", kept: "already there", left: "for the model" })[kind],
  },
};
