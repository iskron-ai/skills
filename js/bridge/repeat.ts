// Какой запрос к MCP мост повторяет сам, когда соединение закрылось под ним до
// ответа (keep-alive из пула, закрытый сервером: ECONNRESET у Bun, UND_ERR_SOCKET у
// Node; граф nks-dev: #6630). Сервер мог запрос и прочесть: повтор — только там, где
// второй раз ничего не применит. Записи харнеса (iskron_case, iskron_add_*, update,
// revoke, leave…) не повторяются: исход их — «неизвестен», как прежде (deliver.ts).
// connect тоже: прочитанный сервером, он уже выдал место-адрес, и второй повернул бы его.
import { type JsonRpcMessage } from "./types.ts";

/** id собственных вызовов моста (call.ts) — не харнеса. */
export const OWN_CALL_PREFIX = "iskron-bridge-call-";

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
  const action = String(msg.params?.arguments?.action ?? "");
  if (ownPlaceEnd(msg, name, action)) return true;
  return !!SAFE_ACTIONS[name]?.has(action);
}

/**
 * revoke и close собственного места, которые мост шлёт сам на конце прогона (caseexit.ts,
 * id своего вызова — call.ts): повтор на уже снятом месте отвечает «закрыто» и ничего не
 * применяет дважды, а без повтора место висело на доске до срока канала (e2e12, №147).
 * revoke харнеса сюда не входит: его исход по-прежнему «неизвестен».
 */
function ownPlaceEnd(msg: JsonRpcMessage, name: string, action: string): boolean {
  return (
    name === "iskron_channel" &&
    (action === "revoke" || action === "close") &&
    String(msg.id ?? "").startsWith(OWN_CALL_PREFIX)
  );
}
