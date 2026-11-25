// A busy line over the dispatcher connection asks for its answer (graph @nks/nks-dev, node
// #11337): a status frame with ack and a fresh ref, one write in flight per channel. A status_*
// frame on the channel answers the write in flight — its ref exact, another ref ignored, none
// taken as the write's own. After a write heard nothing in time, an unlabelled answer may be the
// earlier one's: the next is "not known" until an exact ref resolves cleanly again. A server that
// does not answer yet is silence — not a refusal. error frames answer ticks only (muxframe.ts).
import { randomBytes } from "node:crypto";

import { type Frame } from "../shared/channel.ts";
import { type TickEntry } from "./muxtick.ts";
import { log } from "./streams.ts";

/** How long a write waits for its answer. */
export const ANSWER_MS = 3000;

export type StatusAnswer =
  | { sent: false }
  | { sent: true; frame: Frame }
  | { sent: true; silent: true }
  | { sent: true; earlier: true };

type Pending = { ref: string; finish: (f: Frame) => void };
const pending = new Map<string, Pending>();
const tails = new Map<string, Promise<void>>();
const uncertain = new Set<string>();

/** A status_* frame of `channel` (muxframe.ts): the answer of the write in flight, if it is its. */
export function statusAnswer(channel: string, f: Frame): void {
  if (f.type === "status_rejected" && f.reason === "ref_invalid")
    log(`dispatcher: ${channel} refused the bridge's ref as invalid — a bridge defect`);
  const p = pending.get(channel);
  if (!p || (typeof f.ref === "string" && f.ref !== p.ref)) return;
  p.finish(f);
}

/** One status frame of a channel, after the one in flight; `send` gets the frame's ack and ref. */
export async function sendStatus(
  channel: string,
  send: (extra: { ack: true; ref: string }) => boolean,
): Promise<StatusAnswer> {
  const previous = tails.get(channel) ?? Promise.resolve();
  let release = (): void => {};
  const tail = new Promise<void>((r) => (release = r));
  tails.set(channel, tail);
  await previous;
  try {
    const ref = randomBytes(8).toString("hex");
    const f = await new Promise<Frame | "silent" | "unsent">((resolve) => {
      const timer = setTimeout(() => resolve("silent"), ANSWER_MS);
      timer.unref?.();
      const end = (x: Frame | "unsent"): void => {
        clearTimeout(timer);
        resolve(x);
      };
      pending.set(channel, { ref, finish: end });
      if (!send({ ack: true, ref })) end("unsent");
    });
    if (f === "unsent") return { sent: false };
    if (f === "silent") return (uncertain.add(channel), { sent: true, silent: true });
    if (f.ref !== ref && uncertain.has(channel)) return { sent: true, earlier: true };
    uncertain.delete(channel);
    return { sent: true, frame: f };
  } finally {
    pending.delete(channel);
    release();
    if (tails.get(channel) === tail) tails.delete(channel);
  }
}

/** The status frame of one seat (`id`; null — the channel's one seat, or each live one). */
export function statusFrame(
  send: (frame: object) => boolean,
  channel: string,
  id: string | null,
  text: string,
): Promise<StatusAnswer> {
  const frame = { type: "status", channel_id: channel, text, ...(id ? { standing_id: id } : {}) };
  return sendStatus(channel, (extra) => send({ ...frame, ...extra }));
}

/** A line held for hello goes now that hello came; nobody waits for its answer but the journal. */
export function heldLine(send: (frame: object) => boolean, e: TickEntry): void {
  const channel = e.channel_id;
  void statusFrame(send, channel, e.standing_id ?? null, e.status ?? "").then((a) => {
    const f = "frame" in a ? a.frame : null;
    const why = a.sent ? String(f?.reason) : "not sent";
    if (!a.sent || f?.type === "status_rejected")
      log(`busy line held for hello not set on ${channel}: ${why}`);
  });
}
