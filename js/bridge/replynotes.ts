// What a tool call's own reply tells the bridge about its place: a satellite remembers the
// cases it joins (graph @nks/nks-dev, node #6573); a write through a provisional seat makes
// it the session's own (node #8033).
import { noteCaseEntry } from "./caseexit.ts";
import { noteWork } from "./provisional.ts";
import type { JsonRpcMessage } from "./types.ts";

export function noteReply(msg: JsonRpcMessage, reply: JsonRpcMessage): void {
  noteCaseEntry(msg.params?.name, msg.params?.arguments, reply);
  noteWork(msg, reply);
}
