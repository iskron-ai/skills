// Какой запрос к MCP мост повторяет сам, когда соединение закрылось под ним до
// ответа (keep-alive из пула, закрытый сервером: ECONNRESET у Bun, UND_ERR_SOCKET у
// Node; граф nks-dev: #6630). Сервер мог запрос и прочесть: повтор — только там, где
// второй раз ничего не применит. Записи харнеса (iskron_case, iskron_add_*, update,
// revoke, leave…) не повторяются: исход их — «неизвестен», как прежде (deliver.ts).
// connect тоже: прочитанный сервером, он уже выдал место-адрес, и второй повернул бы его.
import { type JsonRpcMessage } from "./types.ts";

/** Тулы, которые только читают: повтор вызова ничего не меняет. */
export const READ_TOOLS = new Set([
  "iskron_look",
  "iskron_orient",
  "iskron_search",
  "iskron_semantic_search",
]);

/**
 * Действия, чей повтор безвреден: чтение доски и списка графов. register не здесь:
 * что двойной register на сервере ничего не меняет, мост показать не может, а его
 * пропуск догоняет ensureStanding перед следующим вызовом.
 */
const SAFE_ACTIONS: Record<string, Set<string>> = {
  iskron_channel: new Set(["list"]),
  iskron_realm: new Set(["list"]),
};

export function repeatable(msg: JsonRpcMessage): boolean {
  if (msg?.id === undefined || msg?.id === null) return true; // уведомление: ответа нет и не ждут
  if (msg.method === "initialize" || msg.method === "tools/list") return true;
  if (msg.method !== "tools/call") return false;
  const name = String(msg.params?.name ?? "");
  if (READ_TOOLS.has(name)) return true;
  return !!SAFE_ACTIONS[name]?.has(String(msg.params?.arguments?.action ?? ""));
}
