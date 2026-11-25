// Слова текста кадра и строк счёта дела (ядро shared/frame-text.ts), автор-платформа
// рода комнаты (shared/room-kinds.ts) и кавычки ответа вопроса (shared/asks.ts).
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface ClockNoticeFacts {
  room: number | null;
  roomId: string | null;
  realm: string | null;
  entry: number | null;
  key: string | null;
  standing: string | null;
  standingId: string | null;
  karta: number | null;
  /**
   * Род адресата словом сервера (#11372): «person» — карточка человеку, факты места к ней не
   * относятся; null — сервер не сказал, и мост ничего не выводит сам.
   */
  kind: string | null;
  /** Факты доставки человеку от сервера — как пришли: [поле, значение]. */
  delivery: [string, string][];
  listening: boolean | null;
  lastAct: string | null;
  roleCalled: boolean | null;
  due: string | null;
  escalated: boolean | null;
}

function clockNotice(
  lang: Lang,
  kind: "card_unanswered" | "line_due",
  f: ClockNoticeFacts,
): string {
  const ru = lang === "ru";
  const unknown = ru ? "неизвестно" : "unknown";
  const flag = (v: boolean | null) =>
    v === null ? unknown : v ? (ru ? "да" : "yes") : ru ? "нет" : "no";
  const head =
    kind === "card_unanswered"
      ? ru
        ? "карточка без ответа"
        : "unanswered card"
      : ru
        ? "срок строки"
        : "line due";
  const ref = `${ru ? "дело" : "case"} №${f.room ?? unknown} (id: ${f.roomId ?? unknown}, ${ru ? "граф" : "realm"}: ${f.realm ?? unknown}) [${f.entry ?? unknown}], ${ru ? "ключ" : "key"}: ${f.key ?? unknown}`;
  const last = `${ru ? "последний ход" : "last action"}: ${f.lastAct ?? unknown}`;
  // Человек — только словом сервера (#11372): мост рода адресата не выводит; человеку — не факты
  // места, а доставка, как её назвал сервер; не назвал — «неизвестно», не «нет».
  const person = kind === "card_unanswered" && f.kind === "person";
  const role = `${ru ? "роль" : "role"}: ${f.karta ?? unknown}`;
  const said = f.kind && !person ? `, ${ru ? "род" : "kind"}: ${f.kind}` : "";
  const who = person
    ? `${ru ? "адресат — человек" : "recipient is a person"} (${role})`
    : `${kind === "card_unanswered" ? (ru ? "адресат" : "recipient") : ru ? "держатель" : "holder"}: ${f.standing ?? unknown} (id: ${f.standingId ?? unknown}, ${role}${said})`;
  const delivered = f.delivery.length
    ? f.delivery.map(([k, v]) => `${k}: ${v}`).join(", ")
    : unknown;
  const facts =
    kind === "line_due"
      ? `${ru ? "срок" : "due"}: ${f.due ?? unknown}; ${ru ? "передано постановщику" : "escalated"}: ${flag(f.escalated)}`
      : person
        ? `${ru ? "доставка" : "delivery"}: ${delivered}; ${last}`
        : `${ru ? "слушает" : "listening"}: ${flag(f.listening)}; ${last}; ${ru ? "роль позвана" : "role called"}: ${flag(f.roleCalled)}`;
  return `${head}: ${ref}; ${who}; ${facts}`;
}

/** Карточка перечня у счёта (#11342): room — номер дела, entry — запись, asker — словами `openCardAsker`. */
export interface OpenCardItem {
  room: number | null;
  entry: number | null;
  key: string | null;
  asker: string;
}

export interface FrameTextWords {
  clockNotice: (kind: "card_unanswered" | "line_due", facts: ClockNoticeFacts) => string;
  cardRepeat: (n: number | null) => string;
  openCards: (
    count: number | null,
    oldest: string | null,
    malformed?: boolean,
    items?: readonly OpenCardItem[],
  ) => string;
  /** Спросивший карточки перечня: место; роль без места; неизвестно. */
  openCardAsker: (standing: string | null, karta: number | null) => string;
  /** Одна карточка перечня: дело, запись, ключ, спросивший. */
  openCard: (item: OpenCardItem) => string;
  /**
   * Куда вести за не вошедшим и пропавшим: дела места — журнала канала у сервера нет
   * (граф @nks/nks-dev, узел #7636).
   */
  myCases: () => string;
  /** Род кадра без словаря: «кадр <id>». */
  frame: (id: string) => string;
  /** Хвост строки счёта: есть ли адресованные месту строками ниже. */
  yoursBelow: () => string;
  noneYours: () => string;
  /** head — «№N «зачин»», n — записей после свёртки, mine — адресованных месту. */
  count: (head: string, n: number, mine: number) => string;
  supersededLines: (gone: number) => string;
  /** Чужая запись закрыла вопрос ко мне [n] (#6867): ответил by — без её текста. */
  askAnswered: (n: string, by: string) => string;
  /** Переспрос на ключе вопроса ко мне [n] другому адресату to. */
  askMoved: (n: string, to: string) => string;
  /** Указание, где читать целиком: args — аргументы history дела через «; »; пусто — дела места. */
  inFull: (cases: string) => string;
  /** Вызов history одного дела. */
  caseHistory: (args: string, since: number | string) => string;
  /** Под текстом побудки о живости (дело №1046): чем на неё ответить. */
  lifeCheckReply: () => string;
  /** Какое место побудка предупредила; пусто — платформа места не назвала. */
  lifeCheckSeat: (name: string) => string;
  /**
   * Строка ответа под прямым словом человека из окна (#9128): чем ответить на слово,
   * чтобы ответ встал в окне под ним. realm — граф кадра, karta — роль человека
   * (from_karta_seq, иначе user_karta_seq), standing — место человека (provenance),
   * id — слова; у send они обязательны, ответ исполняется по строке.
   */
  humanWordReply: (realm: string, karta: string, standing: string, id: string) => string;
  /**
   * Адреса для ответа нет (#9128): true — какой части не хватает (realm — граф кадра,
   * karta — роль человека, standing — его место, id — слово). Сказать явно, чтобы агент
   * не искал адрес.
   */
  noReplyAddress: (missing: {
    realm: boolean;
    karta: boolean;
    standing: boolean;
    id: boolean;
  }) => string;
}

export const FRAME_TEXT: Readonly<Record<Lang, FrameTextWords>> = {
  ru: {
    clockNotice: (kind, facts) => clockNotice("ru", kind, facts),
    cardRepeat: (n) => `повтор карточки: ${n ?? "номер неизвестен"}`,
    openCards: (count, oldest, malformed = false, items) =>
      `карточек без ответа: ${count ?? "неизвестно"}${oldest ? `; старшая с ${oldest}` : ""}${malformed ? " (неверное my_open_cards)" : ""}${items?.length ? ` — ${items.map(FRAME_TEXT.ru.openCard).join("; ")}` : ""}`,
    openCardAsker: (standing, karta) =>
      standing ?? (karta === null ? "неизвестно" : `роль ${karta}`),
    openCard: ({ room, entry, key, asker }) =>
      `дело №${room ?? "неизвестно"} [${entry ?? "неизвестно"}], ключ: ${key ?? "неизвестно"}, спросил: ${asker}`,
    myCases: () => `${tool("case")}(action="mine"), затем read каждого`,
    frame: (id) => `кадр ${id}`,
    yoursBelow: () => ` — адресованные строками ниже; `,
    noneYours: () => ` — адресованных месту нет; `,
    count: (head, n, mine) => `${head}: записей ${n}, тебе ${mine}`,
    supersededLines: (gone) => `, сменённых строк ключа ${gone}`,
    askAnswered: (n, by) => `; вопрос [${n}] к тебе закрыт: ответил ${by}`,
    askMoved: (n, to) => `; вопрос [${n}] к тебе переадресован ${to}`,
    inFull: (cases) => `целиком — ${cases || FRAME_TEXT.ru.myCases()}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`,
    lifeCheckReply: () =>
      `Ответь действием: обнови занятость — ${tool("stand")}(realm, status=<чем занят>) — или скажи в деле.`,
    lifeCheckSeat: (name) => `Предупреждено место: ${name || "место не названо платформой"}.`,
    humanWordReply: (realm, karta, standing, id) =>
      `ответ: ${tool("channel")}(action="send", realm=${realm}, karta=${karta}, standing=${standing}, in_reply_to=${id}, text=…)`,
    noReplyAddress: (m) =>
      `адреса для ответа нет: ${[
        m.realm && "графа",
        m.karta && "роли человека",
        m.standing && "места человека",
        m.id && "id слова",
      ]
        .filter(Boolean)
        .join(", ")}`,
  },
  en: {
    clockNotice: (kind, facts) => clockNotice("en", kind, facts),
    cardRepeat: (n) => `card repeat: ${n ?? "number unknown"}`,
    openCards: (count, oldest, malformed = false, items) =>
      `unanswered cards: ${count ?? "unknown"}${oldest ? `; oldest since ${oldest}` : ""}${malformed ? " (invalid my_open_cards)" : ""}${items?.length ? ` — ${items.map(FRAME_TEXT.en.openCard).join("; ")}` : ""}`,
    openCardAsker: (standing, karta) => standing ?? (karta === null ? "unknown" : `role ${karta}`),
    openCard: ({ room, entry, key, asker }) =>
      `case №${room ?? "unknown"} [${entry ?? "unknown"}], key: ${key ?? "unknown"}, asked by: ${asker}`,
    myCases: () => `${tool("case")}(action="mine"), then read each`,
    frame: (id) => `frame ${id}`,
    yoursBelow: () => ` — yours in the lines below; `,
    noneYours: () => ` — none of them yours; `,
    count: (head, n, mine) => `${head}: ${n} records, yours ${mine}`,
    supersededLines: (gone) => `, ${gone} superseded lines of a key`,
    askAnswered: (n, by) => `; your question [${n}] is closed: answered by ${by}`,
    askMoved: (n, to) => `; your question [${n}] is re-asked of ${to}`,
    inFull: (cases) => `in full — ${cases || FRAME_TEXT.en.myCases()}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`,
    lifeCheckReply: () =>
      `Answer with an action: update your status — ${tool("stand")}(realm, status=<what you are doing>) — or say a word in the case.`,
    lifeCheckSeat: (name) => `Seat warned: ${name || "the platform did not name the seat"}.`,
    humanWordReply: (realm, karta, standing, id) =>
      `reply: ${tool("channel")}(action="send", realm=${realm}, karta=${karta}, standing=${standing}, in_reply_to=${id}, text=…)`,
    noReplyAddress: (m) =>
      `no address to reply: missing ${[
        m.realm && "the graph",
        m.karta && "the person's role",
        m.standing && "the person's seat",
        m.id && "the word's id",
      ]
        .filter(Boolean)
        .join(", ")}`,
  },
};

export interface CaseLineWords {
  /** Автор записи — платформа. */
  platform: () => string;
  /** Подпись варианта или ответ вопроса в кавычках языка. */
  quote: (s: string) => string;
}

export const CASE_LINE: Readonly<Record<Lang, CaseLineWords>> = {
  ru: {
    platform: () => "платформа",
    quote: (s) => `«${s}»`,
  },
  en: {
    platform: () => "platform",
    quote: (s) => `“${s}”`,
  },
};
