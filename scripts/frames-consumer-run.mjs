#!/usr/bin/env node
// A consumer run of raw api frames through the delivered bridge (case №1249): every file of
// the directory is one seat, its messages go — in delivery order — through a fake NKS onto the
// socket of the dev-built bridge (dist/dev, as the probes in js/tests), heard by the real
// `watchdog` and by a raw tap of the bridge's local socket. Per record: the count line
// «записей N, тебе M», the record's text shown or not, the bridge's `addressed` mark, a closing
// line — judged against what the frame's address fields mean (frames-consumer-judge.mjs).
//
//   node scripts/frames-consumer-run.mjs <dir> [--bridge <iskron.mjs>] [--json <file>] [--human <label,…>]
//
// Persons' seats (label person_*, a person mark in the seat file, or --human) and a role's
// unmanned share (no standing_id) are outside the bridge — their window or bot delivers them,
// no seat holds the share: their records are outside-bridge, never pass/fail.
//
// A file: {"standing_id": "...", "standing": "@handle:name", "branch": "<matrix branch>",
// "messages": [channel_messages in delivery order]}; a message that is a string goes as is.
// Or a directory of scenarios — <scenario>/<seat>.json beside <scenario>/_scenario.json, a raw
// channel_messages row per message; then a scenario table follows: the bridge's outcome, the
// api's verdict on main against the one seen in the frames, leaks the bridge rescued or let
// through (frames-consumer-scenarios.mjs).
// Each record is flushed alone: sent, then a word addressed to the seat itself (case
// №999999, cut from the output) interrupts, so the count before it belongs to that record only
// (batch folding across records is not run); output after the nudge is read as late for that
// and earlier records. Not covered: the bridge always holds one seat, connected as `proba` —
// the seat a frame names is taken from the frame (to_standing_id), so the bridge's own routing
// between seats (several seats, its own seat id) is not run; a stale frame is not judged.
// Outcome per branch: pass | fail | rejected (a frame the bridge handed to no client) |
// unparsed (an address the judge does not read) | unjudged | not-covered.
// Bridge and watchdog run with updates off and a home of their own (mkdtemp): the real
// ~/.iskron-bridge and OpenCode plugin are never read or written. Ctrl-C cleans up.
// Exit 0 — every branch pass, unjudged or outside-bridge; 1 — a branch failed; 2 — setup
// failed; 3 — no fail, but a branch not-covered (a kind not checked, no records), unparsed (an
// address the judge does not read) or rejected (a frame dropped): not an acceptance.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILT_BRIDGE } from "../js/tests/built.mjs";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { roomFrame } from "../js/tests/room-frames.mjs";
import { addressHint, branchOutcome, intentFor, judge, kindOf, readSegment, table, textsOf } from "./frames-consumer-judge.mjs";
import { loadSeats, scenarioOf, scenarioTable } from "./frames-consumer-scenarios.mjs";

const BATCH_MS = 400;
const STALE_MS = 1500; // the bridge's stale window (js/bridge/stale.ts)
const TAIL_MS = 300; // how long output after a nudge is awaited as late
const NUDGE_CASE = 999_999;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const fail = (code, why) => {
  process.stderr.write(`frames-consumer-run: ${why}\n`);
  process.exit(code);
};
async function waitFor(check, what, ms = 10_000) {
  for (const end = Date.now() + ms; !check(); await sleep(50)) if (Date.now() > end) throw new Error(`timed out: ${what}`);
}

// What a stop leaves behind — processes, directories, fakes — goes on a signal too.
const live = { procs: new Set(), dirs: new Set(), fakes: new Set() };
async function cleanup() {
  for (const p of live.procs) p.kill("SIGKILL");
  await Promise.all([...live.fakes].map((f) => f.stop().catch(() => {})));
  for (const d of live.dirs) rmSync(d, { recursive: true, force: true });
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => void cleanup().finally(() => process.exit(130)));
const tempDir = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  live.dirs.add(d);
  return d;
};

/** A process whose stdout and stderr accumulate. */
function run(argv, env) {
  const proc = spawn(process.execPath, argv, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  live.procs.add(proc);
  proc.once("exit", () => live.procs.delete(proc));
  const p = { proc, out: "", err: "" };
  proc.stdout.on("data", (c) => (p.out += c));
  proc.stderr.on("data", (c) => (p.err += c));
  return p;
}

/** One JSON-RPC call over the bridge's stdio. */
async function call(b, id, method, params = {}) {
  b.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  let msg;
  await waitFor(() => (msg = b.out.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.id === id)), method);
  return msg;
}

/** The word to the seat itself that flushes the record before it. */
const nudgeOf = (seat, i) => {
  const to = { id: seat.standing_id, standing: seat.standing };
  const f = roomFrame("said", { entry_id: 900_000 + i, key: "said", stack: "interrupt", body: `FC-NUDGE-${i}`, fields: { kind: "text", to } });
  return { ...f, room: { id: "fc-nudge", seq: NUDGE_CASE, zachin: "nudge", realm: "nks-dev", status: "open" }, to_standing_id: seat.standing_id, to_standing: seat.standing, addressee: seat.standing || null };
};

/** Output of the nudge itself: its case number, its text. */
const nudgeLine = (l) => l.includes(`№${NUDGE_CASE}`) || l.includes("FC-NUDGE-");
/** Watchdog output from `from` up to the nudge of record i (exclusive), the nudge's own lines cut. */
const upToNudge = (out, from, i) => {
  const at = out.indexOf(`FC-NUDGE-${i}`, from);
  const lines = out.slice(from, at === -1 ? undefined : at).split("\n");
  return lines.filter((l) => !nudgeLine(l)).join("\n");
};

async function runSeat(bridgePath, seat) {
  const fake = await startFakeNks({ pat: PAT });
  live.fakes.add(fake);
  const auth = tempDir("fc-");
  const home = tempDir("fc-home-");
  // Both halves get the same env: updates off and a home of their own — the watchdog
  // subcommand syncs ~/.iskron-bridge otherwise (js/cli/main.ts), and may re-exec into it.
  const env = {
    ISKRON_BRIDGE_TOKEN: PAT, ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_DAEMON: "0",
    ISKRON_BRIDGE_ROOM_BATCH_MS: String(BATCH_MS), HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"),
  };
  const bridge = run([bridgePath, fake.mcpUrl, "--no-browser", "--auth-dir", auth], env);
  let wd, tap;
  try {
    await call(bridge, 1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "frames-consumer", version: "0" } });
    const conn = await call(bridge, 2, "tools/call", { name: "iskron_channel", arguments: { realm: "nks-dev", action: "connect", karta: 931, name: "proba" } });
    const key = /watchdog (\S+)/.exec((conn.result?.content ?? []).map((c) => c.text ?? "").join("\n"))?.[1];
    if (!key) throw new Error(`connect gave no watchdog key: ${JSON.stringify(conn).slice(0, 300)}`);
    await waitFor(() => fake.state.ws.size === 1, "the seat's socket");
    const sockDir = join(auth, "standings");
    const sock = readdirSync(sockDir).find((f) => f.endsWith(".sock"));
    if (!sock) throw new Error("no local socket under the auth dir");
    const tapped = [];
    tap = connect(join(sockDir, sock));
    let buf = "";
    tap.setEncoding("utf8").on("data", (c) => {
      const lines = (buf += c).split("\n");
      buf = lines.pop();
      for (const l of lines) {
        let ev = null;
        try { ev = JSON.parse(l); } catch { /* not our line */ }
        if (ev?.kind === "stale") for (const frame of ev.frames ?? []) tapped.push({ raw: JSON.stringify(frame), frame });
        if (ev?.kind !== "frame") continue;
        let frame = ev.frame;
        try { frame ??= JSON.parse(ev.raw); } catch { /* raw, not JSON */ }
        tapped.push({ raw: ev.raw, frame });
      }
    });
    wd = run([bridgePath, "watchdog", key, "--auth-dir", auth], env);
    await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
    const records = [];
    let from = wd.out.length;
    for (const [i, m] of seat.messages.entries()) {
      const before = tapped.length;
      await fake.control({ ws_send: typeof m === "string" ? m : JSON.stringify(m) });
      await sleep((m?.stale === true ? STALE_MS : BATCH_MS) + 300);
      await fake.control({ ws_send: JSON.stringify(nudgeOf(seat, i)) });
      await waitFor(() => wd.out.includes(`FC-NUDGE-${i}`), `the nudge after message ${i}`, 5000);
      const segment = upToNudge(wd.out, from, i);
      // The tail after the nudge: output of this or an earlier record that came late.
      await sleep(TAIL_MS);
      const at = wd.out.indexOf(`FC-NUDGE-${i}`, from);
      const tail = wd.out.slice(at).split("\n").slice(1).filter((l) => !nudgeLine(l)).join("\n");
      from = wd.out.length;
      for (const r of records) lateInto(r, tail);
      const f = typeof m === "string" ? {} : m;
      // By id; an id-less frame by its own fields (the bridge may add some), a string as is.
      const same = (t) =>
        typeof m === "string" ? t.raw === m
        : f.id ? t.frame?.id === f.id
        : Object.entries(f).every(([k, v]) => JSON.stringify(t.frame?.[k]) === JSON.stringify(v));
      const got = tapped.slice(before).find(same);
      const texts = textsOf(f);
      const repeat = !!f.id && seat.messages.slice(0, i).some((p) => p?.id === f.id);
      const obs = { outside: seat.outside, apiWhole: textsOf(f).length > 0 && f.body_withheld !== true, delivered: !!got, repeat, stale: f.stale === true, withheld: f.body_withheld === true, addressed: got?.frame?.addressed, texts, shown: texts.filter((t) => segment.includes(t)), ...readSegment(segment, f.entry_id) };
      const intent = intentFor(f, seat, seat.messages);
      const rec = { seat: seat.label, entry: f.entry_id ?? `#${i}`, kind: kindOf(f), intent, hint: addressHint(f), ...obs, late: [], segment };
      lateInto(rec, tail);
      records.push(rec);
    }
    return records.map((r) => ({ ...r, ...judge(r.intent, r) }));
  } finally {
    wd?.proc.kill("SIGKILL");
    tap?.destroy();
    bridge.proc.stdin.end();
    await Promise.race([new Promise((r) => bridge.proc.once("exit", r)), sleep(3000)]);
    bridge.proc.kill("SIGKILL");
    await fake.stop();
    live.fakes.delete(fake);
    for (const d of [auth, home]) rmSync(d, { recursive: true, force: true }), live.dirs.delete(d);
  }
}

/** A record's text or line in output that came after its nudge: it counts as shown. */
function lateInto(r, tail) {
  const shown = r.texts.filter((t) => tail.includes(t) && !r.shown.includes(t));
  const line = readSegment(tail, r.entry).recordLine;
  if (!shown.length && !line) return;
  r.shown.push(...shown);
  r.recordLine ||= line;
  r.late.push(tail);
}

const dir = process.argv[2];
if (!dir || dir.startsWith("--")) fail(2, "usage: frames-consumer-run.mjs <dir> [--bridge <iskron.mjs>] [--json <file>] [--human <label,…>]");
const bridgePath = arg("--bridge") ?? process.env.ISKRON_BRIDGE_PATH ?? BUILT_BRIDGE;
let loaded;
try {
  loaded = loadSeats(dir, (arg("--human") ?? "").split(",").filter(Boolean));
} catch (e) {
  fail(2, e.message);
}
const { seats, scenarios } = loaded;
if (!seats.length) fail(2, `no seat files in ${dir}`);
/** Records of a seat no bridge holds (an unmanned share): listed, not run. */
const unheld = (seat) =>
  seat.messages.map((f, i) => ({
    seat: seat.label, entry: f.entry_id ?? `#${i}`, kind: kindOf(f),
    intent: null, texts: textsOf(f), shown: [], closing: [], count: null, yours: null, late: [], segment: "",
    verdict: "outside-bridge", why: [seat.outside],
  }));
const byBranch = new Map();
let setupFailed = false;
for (const seat of seats) {
  let records = [];
  try {
    if (seat.unmanned) records = unheld(seat);
    else if (seat.messages.length) records = await runSeat(bridgePath, seat);
  } catch (e) {
    // One seat's setup failure is its own outcome; the rest of the set still runs.
    setupFailed = true;
    process.stderr.write(`frames-consumer-run: ${seat.file}: ${e.message}\n`);
    records = [{ seat: seat.label, entry: "—", kind: "—", intent: null, texts: [], shown: [], closing: [], count: null, yours: null, late: [], segment: "", verdict: "setup-error", why: [e.message] }];
  }
  byBranch.set(seat.branch, [...(byBranch.get(seat.branch) ?? []), ...records]);
}
const branches = [...byBranch].map(([branch, records]) => ({ branch, outcome: branchOutcome(records), records }));
const scenarioList = scenarios.size ? branches.map((b) => scenarioOf(b.branch, b.outcome, b.records, scenarios.get(b.branch), seats)) : [];
const seatList = seats.map((s) => ({ branch: s.branch, seat: s.label, outside: s.outside || null, expected: s.expected }));
const summary = { bridge: bridgePath, scenarios: scenarioList, seats: seatList, branches: branches.map((b) => ({ branch: b.branch, outcome: b.outcome, records: b.records.map(({ segment: _s, late: _l, ...r }) => ({ ...r, late: _l.length > 0 })) })) };
const scenarioText = scenarioList.length ? scenarioTable(scenarioList) + "\n\n" : "";
process.stdout.write(table(branches) + "\n\n" + scenarioText + JSON.stringify(summary, null, 2) + "\n");
const jsonOut = arg("--json");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...summary, segments: branches.flatMap((b) => b.records.map((r) => ({ seat: r.seat, entry: r.entry, segment: r.segment, late: r.late }))) }, null, 2));
const has = (o) => branches.some((b) => b.outcome === o);
process.exit(setupFailed ? 2 : has("fail") ? 1 : ["not-covered", "unparsed", "rejected"].some(has) ? 3 : 0);
