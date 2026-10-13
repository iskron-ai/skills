// The launcher's revoke of its lead subagent's seat (graph @nks/nks-dev, nodes #7505, #6593):
// the plugin ends the child first (leads.ts — the outcome to the parent, the child's bridge
// leaves its cases, revokes and goes down), then the launcher's own revoke goes to the platform
// by the launcher's bridge, the seat's role filled in. One word of the launcher takes the seat
// off the board whatever the child's bridge managed; a seat already gone counts as taken off,
// any other refusal is a loud refusal of the launcher's call, not a quiet "released".
import { refusalOf } from "../bridge/refusal.ts";
import type { JsonRpcMessage } from "../bridge/types.ts";
import type { Released } from "./leaddoors.ts";
import { W } from "./leadwords.ts";

/**
 * The seat is already off only by the api's refusal data (tools.ts carries it on the throw):
 * standing_not_held, 410, or 404 without a rule — as the bridge's caseexit.ts. A missing role
 * or graph, a refusal without data, any prose — the seat is NOT taken off.
 */
const seatGone = (e: unknown): boolean => {
  const r = refusalOf({ result: (e as { result?: unknown }).result } as JsonRpcMessage);
  return (
    !!r && (r.rule === "standing_not_held" || r.status === 410 || (r.status === 404 && !r.rule))
  );
};

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
    if (seatGone(e)) return freed.word;
    const why = (e as Error).message;
    throw new Error(W().unreleased(p?.name ?? String(args.standing ?? ""), why), { cause: e });
  }
}
