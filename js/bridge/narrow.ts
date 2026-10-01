// Что из списка тулов видит харнес. Список тулов — вес каждого запроса агента:
// Claude Code шлёт схемы целиком, и полный список сервера стоит десятки тысяч
// токенов на запрос даже субагенту с задачей в одно слово. Сужает мост только копию для
// харнеса: общий кэш ответов сервера хранит полный список (его читают другие
// мосты), и сам мост зовёт на сервер любые ходы.
//
// Два сужения:
//  - набор тулов — только по флагу `--tools a,b,c`; без флага харнес видит все
//    тулы, и мост с ролевыми файлами прежнего вида работает как прежде;
//  - схема iskron_channel у всех мостов: занятие места (mint, connect) и сессии
//    (sessions) мост делает сам — iskron_stand, — и их поля агенту только вес.
//    register и revoke остаются: корпус велит агенту без вахты назвать себя
//    register'ом и отзывать место revoke'ом, и их поля — тоже.
//
// Выгрузка снимка поверхности (`make surface`, клиент export-surface) получает
// сырой список: снимок — поверхность сервера, по нему фейк NKS режет аргументы.
import { SURFACE_CLIENT } from "../shared/clients.ts";
import { L } from "../shared/lang.ts";
import { CFG } from "./config.ts";
import { STAND_TOOL } from "./standtool.ts";
import { state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Ходы iskron_channel, которые мост делает сам; из перечня action в описании они убраны. */
const PLACE_MOVES = new Set(["mint", "connect", "sessions"]);
/** Поля схемы iskron_channel, которые берут только эти ходы (по описаниям полей сервера 0.97.1). */
const PLACE_FIELDS = ["ttl_seconds", "mute_siblings"];

function clientName(): string {
  const info = (state.initParams as { clientInfo?: { name?: unknown } } | null)?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}

/** Имена тулов, которые видит харнес; null — все. iskron_stand в наборе всегда. */
export function toolSet(): Set<string> | null {
  return CFG.tools ? new Set([...CFG.tools, STAND_TOOL.name]) : null;
}

/** Отказ вслух на вызов тула вне набора: харнес его не видел, но имя пришло. */
export function outsideSetRefusal(msg: JsonRpcMessage): JsonRpcMessage | null {
  if (msg?.method !== "tools/call" || msg.id === undefined || msg.id === null) return null;
  const set = toolSet();
  const name = String(msg.params?.name ?? "");
  if (!set || set.has(name)) return null;
  const list = [...set].sort().join(", ");
  const text = L(
    `Отказано (мост): тула ${name} нет в наборе этого моста (${list}) — набор задаёт --tools в записи моста.`,
    `Refused (bridge): the tool ${name} is not in this bridge's set (${list}) — the set comes from --tools in the bridge entry.`,
  );
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { isError: true, content: [{ type: "text", text }] },
  };
}

type Tool = { name?: string; description?: string; inputSchema?: Record<string, unknown> };

/** Перечень action без ходов моста: «одно из: a | b | c» (или «one of:»). */
function withoutPlaceMoves(text: string): string {
  return text.replace(
    /((?:одно из|one of):\s*)([a-z_]+(?:\s*\|\s*[a-z_]+)*)/i,
    (_, head: string, list: string) =>
      head +
      list
        .split("|")
        .map((s) => s.trim())
        .filter((s) => !PLACE_MOVES.has(s))
        .join(" | "),
  );
}

function channelForHarness(t: Tool): Tool {
  const schema = t.inputSchema;
  const props = schema?.properties as Record<string, Record<string, unknown>> | undefined;
  if (!schema || !props) return t;
  const kept: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(props)) if (!PLACE_FIELDS.includes(k)) kept[k] = v;
  const action = kept.action;
  if (action) {
    const a = { ...action };
    if (typeof a.description === "string") a.description = withoutPlaceMoves(a.description);
    if (Array.isArray(a.enum)) a.enum = a.enum.filter((x) => !PLACE_MOVES.has(String(x)));
    kept.action = a;
  }
  const next: Record<string, unknown> = { ...schema, properties: kept };
  if (Array.isArray(schema.required))
    next.required = schema.required.filter((r) => !PLACE_FIELDS.includes(String(r)));
  return { ...t, inputSchema: next };
}

/**
 * Копия ответа tools/list для харнеса: тулы вне набора убраны, схема iskron_channel
 * без полей ходов над местом. Исходный ответ не трогается — он идёт в общий кэш.
 */
export function narrowToolList(reply: JsonRpcMessage): JsonRpcMessage {
  const tools = reply?.result?.tools;
  if (!Array.isArray(tools) || clientName() === SURFACE_CLIENT) return reply;
  const set = toolSet();
  const shown = (tools as Tool[])
    .filter((t) => !set || set.has(String(t?.name)))
    .map((t) => (t?.name === "iskron_channel" ? channelForHarness(t) : t));
  return { ...reply, result: { ...reply.result, tools: shown } };
}
