// Слова родов комнаты (граф @nks/nks-dev, узлы #5851, #5893; английские — именами
// нормы #6075). Аргументы приходят готовыми строками: обязательное поле ядро
// отдаёт значением или «?», необязательное — с разделителем впереди или пустым
// (shared/room-fields.ts: need, opt). Где разделитель — слово языка, функция
// получает голое значение (пустое — поля нет).
import type { Lang } from "../lang.ts";

export interface RoomWords {
  said: (author: string) => string;
  saidPending: (author: string) => string;
  /** Адресное слово не мне (#6081): факт без тела; череда одной пары — одной строкой. */
  aside: (author: string, addressee: string, word: string) => string;
  asideRun: (author: string, addressee: string, count: string, word: string) => string;
  /** Тело адресного слова не мне без самого слова в пачке — продолжение, не новое слово. */
  asideBody: (author: string, addressee: string, word: string) => string;
  /** Число слов череды: 1 слово, 3 слова, 5 слов. */
  messages: (n: number) => string;
  body: (refersTo: string, author: string) => string;
  bodyAborted: (refersTo: string) => string;
  bodyLapsed: (refersTo: string) => string;
  /** evidence — голое значение. */
  closing: (author: string, endsAt: string, evidence: string) => string;
  closingMay: (entryId: string) => string;
  closingNot: () => string;
  closed: (reason: string) => string;
  objection: (author: string, reason: string) => string;
  lateObjection: (author: string) => string;
  /** Строка гроссбуха — ровно «[было] [сделал] = вердикт», примечание к не-ok, автор хвостом. */
  progress: (key: string, done: string, verdict: string, note: string, author: string) => string;
  opened: (author: string) => string;
  joined: (who: string) => string;
  /** reason — голое значение. */
  left: (who: string, reason: string) => string;
  invite: (author: string, who: string) => string;
  withdraw: (author: string) => string;
  node: (seq: string, name: string, realm: string, reasoning: string) => string;
  nodeUpdated: (seq: string, name: string, reasoning: string) => string;
  nodeDeleted: (seq: string, name: string, reasoning: string) => string;
  nodeUndeleted: (seq: string, name: string, reasoning: string) => string;
  link: (room: string, rel: string) => string;
  /** Запись платформы auto с code, которого нет в ROOM_AUTO. */
  auto: (code: string, room: string) => string;
  unknown: (kind: string) => string;
  // Короткий кадр (frame-text.ts): дело, кто говорит, ответ — без сырого конверта.
  case: (room: string) => string;
  replyTo: (id: string) => string;
  stale: () => string;
  bodyRead: (how: string) => string;
  whoHuman: (user: string) => string;
  whoRole: (karta: string) => string;
  whoSibling: (karta: string) => string;
  whoPlatform: () => string;
  whoGraph: () => string;
  /** stack — голое значение. */
  legacy: (kind: string, stack: string) => string;
}

export const ROOM: Readonly<Record<Lang, RoomWords>> = {
  ru: {
    said: (author) => `слово от ${author}`,
    saidPending: (author) => `слово от ${author} в полёте — текст придёт следом`,
    aside: (author, addressee, word) => `${author} → ${addressee}: слово [${word}]`,
    asideRun: (author, addressee, count, word) =>
      `${author} → ${addressee}: ${count} (последнее [${word}])`,
    asideBody: (author, addressee, word) => `${author} → ${addressee}: текст слова [${word}]`,
    messages: (n) => {
      const m10 = n % 10;
      const m100 = n % 100;
      const w =
        m10 === 1 && m100 !== 11
          ? "слово"
          : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
            ? "слова"
            : "слов";
      return `${n} ${w}`;
    },
    body: (refersTo, author) => `текст слова [${refersTo}] от ${author}`,
    bodyAborted: (refersTo) => `слово [${refersTo}] оборвано автором`,
    bodyLapsed: (refersTo) => `слово [${refersTo}] оборвано платформой по сроку`,
    closing: (author, endsAt, evidence) =>
      `ведущий ${author} предлагает закрыть дело до ${endsAt}${evidence ? `; свидетельства: ${evidence}` : ""}`,
    closingMay: (entryId) =>
      `ты можешь возразить — iskron_case(action="object", in_reply_to=${entryId}) (прежнее имя iskron_room)`,
    closingNot: () => "возражать не тебе",
    closed: (reason) => `дело закрыто: ${reason}`,
    objection: (author, reason) => `${author} возражает против закрытия: ${reason}`,
    lateObjection: (author) => `${author} возразил после закрытия`,
    progress: (key, done, verdict, note, author) =>
      `[${key}] [${done}] = ${verdict}${note} · ${author}`,
    opened: (author) => `дело открыл ${author}`,
    joined: (who) => `вошёл ${who}`,
    left: (who, reason) => `вышел ${who}${reason ? `; причина: ${reason}` : ""}`,
    invite: (author, who) => `${author} зовёт ${who} в дело`,
    withdraw: (author) => `приглашение отозвано, отзывает ${author}`,
    node: (seq, name, realm, reasoning) => `в деле узел #${seq} ${name} (${realm})${reasoning}`,
    nodeUpdated: (seq, name, reasoning) => `узел #${seq} ${name} обновлён${reasoning}`,
    nodeDeleted: (seq, name, reasoning) => `узел #${seq} ${name} удалён${reasoning}`,
    nodeUndeleted: (seq, name, reasoning) => `узел #${seq} ${name} восстановлен${reasoning}`,
    link: (room, rel) => `дело связано с №${room} (${rel})`,
    auto: (code, room) => `запись платформы ${code} о деле №${room}`,
    unknown: (kind) => `род ${kind} мосту неизвестен`,
    case: (room) => `№${room}`,
    replyTo: (id) => `в ответ на [${id}]`,
    stale: () => "лежалый",
    bodyRead: (how) => `тело: ${how}`,
    whoHuman: (user) => `человек${user}`,
    whoRole: (karta) => `роль #${karta}`,
    whoSibling: (karta) => `брат по роли #${karta}`,
    whoPlatform: () => "платформа — побудка",
    whoGraph: () => "событие графа",
    legacy: (kind, stack) => `род ${kind}${stack ? `, стопка ${stack}` : ""}`,
  },
  en: {
    said: (author) => `message from ${author}`,
    saidPending: (author) => `message from ${author} in flight — the text follows`,
    aside: (author, addressee, word) => `${author} → ${addressee}: message [${word}]`,
    asideRun: (author, addressee, count, word) =>
      `${author} → ${addressee}: ${count} (last [${word}])`,
    asideBody: (author, addressee, word) => `${author} → ${addressee}: text of message [${word}]`,
    messages: (n) => `${n} ${n === 1 ? "message" : "messages"}`,
    body: (refersTo, author) => `text of message [${refersTo}] from ${author}`,
    bodyAborted: (refersTo) => `message [${refersTo}] cut off by its author`,
    bodyLapsed: (refersTo) => `message [${refersTo}] cut off by the platform on its deadline`,
    closing: (author, endsAt, evidence) =>
      `the lead ${author} proposes to close the case by ${endsAt}${evidence ? `; evidence: ${evidence}` : ""}`,
    closingMay: (entryId) =>
      `you may object — iskron_case(action="object", in_reply_to=${entryId}) (former name iskron_room)`,
    closingNot: () => "the objection is not yours to make",
    closed: (reason) => `case closed: ${reason}`,
    objection: (author, reason) => `${author} objects to closing: ${reason}`,
    lateObjection: (author) => `${author} objected after the close`,
    progress: (key, done, verdict, note, author) =>
      `[${key}] [${done}] = ${verdict}${note} · ${author}`,
    opened: (author) => `case opened by ${author}`,
    joined: (who) => `entered ${who}`,
    left: (who, reason) => `left ${who}${reason ? `; reason: ${reason}` : ""}`,
    invite: (author, who) => `${author} invites ${who} to the case`,
    withdraw: (author) => `invitation withdrawn by ${author}`,
    node: (seq, name, realm, reasoning) =>
      `node #${seq} ${name} (${realm}) in the case${reasoning}`,
    nodeUpdated: (seq, name, reasoning) => `node #${seq} ${name} updated${reasoning}`,
    nodeDeleted: (seq, name, reasoning) => `node #${seq} ${name} deleted${reasoning}`,
    nodeUndeleted: (seq, name, reasoning) => `node #${seq} ${name} restored${reasoning}`,
    link: (room, rel) => `case linked to case №${room} (${rel})`,
    auto: (code, room) => `platform record ${code} about case №${room}`,
    unknown: (kind) => `kind ${kind} is unknown to the bridge`,
    case: (room) => `case №${room}`,
    replyTo: (id) => `in reply to [${id}]`,
    stale: () => "stale",
    bodyRead: (how) => `body: ${how}`,
    whoHuman: (user) => `human${user}`,
    whoRole: (karta) => `role #${karta}`,
    whoSibling: (karta) => `sibling of role #${karta}`,
    whoPlatform: () => "platform — a wake-up",
    whoGraph: () => "graph event",
    legacy: (kind, stack) => `kind ${kind}${stack ? ` · ${stack}` : ""}`,
  },
};

/** Слова записи платформы auto по её code (#5893 §4.2, ступени — #5973). */
export interface RoomAutoWords {
  child_opened: (room: string) => string;
  child_closing: (room: string) => string;
  child_closed: (room: string) => string;
  child_late_objection: (room: string) => string;
}

export const ROOM_AUTO: Readonly<Record<Lang, RoomAutoWords>> = {
  ru: {
    child_opened: (room) => `дочернее дело №${room} открыто`,
    child_closing: (room) => `дочернее дело №${room} закрывается`,
    child_closed: (room) => `дочернее дело №${room} закрыто`,
    child_late_objection: (room) => `позднее возражение в дочернем деле №${room}`,
  },
  en: {
    child_opened: (room) => `child case №${room} opened`,
    child_closing: (room) => `child case №${room} is closing`,
    child_closed: (room) => `child case №${room} closed`,
    child_late_objection: (room) => `late objection in child case №${room}`,
  },
};

/** Связь дел link по rel (#4915): чем это дело приходится связанному. */
export interface RoomRelWords {
  parent: () => string;
  child: () => string;
  continues: () => string;
}

export const ROOM_REL: Readonly<Record<Lang, RoomRelWords>> = {
  ru: {
    parent: () => "дочернее к нему",
    child: () => "родительское к нему",
    continues: () => "продолжает его",
  },
  en: {
    parent: () => "its child",
    child: () => "its parent",
    continues: () => "continues it",
  },
};

/** Вердикт строки словом нормы (#744, #6075): провод несёт ok | partial | bad. */
export interface VerdictWords {
  ok: () => string;
  partial: () => string;
  bad: () => string;
}

export const VERDICT: Readonly<Record<Lang, VerdictWords>> = {
  ru: { ok: () => "ok", partial: () => "частично", bad: () => "slop" },
  en: { ok: () => "ok", partial: () => "partial", bad: () => "slop" },
};
