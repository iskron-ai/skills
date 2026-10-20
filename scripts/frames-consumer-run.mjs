#!/usr/bin/env node
// A consumer run of raw api frames through the delivered bridge (case №1249): every file of
// the directory is one seat, its messages go — in delivery order — through a fake NKS onto the
// socket of the dev-built bridge (dist/dev, as the probes in js/tests), heard by the real
// `watchdog` and by a raw tap of the bridge's local socket. Per record: the count line
// «записей N, тебе M», the record's text shown or not, the bridge's `addressed` mark, a closing
// line — judged against what the frame's address fields mean (frames-consumer-judge.mjs).
//
//   node scripts/frames-consumer-run.mjs <dir> [--bridge <iskron.mjs>] [--json <file>]
//
// A file: {"standing_id": "...", "standing": "@handle:name", "branch": "<matrix branch>",
// "messages": [channel_messages in delivery order]}; a message that is a string goes as is.
// Each record is flushed alone: sent, then a word addressed to the seat itself interrupts, so
// the count before it belongs to that record only (batch folding across records is not run).
// Outcome per branch: pass | fail | rejected (a frame the bridge handed to no client) | not-covered.
// Exit 0 — no branch failed; 1 — a branch failed; 2 — setup failed.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILT_BRIDGE } from "../js/tests/built.mjs";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { roomFrame } from "../js/tests/room-frames.mjs";
import { branchOutcome, intentFor, judge, readSegment, table, textsOf } from "./frames-consumer-judge.mjs";

const BATCH_MS = 400;
const STALE_MS = 1500; // the bridge's stale window (js/bridge/stale.ts)
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

/** A process whose stdout and stderr accumulate. */
function run(argv, env) {
  const proc = spawn(process.execPath, argv, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
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
const nudgeOf = (seat, i) => ({
  ...roomFrame("said", { entry_id: 900_000 + i, key: "said", stack: "interrupt", body: `FC-NUDGE-${i}` }),
  room: { id: "fc-nudge", seq: 999_999, zachin: "nudge", realm: "nks-dev", status: "open" },
  to_standing_id: seat.standing_id,
  to_standing: seat.standing,
  addressee: seat.standing,
});

async function runSeat(bridgePath, seat) {
  const fake = await startFakeNks({ pat: PAT });
  const auth = mkdtempSync(join(tmpdir(), "fc-"));
  const env = { ISKRON_BRIDGE_TOKEN: PAT, ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_DAEMON: "0", ISKRON_BRIDGE_ROOM_BATCH_MS: String(BATCH_MS) };
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
    wd = run([bridgePath, "watchdog", key, "--auth-dir", auth], {});
    await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
    const records = [];
    for (const [i, m] of seat.messages.entries()) {
      const from = wd.out.length;
      const before = tapped.length;
      await fake.control({ ws_send: typeof m === "string" ? m : JSON.stringify(m) });
      await sleep((m?.stale === true ? STALE_MS : BATCH_MS) + 300);
      await fake.control({ ws_send: JSON.stringify(nudgeOf(seat, i)) });
      await waitFor(() => wd.out.includes(`FC-NUDGE-${i}`), `the nudge after message ${i}`, 5000);
      const segment = wd.out.slice(from).split("\n").filter((l) => !l.includes(`[${900_000 + i}]`) && !l.includes(`FC-NUDGE-${i}`)).join("\n");
      const f = typeof m === "string" ? {} : m;
      // By id; an id-less frame by its own fields (the bridge may add some), a string as is.
      const same = (t) =>
        typeof m === "string" ? t.raw === m
        : f.id ? t.frame?.id === f.id
        : Object.entries(f).every(([k, v]) => JSON.stringify(t.frame?.[k]) === JSON.stringify(v));
      const got = tapped.slice(before).find(same);
      const texts = textsOf(f);
      const repeat = !!f.id && seat.messages.slice(0, i).some((p) => p?.id === f.id);
      const obs = { delivered: !!got, repeat, stale: f.stale === true, addressed: got?.frame?.addressed, texts, shown: texts.filter((t) => segment.includes(t)), ...readSegment(segment, f.entry_id) };
      const intent = intentFor(f, seat, seat.messages);
      records.push({ seat: seat.standing, entry: f.entry_id ?? `#${i}`, kind: String(f.event_kind ?? f.kind ?? "?").replace(/^room\./, ""), intent, ...obs, segment, ...judge(intent, obs) });
    }
    return records;
  } finally {
    wd?.proc.kill("SIGKILL");
    tap?.destroy();
    bridge.proc.stdin.end();
    await Promise.race([new Promise((r) => bridge.proc.once("exit", r)), sleep(3000)]);
    bridge.proc.kill("SIGKILL");
    await fake.stop();
    rmSync(auth, { recursive: true, force: true });
  }
}

const dir = process.argv[2];
if (!dir || dir.startsWith("--")) fail(2, "usage: frames-consumer-run.mjs <dir> [--bridge <iskron.mjs>] [--json <file>]");
const bridgePath = arg("--bridge") ?? process.env.ISKRON_BRIDGE_PATH ?? BUILT_BRIDGE;
const seats = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (!s.standing || !Array.isArray(s.messages)) fail(2, `${f}: needs standing and messages[]`);
  return { ...s, branch: s.branch ?? "(no branch)", file: f };
});
if (!seats.length) fail(2, `no *.json seat files in ${dir}`);
const byBranch = new Map();
for (const seat of seats) {
  let records;
  try {
    records = await runSeat(bridgePath, seat);
  } catch (e) {
    fail(2, `${seat.file}: ${e.message}`);
  }
  byBranch.set(seat.branch, [...(byBranch.get(seat.branch) ?? []), ...records]);
}
const branches = [...byBranch].map(([branch, records]) => ({ branch, outcome: branchOutcome(records), records }));
const summary = { bridge: bridgePath, branches: branches.map((b) => ({ branch: b.branch, outcome: b.outcome, records: b.records.map(({ segment: _s, ...r }) => r) })) };
process.stdout.write(table(branches) + "\n\n" + JSON.stringify(summary, null, 2) + "\n");
const jsonOut = arg("--json");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...summary, segments: branches.flatMap((b) => b.records.map((r) => ({ seat: r.seat, entry: r.entry, segment: r.segment }))) }, null, 2));
process.exit(branches.some((b) => b.outcome === "fail") ? 1 : 0);
