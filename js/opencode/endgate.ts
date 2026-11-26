// The end gate of the plugin (graph @nks/nks-dev, nodes #11360, #11359): once a session is ended
// nothing opens a turn in it — no frame, batch, stale word, alive/dead/evicted word, word about a
// child, wake word. The host's word decides (host.ts accepting): "live" gets the word; "ended"
// (archived, or no such session) drops it. "unknown" (the host did not answer) is no proof of
// either: the bridge has already marked the frame seen, so a refusal would lose it — the frame is
// held in memory per session and the session is asked again on its next event and on a short
// bounded backoff; live — delivered once, as it would have been; ended — dropped. A plugin reload
// loses the hold. The server decides the seat's fate; the gate only keeps the plugin from waking
// the dead.
import { envName, type OpencodeWords } from "../delivery/index.ts";
import { accepting } from "./host.ts";
import type { Context } from "./plugin.ts";
import { type Say } from "./tools.ts";

/** The first re-check of a held session; each next one waits twice as long. */
const HOLD_MS = Number(process.env[envName("OPENCODE_HOLD_MS")]) || 1_000;
/** Re-checks by the backoff; after them only the session's next event asks again. */
const HOLD_CHECKS = 4;
/** Frames held per session at most; the oldest goes first. */
const HOLD_CAP = 50;

/** The session is live by the host's word; ended or unknown — false. */
export async function live(ctx: Context, session: string): Promise<boolean> {
  return (await accepting(ctx, session)) === "live";
}

export interface Word {
  session: string | null;
  text: string;
  frame: string;
  delivery: "steer" | "queue";
  child: boolean;
}

export interface Holds {
  /** May the word go on to the session? false — dropped (ended) or held (unknown). */
  admit(w: Word): Promise<boolean>;
  /** The session's event: a held session is asked again now. */
  poke(session: string | null): void;
  /** The session is gone: what it held goes with it. */
  gone(session: string): void;
  stop(): void;
}

interface Hold {
  words: Word[];
  tries: number;
  timer: ReturnType<typeof setTimeout> | null;
  asking: boolean;
}

/** `again` — a held word re-enters delivery once the host calls its session live. */
export function createHolds(
  ctx: Context,
  say: Say,
  W: OpencodeWords,
  again: (w: Word) => Promise<unknown>,
): Holds {
  const holds = new Map<string, Hold>();

  const dropped = (w: Word, session: string | null): void =>
    w.child
      ? say(W.childGone(w.frame, session ?? "?", w.text.slice(0, 120)), "error")
      : say(W.sessionClosed(session ?? "?", w.frame), "warning");

  function hold(session: string, w: Word): void {
    let h = holds.get(session);
    if (!h) holds.set(session, (h = { words: [], tries: 0, timer: null, asking: false }));
    h.words.push(w);
    while (h.words.length > HOLD_CAP) say(W.holdFull(session, h.words.shift()!.frame), "warning");
    say(W.sessionUnknown(session, w.frame), "warning");
    if (!h.timer && !h.asking) schedule(session, h);
  }

  function schedule(session: string, h: Hold): void {
    if (h.tries >= HOLD_CHECKS) return;
    h.timer = setTimeout(() => void ask(session), HOLD_MS * 2 ** h.tries++);
    (h.timer as { unref?: () => void }).unref?.();
  }

  async function ask(session: string): Promise<void> {
    const h = holds.get(session);
    if (!h || h.asking) return;
    if (h.timer) clearTimeout(h.timer);
    h.timer = null;
    h.asking = true;
    const standing = await accepting(ctx, session);
    h.asking = false;
    if (holds.get(session) !== h) return;
    if (standing === "unknown") return schedule(session, h);
    holds.delete(session);
    for (const w of h.words) {
      if (standing === "ended") dropped(w, session);
      else await again(w);
    }
  }

  return {
    async admit(w) {
      const { session } = w;
      if (session && holds.has(session)) {
        hold(session, w); // behind the held ones, in their order
        return false;
      }
      if (!session) {
        if (!w.child) return true;
        dropped(w, session);
        return false;
      }
      const standing = await accepting(ctx, session);
      if (standing === "live") return true;
      if (standing === "unknown") hold(session, w);
      else dropped(w, session);
      return false;
    },
    poke(session) {
      if (session && holds.has(session)) void ask(session);
    },
    gone(session) {
      const h = holds.get(session);
      if (h?.timer) clearTimeout(h.timer);
      holds.delete(session);
    },
    stop() {
      for (const h of holds.values()) if (h.timer) clearTimeout(h.timer);
      holds.clear();
    },
  };
}
