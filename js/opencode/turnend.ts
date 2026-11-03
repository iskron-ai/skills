// The turn's end on a watch in OpenCode (shared/turnend.ts, graph @nks/nks-dev, node #9342): the
// plugin lays the frames itself, so it knows a turn they started. A frame enters a turn when
// OpenCode takes its inbox item (at once when the prompt names none); a prompt without the
// delivery's mark is a human's word; a completed call that speaks (case ask, say, answer, talk;
// channel send) is the word laid; the turn's text is its last session.text.ended after the last
// call. At the turn's end — session.execution.succeeded, or the deprecated session.idle — a
// frame's turn that lost its word gets the wake word queued, once: the turn it wakes (the next
// session.execution.started) is exempt.
/* eslint-disable @typescript-eslint/no-explicit-any -- SDK events without a schema */
import { TURN } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { lostWord, marked, speaks, type TurnSeen } from "../shared/turnend.ts";
import type { Context } from "./plugin.ts";

const ENDS = new Set<unknown>(["session.execution.succeeded", "session.idle"]);
/** A turn's end that is no turn of a frame left alone: its state goes, no word. */
const CUTS = new Set<unknown>(["session.execution.failed", "session.execution.interrupted"]);

export interface TurnEnds {
  /** The channel laid a frame into the session; inbox — its inbox item, if OpenCode named one. */
  laid: (session: string, inbox: string | null) => void;
  /** A prompt passed the prompt hook. */
  prompt: (session: string, text: string) => void;
  /** The tool hook that sees the session's calls end. */
  wire: () => Promise<void>;
  onEvent: (ev: any) => void;
  forget: (session: string) => void;
}

export function createTurnEnds(
  ctx: Context,
  opts: {
    /** A session the wake word is not for: a child, a stopped or ended one. */
    skip: (session: string) => boolean;
    /** The ritual is switched on for the session (the cover's list of rituals). */
    on: (session: string) => Promise<boolean>;
    say: (text: string) => void;
  },
): TurnEnds {
  const turns = new Map<string, TurnSeen>();
  const pending = new Map<string, string>();
  // Woken: the word is queued; exempt: the turn it started runs.
  const woke = new Set<string>();
  const exempt = new Set<string>();
  const turn = (s: string): TurnSeen => {
    let t = turns.get(s);
    if (!t) turns.set(s, (t = { framed: false, human: false, spoke: false, text: false }));
    return t;
  };

  async function end(s: string): Promise<void> {
    const t = turns.get(s);
    turns.delete(s);
    // The turn the word woke ends without one, whatever entered it.
    if (exempt.delete(s) || !t || !lostWord(t) || opts.skip(s) || !(await opts.on(s))) return;
    woke.add(s);
    try {
      await ctx.session.prompt({ sessionID: s, text: words(TURN).wake(), delivery: "queue" });
    } catch (e) {
      woke.delete(s);
      opts.say(words(TURN).notLaid(s, (e as Error).message));
    }
  }

  return {
    laid(session, inbox) {
      if (inbox) pending.set(inbox, session);
      else turn(session).framed = true;
    },
    prompt(session, text) {
      if (!marked(text)) turn(session).human = true;
    },
    async wire() {
      const tool = (ctx as Partial<Pick<Context, "tool">>).tool;
      if (typeof tool?.hook !== "function") return;
      await tool.hook("execute.after", (c) => {
        const t = turn(String(c.sessionID));
        t.text = false;
        if (c.status === "completed" && speaks(c.tool, c.input)) t.spoke = true;
      });
    },
    onEvent(ev) {
      const s: unknown = ev?.data?.sessionID;
      if (typeof s !== "string") return;
      const type: unknown = ev?.type;
      if (type === "session.execution.started") {
        if (woke.delete(s)) exempt.add(s);
      } else if (type === "session.inbox.delivered") {
        const inbox: unknown = ev.data?.inboxID;
        if (typeof inbox === "string" && pending.get(inbox) === s) {
          pending.delete(inbox);
          turn(s).framed = true;
        }
      } else if (type === "session.inbox.cancelled") {
        if (typeof ev.data?.inboxID === "string") pending.delete(ev.data.inboxID);
      } else if (type === "session.text.ended") {
        if (typeof ev.data?.text === "string" && ev.data.text.trim()) turn(s).text = true;
      } else if (ENDS.has(type)) void end(s);
      else if (CUTS.has(type)) {
        turns.delete(s);
        exempt.delete(s);
      }
    },
    forget(session) {
      turns.delete(session);
      woke.delete(session);
      exempt.delete(session);
      for (const [inbox, s] of pending) if (s === session) pending.delete(inbox);
    },
  };
}
