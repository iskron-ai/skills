// Список тулов сессии харнеса — снимок на её старте: харнес не перечитывает
// его, пока сервер не скажет, что он изменился, а выкатка сервера рвёт сессию
// моста молча (граф nks-dev: #5405). Мост помнит отпечаток отданного списка и,
// переоткрыв сессию к серверу, сверяет его со свежим: разошёлся — харнесу
// уходит notifications/tools/list_changed, и он читает список заново.
//
// Посреди живой HTTP-сессии сервер сам кладёт list_changed в SSE ответа на
// каждый запрос с id, пока сессия не спросит tools/list (#6819): моста ли этот
// запрос или харнеса — слово уходит харнесу один раз, пока он не начал
// перечитывать; вызов, ушедший до того, как его tools/list снял пометку,
// может сказать ещё раз (#6817 допускает лишнее уведомление). Сужение --tools
// здесь не судится: смена вне набора стоит харнесу перечтения суженной копии.
import { createHash } from "node:crypto";

import { scoped } from "../shared/scope.ts";
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

const LIST_CHANGED = "notifications/tools/list_changed";

const T = scoped(() => ({
  served: null as string | null, // у сессии харнеса — свой список
  told: false, // list_changed сказан, а харнес списка ещё не перечёл
  inFlight: 0, // tools/list харнеса в полёте (любые страницы)
  listing: new WeakSet<JsonRpcMessage>(), // tools/list харнеса (первая страница) в полёте
  heldBack: new WeakSet<JsonRpcMessage>(), // …в чьём ответе сервер сказал list_changed
  live: new WeakSet<JsonRpcMessage>(), // …на который харнесу ушёл живой список сервера
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

/**
 * Харнесу отдан список (живой или из кэша): запомнить, что он теперь знает.
 * `liveFor` — tools/list харнеса, на который ушёл живой список сервера.
 */
export function noteServedTools(result: unknown, liveFor?: JsonRpcMessage): void {
  const print = toolsPrint(result);
  if (!print) return;
  T.served = print;
  T.told = false;
  if (liveFor) T.live.add(liveFor);
}

/** Свои tools/list харнеса в полёте: он и так получит свежий список. */
export const harnessListing = (): boolean => T.inFlight > 0;

/**
 * tools/list харнеса уходит. Первая страница: смена, объявленная в её же ответе,
 * придёт ему списком, и следующая смена снова его. Возвращает, что сделать по его концу:
 * сервер снял пометку и этим ответом, даже ошибкой (#6817), — не дошёл живой список,
 * придержанное слово уходит харнесу, иначе он остался бы со старым.
 */
export function watchHarnessListing(
  msg: JsonRpcMessage,
  emit: (m: JsonRpcMessage) => void,
): () => void {
  T.inFlight++;
  const first = !msg.params?.cursor;
  if (first) T.listing.add(msg);
  if (first) T.told = false;
  return () => {
    T.inFlight--;
    if (T.heldBack.has(msg) && !T.live.has(msg))
      tell(emit, "the server said its tool list changed, and no fresh list reached the harness");
  };
}

export const isListChanged = (m: JsonRpcMessage): boolean =>
  m?.method === LIST_CHANGED && (m.id === undefined || m.id === null);

function tell(emit: (m: JsonRpcMessage) => void, why: string, again = false): void {
  if (T.told && !again) return; // харнес уже знает и ещё не перечёл — повтор ничего не добавит
  T.told = true;
  log(`${why} — telling the harness (tools/list_changed)`);
  emit({ jsonrpc: "2.0", method: LIST_CHANGED });
}

/**
 * Сервер сказал list_changed в ответе на `sent` — запрос моста или харнеса:
 * харнесу, раз на смену. Свой tools/list харнеса принесёт новый список сам —
 * слово ждёт, дошёл ли он (watchHarnessListing).
 */
export function heardListChanged(sent: JsonRpcMessage, emit: (m: JsonRpcMessage) => void): void {
  if (T.listing.has(sent)) return void T.heldBack.add(sent);
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
  tell(emit, "tool list changed under the re-opened session", true); // разошёлся отпечаток — говорится всегда, как прежде
}
