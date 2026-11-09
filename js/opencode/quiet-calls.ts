// A stale batch wakes no turn for calls that ask nothing of the session (case №4050 [74]):
// a withdrawal, an invite withdrawn in the same batch, and — for a session raised for an invite
// (spawned_for) — every invite: its own is taken, another's is the orchestrator's to raise.
// The frames stay marked as delivered; only the text that would wake the model loses them.
import type { ChannelEvent } from "../bridge/door.ts";
import type { Frame } from "../shared/channel.ts";
import { caseKey } from "../shared/frame-text.ts";
import { staleBatch } from "../shared/stalebatch.ts";

type Line = { kind?: unknown; key?: unknown; entry_id?: unknown };

const lineOf = (f: Frame): Line => (f.line && typeof f.line === "object" ? (f.line as Line) : {});
const kindOf = (f: Frame): string =>
  typeof f.event_kind === "string" && f.event_kind.startsWith("room.")
    ? f.event_kind.slice(5)
    : String(lineOf(f).kind ?? "");
const callKey = (f: Frame): string => `${caseKey(f)}|${String(lineOf(f).key ?? "")}`;
const entryOf = (f: Frame): number => Number(lineOf(f).entry_id ?? f.entry_id) || 0;

/** The calls of a stale batch that ask nothing, by the rule above. */
function quiet(frames: readonly Frame[], spawned: boolean): Set<Frame> {
  const withdrawn = new Map<string, number>();
  for (const f of frames)
    if (kindOf(f) === "withdraw")
      withdrawn.set(callKey(f), Math.max(withdrawn.get(callKey(f)) ?? 0, entryOf(f)));
  return new Set(
    frames.filter((f) => {
      const kind = kindOf(f);
      if (kind === "withdraw") return true;
      if (kind !== "invite") return false;
      return spawned || entryOf(f) < (withdrawn.get(callKey(f)) ?? 0);
    }),
  );
}

/** The batch without its quiet calls, its marks kept; an empty text wakes nothing (channel.ts batch). */
export function quietCalls(ev: ChannelEvent, spawned: boolean): ChannelEvent {
  if (ev.kind !== "stale" || !ev.frames?.length) return ev;
  const drop = quiet(ev.frames, spawned);
  if (!drop.size) return ev;
  const kept = ev.frames.filter((f) => !drop.has(f));
  const text = kept.length ? staleBatch(kept, () => false).text : "";
  return { ...ev, frames: kept, text, body: undefined };
}
