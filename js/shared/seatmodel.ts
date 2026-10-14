// A satellite seat names the model its subagent runs on (graph @nks/nks-dev, node #7591): the
// harness's, not the agent's word — one rule for the OpenCode plugin and the pi extension.
import { takingArgs } from "./busyargs.ts";

/**
 * The stand arguments of a satellite with the harness's model; the satellite's name does not
 * derive from it. The agent's model is always dropped: no model from the harness — no model.
 * A busy line alone stays one (#6509): the bridge runs it so only while it holds a seat (its
 * "held" word — `holds`) and nothing but the busy-only arguments is set; otherwise the stand
 * takes the seat and names the model.
 */
export function withHarnessModel(
  args: Record<string, unknown>,
  model: string | null | undefined,
  holds: boolean,
): Record<string, unknown> {
  if (!args.satellite_of) return args;
  const { model: _said, ...own } = args;
  const busy = holds && typeof own.status === "string" && takingArgs(own).length === 0;
  return model && !busy ? { ...own, model } : own;
}
