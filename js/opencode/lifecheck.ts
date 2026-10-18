// The life check in an OpenCode session (case #1046; the frame — shared/seen.ts isLifeCheck).
// Its own prompt into the root session, queued (channel.ts): an idle session wakes, a running
// turn is not cut; neither the case pile, its counts nor a tact. The platform's text as is,
// the way to answer below it.
import { OPENCODE } from "../delivery/index.ts";
import { type Frame } from "../shared/channel.ts";
import { words } from "../shared/lang.ts";

/** The prompt's text and its label in the log. */
export function lifeCheckPrompt(frame: Frame): { text: string; what: string } {
  const W = words(OPENCODE);
  const body = typeof frame.body === "string" ? frame.body : JSON.stringify(frame.body ?? "");
  const id = frame.id != null ? W.frameId(String(frame.id)) : W.frameNoId();
  return { text: `${body}\n\n${W.lifeCheckReply()}`, what: `${W.lifeCheck()}, ${id}` };
}

/**
 * The root a child session's seat warns: the top of its known parent chain; null — no parent
 * known, the freshest root seen takes it.
 */
export function rootAbove(session: string, parents: ReadonlyMap<string, string>): string | null {
  const visited = new Set([session]);
  let root: string | null = null;
  for (let up = parents.get(session); up && !visited.has(up); up = parents.get(up)) {
    visited.add(up);
    root = up;
  }
  return root;
}
