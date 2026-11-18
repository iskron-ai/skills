// The role the orchestrator's task names for its home (graph @nks/nks-dev, nodes #10598, #11076):
// the task of the headless run — the service `headlessStartup` {json, sessionId, task}, observed
// live on agent/created — opens with the pair line carrying the role (bridge/orchestra-raise-gates.ts
// homeLine), read by OpenCode's own parse (shared/spawned-for.ts firstLineSpawn). No line, no role
// in it — none, the cover's role; a broken line is said and the cover's role stays.
/* eslint-disable @typescript-eslint/no-explicit-any -- the Cordis context without a schema */
import { refusedWord } from "../shared/rootseat-say.ts";
import { firstLineSpawn } from "../shared/spawned-for.ts";

export function taskRole(ctx: any, log: (text: string) => void): string | undefined {
  let task: unknown;
  try {
    task = ctx?.get?.("headlessStartup", false)?.task;
  } catch {
    return undefined;
  }
  if (typeof task !== "string") return undefined;
  try {
    const k = firstLineSpawn(task)?.karta;
    return k === undefined ? undefined : String(k);
  } catch (e) {
    log(refusedWord((e as Error).message));
    return undefined;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
