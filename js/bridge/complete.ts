// Дочитывание и штамп кадра — прежде, чем кадр покинет мост (граф nks-dev: #4234).
import { classifyOrigin, type Frame } from "../shared/channel.ts";
import { replyText } from "./standing.ts";
import { log } from "./streams.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

let readCounter = 0;

/**
 * Дочитывание кадра — обязанность моста (слово владельца): платформа режет
 * длинное тело в кадре сокета и называет полную длину в body_chars; до делателя
 * кадр доходит целым, потому что мост, держатель сессии, дочитывает его сам
 * через историю канала, прежде чем отдать сторожу или плагину. Не дочиталось —
 * кадр идёт как есть, с пометкой, что он обрезан: лучше честный обрез, чем
 * молчание.
 */
export async function completeFrame(frame: Frame | null): Promise<Frame | null> {
  if (!frame || typeof frame.body !== "string" || typeof frame.body_chars !== "number")
    return frame;
  if (!frame.id || [...frame.body].length >= frame.body_chars) return frame;
  const realm = state.standing?.realm;
  if (!realm) return { ...frame, body_read: "truncated: стояние без realm, дочитать нечем" };
  const id = `iskron-bridge-read-${++readCounter}`;
  let reply: JsonRpcMessage | null = null;
  try {
    await post(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "iskron_channel",
          arguments: { realm, action: "history", view: "message", message: frame.id },
        },
      },
      (m) => {
        if (m.id === id) reply = m;
      },
    );
  } catch (e) {
    log(`кадр ${frame.id} обрезан, дочитать не вышло: ${(e as Error).message}`);
    return { ...frame, body_read: `truncated: ${(e as Error).message}` };
  }
  const text = replyText(reply);
  const nl = text.indexOf("\n");
  const tail = text.indexOf("\nПровенанс, как платформа");
  if (nl < 0 || (reply as JsonRpcMessage | null)?.result?.isError) {
    return { ...frame, body_read: `truncated: ${text.slice(0, 160)}` };
  }
  const body = (tail > nl ? text.slice(nl + 1, tail) : text.slice(nl + 1)).trim();
  return { ...frame, body, body_read: "history" };
}

/** Кто говорит — штампует мост: он один знает роль своего стояния. */
export function stampOrigin(frame: Frame | null): Frame | null {
  if (!frame || frame.type !== "message") return frame;
  return { ...frame, origin: classifyOrigin(frame, state.standing?.karta) };
}
