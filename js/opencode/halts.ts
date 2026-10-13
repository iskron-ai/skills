// Sessions the owner stopped (graph @nks/nks-dev, nodes #7439, #7440): a stopped session and its
// descendants get no channel word — frame, batch, tact, resumed — until a new "held" of that session,
// which after a stop only an explicit call of the stand tool brings (bridge stophold.ts).

export interface Halts {
  stop(session: string): void;
  held(session: string | null): void;
  /** The session or any of its ancestors is stopped. */
  halted(session: string): boolean;
}

/** `parentOf` — the known parent of a child session, without asking OpenCode. */
export function createHalts(parentOf: (session: string) => string | undefined): Halts {
  const stopped = new Set<string>();
  return {
    stop: (session) => void stopped.add(session),
    held: (session) => void (session && stopped.delete(session)),
    halted(session) {
      const seen = new Set<string>();
      for (let s: string | undefined = session; s && !seen.has(s); s = parentOf(s)) {
        if (stopped.has(s)) return true;
        seen.add(s);
      }
      return false;
    },
  };
}

/** Every known descendant of `session` — children, theirs, and so on — by the parent map `parents`. */
export function descendantsOf(session: string, parents: Iterable<[string, string]>): string[] {
  const all = [...parents];
  const found: string[] = [];
  const seen = new Set([session]);
  for (let i = -1; i < found.length; i++) {
    const of = i < 0 ? session : found[i];
    for (const [child, parent] of all)
      if (parent === of && !seen.has(child)) {
        seen.add(child);
        found.push(child);
      }
  }
  return found;
}
