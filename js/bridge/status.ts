// Занятость стояния — слово держателя сокета, а держит его мост (решение
// владельца, граф nks-dev: #4284 отвергнут): action="status" у iskron_channel
// исполняется здесь, на сервер не уходит. POST на статусный адрес из ответа
// connect; ответ поверхности — успех или ProblemDetail — доносится целиком.
import { statusAddress } from "./hold.ts";
import { type JsonRpcMessage } from "./types.ts";

/** action="status" — занятость ЭТОГО стояния. Возвращает null для всякого другого вызова. */
export function localStatus(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text = typeof a.text === "string" ? a.text : "";
  const reply = (body: string, isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: body }] },
  });
  return (async () => {
    const st = await publishStatus(text);
    if (st.ok) return reply(`занятость ${statusAddress()?.key}: ${text || "(снята)"}`);
    return reply(st.body, true);
  })();
}

/** POST строки занятости на статусный адрес стояния, которое держит мост. */
export async function publishStatus(text: string): Promise<{ ok: boolean; body: string }> {
  const addr = statusAddress();
  if (!addr) {
    return {
      ok: false,
      body:
        "Отказано (мост): у моста нет стояния этого агента — назовись одним вызовом iskron_stand(realm, karta, model, status) " +
        "(занятость можно передать прямо в нём); место слушает другой держатель — take=true берёт слух и статусный адрес сюда",
    };
  }
  let res: Response;
  try {
    res = await fetch(addr.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    return {
      ok: false,
      body: `Отказано (мост): статусный адрес не ответил — ${(e as Error).message}`,
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404)
    return {
      ok: false,
      body:
        `Отказано (404) поверхностью: ${body || "без тела"} — статусный адрес повернули connect-ом другого держателя; ` +
        "занятость теперь его; вернуть слух и адрес сюда — iskron_stand с take=true",
    };
  if (!res.ok)
    return { ok: false, body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}` };
  return { ok: true, body };
}
