// A satellite seat names the model its subagent runs on (graph @nks/nks-dev, node #7591): the
// harness's, not the agent's word — one rule for the OpenCode plugin and the pi extension.
import { takingArgs } from "./busyargs.ts";

/**
 * The stand arguments of a satellite with the harness's model; the satellite's name does not
 * derive from it. A busy line alone stays one (#6509): model is a taking argument.
 */
export function withHarnessModel(
  args: Record<string, unknown>,
  model: string | null | undefined,
): Record<string, unknown> {
  const busy = typeof args.status === "string" && takingArgs(args).length === 0;
  return args.satellite_of && model && !busy ? { ...args, model } : args;
}
