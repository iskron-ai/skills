// The delivery's ear inside a dsh (DeepSeek Harness) session — a Cordis bundle entry
// applied as `apply(ctx)` (graph @nks/nks-dev, node #10776). No bridge and no tools of
// its own: the machine bridge holds the standing, and the ear turns frames addressed to
// the seat into next-turn messages of the live session (hearing.ts); the session's first
// agent gets the start word in its system prompt (start.ts, #10921); a compacted session
// gets its role back (compaction.ts); a shell call that pushed or merged gets its lines as a
// turn (rites.ts, #11071); a frame's turn that lost its word in the console wakes the session
// (turnend.ts) — in headless through a task holding the root's idle (hold.ts, #11071); a disposed
// session hears nothing more.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK events without a schema */
import { DSH } from "../delivery/index.ts";
import { markFrame } from "../shared/frame-text.ts";
import { words } from "../shared/lang.ts";
import { ritualCover } from "../shared/ritualcover.ts";
import { authDirFromEnv } from "../shared/standings.ts";
import { TURN_RITE } from "../shared/turnend.ts";
import { roleWord } from "./compaction.ts";
import { isHeadless } from "./headless.ts";
import { type DshAgent, type Hearing, startHearing, turnMessage } from "./hearing.ts";
import { createHold } from "./hold.ts";
import { afterPublish } from "./publish.ts";
import { riteLines } from "./rites.ts";
import { createRoot } from "./root.ts";
import { putStartWord } from "./start.ts";
import { createTurnEnds } from "./turnend.ts";

export interface DshCtx {
  on(event: string, fn: (...args: any[]) => unknown): unknown;
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
  const notDelivered = (why: string): void => log(W().notDelivered(why));
  const sendAfterPublish = (a: DshAgent, message: Record<string, unknown>): void =>
    void afterPublish(a, message).catch((e: Error) => notDelivered(e.message));
  const authDir = authDirFromEnv();
  let agent: DshAgent | null = null;
  let raw: any = null; // the root's agent itself: its status and maintenance (hold.ts)
  let headless = false; // the sign shows on agent/created, not on apply (observed, #11071)
  let hearing: Hearing | null = null;
  const hold = createHold(notDelivered);
  // No cover — on, a frame proves the seat; else by the cover's rituals field.
  const turns = createTurnEnds({
    on: () => ritualCover(process.cwd())?.on.has(TURN_RITE) ?? true,
    wake: (text) => hold.wake(turnMessage(text)),
  });
  /** The root's agent as the hearing sees it: each frame it lays is known to the turn's end. */
  const heard = (): DshAgent | null => {
    const a = agent;
    if (!a) return null;
    return {
      followup: (m: any) => {
        turns.laid(m);
        return hold.through(m) ?? a.followup(m);
      },
    };
  };

  const on = (event: string, fn: (...args: any[]) => unknown): void => {
    try {
      ctx.on(event, fn);
    } catch (e) {
      log(W().notDelivered(`${event}: ${(e as Error).message}`));
    }
  };

  // The session's first agent is its root; a subagent spawned in the process takes none of
  // its hearing, start word or rituals (root.ts). A disposed root session makes the next
  // agent/created a new session's root — a long process (dsh web) has many.
  const root = createRoot();
  on("agent/created", (payload) => {
    const took = root.take(payload?.agent, payload?.source);
    if (took === "child") return;
    if (took === "root")
      putStartWord(payload?.agent, payload?.source, process.cwd(), (why) =>
        log(W().notDelivered(why)),
      );
    const own = agentOf(payload?.agent);
    if (own) [agent, raw] = [own, payload.agent];
    headless = isHeadless(ctx);
    if (!hearing) hearing = startHearing(heard, log, startedAt);
  });
  on("session/disposed", (session) => {
    if (!root.ours(session)) return; // a subagent's session ended, the root's lives on
    hearing?.stop(); // the session is gone: nothing more goes into it
    hearing = null;
    agent = null;
    raw = null;
    hold.end();
    turns.forget();
    root.end();
  });
  // Synchronously in the idle's own call: headless checks for its exit right after (hold.ts).
  on("agent/status", (p) => {
    if (p?.status === "idle" && raw && agent && p.agent === raw)
      hold.idle(raw, agent, headless, hearing?.live() ?? false);
  });
  // A waterfall (exec, result, next): the decision passes unchanged, the lines go to the root.
  on("tools/post-execute", (exec, result, next) => {
    try {
      const note = riteLines(exec, result, process.cwd());
      const a = agent;
      // The RITES words carry the delivery's mark themselves: no second one.
      if (note && a) sendAfterPublish(a, turnMessage(note));
    } catch (e) {
      log(W().notDelivered((e as Error).message));
    }
    return typeof next === "function" ? next() : undefined;
  });
  on("session/event", (session, ev) => {
    // A failed compaction kept the context: no word about a compaction that did not happen.
    if (!root.ours(session)) return;
    if (ev?.type === "turn/start") hold.turnStarted();
    turns.onEvent(ev);
    if (ev?.type !== "compaction/end" || ev.error) return;
    const a = agent;
    if (!a || !hearing) return;
    sendAfterPublish(a, turnMessage(markFrame(roleWord(authDir, hearing.key()))));
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */
