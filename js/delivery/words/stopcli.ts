// Подкоманда stop: человек снимает место агента с машины (граф @nks/nks-dev, узлы #7518,
// #5085; контракт приказа — дело №669): приказ останова, на старом api — снятие места.
import type { Lang } from "../lang.ts";

export interface StopCliWords {
  usage: () => string;
  noDaemon: () => string;
  notFound: (target: string) => string;
  /** list — кандидаты через запятую. */
  ambiguous: (target: string, list: string) => string;
  noId: (seat: string) => string;
  noRecord: (seat: string) => string;
  noKey: () => string;
  ordered: (seat: string, order: string) => string;
  revoked: (seat: string) => string;
  gone: (seat: string) => string;
  refused: (seat: string, how: string, status: number, body: string) => string;
  unreachable: (seat: string, why: string) => string;
}

export const STOP_CLI: Readonly<Record<Lang, StopCliWords>> = {
  ru: {
    usage: () =>
      "использование: stop <место|id сессии> [--realm <граф>] [--auth-dir <dir>] [--lang en|ru]\n",
    noDaemon: () =>
      "демон машины не ответил снимком — живых мест не видно; место, которое держит мост мимо демона, снимает его сессия (iskron_channel action=revoke)",
    notFound: (target) =>
      `ни сессии, ни места «${target}» у демона машины нет — имена и id сессий печатает status`,
    ambiguous: (target, list) =>
      `«${target}» называет несколько мест: ${list} — уточни --realm или назови id сессии`,
    noId: (seat) =>
      `id места ${seat} мосту ещё не известен (hello его не назвал) — приказ адресовать нечем; повтори позже`,
    noRecord: (seat) =>
      `записи держания места ${seat} на диске нет — адрес api этого места неизвестен`,
    noKey: () =>
      "ключа учётки нет — ни личного токена, ни гранта OAuth в каталоге гранта; вход — establish-mcp",
    ordered: (seat, order) =>
      `приказ останова выдан месту ${seat}${order ? ` (приказ ${order})` : ""}: мост погасит агента и ответит исходом; ушло ли место — status`,
    revoked: (seat) =>
      `api без приказа останова (404 ручки) — место ${seat} снято (revoke): агент гаснет по закрытию сокета`,
    gone: (seat) => `место ${seat} уже снято (410)`,
    refused: (seat, how, status, body) => `место ${seat}: ${how} отказан (${status}) — ${body}`,
    unreachable: (seat, why) => `место ${seat}: api не ответил — ${why}`,
  },
  en: {
    usage: () =>
      "usage: stop <seat|session id> [--realm <graph>] [--auth-dir <dir>] [--lang en|ru]\n",
    noDaemon: () =>
      "the machine daemon gave no snapshot — no live seats are seen; a seat a bridge holds past the daemon is revoked by its session (iskron_channel action=revoke)",
    notFound: (target) =>
      `the machine daemon has neither a session nor a seat «${target}» — status prints the names and session ids`,
    ambiguous: (target, list) =>
      `«${target}» names several seats: ${list} — narrow it by --realm or name the session id`,
    noId: (seat) =>
      `the bridge does not know the id of the seat ${seat} yet (hello did not name it) — the order has no address; repeat later`,
    noRecord: (seat) =>
      `there is no hold record of the seat ${seat} on disk — the seat's api address is unknown`,
    noKey: () =>
      "no account key — neither a personal token nor an OAuth grant in the grant directory; sign in — establish-mcp",
    ordered: (seat, order) =>
      `a stop order is issued to the seat ${seat}${order ? ` (order ${order})` : ""}: the bridge puts the agent down and answers the outcome; whether the seat went — status`,
    revoked: (seat) =>
      `the api has no stop order (404 of the route) — the seat ${seat} is revoked: the agent goes down on the socket's close`,
    gone: (seat) => `the seat ${seat} is already ended (410)`,
    refused: (seat, how, status, body) => `seat ${seat}: ${how} refused (${status}) — ${body}`,
    unreachable: (seat, why) => `seat ${seat}: the api did not answer — ${why}`,
  },
};
