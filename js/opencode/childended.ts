// The server's word of a child's end (graph @nks/nks-dev, nodes #11362, #11359): the parent of an
// ended child gets an ordinary queued platform message (like card_unanswered): provenance.via
// "platform", provenance.notice "child_ended", provenance.notice_data {standing_id, standing, by,
// reason}, and a body — the server's text in the parent's language. It goes to the parent as any
// server frame, its body as is — the bridge batches it as a wake-up (backlog.ts); the plugin's own
// end word for that child (leads.ts finish) is then not also sent. For a server without it: until
// the first notice is seen in the process the end goes as before (the plugin's word, then the
// run's end) and a notice of an end already told is not delivered; once seen, the run ends first
// and the plugin's own word goes only if no notice came within the window. The notes are
// process-wide: the parent's frame may reach another folder's instance than the child's.
/* eslint-disable @typescript-eslint/no-explicit-any -- the process registry lives on globalThis */
import { envName, GLOBAL_PREFIX } from "../delivery/index.ts";

/** How long the child's end waits for the server's notice before its own word goes. */
const WINDOW_MS = Number(process.env[envName("OPENCODE_CHILD_ENDED_MS")]) || 3_000;
/** A note is kept this long: a notice ahead of the end it answers still counts. */
const KEPT_MS = 60_000;

export interface ChildEnded {
  standing_id: string | null;
  standing: string | null;
  by: string | null;
  reason: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The child_ended notice_data of a platform message, or null. */
export function childEndedOf(frame: unknown): ChildEnded | null {
  const f = (frame ?? {}) as Record<string, any>;
  const p = f.provenance;
  if (f.type !== "message" || p?.via !== "platform" || p.notice !== "child_ended") return null;
  const d = p.notice_data && typeof p.notice_data === "object" ? p.notice_data : {};
  const n = {
    standing_id: str(d.standing_id),
    standing: str(d.standing),
    by: str(d.by),
    reason: str(d.reason),
  };
  return n.standing_id || n.standing ? n : null;
}

type Note = ChildEnded & { at: number };
type Told = { seat: string | null; child: string; at: number };
const G = globalThis as any;
const notes = (): Note[] => (G[`${GLOBAL_PREFIX}ChildEnded`] ??= []);
const told = (): Told[] => (G[`${GLOBAL_PREFIX}ChildEndedTold`] ??= []);
const waiters = (): Set<() => void> => (G[`${GLOBAL_PREFIX}ChildEndedWaiters`] ??= new Set());

/**
 * Does this server send child_ended? Learned from its first notice in the process. Until then a
 * child's end goes as before — the plugin's word first, then the run's end (№147: a word after
 * the run's end lay down after OpenCode's own synthetic and woke the parent twice).
 */
export const sendsChildEnded = (): boolean => G[`${GLOBAL_PREFIX}ChildEndedKnown`] === true;

const names = (n: ChildEnded, seat: string | null, child: string): boolean =>
  [n.standing, n.standing_id].some(
    (s) => !!s && (s === child || (!!seat && (s === seat || s.endsWith(`:${seat}`)))),
  );

/** The plugin told the parent itself (the server not known to send the notice yet). */
export function toldChildEnded(seat: string | null, child: string): void {
  const now = Date.now();
  G[`${GLOBAL_PREFIX}ChildEndedTold`] = [
    ...told().filter((t) => now - t.at < KEPT_MS),
    { seat, child, at: now },
  ].slice(-200);
}

/**
 * The server said a child ended: its waiting end hears it. true — the plugin already told the
 * parent of this end itself: the frame would be a second turn, it is not delivered.
 */
export function noteChildEnded(n: ChildEnded): boolean {
  G[`${GLOBAL_PREFIX}ChildEndedKnown`] = true;
  const now = Date.now();
  const i = told().findIndex((t) => now - t.at < KEPT_MS && names(n, t.seat, t.child));
  if (i >= 0) {
    told().splice(i, 1);
    return true;
  }
  G[`${GLOBAL_PREFIX}ChildEnded`] = [
    ...notes().filter((x) => now - x.at < KEPT_MS),
    { ...n, at: now },
  ].slice(-200);
  for (const w of [...waiters()]) w();
  return false;
}

/** Did the server say child `child` (seat `seat`) ended — now or within the window? */
export function serverEnded(seat: string | null, child: string, ms = WINDOW_MS): Promise<boolean> {
  // A heard note is taken: the same seat name stood again later is another child.
  const said = (): boolean => {
    const all = notes();
    const i = all.findIndex((n) => Date.now() - n.at < KEPT_MS && names(n, seat, child));
    if (i >= 0) all.splice(i, 1);
    return i >= 0;
  };
  if (said()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (v: boolean): void => {
      clearTimeout(timer);
      waiters().delete(check);
      resolve(v);
    };
    const check = (): void => void (said() && done(true));
    const timer = setTimeout(() => done(false), ms);
    (timer as { unref?: () => void }).unref?.();
    waiters().add(check);
  });
}

/**
 * A channel event — a frame, or a wake-up/stale batch of frames: each child_ended in it is noted
 * for the child's waiting end. When it carries nothing but notices of ends the plugin already told
 * the parent, their seats — the event is not delivered then (a second turn); null — deliver as any.
 */
export function endToldAlready(ev: { frame?: unknown; frames?: unknown[] | null }): string | null {
  const frames = ev.frames?.length ? ev.frames : ev.frame ? [ev.frame] : [];
  const notices = frames.map(childEndedOf);
  if (!notices.some(Boolean)) return null;
  const told = notices.map((n) => (n && noteChildEnded(n) ? (n.standing ?? n.standing_id) : null));
  return told.every(Boolean) ? told.join(", ") : null;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
