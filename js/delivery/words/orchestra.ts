// Подкоманда orchestra: ведение агентов оркестратором моста (граф @nks/nks-dev, узлы #7513,
// #7514, #8202): флаг, граница графов и один такт — локальным входом демона машины. Демон —
// владелец запусков; флаг лежит рядом с грантом и переживает перезапуск демона.
import type { Lang } from "../lang.ts";

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
  /** Согласия машины нет: окружение демона не допускает оркестратора. */
  notAdmitted: () => string;
  /** realms — названный перечень границы через запятую (может быть пуст). */
  on: (realms: string) => string;
  off: () => string;
  /** tact — строки курсоров и последних исходов такта через «; » (может быть пуст). */
  status: (on: boolean, realms: string, tact?: string) => string;
  /** Такт пуст: выключен или названная граница пуста — читать нечего. */
  stepEmpty: () => string;
  /** parts — строки графов такта, уже соединённые через «; ». */
  step: (parts: string) => string;
  /** Один граф такта: приглашения, сигналы и их поводы (api-слова поводов). */
  tactRealm: (realm: string, invites: number, signals: number, causes: string) => string;
  /** Почему такт отказан: граф не прочитан; курсоры не двинуты, приказов нет. */
  stepReadError: (realm: string, why: string) => string;
  /** Адрес api неизвестен: нет живого канала и записей мест — адрес несёт канал, не сервер MCP. */
  stepNoApi: () => string;
  /** Строка status о последнем такте графа: исход, курсор и когда. */
  tactOut: (realm: string, invites: number, signals: number, cursor: string, at: string) => string;
}

export const ORCHESTRA: Readonly<Record<Lang, OrchestraWords>> = {
  ru: {
    usage: () =>
      "использование: orchestra <on|off|status|step> [--realm <граф>]… [--auth-dir <dir>] [--lang en|ru]\n",
    noDaemon: () =>
      "демона машины нет — оркестратор живёт демоном и его локальным входом; поднимите мост (любая сессия харнеса поднимает демона) и повторите",
    doorSilent: () =>
      "вход демона не ответил вовремя — демон жив, но занят или сборка старше orchestra; повторите позже",
    unknownOp: (op) => `оркестратор: неизвестное действие ${op}`,
    doorError: (message) => `вход демона ответил ошибкой: ${message}`,
    notAdmitted: () =>
      "машина не допустила оркестратора: согласие даёт демон — переменная окружения ISKRON_ORCHESTRA=1 в его среде; без неё поднятие агентов запрещено, флаг не двинут",
    on: (realms) =>
      `оркестратор включён${realms ? `, названная граница: ${realms}` : " (граница — графы живых на машине агентов)"}; флаг лежит рядом с грантом`,
    off: () =>
      "оркестратор выключен; поднятые агенты доживают свой путь — их не гасит сам факт выключения",
    status: (on, realms, tact) =>
      on
        ? `включён; названная граница: ${realms || "—"} (плюс графы живых на машине агентов)${tact ? `; такт: ${tact}` : ""}`
        : `выключен${tact ? `; такт: ${tact}` : ""}`,
    stepEmpty: () =>
      "такт пуст: оркестратор выключен или названная граница пуста — читать нечего (графы живых на машине агентов подъезжают со срезом подъёма)",
    step: (parts) => `такт прошёл: ${parts}`,
    tactRealm: (realm, invites, signals, causes) =>
      `${realm}: приглашений ${invites}, сигналов ${signals}${causes ? ` (${causes})` : ""}`,
    stepReadError: (realm, why) =>
      `такт отказан целиком: ${realm} не прочитан (${why}) — курсоры не двинуты, приказов останова нет`,
    stepNoApi: () =>
      "такт отказан: адрес api неизвестен — у демона нет живого канала и записей мест; адрес api несёт канал (ответ connect), не сервер MCP",
    tactOut: (realm, invites, signals, cursor, at) =>
      `${realm}: приглашений ${invites}, сигналов ${signals}, курсор ${cursor || "—"} (${at})`,
  },
  en: {
    usage: () =>
      "usage: orchestra <on|off|status|step> [--realm <graph>]… [--auth-dir <dir>] [--lang en|ru]\n",
    noDaemon: () =>
      "the machine daemon is not running — the orchestrator lives by the daemon and its local entrance; raise a bridge (any harness session raises the daemon) and retry",
    doorSilent: () =>
      "the daemon's entrance did not answer in time — the daemon is alive but busy or older than orchestra; retry later",
    unknownOp: (op) => `orchestra: unknown op ${op}`,
    doorError: (message) => `the daemon's entrance answered with an error: ${message}`,
    notAdmitted: () =>
      "the machine has not admitted the orchestrator: the daemon's consent is the ISKRON_ORCHESTRA=1 environment variable of its own process; without it raising agents is refused and the flag is not moved",
    on: (realms) =>
      `the orchestrator is on${realms ? `, named boundary: ${realms}` : " (the boundary is the graphs of the machine's live agents)"}; the flag lies next to the grant`,
    off: () =>
      "the orchestrator is off; raised agents live out their own path — the switching off itself extinguishes none",
    status: (on, realms, tact) =>
      on
        ? `on; named boundary: ${realms || "—"} (plus the graphs of the machine's live agents)${tact ? `; tact: ${tact}` : ""}`
        : `off${tact ? `; tact: ${tact}` : ""}`,
    stepEmpty: () =>
      "the tact is empty: the orchestrator is off or the named boundary is empty — nothing to read (the graphs of the machine's live agents arrive with the raising slice)",
    step: (parts) => `the tact passed: ${parts}`,
    tactRealm: (realm, invites, signals, causes) =>
      `${realm}: invites ${invites}, signals ${signals}${causes ? ` (${causes})` : ""}`,
    stepReadError: (realm, why) =>
      `the tact is refused whole: ${realm} did not read (${why}) — no cursor moved, no stop order went out`,
    stepNoApi: () =>
      "the tact is refused: the api address is unknown — the daemon holds no live channel and no hold records; the channel (the connect answer) carries the api address, not the mcp server",
    tactOut: (realm, invites, signals, cursor, at) =>
      `${realm}: invites ${invites}, signals ${signals}, cursor ${cursor || "—"} (${at})`,
  },
};
