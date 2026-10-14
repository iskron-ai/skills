// Проба кадра живости места (граф nks-dev: #7529, #7493): мост шлёт по сокету канала
// {type: "pulse", state, pending, turn_at?, read_at?, cycle_at?} — при смене, не чаще шва
// ISKRON_PULSE_GAP_MS, заново на hello и последним перед уходом с места. state, turn_at и
// read_at дают только харнесы с плагином (pi, OpenCode) методом iskron/pulse; у Claude Code
// state unknown. Фейк NKS кладёт присланные кадры в state.pulses.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: мост без pulse не шлёт ни одного кадра.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_pulse";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (name) => ({
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name, version: "0" },
});

async function bridgeOf(t, harness, gap) {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-pulse-"));
  const proc = spawn(NODE, [FILE, fake.mcpUrl, "--no-browser", "--auth-dir", dir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_DAEMON: "0",
      ISKRON_PULSE_GAP_MS: String(gap),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    for (let nl; (nl = out.indexOf("\n")) >= 0;) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      const msg = line ? JSON.parse(line) : null;
      waiters.get(msg?.id)?.(msg);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((res, rej) => {
      const my = ++id;
      waiters.set(my, res);
      setTimeout(() => rej(new Error(`no answer for ${method}\n${stderr}`)), 20_000).unref();
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
    });
  t.after(async () => {
    if (proc.exitCode === null) {
      const gone = new Promise((r) => proc.once("exit", r));
      proc.stdin.end();
      setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
      await gone;
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.ok((await call("initialize", client(harness))).result);
  const stood = await call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "pulse" },
  });
  assert.ok(!stood.result?.isError, JSON.stringify(stood));
  const pulses = () => fake.state.pulses.map((p) => p.frame);
  const until = async (ok, what) => {
    for (let i = 0; i < 200 && !ok(); i++) await sleep(25);
    assert.ok(ok(), `${what}: ${JSON.stringify(fake.state.pulses)}\n${stderr}`);
  };
  const text = (stood.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const watchdog = () => {
    const key = / watchdog (\S+)/.exec(text)?.[1];
    assert.ok(key, text);
    const wd = spawn(NODE, [FILE, "watchdog", key], {
      env: { ...process.env, ISKRON_BRIDGE_AUTH_DIR: dir, ISKRON_BRIDGE_NO_UPDATE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    wd.stdout.resume();
    t.after(() => wd.kill("SIGKILL"));
    return wd;
  };
  return { fake, call, pulses, until, watchdog };
}

test("Claude Code: the seat's pulse goes on hello with state unknown, no turn_at or read_at", async (t) => {
  const { call, pulses, until } = await bridgeOf(t, "claude-code", 60_000);
  await until(() => pulses().length > 0, "a pulse on hello");
  const [first] = pulses();
  assert.equal(first.state, "unknown");
  assert.equal(first.pending, 0);
  assert.ok(!("turn_at" in first) && !("read_at" in first), JSON.stringify(first));
  assert.ok(!Number.isNaN(Date.parse(first.cycle_at)), "cycle_at — the stand call");
  const said = await call("iskron/pulse", { state: "busy", turn_at: new Date().toISOString() });
  assert.equal(said.result?.taken, false, "a harness without a plugin is not heard");
  await sleep(300);
  assert.equal(pulses().length, 1, "nothing new to say");
});

test("pi: a change gives one pulse, changes inside the gap give one more after it", async (t) => {
  const GAP = 1200;
  const { fake, call, pulses, until } = await bridgeOf(t, "pi-iskron", GAP);
  await until(() => pulses().length > 0, "a pulse on hello");
  assert.equal((await call("iskron/pulse", { state: "busy" })).result?.taken, true);
  await until(() => pulses().at(-1).state === "busy", "the busy pulse");
  const turn = new Date().toISOString();
  await call("iskron/pulse", { state: "idle", turn_at: turn });
  await call("iskron/pulse", { state: "busy" });
  await call("iskron/pulse", { state: "idle", turn_at: turn });
  await until(() => pulses().at(-1).state === "idle", "the last word after the gap");
  await sleep(GAP + 300);
  const at = fake.state.pulses.map((p) => p.at);
  for (let i = 2; i < at.length; i++)
    assert.ok(at[i] - at[i - 1] >= GAP - 50, `pulses ${at[i] - at[i - 1]} ms apart`);
  assert.equal(pulses().length, 3, JSON.stringify(pulses()));
  assert.equal(pulses().at(-1).turn_at, turn);
});

test("pending grows with a frame no watchdog took and falls once one gives it; a left seat is silent", async (t) => {
  const { fake, call, pulses, until, watchdog } = await bridgeOf(t, "claude-code", 600);
  await until(() => pulses().length > 0, "a pulse on hello");
  await fake.control({ ws_say: { name: "pulse", text: "слово месту", id: "m-1" } });
  await until(() => pulses().at(-1).pending === 1, "pending 1 — no watchdog took it");
  watchdog();
  await until(() => pulses().at(-1).pending === 0, "pending 0 — the watchdog gave it");
  const left = await call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  assert.ok(!left.result?.isError, JSON.stringify(left));
  const n = pulses().length;
  await sleep(800);
  assert.equal(pulses().length, n, "a left seat sends nothing");
});

// A stale frame skips the ring: its batch waits out its window (stale.ts) — the bridge holds it
// all that while, and the board must not read 0 then.
test("pending counts a stale frame the bridge holds in its batch and falls once the batch is given", async (t) => {
  const { fake, pulses, until, watchdog } = await bridgeOf(t, "claude-code", 300);
  await until(() => pulses().length > 0, "a pulse on hello");
  watchdog();
  await fake.control({ ws_say: { name: "pulse", text: "лежалое", id: "st-1", stale: true } });
  await until(() => pulses().at(-1).pending === 1, "pending 1 — the stale batch holds it");
  await until(() => pulses().at(-1).pending === 0, "pending 0 — the batch went to the watchdog");
});

test("the last pulse goes past the gap before the seat is left", async (t) => {
  const { call, pulses, until } = await bridgeOf(t, "pi-iskron", 600_000);
  await until(() => pulses().length > 0, "a pulse on hello");
  await call("iskron/pulse", { state: "busy" });
  await sleep(300);
  assert.equal(pulses().length, 1, "the gap holds the change");
  await call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  await until(() => pulses().at(-1).state === "busy", "the held change before leave");
});
