// The delivery's ear inside a dsh (DeepSeek Harness) session — a Cordis bundle entry
// applied as `apply(ctx)` (graph @nks/nks-dev, node #10776). No bridge and no tools of
// its own: the machine bridge holds the standing, and the ear turns frames addressed to
// the seat into next-turn messages of the live session (hearing.ts); the session's first
// agent gets the start word in its system prompt (start.ts, #10921) and its seat by the cover
// before the first model request (rootseat.ts, #11076); a compacted session
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
import { type DshCtx, listenerOf, loudOf } from "./console.ts";
import { isHeadless } from "./headless.ts";
import { type DshAgent, type Hearing, startHearing, turnMessage } from "./hearing.ts";
import { createHold } from "./hold.ts";
import { afterPublish } from "./publish.ts";
import { riteLines } from "./rites.ts";
import { agentOf, createRoot } from "./root.ts";
import { createRootSeat } from "./rootseat.ts";
import { putStartWord, seatedStart } from "./start.ts";
import { createTurnEnds } from "./turnend.ts";

export type { DshCtx } from "./console.ts";

export function apply(ctx: DshCtx): void {
  const W = () => words(DSH);
  const startedAt = Date.now(); // the plugin's own start: no hold record written earlier is this session's
  const log = loudOf(ctx);
  const notDelivered = (why: string): void => log(W().notDelivered(why));
  const sendAfterPublish = (a: DshAgent, message: Record<string, unknown>): void =>
    void afterPublish(a, message).catch((e: Error) => notDelivered(e.message));
  const authDir = authDirFromEnv();
  let agent: DshAgent | null = null;
  let raw: any = null; // the root's agent itself: its status and maintenance (hold.ts)
  let headless = false; // the sign shows on agent/created, not on apply (observed, #11071)
  let source: unknown = null; // the root's start: startup or resume (start.ts)
  let hearing: Hearing | null = null;
  const hold = createHold(notDelivered);
  // No cover — on, a frame proves the seat; else by the cover's rituals field.
  const turns = createTurnEnds({
    on: () => ritualCover(process.cwd())?.on.has(TURN_RITE) ?? true,
    wake: (text) => hold.wake(turnMessage(text)),
    watched: () => !headless,
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

  const on = listenerOf(ctx, notDelivered);

  // The session's first agent is its root; a subagent spawned in the process takes none of
  // its hearing, start word or rituals (root.ts). A disposed root session makes the next
  // agent/created a new session's root — a long process (dsh web) has many.
  const root = createRoot();
  // The root's seat by the cover before its first model request (rootseat.ts, #11076).
  const seats = createRootSeat(ctx, startedAt, authDir, log);
  on("agent/created", (payload) => {
    const took = root.take(payload?.agent, payload?.source);
    if (took === "child") return;
    const fresh = payload?.source === "startup" || payload?.source === "resume";
    if (took === "root") putStartWord(payload?.agent, payload?.source, process.cwd(), notDelivered);
    const own = agentOf(payload?.agent);
    if (own) [agent, raw] = [own, payload.agent];
    if (took === "root" && fresh) {
      source = payload.source;
      seats.begin(payload?.agent, process.cwd());
    }
    headless = isHeadless(ctx);
    if (!hearing) hearing = startHearing(heard, log, startedAt);
  });
  // Waterfalls before the root's first model request wait for its seating, no longer: the
  // prompt's assembly (system-prompt/assemble, context.scope — the agent; dsh-agent
  // lib/index.js:407-412) — its start word then names the seat taken (start.ts) — and the
  // request itself (payload, next).
  on("system-prompt/assemble", async (_assembly, context, next) => {
    const a = context?.scope;
    if (a && a === raw) await seats.request(a);
    const out = typeof next === "function" ? await next() : _assembly;
    return a && a === raw ? seatedStart(out, process.cwd(), source, seats.seated()) : out;
  });
  on("agent/request", async (payload, next) => {
    await seats.request(payload?.agent);
    return typeof next === "function" ? next() : undefined;
  });
  on("session/disposed", (session) => {
    if (!root.ours(session)) return; // a subagent's session ended, the root's lives on
    hearing?.stop(); // the session is gone: nothing more goes into it
    hearing = null;
    agent = null;
    raw = null;
    hold.end();
    seats.end();
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
