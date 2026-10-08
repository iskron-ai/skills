// Слова занятости стояния (граф @nks/nks-dev, узлы #6509, #5395): строка
// занятости, отказы без статусного адреса и путь передачи слуха целиком.
import type { Lang } from "../lang.ts";

export interface StatusWords {
  /** label — место (placeDerived/placeUnnamed либо адрес); nudge — с ведущим «; » либо пустая. */
  busyLine: (label: string, line: string, nudge: string) => string;
  placeDerived: (place: string) => string;
  /** name — имя места либо пустая строка. */
  placeUnnamed: (name: string) => string;
  evictedWhy: () => string;
  reopeningWhy: () => string;
  noSeatId: (key: string) => string;
  /** Путь передачи слуха целиком (#5395). */
  takePath: () => string;
  /** Отказ 404: адрес повернул чужой connect. */
  turnedGuidance: () => string;
  notHeld: () => string;
  notHeldNone: () => string;
  /** list — живые мосты этой машины, сведённые ядром в строку. */
  notHeldList: (list: string) => string;
  whereCwd: (cwd: string) => string;
  whereClient: (client: string) => string;
}

const TAKE_PATH_RU =
  "iskron_stand с take=true — только по слову человека — переносит слух и статусный адрес сюда ОДИН раз: адрес остаётся у ЭТОГО экземпляра моста, " +
  "и поднятый следом сторож его не уносит — по устройству: сторож есть локальный клиент сокета, своего connect он не делает (замер: два вызова занятости подряд при живом стороже, сборка 6.10.1; путь take наблюдала сторона nks-mcp на своей). Прежний держатель получит закрытие 4000 " +
  "(вытесненному отбивать место назад тем же ходом не нужно — ему место рядом, имя.N); входной адрес и очередь места connect не трогает, ждавшее придёт в hello " +
  '(справка iskron_channel action="?", connect); после переноса перевзведи сторожа командой из ответа';
const TAKE_PATH_EN =
  "iskron_stand with take=true — only on the human's word — moves the hearing and the status address here ONCE: the address stays with THIS bridge instance, " +
  "and a watchdog raised after it does not carry it off — by design: the watchdog is a local client of the socket and makes no connect of its own. The former holder gets close 4000 " +
  "(the evicted one need not take the seat back the same way — it gets a seat beside, name.N); connect does not touch the seat's incoming address and queue, what waited comes in hello " +
  '(help: iskron_channel action="?", connect); after the move re-arm the watchdog with the command from the answer';

const TWO_ENTRIES_RU =
  "Если место — твоё и держит его мост этой же сессии (в ней две записи iskron, плагинная и пользовательская), зови status тем же набором тулов, которым звал iskron_stand: передача не нужна.";
const TWO_ENTRIES_EN =
  "If the seat is yours and a bridge of this same session holds it (the session has two iskron entries, the plugin's and the user's), call status with the same tool set you called iskron_stand with: no move is needed.";

const TURNED_RU = `${TWO_ENTRIES_RU} Иначе ${TAKE_PATH_RU}.`;
const TURNED_EN = `${TWO_ENTRIES_EN} Otherwise ${TAKE_PATH_EN}.`;

const NOT_HELD_RU = "Отказано (мост): этот мост места не держит, статусного адреса у него нет.";
const NOT_HELD_EN = "Refused (bridge): this bridge holds no seat, it has no status address.";

export const STATUS: Readonly<Record<Lang, StatusWords>> = {
  ru: {
    busyLine: (label, line, nudge) => `занятость ${label}: ${line || "(снята)"}${nudge}`,
    placeDerived: (place) => `${place} (адрес выведен, hello его не называл)`,
    placeUnnamed: (name) =>
      `места${name ? ` «${name}»` : ""} (адреса @handle:name ещё нет — hello не пришёл)`,
    evictedWhy: () =>
      "слух у другого держателя — вернуть его iskron_stand с take=true только по слову человека",
    reopeningWhy: () => "сокет переоткрывается — строка опубликована, слух вернётся сам",
    noSeatId: (key) =>
      `Отказано (мост): id места ${key} у моста ещё не известен (hello его не назвал) — без него строка легла бы на все места канала; повтори iskron_stand этого графа.`,
    takePath: () => TAKE_PATH_RU,
    turnedGuidance: () => TURNED_RU,
    notHeld: () => NOT_HELD_RU,
    notHeldNone: () =>
      `${NOT_HELD_RU} Назовись одним вызовом iskron_stand(realm, karta, model, status) — занятость можно передать прямо в нём. ` +
      `Если место слушает другой держатель, iskron_stand скажет это; тогда ${TAKE_PATH_RU}.`,
    notHeldList: (list) =>
      `${NOT_HELD_RU} Места этого графа на этой машине держат живые мосты: ${list}. ${TURNED_RU}`,
    whereCwd: (cwd) => `каталог ${cwd}`,
    whereClient: (client) => `харнесс ${client}`,
  },
  en: {
    busyLine: (label, line, nudge) => `busyness ${label}: ${line || "(cleared)"}${nudge}`,
    placeDerived: (place) => `${place} (address derived, hello did not name it)`,
    placeUnnamed: (name) =>
      `of the seat${name ? ` «${name}»` : ""} (no @handle:name address yet — hello has not come)`,
    evictedWhy: () =>
      "the hearing is with another holder — take it back by iskron_stand with take=true only on the human's word",
    reopeningWhy: () =>
      "the socket is reopening — the line is published, the hearing comes back by itself",
    noSeatId: (key) =>
      `Refused (bridge): the bridge does not yet know the id of the seat ${key} (hello did not name it) — without it the line would land on all seats of the channel; repeat iskron_stand for this graph.`,
    takePath: () => TAKE_PATH_EN,
    turnedGuidance: () => TURNED_EN,
    notHeld: () => NOT_HELD_EN,
    notHeldNone: () =>
      `${NOT_HELD_EN} Introduce yourself with one call iskron_stand(realm, karta, model, status) — busyness can be passed right in it. ` +
      `If another holder listens on the seat, iskron_stand will say so; then ${TAKE_PATH_EN}.`,
    notHeldList: (list) =>
      `${NOT_HELD_EN} Seats of this graph on this machine are held by live bridges: ${list}. ${TURNED_EN}`,
    whereCwd: (cwd) => `directory ${cwd}`,
    whereClient: (client) => `harness ${client}`,
  },
};
