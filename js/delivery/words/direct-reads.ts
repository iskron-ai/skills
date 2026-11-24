import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

const names = ["look", "orient", "search", "semantic_search", "history"].map(tool);
const list = names.join(", ");

export const DIRECT_READ_NAMES: readonly string[] = names;
export const DIRECT_READ_WORD: Readonly<Record<Lang, string>> = {
  en: `Graph reads — ${list} — are direct tool calls outside execute; search() inside execute does not list them. Every other ${tool("*")} tool is called inside execute.`,
  ru: `Чтение графа — ${list} — вызывается напрямую, вне execute; search() внутри execute их не показывает. Все остальные тулы ${tool("*")} вызываются внутри execute.`,
};
