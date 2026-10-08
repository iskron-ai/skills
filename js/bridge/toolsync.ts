// Список тулов сессии харнеса — снимок на её старте: харнес не перечитывает
// его, пока сервер не скажет, что он изменился, а выкатка сервера рвёт сессию
// моста молча (граф nks-dev: #5405). Мост помнит отпечаток отданного списка и,
// переоткрыв сессию к серверу, сверяет его со свежим: разошёлся — харнесу
// уходит notifications/tools/list_changed, и он читает список заново.
//
// Посреди живой HTTP-сессии сервер сам кладёт list_changed в SSE ответа на
// каждый запрос с id, пока сессия не спросит tools/list (#6819): моста ли этот
// запрос или харнеса — слово уходит харнесу, раз на смену, до его перечтения.
import { createHash } from "node:crypto";

import { scoped } from "../shared/scope.ts";
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

const LIST_CHANGED = "notifications/tools/list_changed";

const T = scoped(() => ({
  served: null as string | null, // у сессии харнеса — свой список
  told: false, // list_changed сказан, а харнес списка ещё не перечёл
  listing: new WeakSet<JsonRpcMessage>(), // tools/list харнеса (первая страница) в полёте
}));

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
  if (!print) return;
  T.served = print;
  T.told = false;
}

/**
 * Запрос — tools/list харнеса: смена, объявленная в его же ответе, придёт ему списком.
 * Харнес перечитывает — следующая смена снова его, даже если это чтение сорвётся.
 */
export function noteHarnessListing(msg: JsonRpcMessage): void {
  T.listing.add(msg);
  T.told = false;
}

export const isListChanged = (m: JsonRpcMessage): boolean =>
  m?.method === LIST_CHANGED && (m.id === undefined || m.id === null);

function tell(emit: (m: JsonRpcMessage) => void, why: string): void {
  if (T.told) return; // харнес уже знает и ещё не перечёл — повтор ничего не добавит
  T.told = true;
  log(`${why} — telling the harness (tools/list_changed)`);
  emit({ jsonrpc: "2.0", method: LIST_CHANGED });
}

/**
 * Сервер сказал list_changed в ответе на `sent` — запрос моста или харнеса:
 * харнесу, раз на смену. Свой tools/list харнеса принесёт новый список сам.
 */
export function heardListChanged(sent: JsonRpcMessage, emit: (m: JsonRpcMessage) => void): void {
  if (T.listing.has(sent)) return;
  tell(emit, `the server said its tool list changed (answering ${sent?.method})`);
}

/**
 * Сессия к серверу открыта заново: спросить список и сверить с отданным.
 * `ask` — вызов tools/list по новой сессии; `emit` — слово харнесу.
 */
export async function recheckTools(
  ask: () => Promise<JsonRpcMessage | null>,
  emit: (m: JsonRpcMessage) => void,
): Promise<void> {
  if (!T.served) return; // харнес списка ещё не просил — сверять не с чем
  const fresh = toolsPrint((await ask().catch(() => null))?.result);
  if (!fresh || fresh === T.served) return;
  T.served = fresh;
  tell(emit, "tool list changed under the re-opened session");
}
