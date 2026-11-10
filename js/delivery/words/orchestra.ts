// Подкоманда orchestra: ведение агентов оркестратором моста (граф @nks/nks-dev, узлы #7513,
// #7514, #8202): флаг, граница графов и один такт — локальным входом демона машины. Демон —
// владелец запусков; флаг лежит рядом с грантом и переживает перезапуск демона.
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface OrchestraWords {
  usage: () => string;
  /** Демона нет — операция отказана с причиной, не молча. */
  noDaemon: () => string;
  /** Дверь молчит: демон слушает, но не ответил вовремя. */
  doorSilent: () => string;
  /** Строка не является известным действием двери. */
  unknownOp: (op: string) => string;
  /** Служба двери отказала ошибкой — ответ адресату, не молчание. */
  doorError: (message: string) => string;
  /** Согласия машины нет: ни on из терминала, ни окружения демона. */
  notAdmitted: () => string;
  /** realms — названный перечень границы через запятую (может быть пуст). */
  on: (realms: string) => string;
  /** Краткая форма rN не ходит в REST — граница не принята, названо полным адресом. */
  onShortRealm: (realms: string) => string;
  off: () => string;
  /** tact — строки курсоров и последних исходов такта через «; » (может быть пуст). */
  status: (on: boolean, realms: string, found: string, tact?: string) => string;
  /** Такт пуст: выключен или названная граница пуста — читать нечего. */
  stepEmpty: () => string;
  /** parts — строки графов такта, уже соединённые через «; ». */
  step: (parts: string) => string;
  /** Один граф такта: приглашения, сигналы и их поводы (api-слова поводов). */
  tactRealm: (realm: string, invites: number, signals: number, causes: string) => string;
  /** Почему такт отказан: граф не прочитан; курсоры не двинуты, приказов нет. */
  stepReadError: (realm: string, why: string) => string;
  /** Короткая форма живого места не разрешается списком графов — граница неполна, такт отказан. */
  stepUnresolvedRealm: (realm: string, why: string) => string;
  /** Адрес api неизвестен: нет живого канала и записей мест — адрес несёт канал, не сервер MCP. */
  stepNoApi: () => string;
  /** Клиент ушёл до конца такта: его отказ уже прозвучал — курсоры не двинуты. */
  stepGone: () => string;
  /** Строка status о последнем такте графа: исход, курсор и когда. */
  tactOut: (realm: string, invites: number, signals: number, cursor: string, at: string) => string;
  /** lines — исходы ведения такта (подъём и погашение) через «; ». */
  lead: (lines: string) => string;
  /** Исход по одному зову: граф, дело (id), номер зова в деле и код исхода (коды — слова api и моста). */
  leadRow: (realm: string, room: string, invite: number, code: string) => string;
  /** Флаг лежит, а согласия машины в среде демона нет — ни подъёма, ни погашения. */
  leadNotAdmitted: () => string;
  /** Снимок требований неполон — по нему ничего не поднимается и не гасится. */
  leadIncomplete: (errors: string) => string;
  /** Описания запускателей в mind не прочитаны — подъёма нет. */
  leadNoLaunchers: (why: string) => string;
  /** Описание запускателя в mind не годится — по нему ничего не поднимается. */
  leadDescription: (what: string, code: string) => string;
  /** Приказы учётки не прочитаны — останов по требованию не замечен в этом такте. */
  leadOrdersUnread: (why: string) => string;
  /** Бриф поднимаемого агента после строки spawned_for. */
  brief: (realm: string, karta: number, room: string, invite: number) => string;
  /** Сухой такт: rows — строки по зовам через перевод строки (может быть пуст). */
  plan: (rows: string) => string;
  /** Сухой такт: зов был бы поднят этой командой. */
  planLaunch: (argv: string) => string;
  /** Сухой такт: зов был бы отказан этим кодом. */
  planRefuse: (code: string) => string;
  /** Сухой такт: зов уже в реестре в этом состоянии. */
  planAlready: (state: string) => string;
  /** Сухой такт: копию назвала бы Orca при запуске — сейчас её не спрашивают. */
  planCheckout: (repository: string) => string;
  /** Сухой такт: не будь у Orca копии, склонировал бы этот адрес в этот каталог. */
  planClone: (url: string, destination: string) => string;
  /** Сухой такт: не будь у Orca копии, клон отказан этим кодом. */
  planNoClone: (code: string) => string;
  /** Сухой такт: место брифа в argv. */
  planBrief: () => string;
  /** on --launcher: описание записано в mind (seq — номер узла, может быть пуст; holon — холон работы с агентами, пусто — корень). */
  describeWritten: (launcher: string, seq: string, holon: string) => string;
  /** on --launcher: имя запускателя длиннее, чем примет чтение описаний, — флаг не двинут. */
  describeTooLong: (launcher: string, max: number) => string;
  /** on --launcher: описание этого запускателя уже лежит — взято как есть. */
  describeTaken: (launcher: string, seq: string) => string;
  /** on --launcher: нового описания без моделей не пишут — флаг не двинут. */
  describeNoModel: (launcher: string) => string;
  /** on --launcher: описание не прочитано или не записано — флаг не двинут. */
  describeFailed: (launcher: string, why: string) => string;
  /** Имя узла описания в mind. */
  describeName: (launcher: string) => string;
  /** reasoning записи описания. */
  describeReason: () => string;
}

export const ORCHESTRA: Readonly<Record<Lang, OrchestraWords>> = {
  ru: {
    usage: () =>
      "использование: orchestra <on|off|status|step [--dry-run]|demands> [--realm <граф>]… [--auth-dir <dir>] [--lang en|ru]\n" +
      "              orchestra on --launcher <имя> [--model <id>]… [--limit N] [--host <машина>] — описание запускателя в mind, если его нет\n",
    noDaemon: () =>
      "демона машины нет — оркестратор живёт демоном и его локальным входом; поднимите мост (любая сессия харнеса поднимает демона) и повторите",
    doorSilent: () =>
      "вход демона не ответил вовремя — демон жив, но занят или сборка старше orchestra; повторите позже",
    unknownOp: (op) => `оркестратор: неизвестное действие ${op}`,
    doorError: (message) => `вход демона ответил ошибкой: ${message}`,
    notAdmitted: () =>
      "машина не допустила оркестратора: согласие даёт человек — та же команда orchestra on, набранная им в терминале, либо ISKRON_ORCHESTRA=1 в среде демона; из оболочки агента (без терминала) согласия нет, флаг не двинут",
    on: (realms) =>
      `оркестратор включён${realms ? `, названная граница: ${realms}` : " (граница — графы живых на машине агентов)"}; флаг лежит рядом с грантом`,
    onShortRealm: (realms) =>
      `граница не принята: ${realms} — краткая форма rN не ходит в двери REST api (живая проба: 404 «Realm not found»); назовите граф полным адресом — хэндл владельца/slug из листинга графов`,
    off: () =>
      "оркестратор выключен; поднятые агенты доживают свой путь — их не гасит сам факт выключения",
    status: (on, realms, found, tact) =>
      on
        ? `включён; названная граница: ${realms || "—"}${found ? `; графы живых на машине: ${found}` : " (плюс графы живых на машине агентов)"}${tact ? `; такт: ${tact}` : ""}`
        : `выключен${tact ? `; такт: ${tact}` : ""}`,
    stepEmpty: () =>
      "такт пуст: оркестратор выключен или граница пуста — названных графов нет и живых мест на машине нет",
    step: (parts) => `такт прошёл: ${parts}`,
    tactRealm: (realm, invites, signals, causes) =>
      `${realm}: приглашений ${invites}, сигналов ${signals}${causes ? ` (${causes})` : ""}`,
    stepReadError: (realm, why) =>
      `такт отказан целиком: ${realm} не прочитан (${why}) — курсоры не двинуты, приказов останова нет`,
    stepUnresolvedRealm: (realm, why) =>
      `такт отказан: ${realm} — граф живого места назван короткой формой и не разрешается списком графов (${why}); граница неполна, курсоры не двинуты`,
    stepNoApi: () =>
      "такт отказан: адрес api неизвестен — у демона нет живого канала и записей мест; адрес api несёт канал (ответ connect), не сервер MCP",
    stepGone: () =>
      "такт не коммитится: спрашивавший ушёл до конца такта — его отказ уже прозвучал, курсоры не двинуты",
    tactOut: (realm, invites, signals, cursor, at) =>
      `${realm}: приглашений ${invites}, сигналов ${signals}, курсор ${cursor || "—"} (${at})`,
    lead: (lines) => `ведение: ${lines}`,
    leadRow: (realm, room, invite, code) => `${realm} дело ${room} зов ${invite}: ${code}`,
    leadNotAdmitted: () =>
      "флаг лежит, но машина не допустила оркестратора (orchestra on, набранная в терминале, или ISKRON_ORCHESTRA=1 в среде демона) — агенты не поднимаются и не гасятся",
    leadIncomplete: (errors) =>
      `снимок требований неполон (${errors}) — по нему ничего не поднято и не погашено`,
    leadNoLaunchers: (why) => `описания запускателей в mind не прочитаны (${why}) — подъёма нет`,
    leadDescription: (what, code) =>
      `описание запускателя ${what} в mind: ${code} — по нему подъёма нет`,
    leadOrdersUnread: (why) =>
      `приказы учётки не прочитаны (${why}) — останов поднятых по требованию увидит следующий такт`,
    brief: (realm, karta, room, invite) =>
      `Ты уже взят: оркестратор поднял тебя по зову ${invite} дела ${room} в графе ${realm}, роль #${karta}, и место встало по первой строке. ` +
      `Заново не регистрируйся. До работы войди в дело: ${tool("case")}(action="join", realm="${realm}", room="${room}"). ` +
      "Прочти постановку дела и критерии приёмки; задачи не выдумывай.",
    plan: (rows) =>
      `сухой такт — ничего не поднято, не приказано и не сдвинуто (Orca не спрошена):${rows ? `\n${rows}` : " зовов нет"}`,
    planLaunch: (argv) => `поднял бы: ${argv}`,
    planRefuse: (code) => `отказал бы: ${code}`,
    planAlready: (state) => `уже в реестре: ${state}`,
    planCheckout: (repository) => `<копия Orca для ${repository}>`,
    planClone: (url, destination) =>
      `если у Orca нет копии — склонировал бы ${url} в ${destination}`,
    planNoClone: (code) => `если у Orca нет копии — ${code}`,
    planBrief: () => "<бриф>",
    describeWritten: (launcher, seq, holon) =>
      `описание запускателя ${launcher} записано в mind${seq ? ` (#${seq})` : ""}` +
      (holon
        ? ` под холоном работы с агентами ${holon}`
        : " в корень: холон работы с агентами (с карточками slice:agents) не найден однозначно — перенесите под него, когда он будет"),
    describeTooLong: (launcher, max) =>
      `имя запускателя ${launcher} длиннее ${max} знаков — такое описание мост не примет; назовите короче, флаг не двинут`,
    describeTaken: (launcher, seq) =>
      `запускатель ${launcher}: взято существующее описание в mind (${seq}), не тронуто — правится там же`,
    describeNoModel: (launcher) =>
      `описания запускателя ${launcher} в mind нет, а без --model его не записать — назовите модели (--model <id>, можно несколько); флаг не двинут`,
    describeFailed: (launcher, why) =>
      `описание запускателя ${launcher} не прочитано или не записано (${why}) — флаг не двинут`,
    describeName: (launcher) => `🚀 Запускатель агентов ${launcher}`,
    describeReason: () => "человек включил автоподъём командой orchestra on --launcher",
  },
  en: {
    usage: () =>
      "usage: orchestra <on|off|status|step [--dry-run]|demands> [--realm <graph>]… [--auth-dir <dir>] [--lang en|ru]\n" +
      "       orchestra on --launcher <name> [--model <id>]… [--limit N] [--host <machine>] — describes the launcher in mind unless one lies there\n",
    noDaemon: () =>
      "the machine daemon is not running — the orchestrator lives by the daemon and its local entrance; raise a bridge (any harness session raises the daemon) and retry",
    doorSilent: () =>
      "the daemon's entrance did not answer in time — the daemon is alive but busy or older than orchestra; retry later",
    unknownOp: (op) => `orchestra: unknown op ${op}`,
    doorError: (message) => `the daemon's entrance answered with an error: ${message}`,
    notAdmitted: () =>
      "the machine has not admitted the orchestrator: consent is the human's — this same orchestra on typed at a terminal, or ISKRON_ORCHESTRA=1 in the daemon's environment; an agent's shell (no terminal) gives none, and the flag is not moved",
    on: (realms) =>
      `the orchestrator is on${realms ? `, named boundary: ${realms}` : " (the boundary is the graphs of the machine's live agents)"}; the flag lies next to the grant`,
    onShortRealm: (realms) =>
      `the boundary is not taken: ${realms} — the short rN form does not ride the REST doors of the api (live probe: 404 "Realm not found"); name the graph by its full address — the owner's handle/slug from the list of graphs`,
    off: () =>
      "the orchestrator is off; raised agents live out their own path — the switching off itself extinguishes none",
    status: (on, realms, found, tact) =>
      on
        ? `on; named boundary: ${realms || "—"}${found ? `; graphs of the machine's live agents: ${found}` : " (plus the graphs of the machine's live agents)"}${tact ? `; tact: ${tact}` : ""}`
        : `off${tact ? `; tact: ${tact}` : ""}`,
    stepEmpty: () =>
      "the tact is empty: the orchestrator is off or the boundary is empty — no named graphs and no live places on the machine",
    step: (parts) => `the tact passed: ${parts}`,
    tactRealm: (realm, invites, signals, causes) =>
      `${realm}: invites ${invites}, signals ${signals}${causes ? ` (${causes})` : ""}`,
    stepReadError: (realm, why) =>
      `the tact is refused whole: ${realm} did not read (${why}) — no cursor moved, no stop order went out`,
    stepUnresolvedRealm: (realm, why) =>
      `the tact is refused: ${realm} — a live place's graph is named by its short form and the realm list does not resolve it (${why}); the boundary is incomplete, no cursor moved`,
    stepNoApi: () =>
      "the tact is refused: the api address is unknown — the daemon holds no live channel and no hold records; the channel (the connect answer) carries the api address, not the mcp server",
    stepGone: () =>
      "the tact commits nothing: the caller left before its end — the refusal has already been spoken, no cursor moved",
    tactOut: (realm, invites, signals, cursor, at) =>
      `${realm}: invites ${invites}, signals ${signals}, cursor ${cursor || "—"} (${at})`,
    lead: (lines) => `leading: ${lines}`,
    leadRow: (realm, room, invite, code) => `${realm} case ${room} invite ${invite}: ${code}`,
    leadNotAdmitted: () =>
      "the flag lies, but the machine has not admitted the orchestrator (orchestra on typed at a terminal, or ISKRON_ORCHESTRA=1 in the daemon's environment) — no agent is raised or extinguished",
    leadIncomplete: (errors) =>
      `the demands snapshot is incomplete (${errors}) — nothing raised or extinguished by it`,
    leadNoLaunchers: (why) =>
      `the launcher descriptions in mind did not read (${why}) — nothing is raised`,
    leadDescription: (what, code) =>
      `the launcher description ${what} in mind: ${code} — nothing is raised by it`,
    leadOrdersUnread: (why) =>
      `the account's orders did not read (${why}) — a stop on demand of a raised seat is seen by the next tact`,
    brief: (realm, karta, room, invite) =>
      `You are already taken: the orchestrator raised you for invite ${invite} of case ${room} in graph ${realm}, role #${karta}, and your seat stood by the first line. ` +
      `Do not register again. Before any work join the case: ${tool("case")}(action="join", realm="${realm}", room="${room}"). ` +
      "Read the case assignment and its acceptance criteria; do not invent a task.",
    plan: (rows) =>
      `dry run — nothing launched, ordered or moved (Orca not asked):${rows ? `\n${rows}` : " no invites"}`,
    planLaunch: (argv) => `would launch: ${argv}`,
    planRefuse: (code) => `would refuse: ${code}`,
    planAlready: (state) => `already in the registry: ${state}`,
    planCheckout: (repository) => `<orca checkout of ${repository}>`,
    planClone: (url, destination) =>
      `if Orca has no checkout — would clone ${url} into ${destination}`,
    planNoClone: (code) => `if Orca has no checkout — ${code}`,
    planBrief: () => "<brief>",
    describeWritten: (launcher, seq, holon) =>
      `the description of launcher ${launcher} written in mind${seq ? ` (#${seq})` : ""}` +
      (holon
        ? ` under the holon of the work with agents ${holon}`
        : " at the root: no single holon of the work with agents (holding slice:agents cards) was found — move it under one when there is"),
    describeTooLong: (launcher, max) =>
      `launcher name ${launcher} is longer than ${max} characters — the bridge would not take such a description; name it shorter, the flag is not moved`,
    describeTaken: (launcher, seq) =>
      `launcher ${launcher}: the existing description is taken from mind (${seq}), untouched — edit it there`,
    describeNoModel: (launcher) =>
      `no description of launcher ${launcher} in mind, and none is written without --model — name the models (--model <id>, any number); the flag is not moved`,
    describeFailed: (launcher, why) =>
      `the description of launcher ${launcher} did not read or write (${why}) — the flag is not moved`,
    describeName: (launcher) => `🚀 Agent launcher ${launcher}`,
    describeReason: () => "the human switched raising on with orchestra on --launcher",
  },
};
