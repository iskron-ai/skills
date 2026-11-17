// The dormancy of a raised dsh run (graph @nks/nks-dev, node #10995): a clean exit — final
// completed, exit 0, a session in hand — with the call's case still open does not end the run.
// It sleeps: the tree and the dsh session stay, the slot frees, and the tact watches the case
// journal until a word wakes the continuation `dsh --session-id` (orchestra-dsh-run.ts) or the
// sleep ends — a closed case, a revoked seat, a stop order on the seat, the window. The seat's
// own stop at the exit is not touched: the sleep arms only where the run would end anyway.
import { ORCHESTRA } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { type CaseEntry, readCaseHistory, readCaseStatus } from "./orchestra-case-read.ts";
import { launchDsh } from "./orchestra-dsh-run.ts";
import type { Launchers } from "./orchestra-launcher-types.ts";
import { LIVE, type Run } from "./orchestra-runs.ts";
import { DORMANT_WINDOW_MS } from "./orchestra-window.ts";

const w = () => words(ORCHESTRA);

/** A dsh exit that can sleep: final completed, exit 0, a session to continue. */
export const dshSleepable = (r: Run): boolean =>
  r.dsh?.final === "completed" && r.dsh.exit === "0" && !!r.dsh.session;

/**
 * Arm the sleep on a run whose end was already decided: the case must still be open, and the
 * journal is read whole once — the cursor takes its last number, the wake keeps the seat ids
 * (the row's own and every earlier one), the invite entry's role uuid and the seat's own asks.
 * True — the row sleeps; false — the end stands as it was decided. A failed read keeps the
 * end: nothing is slept on a guess.
 */
export async function goDormant(base: string, token: string, r: Run): Promise<boolean> {
  if (!dshSleepable(r) || r.tree?.state !== "ready") return false;
  let read: { entries: CaseEntry[]; cursor: number };
  try {
    if ((await readCaseStatus(base, token, r.room)) !== "open") return false;
    read = await readCaseHistory(base, token, r.room);
  } catch {
    return false;
  }
  const seats = [
    ...new Set([...(r.dormant?.seats ?? []), r.standing_id].filter((s): s is string => !!s)),
  ];
  // The seat left the case before the process exited: our exit stop met an already-gone
  // standing (the 410 path), so a left authored by the call's seat is its own walk-away —
  // no sleep on it. Our completed stop's left is another matter: its stop_outcome stands on
  // the row, and the sleep arms (#10995 review).
  if (
    r.why === "seat_gone_after_exit" &&
    read.entries.some(
      (e) => e.kind === "left" && !!e.author_standing_id && seats.includes(e.author_standing_id),
    )
  )
    return false;
  // The cursor lands on the seat's own last word, never past it: a said that came after the
  // agent's last move but before this read must still wake — a spurious wake is cheaper than
  // a lost word (#10995 review). No word of the call's seats — the invite's number is the
  // floor, and the cursor never walks back.
  const seatLast = [...read.entries]
    .reverse()
    .find((e) => e.author_standing_id && seats.includes(e.author_standing_id))?.n;
  const asks: Record<string, string> = {};
  for (const e of read.entries)
    if (e.kind === "ask" && e.author_standing_id && seats.includes(e.author_standing_id))
      asks[e.n] = e.author_standing_id;
  const karta = read.entries.find((e) => e.n === r.invite)?.to_karta_node_id;
  r.state = "dormant";
  r.dormant = {
    since: new Date().toISOString(),
    cursor: Math.max(seatLast ?? 0, r.invite, r.dormant?.cursor ?? 0),
    seats,
    ...(karta ? { karta } : {}),
    asks,
  };
  return true;
}

/** The tact's ended dsh rows sleep too (#10995) — except a stop ordered elsewhere, which is a
 * wind-down: its end stays an end. Called where a tact settles stops into ends synchronously. */
export async function dormantFromEnds(
  base: string,
  token: string,
  runs: Record<string, Run>,
): Promise<void> {
  for (const r of Object.values(runs))
    if (r.state === "ended" && !r.why?.endsWith("_elsewhere") && r.tree?.state === "ready")
      await goDormant(base, token, r);
}

/** What a journal entry means for the sleep: the platform's addressing wakes — a said or an
 * ask to a standing id the call's seat had, an ask or an invite to the invited role's karta
 * uuid, an answer to the seat's own ask; a left of the seat with reason revoked ends it. */
type Verdict = { wake: CaseEntry } | { end: string; cursor: number } | { cursor: number };

function judge(entries: CaseEntry[], from: number, r: Run): Verdict {
  const seats = new Set(r.dormant?.seats ?? []);
  const karta = r.dormant?.karta;
  const asks = r.dormant?.asks ?? {};
  // An answer may answer an ask of this same page: the page's own asks resolve first.
  const pageAsks = new Map(
    entries
      .filter((e) => e.kind === "ask" && e.author_standing_id)
      .map((e) => [e.n, e.author_standing_id as string]),
  );
  const wakes = (e: CaseEntry): boolean => {
    if (
      (e.kind === "said" || e.kind === "ask") &&
      !!e.to_standing_id &&
      seats.has(e.to_standing_id)
    )
      return true;
    if ((e.kind === "ask" || e.kind === "invite") && !!karta && e.to_karta_node_id === karta)
      return true;
    if (e.kind === "answer" && e.in_reply_to !== null) {
      const author = pageAsks.get(e.in_reply_to) ?? asks[String(e.in_reply_to)];
      return !!author && seats.has(author);
    }
    return false;
  };
  let cursor = from;
  let wake: CaseEntry | undefined;
  let end: { code: string; n: number } | undefined;
  // The journal cannot tell our own exit-stop's left from the seat's walk-away: the first
  // left of each seat after the cursor is taken as ours, and only a later one ends (#10995).
  const firstLeft = new Set<string>();
  for (const e of entries) {
    // A number at or behind the cursor replaces its predecessor — it never wakes twice.
    if (e.n <= from) continue;
    if (e.kind === "closed") {
      end ??= { code: "dormant_case_closed", n: e.n };
      continue;
    }
    if (e.kind === "left" && e.author_standing_id && seats.has(e.author_standing_id)) {
      if (firstLeft.has(e.author_standing_id)) {
        if (e.reason === "revoked") end ??= { code: "dormant_seat_revoked", n: e.n };
        // The seat's own walk-away: the agent said it is done with the case.
        else if (e.reason === "leave") end ??= { code: "dormant_seat_left", n: e.n };
      } else firstLeft.add(e.author_standing_id);
      cursor = Math.max(cursor, e.n);
      continue;
    }
    // The call's own words never wake it: the seat speaking is the live agent's business.
    if (e.author_standing_id && seats.has(e.author_standing_id)) {
      cursor = Math.max(cursor, e.n);
      continue;
    }
    if (!wake && wakes(e)) {
      wake = e;
      continue;
    }
    cursor = Math.max(cursor, e.n);
  }
  // The read is decided whole: an end anywhere on it beats an earlier waking word — nothing
  // continues a sleep whose own page says it is over (#10995 review).
  if (end) return { end: end.code, cursor: end.n };
  if (wake) return { wake };
  return { cursor };
}

/**
 * One tact over the dormant rows (#10995): each case is read from its cursor after its status.
 * A waking word launches the continuation on the slept session — the cursor lands on the waking
 * entry; while the continuation lives, the journal is not read (the row is no longer dormant).
 * The launcher's slot taken or gone holds the cursor where it lay. A closed case, a revoked
 * seat, a passed window ends the sleep, and the ordinary tree cleanup takes the tree. A failed
 * read leaves the cursor standing and names itself in the row.
 */
export async function stepDormant(
  authDir: string,
  base: string,
  token: string,
  runs: Record<string, Run>,
  ls: Launchers,
  gone?: { gone: boolean },
  now = Date.now(),
  launch: typeof launchDsh = launchDsh,
): Promise<string[]> {
  const out: string[] = [];
  for (const [key, r] of Object.entries(runs)) {
    if (r.state !== "dormant" || !r.dsh || !r.dormant) continue;
    if (gone?.gone) break;
    const sleep = r.dormant;
    if (now - Date.parse(sleep.since) > DORMANT_WINDOW_MS) {
      r.state = "ended";
      r.why = "dormant_window";
      out.push(w().leadRow(r.realm, r.room, r.invite, r.why));
      continue;
    }
    let entries: CaseEntry[];
    try {
      if ((await readCaseStatus(base, token, r.room)) !== "open") {
        r.state = "ended";
        r.why = "dormant_case_closed";
        out.push(w().leadRow(r.realm, r.room, r.invite, r.why));
        continue;
      }
      entries = (await readCaseHistory(base, token, r.room, sleep.cursor ?? 0)).entries;
    } catch (e) {
      r.why = "dormant_read_error";
      out.push(
        w().leadRow(r.realm, r.room, r.invite, `dormant_read_error (${(e as Error).message})`),
      );
      continue;
    }
    const verdict = judge(entries, sleep.cursor ?? 0, r);
    if ("wake" in verdict) {
      const own = ls.own.get(r.launcher);
      const spec = own?.harnesses[r.harness]?.dsh;
      if (!own || !spec) {
        r.why = "dormant_launcher_gone";
        out.push(w().leadRow(r.realm, r.room, r.invite, r.why));
        continue;
      }
      const live = Object.values(runs).filter(
        (x) => x.launcher === r.launcher && LIVE.includes(x.state),
      ).length;
      if (live >= own.limit) {
        r.why = "dormant_limit_reached";
        out.push(w().leadRow(r.realm, r.room, r.invite, r.why));
        continue;
      }
      r.dormant = { ...sleep, cursor: verdict.wake.n };
      const why = await launch(authDir, runs, key, spec, w().dshContinue(r.room, verdict.wake.n));
      out.push(w().leadRow(r.realm, r.room, r.invite, `dormant_woken_${verdict.wake.n}, ${why}`));
      continue;
    }
    if ("end" in verdict) {
      r.state = "ended";
      r.why = verdict.end;
      r.dormant = { ...sleep, cursor: verdict.cursor };
      out.push(w().leadRow(r.realm, r.room, r.invite, r.why));
      continue;
    }
    r.dormant = { ...sleep, cursor: verdict.cursor };
  }
  return out;
}
