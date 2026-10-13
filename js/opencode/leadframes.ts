// Frames of a lead subagent's own bridge (channel.ts; graph @nks/nks-dev, node #7505): an
// ended or ending lead gets nothing into its session, and its launcher's addressed word
// enters its running turn whatever the stack.
import { addressedToMine } from "../shared/addressed.ts";
import { type Frame } from "../shared/channel.ts";
import { roomKind } from "../shared/room-kinds.ts";

/** Lead subagents as the tools half knows them (leads.ts). */
export interface ChildLeads {
  /** Ended or ending: nothing goes into its session any more. */
  ended(session: string): boolean;
  /** Its launcher's seat name; not a live lead — null. */
  launcherOf(session: string): string | null;
}

export const NO_LEADS: ChildLeads = { ended: () => false, launcherOf: () => null };

/** A record of the launcher's seat addressed to its live lead, not a word in flight. */
export function fromLauncher(frame: Frame, launcher: string | null): boolean {
  if (!launcher || !addressedToMine(frame) || roomKind(frame)?.phase) return false;
  const f = frame as { provenance?: { from_standing?: unknown }; line?: { author?: unknown } };
  const by = String(
    f.provenance?.from_standing ?? (f.line?.author as { standing?: unknown })?.standing ?? "",
  );
  return by === launcher || by.endsWith(`:${launcher}`);
}
