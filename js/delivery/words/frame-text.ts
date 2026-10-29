// Слова текста кадра и строк счёта дела (ядро shared/frame-text.ts), автор-платформа
// рода комнаты (shared/room-kinds.ts) и кавычки ответа вопроса (shared/asks.ts).
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface FrameTextWords {
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
  caseHistory: (args: string, since: number) => string;
  /** Под текстом побудки о живости (дело №1046): чем на неё ответить. */
  lifeCheckReply: () => string;
  /** Какое место побудка предупредила; пусто — платформа места не назвала. */
  lifeCheckSeat: (name: string) => string;
  /**
   * Строка ответа под прямым словом человека из окна (#9128): чем ответить на слово,
   * чтобы ответ встал в окне под ним. standing — место человека (provenance), id — слова.
   */
  humanWordReply: (standing: string, id: string) => string;
}

export const FRAME_TEXT: Readonly<Record<Lang, FrameTextWords>> = {
  ru: {
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
    humanWordReply: (standing, id) =>
      `ответ: ${tool("channel")}(action="send", standing=${standing}, in_reply_to=${id}, text=…)`,
  },
  en: {
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
    humanWordReply: (standing, id) =>
      `reply: ${tool("channel")}(action="send", standing=${standing}, in_reply_to=${id}, text=…)`,
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
