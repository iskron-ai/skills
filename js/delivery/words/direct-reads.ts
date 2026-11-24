import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface DirectReadWords {
  word: (list: string) => string;
}

export const DIRECT_READ_WORD: Readonly<Record<Lang, DirectReadWords>> = {
  en: {
    word: (list) =>
      `Graph reads — ${list} — are direct tool calls outside execute; search() inside execute does not list them. Every other ${tool("*")} tool is called inside execute.`,
  },
  ru: {
    word: (list) =>
      `Чтение графа — ${list} — вызывается напрямую, вне execute; search() внутри execute их не показывает. Все остальные тулы ${tool("*")} вызываются внутри execute.`,
  },
};
