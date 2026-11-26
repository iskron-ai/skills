// The plugin's own word about its transport — the hearing watchdog's: a seat not back, a
// socket stuck, a return that failed (keep.ts) — opens no turn (graph @nks/nks-dev, nodes
// #11359, #11362): it waits for the session's next tool call and rides its reply, as the
// rituals' notes ride a shell reply (rites.ts). Nothing is laid into the session by itself.
import type { Context } from "./plugin.ts";

type Part = { type: string; text?: string };
type Result = { content?: string | readonly Part[] };

/** Words a session waits with, at most this many: the newest stay. */
const KEPT = 5;

export interface ReplyNotes {
  /** A word for session `session`'s next tool reply; the same word waiting is not doubled. */
  put(session: string, text: string): void;
}

/** The notes, with the tool hook "execute.after" that hands them (a host without hooks keeps them). */
export async function replyNotes(ctx: Context): Promise<ReplyNotes> {
  const waiting = new Map<string, string[]>();
  const notes: ReplyNotes = {
    put(session, text) {
      const got = (waiting.get(session) ?? []).filter((t) => t !== text);
      waiting.set(session, [...got, text].slice(-KEPT));
    },
  };
  const tool = (ctx as Partial<Pick<Context, "tool">>).tool;
  if (typeof tool?.hook === "function")
    await tool.hook("execute.after", (t) => {
      const session = String(t.sessionID);
      const words = waiting.get(session);
      if (!words?.length || t.status !== "completed") return;
      waiting.delete(session);
      const note = words.join("\n\n");
      const result = t.result as unknown as Result;
      const content = result.content;
      const next: Result = {
        ...result,
        content:
          typeof content === "string"
            ? content
              ? `${content}\n\n${note}`
              : note
            : [...(content ?? []), { type: "text", text: note }],
      };
      t.result = next as unknown as typeof t.result;
    });
  return notes;
}
