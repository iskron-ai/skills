// The end gate of the plugin (graph @nks/nks-dev, nodes #11360, #11359): once a session is ended
// nothing opens a turn in it — no frame, batch, stale word, alive/dead/evicted word, word about a
// child, wake word. The host's word decides (host.ts accepting): "live" gets the word; "ended"
// (archived, or no such session) and "unknown" (the host did not answer) both hold it — a session
// the host did not answer about may be over, and a turn in an ended session is what the gate
// stops. The server decides the seat's fate; the gate only keeps the plugin from waking the dead.
import { type OpencodeWords } from "../delivery/index.ts";
import { accepting } from "./host.ts";
import type { Context } from "./plugin.ts";
import { type Say } from "./tools.ts";

/** The session is live by the host's word; ended or unknown — false. */
export async function live(ctx: Context, session: string): Promise<boolean> {
  return (await accepting(ctx, session)) === "live";
}

/**
 * Does session `session` get no word? A child's is not the root's (#5167): it stays in the seat's
 * history. A root's held word names the session; the frame's beginning is in the journal.
 */
export async function held(
  ctx: Context,
  say: Say,
  W: OpencodeWords,
  session: string | null,
  frame: string,
  text: string,
  child: boolean,
): Promise<boolean> {
  if (child) {
    const standing = session ? await accepting(ctx, session) : "ended";
    if (standing === "live") return false;
    if (standing === "unknown" && session) {
      say(W.sessionUnknown(session, frame), "warning");
      return true;
    }
    // The child's seat outlived it: the frame is not the root's (#5167); it stays in the seat's history.
    say(W.childGone(frame, session ?? "?", text.slice(0, 120)), "error");
    return true;
  }
  if (!session) return false;
  const standing = await accepting(ctx, session);
  if (standing === "live") return false;
  say(
    standing === "ended" ? W.sessionClosed(session, frame) : W.sessionUnknown(session, frame),
    "warning",
  );
  return true;
}
