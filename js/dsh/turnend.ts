// The turn's end on a watch in a dsh session (shared/turnend.ts, graph @nks/nks-dev, nodes #9342,
// #9345, #11071), the pattern of opencode/turnend.ts: the plugin lays the frames itself, so it
// knows the turn they entered — counts with nothing addressed to the seat are no frame
// (quietframe.ts); a user message of the human's own source without the delivery's mark is a
// human's word, and its time outlives the turn; a call that speaks (case ask, say, answer, talk,
// line; channel send) and came back without an error is the word laid; the turn's text is the
// last assistant message with no call in it. On turn/end with reason completed, a frame's turn
// that lost its word gets the wake word as one next-turn message, once: the turn the wake word
// itself entered is exempt. The session events' forms — turn/start, turn/end {reason.kind},
// user/message (a UserMessage), assistant/message {message.content with text and tool-call
// blocks}, tool/result {message.toolCallId, isError} — are read from the types of the installed
// @deepseek-ai/dsh-session 0.2.2-rc.1 (SessionEventMap in types.d.ts) and the docs (#10657),
// not observed live.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh session events without a schema */
import { LANGS, TURN } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { quiet } from "../shared/quietframe.ts";
import { lostWord, marked, speaks, type TurnSeen } from "../shared/turnend.ts";

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n")
    : "";

const WAKES = new Set(LANGS.map((l) => TURN[l].wake()));

const args = (raw: unknown): unknown => {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
};

export interface TurnEnds {
  /** The hearing laid this message (a frame's) into the session. */
  laid: (message: { id?: unknown; content?: unknown }) => void;
  /** One event of the root session. */
  onEvent: (ev: any) => void;
  forget: () => void;
}

export function createTurnEnds(opts: {
  /** The ritual is switched on (the cover's list of rituals, no cover — on). */
  on: () => boolean;
  wake: (text: string) => void;
}): TurnEnds {
  let turn: (TurnSeen & { woken: boolean }) | null = null;
  let heard: number | null = null;
  const laid = new Map<string, number>(); // ids and texts of laid frames, until a turn takes them
  const speaking = new Set<string>(); // call ids of speaking calls, until their results
  const fresh = (): TurnSeen & { woken: boolean } => ({
    framed: false,
    human: false,
    spoke: false,
    text: "",
    heard: null,
    woken: false,
  });
  const take = (key: string): boolean => {
    const n = laid.get(key);
    if (!n) return false;
    if (n > 1) laid.set(key, n - 1);
    else laid.delete(key);
    return true;
  };
  const note = (key: unknown): void => {
    if (typeof key === "string" && key) laid.set(key, (laid.get(key) ?? 0) + 1);
  };

  function user(m: any, t: TurnSeen & { woken: boolean }): void {
    const text = textOf(m?.content);
    const byId = typeof m?.id === "string" && take(m.id);
    if (byId) take(textOf(m?.content));
    if (byId || take(text)) {
      if (!quiet(text)) t.framed = true;
    } else if (WAKES.has(text.trim())) t.woken = true;
    else if (m?.source?.kind === "user" && !marked(text)) {
      t.human = true;
      heard = Date.now();
    }
  }

  function end(reason: any): void {
    const t = turn;
    turn = null;
    speaking.clear();
    if (!t || t.woken || reason?.kind !== "completed") return;
    if (lostWord({ ...t, heard }) && opts.on()) opts.wake(words(TURN).wake());
  }

  return {
    laid(m) {
      note(m?.id);
      note(textOf(m?.content));
    },
    onEvent(ev) {
      const type: unknown = ev?.type;
      const data = ev?.data;
      if (type === "turn/start") turn = fresh();
      else if (type === "turn/end") end(data?.reason);
      if (!turn) return;
      if (type === "user/message") user(data, turn);
      else if (type === "assistant/message") {
        const blocks: any[] = Array.isArray(data?.message?.content) ? data.message.content : [];
        const calls = blocks.filter((b) => b?.type === "tool-call");
        for (const c of calls)
          if (typeof c.id === "string" && speaks(c.name, args(c.arguments))) speaking.add(c.id);
        turn.text = calls.length ? "" : textOf(blocks);
      } else if (type === "tool/result") {
        const id: unknown = data?.message?.toolCallId;
        if (typeof id === "string" && speaking.delete(id) && !data.message.isError)
          turn.spoke = true;
      }
    },
    forget() {
      turn = null;
      heard = null;
      laid.clear();
      speaking.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
