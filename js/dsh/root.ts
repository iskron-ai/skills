// Which agent of a dsh process is its session's root (graph @nks/nks-dev, node #11071): dsh's
// subagent tool spawns the child inside the same process, and the plugin hears agent/created for
// it too (observed live on LAB, dsh 0.2.2-rc.1). Hearing, the start word and the rituals stay
// with the root. The child's session names its parent — SessionHeader.parentSession, origin
// "subagent", delegationDepth above zero: read from the types of the installed
// @deepseek-ai/dsh-session 0.2.2-rc.1 (types.d.ts) and dsh-subagent's delegationDepthOf, the
// child's payload itself not observed. A header saying nothing: a fresh agent (source startup or
// resume, #10657) while the root lives is a child as well; clear and compact replace the root's.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK objects without a schema */

/** The agent's session says it is a delegated child. */
export function childAgent(a: any): boolean {
  const h = a?.session?.header;
  if (!h || typeof h !== "object") return false;
  const depth = typeof h.delegationDepth === "number" ? h.delegationDepth : 0;
  return h.parentSession != null || h.origin === "subagent" || depth > 0;
}

/** The id of a session; unknown — null. */
export const sessionId = (s: any): string | null => (typeof s?.id === "string" ? s.id : null);

/** The root of a process's live session: taken by its first agent, kept from its children. */
export function createRoot() {
  let started = false;
  let id: string | null = null;
  return {
    /** "root" — the session's first agent; "same" — the root's agent replaced; "child" — not the root. */
    take(a: any, source: unknown): "root" | "same" | "child" {
      const fresh = source === "startup" || source === "resume";
      if (childAgent(a) || (started && fresh)) return "child";
      if (started) return "same";
      started = true;
      id = sessionId(a?.session);
      return "root";
    },
    /** The event's session is the root's, or one of them is unknown. */
    ours: (session: unknown): boolean => {
      const s = sessionId(session);
      return !id || !s || s === id;
    },
    end(): void {
      started = false;
      id = null;
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
