// Чтение хуков роли для iskron_stand (hook.ts ставит, здесь — читается): список
// хуков роли — полями webhooks[] (hookfields.ts), без них прозой сервера, — и
// схема iskron_admin, объявляет ли она параметр channel.
import { BRIDGE_NAME, tool } from "../delivery/index.ts";
import { FORM } from "./board.ts";
import { callTool as call } from "./call.ts";
import { hooksField, reachesYou } from "./hookfields.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/**
 * Параметры iskron_admin по схеме сервера — читаются заново на каждый iskron_stand:
 * работающий мост подхватывает channel, как только сервер его объявит. null —
 * схему прочесть не удалось (tools/list отказал, пуст или тул на другой странице).
 */
export async function adminParamNames(): Promise<Set<string> | null> {
  const id = `${BRIDGE_NAME}-admin-schema-${++state.reinitCounter}`;
  let got: JsonRpcMessage | null = null;
  try {
    await post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, (m) => {
      if (m.id === id) got = m;
    });
  } catch {
    return null;
  }
  const result = (got as JsonRpcMessage | null)?.result;
  const tools = result?.tools;
  if (!Array.isArray(tools)) return null;
  const admin = (
    tools as { name?: string; inputSchema?: { properties?: Record<string, unknown> } }[]
  ).find((t) => t?.name === tool("admin"));
  if (!admin) return null; // тула на этой странице нет (список постраничный или урезан) — схема не прочтена
  return new Set(Object.keys(admin.inputSchema?.properties ?? {}));
}

/** Список хуков прозой: узнан ли и будит ли хук место с этим именем. */
function fromProse(
  text: string,
  isError: boolean,
  name: string,
): { recognized: boolean; wakesMe: boolean } {
  // Пустой список поверхность печатает без заголовка: «Для #N вебхуки не зарегистрированы.» (#5380).
  // Заголовок узнан, а слово состояния хука — нет: язык угадан частично, и «не будит»
  // поставило бы второй хук; такой список не распознан целиком.
  const blocks = text.split(/\n(?=\s*#\d+\s*→)/).slice(1);
  const recognized =
    !isError &&
    ((FORM.hooksHeader.test(text) && blocks.every((b) => FORM.hookState.test(b))) ||
      FORM.hooksEmpty.test(text));
  const nameRe = new RegExp(`:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`);
  return {
    recognized,
    wakesMe: recognized && blocks.some((b) => FORM.hookActive.test(b) && nameRe.test(b)),
  };
}

/** Хуки роли: узнан ли список, будит ли активный хук место этой сессии, текст ответа. */
export async function readRoleHooks(
  realm: string,
  karta: string,
  name: string,
): Promise<{ recognized: boolean; wakesMe: boolean; text: string }> {
  const hooks = await call(tool("admin"), { action: "list_webhooks", realm, node_id: karta });
  const fields = hooks.isError ? null : hooksField(hooks.structured);
  const read = fields
    ? { recognized: true, wakesMe: fields.some((h) => h.active && reachesYou(h)) }
    : fromProse(hooks.text, hooks.isError, name);
  return { ...read, text: hooks.text };
}
