// The launcher's revoke of its lead subagent's seat (graph @nks/nks-dev, nodes #7505, #6593):
// the plugin ends the child first (leads.ts — the outcome to the parent, the child's bridge
// leaves its cases, revokes and goes down), then the launcher's own revoke goes to the platform
// by the launcher's bridge, the seat's role filled in. One word of the launcher takes the seat
// off the board whatever the child's bridge managed; a seat already gone counts as taken off,
// any other refusal is a loud refusal of the launcher's call, not a quiet "released".
import { CASE_EXIT_CLOSED } from "../delivery/index.ts";
import type { Released } from "./leaddoors.ts";
import { W } from "./leadwords.ts";

export async function revokeAsLauncher(
  freed: Released,
  args: Record<string, unknown>,
  call: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  const p = freed.place;
  const full = {
    ...args,
    ...(args.realm == null && p?.realm ? { realm: p.realm } : {}),
    ...(args.karta == null && p?.karta ? { karta: p.karta } : {}),
  };
  try {
    await call(full);
    return freed.word;
  } catch (e) {
    const why = (e as Error).message;
    if (CASE_EXIT_CLOSED.test(why)) return freed.word;
    throw new Error(W().unreleased(p?.name ?? String(args.standing ?? ""), why), { cause: e });
  }
}
