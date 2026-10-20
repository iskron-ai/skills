// Layouts and scenario verdicts of frames-consumer-run.mjs (case №1249).
//
// Two layouts: a flat directory of seat files (one branch label per file), or a directory of
// scenarios — every subdirectory a branch, its seat files beside _scenario.json (the case and
// the api's expectation); manifest.json and README.md at the top are skipped. A message is a
// wire frame, a string, or a raw channel_messages row (envelope in the `room` column, `body`
// beside it): a row becomes the frame the socket carries (graph @nks/nks-dev, #4939) — the
// envelope on top, body, provenance, to_standing_id the receiver. A row has no to_standing:
// the seat's @-address is taken from any seat object with its id in the scenario's frames.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const isRow = (m) => obj(m) === m && m.type === undefined && "channel_id" in m;
const SKIP = new Set(["_scenario.json", "manifest.json"]);

/** The @-address of seat `id` named anywhere in `values`; "" — none. */
function addressOf(id, values) {
  const stack = [...values];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === "object") {
      if (v.id === id && typeof v.standing === "string" && v.standing.startsWith("@")) return v.standing;
      stack.push(...Object.values(v));
    }
  }
  return "";
}

/** The socket frame of a channel_messages row; other messages as they are. */
export function wireOf(m, seat) {
  if (!isRow(m)) return m;
  const env = obj(m.room);
  const frame = { ...env, type: "message", id: m.id, body: m.body, content_type: m.content_type, provenance: m.provenance };
  if (m.in_reply_to != null && env.in_reply_to === undefined) frame.in_reply_to = m.in_reply_to;
  return { ...frame, to_standing_id: m.standing_id ?? seat.standing_id, ...(seat.standing ? { to_standing: seat.standing } : {}) };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const seatFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith(".json") && !SKIP.has(f)).sort();

/**
 * Why a seat is outside the bridge, "" — it is not: a person's seat (--human names it, the seat
 * file marks it — label person_*, a seat description or role label naming a person), or a
 * role's unmanned share (no standing_id: no seat holds it).
 */
function outsideOf(label, s, humans) {
  if (!s.standing_id) return "unmanned share: no seat holds it";
  const marks = [label, typeof s.seat === "string" ? s.seat : "", String(obj(s.standing).karta ?? "")];
  const person =
    humans.includes(label) || /^person_/.test(label) || obj(s.seat).human === true || obj(s.seat).kind === "person" ||
    marks.slice(1).some((m) => /\bperson(?:'s)?\b|_person\b/i.test(m));
  return person ? "a person's seat: its window or bot delivers it" : "";
}

/** Seats to run and the scenario of each branch (null in a flat directory). */
export function loadSeats(dir, humans = []) {
  // statSync follows a symlinked scenario (a subset assembled by links).
  const subs = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();
  const groups = subs.length
    ? subs.map((s) => ({ dir: join(dir, s), branch: s, files: seatFiles(join(dir, s)) }))
    : [{ dir, branch: null, files: seatFiles(dir) }];
  const seats = [];
  const scenarios = new Map();
  for (const g of groups) {
    const raw = g.files.map((f) => ({ f, s: readJson(join(g.dir, f)) }));
    const rows = raw.flatMap(({ s }) => (Array.isArray(s.messages) ? s.messages : []));
    for (const { f, s } of raw) {
      if (!s.standing_id && !s.standing) throw new Error(`${f}: needs standing_id or standing`);
      if (!Array.isArray(s.messages)) throw new Error(`${f}: needs messages[]`);
      // standing: an @-address string, or a seat object (the full set) — then the file names it.
      const named = typeof s.standing === "string" ? s.standing : "";
      const addr = named.startsWith("@") ? named : addressOf(s.standing_id, rows);
      const label = obj(s.seat).label ?? (named || f.replace(/\.json$/, ""));
      const role = typeof obj(s.standing).karta === "string" ? obj(s.standing).karta : ""; // the seat's role id
      const seat = { standing_id: s.standing_id ?? "", standing: addr, label, role, outside: outsideOf(label, s, humans) };
      const branch = g.branch ?? s.branch ?? "(no branch)";
      const own = { file: join(g.branch ?? "", f), verdict_on_main: s.verdict_on_main, expected: s.expected ?? null };
      seats.push({ ...seat, ...own, branch, messages: s.messages.map((m) => wireOf(m, seat)) });
    }
    if (g.branch) {
      let sc = null;
      try { sc = readJson(join(g.dir, "_scenario.json")); } catch { /* no scenario file */ }
      scenarios.set(g.branch, sc);
    }
  }
  return { seats, scenarios };
}

/**
 * A scenario's verdict apart from the bridge's: the api's frames are wrong where a record
 * carries its text to a seat while naming another (leak), carries it while naming no seat at
 * all — a question with no seat chosen (unaddressed), or withholds it from the seat it names.
 * A leak hidden by the bridge is a rescue, not routing; an unaddressed text hidden is lost to
 * every seat, the intended one too; either way the api stays red.
 */
export function scenarioOf(branch, outcome, all, scenario, seats) {
  // Agents' seats only: a person's seat has its own rule (#6908 v4) and its own deliverer.
  const records = all.filter((r) => r.verdict !== "outside-bridge");
  const leaks = records.filter((r) => r.intent === "theirs" && r.texts.length);
  const unaddressed = records.filter((r) => r.intent === "nobody" && r.texts.length);
  const withheld = records.filter((r) => r.intent === "mine" && r.withheld);
  const expected = scenario?.verdict_on_main ?? seats.find((s) => s.branch === branch)?.verdict_on_main ?? null;
  const api = leaks.length || unaddressed.length || withheld.length ? "red" : "green";
  return {
    branch,
    bridge: outcome,
    api_expected: expected,
    bridge_expectation: scenario?.bridge_expectation ?? null,
    api_seen: api,
    api_match: expected ? api === expected : null,
    leaks: leaks.length,
    rescued: leaks.filter((r) => r.verdict === "pass").length,
    unaddressed: unaddressed.length,
    lost: unaddressed.filter((r) => r.verdict === "pass").length,
    leaked_through: [...leaks, ...unaddressed].filter((r) => r.verdict === "fail").length,
    withheld_from_addressee: withheld.length,
    // The api gave the text whole to a record that names no seat; the bridge printed a count.
    whole_as_count: records.filter((r) => r.apiWhole && r.intent === null && r.verdict === "unjudged" && !r.shown.length).length,
    rejected: records.filter((r) => r.verdict === "rejected").length,
    outside_bridge: all.length - records.length,
    bridge_match: ["pass", "unjudged", "not-covered", "outside-bridge"].includes(outcome),
  };
}

/** The scenario table: bridge outcome, api expectation, match, rescues. */
export function scenarioTable(list) {
  const rows = [["scenario", "bridge", "api main", "api seen", "match api", "leaks", "rescued", "unaddressed", "lost", "let through", "withheld→addr", "whole→count", "rejected", "outside"]];
  for (const s of list)
    rows.push([s.branch, s.bridge, s.api_expected ?? "—", s.api_seen, s.api_match === null ? "—" : s.api_match ? "yes" : "NO", s.leaks, s.rescued, s.unaddressed, s.lost, s.leaked_through, s.withheld_from_addressee, s.whole_as_count, s.rejected, s.outside_bridge]);
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ")).join("\n");
}
