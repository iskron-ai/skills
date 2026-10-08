// Слова текста кадра и строк счёта дела (ядро shared/frame-text.ts), автор-платформа
// рода комнаты (shared/room-kinds.ts) и кавычки ответа вопроса (shared/asks.ts).
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface FrameTextWords {
  /** Род кадра без словаря: «кадр <id>». */
  frame: (id: string) => string;
  /** Хвост строки счёта: есть ли адресованные месту строками ниже. */
  yoursBelow: () => string;
  noneYours: () => string;
  /** head — «№N «зачин»», n — записей после свёртки, mine — адресованных месту. */
  count: (head: string, n: number, mine: number) => string;
  supersededLines: (gone: number) => string;
  /** Указание, где читать целиком: args — аргументы history дела через «; »; пусто — history канала. */
  inFull: (cases: string) => string;
  /** Вызов history одного дела. */
  caseHistory: (args: string, since: number) => string;
}

export const FRAME_TEXT: Readonly<Record<Lang, FrameTextWords>> = {
  ru: {
    frame: (id) => `кадр ${id}`,
    yoursBelow: () => ` — адресованные строками ниже; `,
    noneYours: () => ` — адресованных месту нет; `,
    count: (head, n, mine) => `${head}: записей ${n}, тебе ${mine}`,
    supersededLines: (gone) => `, сменённых строк ключа ${gone}`,
    inFull: (cases) => `целиком — ${cases || `${tool("channel")}(action="history")`}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`,
  },
  en: {
    frame: (id) => `frame ${id}`,
    yoursBelow: () => ` — yours in the lines below; `,
    noneYours: () => ` — none of them yours; `,
    count: (head, n, mine) => `${head}: ${n} records, yours ${mine}`,
    supersededLines: (gone) => `, ${gone} superseded lines of a key`,
    inFull: (cases) => `in full — ${cases || `${tool("channel")}(action="history")`}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`,
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
