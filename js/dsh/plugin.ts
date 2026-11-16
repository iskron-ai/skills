// The delivery's ear inside a dsh (DeepSeek Harness) session — a Cordis bundle entry
// applied as `apply(ctx)` (graph @nks/nks-dev, node #10776). No bridge and no tools of
// its own: the machine bridge holds the standing, and the ear turns frames addressed to
// the seat into next-turn messages of the live session (hearing.ts); the session's first
// agent gets the start word in its system prompt (start.ts, #10921); a compacted session
// gets its role back (compaction.ts); a disposed session hears nothing more.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK events without a schema */
import { DSH } from "../delivery/index.ts";
import { markFrame } from "../shared/frame-text.ts";
import { words } from "../shared/lang.ts";
import { authDirFromEnv } from "../shared/standings.ts";
import { roleWord } from "./compaction.ts";
import { type DshAgent, type Hearing, startHearing, turnMessage } from "./hearing.ts";
import { putStartWord } from "./start.ts";

export interface DshCtx {
  on(event: string, fn: (...args: any[]) => void): unknown;
  logger?: { info?: (...args: unknown[]) => void };
}

/** followup is send(message, "next-turn", true) — the observed surface (#10776 stage 1). */
function agentOf(a: any): DshAgent | null {
  if (!a || typeof a !== "object") return null;
  if (typeof a.followup === "function") return { followup: (m) => a.followup(m) };
  if (typeof a.send === "function") return { followup: (m) => a.send(m, "next-turn", true) };
  return null;
}

export function apply(ctx: DshCtx): void {
  const W = () => words(DSH);
  const startedAt = Date.now(); // the plugin's own start: no hold record written earlier is this session's
  // Headless dsh does not print ctx.logger at all (observed live, #10905): a loud line
  // goes to the process's stderr too, where a person running headless sees it.
  const log = (text: string): void => {
    try {
      ctx.logger?.info?.(text);
    } catch {
      /* the console is not ours */
    }
    console.error(text);
  };
  /**
   * A word sent from inside a session event lands after the store's publish cycle:
   * a synchronous followup there is rejected ("cannot reenter while another append
   * is being published" — observed live on compaction/end, case 5251 stage 2).
   */
  const sendAfterPublish = (a: DshAgent, message: Record<string, unknown>, tries = 5): void => {
    setTimeout(
      () => {
        try {
          a.followup(message);
        } catch (e) {
          const msg = (e as Error).message;
          if (tries > 0 && msg.includes("reenter")) return sendAfterPublish(a, message, tries - 1);
          log(W().notDelivered(msg));
        }
      },
      tries === 5 ? 0 : 25,
    );
  };
  const authDir = authDirFromEnv();
  let agent: DshAgent | null = null;
  let hearing: Hearing | null = null;

  const on = (event: string, fn: (...args: any[]) => void): void => {
    try {
      ctx.on(event, fn);
    } catch (e) {
      log(W().notDelivered(`${event}: ${(e as Error).message}`));
    }
  };

  // The session's first agent is its root; later ones are its subagents. A disposed session
  // makes the next agent/created a new session's root — a long process (dsh web) has many.
  let started = false;
  on("agent/created", (payload) => {
    if (!started) {
      started = true;
      putStartWord(payload?.agent, payload?.source, process.cwd(), (why) =>
        log(W().notDelivered(why)),
      );
    }
    agent = agentOf(payload?.agent) ?? agent;
    if (!hearing) hearing = startHearing(() => agent, log, startedAt);
  });
  on("session/disposed", () => {
    hearing?.stop(); // the session is gone: nothing more goes into it
    hearing = null;
    agent = null;
    started = false;
  });
  on("session/event", (_session, ev) => {
    // A failed compaction kept the context: no word about a compaction that did not happen.
    if (ev?.type !== "compaction/end" || ev.error) return;
    const a = agent;
    if (!a || !hearing) return;
    sendAfterPublish(a, turnMessage(markFrame(roleWord(authDir, hearing.key()))));
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
