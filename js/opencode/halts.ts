// Sessions the owner stopped (graph @nks/nks-dev, nodes #7439, #7440): a stopped session and its
// children get no channel word — frame, batch, tact, resumed — until a new "held" of that session,
// which after a stop only an explicit call of the stand tool brings (bridge stophold.ts).

export interface Halts {
  stop(session: string): void;
  held(session: string | null): void;
  halted(session: string): boolean;
}

/** `rootOf` — the known root of a child session, without asking OpenCode. */
export function createHalts(rootOf: (session: string) => string | undefined): Halts {
  const stopped = new Set<string>();
  return {
    stop: (session) => void stopped.add(session),
    held: (session) => void (session && stopped.delete(session)),
    halted: (session) => stopped.has(session) || stopped.has(rootOf(session) ?? session),
  };
}
