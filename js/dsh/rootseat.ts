// The root seating of a dsh session (graph @nks/nks-dev, node #11076): the delivery's plugin seats
// the root session on the cover's role in its graph before the first model request, as OpenCode's
// root seating (#9334) — the same cover reading (shared/coverin.ts), switch and term
// (shared/rootseat-env.ts), comparison (shared/sameseat.ts) and words (shared/rootseat-say.ts).
// The word of the start stays the word of the work; a seating that failed is a stderr line.
//
// The path to the session's bridge: OpenCode's plugin owns the bridge it seats through; dsh's
// plugin owns none — the session's bridge is dsh's MCP child, its tools registered by
// @deepseek-ai/dsh-mcp-client on the tool registry (ctx.tools.register, dsh-mcp-client
// lib/index.js:153) under mcp__<serverName>__<tool>, the serverName of the delivery's profile
// patch. So the plugin reads the registry through ctx.get("tools") (no inject, as headless.ts)
// and runs the stand tool's own execute — the MCP client's callTool (index.js:140-147, 226-254;
// a refusal throws its text). Its environment is dsh's, not the scrubbed one of MCP children;
// the call needs none of it. The seat this takes is the session's own, not provisional: the
// bridge marks provisional only a call with its service id (bridge/provisional.ts), and dsh's
// MCP client numbers its calls itself.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK objects without a schema */
import { PRODUCT, tool } from "../delivery/index.ts";
import { coverIn } from "../shared/coverin.ts";
import { rootSeatEnabled, rootSeatMs } from "../shared/rootseat-env.ts";
import { heldWord, lateWord, notSeatedWord, refusedWord } from "../shared/rootseat-say.ts";
import { type HeldSeat, sameSeat, short } from "../shared/sameseat.ts";
import { holdOf, ownSeats } from "./seat.ts";

/** The stand tool as dsh's MCP client names it (references/dsh-profile.yml, observed #10657). */
export const STAND = `mcp__${PRODUCT}__${tool("stand")}`;
const LOOK_MS = 100;
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref?.());

export interface RootSeat {
  /** The root's agent/created, startup or resume: its seating starts. */
  begin(agent: any, dir: string): void;
  /** The root's model request: the first one waits for the seating within its term. */
  request(agent: any): Promise<void>;
  end(): void;
}

export function createRootSeat(
  ctx: any,
  startedAt: number,
  authDir: string,
  log: (text: string) => void,
): RootSeat {
  let seating: { agent: any; done: Promise<void>; abort: AbortController } | null = null;

  /** The session's own seat on disk (seat.ts), as the bridge recorded it. */
  const held = (): HeldSeat | null => {
    const [s] = ownSeats(authDir, startedAt);
    const r = s ? holdOf(authDir, s.key) : null;
    return r && typeof r.name === "string"
      ? { name: r.name, karta: String(r.karta ?? ""), realm: String(r.realm ?? "") }
      : null;
  };

  /** The stand tool once dsh's MCP client registered it; none within the term — null. */
  async function standTool(signal: AbortSignal): Promise<any> {
    for (const end = Date.now() + rootSeatMs(); !signal.aborted; await pause(LOOK_MS)) {
      try {
        const def = ctx?.get?.("tools", false)?.get?.(STAND);
        if (typeof def?.execute === "function") return def;
      } catch {
        /* the registry is not ours to break */
      }
      if (Date.now() >= end) return null;
    }
    return null;
  }

  async function seat(agent: any, dir: string, signal: AbortSignal): Promise<void> {
    const cover = coverIn(dir);
    if (cover === null) return;
    if ("why" in cover) return log(notSeatedWord(cover.why));
    const { realm, karta } = cover;
    const own = held();
    if (own) {
      // Held already: compared, not stood over — an rN beside @owner/slug is not guessed.
      const known = !!own.realm && short(own.realm) === short(realm);
      if (known && sameSeat(own, realm, karta))
        return log(heldWord({ place: own.name, realm: own.realm }, realm, karta));
      return log(
        heldWord(known ? { other: own } : { other: own, uncompared: realm }, realm, karta),
      );
    }
    const def = await standTool(signal);
    if (signal.aborted) return;
    if (!def) return log(refusedWord(`${STAND} — no such tool`));
    const model = agent?.model?.current?.()?.model;
    const args = { realm, karta, ...(typeof model === "string" && model ? { model } : {}) };
    try {
      await def.execute(args, { signal, toolCallId: `${STAND}:root`, deferContext() {} });
    } catch (e) {
      return log(refusedWord((e as Error).message));
    }
    if (signal.aborted) return;
    const now = held();
    log(heldWord({ place: now?.name ?? "?", realm: now?.realm || realm }, realm, karta));
  }

  return {
    begin(agent, dir) {
      if (!rootSeatEnabled()) return;
      seating?.abort.abort();
      const abort = new AbortController();
      const done = seat(agent, dir, abort.signal).catch((e: Error) => log(refusedWord(e.message)));
      seating = { agent, done, abort };
    },
    async request(agent) {
      const s = seating;
      if (!s || s.agent !== agent) return;
      seating = null; // only the first request waits
      const ms = rootSeatMs();
      const late = await Promise.race([s.done.then(() => false), pause(ms).then(() => true)]);
      if (late) log(lateWord(ms));
    },
    end() {
      seating?.abort.abort();
      seating = null;
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
