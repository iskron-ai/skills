// Список тулов сессии харнеса — снимок на её старте: харнес не перечитывает
// его, пока сервер не скажет, что он изменился, а выкатка сервера рвёт сессию
// моста молча (граф nks-dev: #5405). Мост помнит отпечаток отданного списка и,
// переоткрыв сессию к серверу, сверяет его со свежим: разошёлся — харнесу
// уходит notifications/tools/list_changed, и он читает список заново.
import { createHash } from "node:crypto";

import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

let served: string | null = null;

/** Отпечаток по именам и схемам: описания мост дописывает сам, их различие — не перемена сервера. */
export function toolsPrint(result: unknown): string | null {
  const tools = (result as { tools?: { name?: string; inputSchema?: unknown }[] } | null)?.tools;
  if (!Array.isArray(tools)) return null;
  const shape = tools
    .map((t) => [t.name ?? "", JSON.stringify(t.inputSchema ?? null)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

/** Харнесу отдан список (живой или из кэша): запомнить, что он теперь знает. */
export function noteServedTools(result: unknown): void {
  const print = toolsPrint(result);
  if (print) served = print;
}

/**
 * Сессия к серверу открыта заново: спросить список и сверить с отданным.
 * `ask` — вызов tools/list по новой сессии; `emit` — слово харнесу.
 */
export async function recheckTools(
  ask: () => Promise<JsonRpcMessage | null>,
  emit: (m: JsonRpcMessage) => void,
): Promise<void> {
  if (!served) return; // харнес списка ещё не просил — сверять не с чем
  const fresh = toolsPrint((await ask().catch(() => null))?.result);
  if (!fresh || fresh === served) return;
  served = fresh;
  log("tool list changed under the re-opened session — telling the harness (tools/list_changed)");
  emit({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
}
