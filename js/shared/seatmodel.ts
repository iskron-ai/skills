// A satellite seat names the model its subagent runs on (graph @nks/nks-dev, node #7591): the
// harness's, not the agent's word — one rule for the OpenCode plugin and the pi extension.
import { takingArgs } from "./busyargs.ts";

/**
 * The stand arguments of a satellite with the harness's model; the satellite's name does not
 * derive from it. The agent's model is always dropped: no model from the harness — no model.
 * A busy line alone stays one (#6509): the bridge runs it so only while it holds a seat in the
 * call's graph (its "held" word — `heldRealm`) and nothing but the busy-only arguments is set;
 * otherwise the stand takes the seat and names the model. The bridge compares graphs in their
 * canonical form, which the harness does not know: two spellings count as two graphs here, so
 * at worst a busy line takes the held seat again, with the harness's model.
 */
export function withHarnessModel(
  args: Record<string, unknown>,
  model: string | null | undefined,
  heldRealm: string | null | undefined,
): Record<string, unknown> {
  if (!args.satellite_of) return args;
  const { model: _said, ...own } = args;
  const realm = typeof own.realm === "string" ? own.realm.trim() : "";
  const holds = !!heldRealm && realm === heldRealm.trim();
  const busy = holds && typeof own.status === "string" && takingArgs(own).length === 0;
  return model && !busy ? { ...own, model } : own;
}
