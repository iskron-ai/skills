// One seat per root session across the OpenCode process (graph @nks/nks-dev, node #11463; the
// contract of #6550: a session speaks with at most one seat). OpenCode loads the plugin once per
// location, and a session moved to another folder (moves.ts) may have the calls of its running
// turn reach the previous folder's instance. Before an instance stands, returns or opens a
// bridge for a ROOT, it asks the process (twins.ts): the slot of another instance holding the
// root's seat serves the call — no second bridge, no second name. A seating in flight in another
// instance is waited for first: two instances seating one root stand two seats.
import { OPENCODE_KEEP, PLUGIN } from "../delivery/index.ts";
import { takingArgs } from "../shared/busyargs.ts";
import { words } from "../shared/lang.ts";
import { authDir, textOf } from "./bridge-io.ts";
import type { Keeper } from "./keep.ts";
import { writeLostMarker } from "./marker.ts";
import type { Home } from "./records.ts";
import { heldAs } from "./rootseat-by.ts";
import type { Slot } from "./slot.ts";
import { adoptIn, heldElsewhere, seatClaim, seatingElsewhere, slotOwners } from "./twins.ts";

export function owned(slot: Slot, slots: Map<string, Slot>): void {
  slotOwners().set(slot, slots);
}
export const foreign = (slot: Slot, slots: Map<string, Slot>): boolean =>
  slotOwners().has(slot) && slotOwners().get(slot) !== slots;

export function handMoved(slot: Slot, to: Home, keeper: Keeper<Slot>): void {
  const entries = writeLostMarker(authDir(), [{ ...slot, dir: to.directory, moved: true }], to);
  if (entries.length) keeper.hint(entries);
  adoptIn(to);
}

export function claimResume(root: string, slot: Slot, slots: Map<string, Slot>): void {
  if (!slot.resume) return;
  const withdraw = seatClaim(
    root,
    slot.resume.then(
      () => {},
      () => {},
    ),
    slots,
  );
  void slot.resume.then(withdraw, withdraw);
}

export function foreignAnswer(result: unknown, name: string): { content: string } {
  if ((result as { isError?: boolean } | null)?.isError)
    throw Object.assign(new Error(textOf(result) || words(PLUGIN).refusalNoText(name)), { result });
  return { content: textOf(result) };
}

/**
 * The slot of ANOTHER instance of this process holding the root's seat; null — none, or this
 * instance holds it itself. slots — this instance's slots: its own seat is not the answer, and
 * its own seating in flight is not waited for.
 */
export async function holderOf(root: string, slots: Map<string, Slot>): Promise<Slot | null> {
  const mine = slots.get(root);
  if (mine?.holding && mine.place && !mine.bridge.failure) return null;
  await seatingElsewhere(root, slots);
  return heldElsewhere(root, mine);
}

/** A call goes through the holder's slot: counted as its call, and known as not this instance's. */
export function served(slot: Slot, touch: boolean): Slot {
  if (touch) slot.lastCall = Date.now();
  return slot;
}

/**
 * An explicit stand of the seat the slot holds, come to an instance that does not hold it: the
 * holder's word instead of a register — a register would stand a second name beside the
 * session's seat. The model names the session's model and changes nothing here. A busy line, a
 * satellite's stand, a local recovery and a call doing more than standing — a name, a room, a
 * take — go to the holder's bridge as any call.
 */
export async function alreadyStands(
  slot: Slot,
  session: string,
  args: Record<string, unknown>,
  foreign: boolean,
): Promise<string | null> {
  if (!foreign || args.context_restored === true || args.satellite_of != null) return null;
  if (Object.keys(args).some((k) => !["realm", "karta", "model"].includes(k))) return null;
  if (typeof args.status === "string" || takingArgs(args).some((k) => k !== "model")) return null;
  const realm = String(args.realm ?? "").trim();
  const karta = String(args.karta ?? "").trim();
  if (!realm || !karta) return null;
  const seat = await heldAs({}, slot, session, realm, karta);
  return seat?.same
    ? words(OPENCODE_KEEP).alreadyStanding(seat.own.name, seat.own.realm, seat.own.karta)
    : null;
}
