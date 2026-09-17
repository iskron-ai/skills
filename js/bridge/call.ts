// Вызов тула сервера самим мостом — теми же вызовами, что и агент (stand.ts,
// resume.ts): доска, connect, register. Ответ connect впитывается мостом так
// же, как проксируемый (absorb.ts), а принятый register запоминается стоянием.
import { absorbChannelReply } from "./absorb.ts";
import { noteStanding, replyText } from "./standing.ts";
import { post } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

export interface Answer {
  text: string;
  isError: boolean;
}

let seq = 0;

export async function callTool(name: string, args: Record<string, unknown>): Promise<Answer> {
  const id = `iskron-bridge-call-${++seq}`;
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
  let reply: JsonRpcMessage | null = null;
  await post(msg, (m) => {
    if (m.id === id) reply = m;
  });
  let got = reply as JsonRpcMessage | null;
  if (!got) return { text: "ответа нет", isError: true };
  if (name === "iskron_channel") {
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return { text: replyText(got), isError: !!got.error || !!got.result?.isError };
}

export const short = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}…` : s);

// Ходы моста над местом — iskron_stand, iskron/resume, iskron/check — идут по
// одному: столкновение стояния с тиком сторожа дало бы два holdStanding и
// лишний released, по которому плагин снял бы holding (#5140).
let chain: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}
