// Behavioural probes of the machine daemon's orchestration door (bridge/orchestra.ts,
// bridge/orchestra-door.ts, cli/orchestra.ts — graph @nks/nks-dev, nodes #7513, #7514, #8202): the flag, the named
// graph boundary and the daemon's local entrance. The daemon is real — raised by the
// subcommand against no server, for the door needs no session; the CLI is the same
// executable. ISKRON_BRIDGE_PATH aims both at any copy, as elsewhere.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;

function cli(args, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "orchestra", ...args, "--lang", "ru"], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  const done = new Promise((resolve) => {
    proc.once("exit", (code, signal) => resolve({ code, signal, out, err }));
    setTimeout(() => proc.kill("SIGKILL"), 30_000).unref();
  });
  return { proc, done };
}

const DAEMON_ENV = {
  // A leaked daemon of a failed probe leaves on its own long before the runner's patience.
  ISKRON_BRIDGE_DAEMON_IDLE_MS: "15000",
};

async function raiseDaemon(dir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...DAEMON_ENV, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  proc.stderr.on("data", (c) => (err += c));
  const stop = () =>
    new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once("exit", resolve);
      setTimeout(resolve, 5000).unref(); // a kill that never reports still ends the probe
      proc.kill("SIGKILL");
    });
  return { stop, err: () => err };
}

/** Until the daemon's door answers — or the cause why it never did. */
async function untilDoor(dir, env = {}) {
  const until = Date.now() + 20_000;
  for (;;) {
    const r = await cli(["status", "--auth-dir", dir], env).done;
    if (!/демона машины нет/.test(r.err)) return r;
    if (Date.now() > until) throw new Error(`the door never answered: ${r.err}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const flagAt = (dir) => join(dir, "run", "orchestra.json");
const flagOf = (dir) => JSON.parse(readFileSync(flagAt(dir), "utf8"));

test("orchestra: no daemon — every op is refused aloud, not run around", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const r = await cli(["on", "--auth-dir", dir]).done;
  assert.equal(r.code, 1, `exit 1, not ${r.code}: ${r.err}${r.out}`);
  assert.match(r.err, /демона машины нет/, r.err);
  assert.ok(!existsSync(flagAt(dir)), "nothing was written without a daemon");
});

test("orchestra: on without the machine's consent — refused, the flag untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir);
  try {
    await untilDoor(dir);
    const r = await cli(["on", "--realm", "@x/one", "--auth-dir", dir]).done;
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /не допустила оркестратора/, r.err);
    assert.match(r.err, /ISKRON_ORCHESTRA/, r.err);
    assert.ok(!existsSync(flagAt(dir)), "the refusal wrote no flag");
  } finally {
    await d.stop();
  }
});

test("orchestra: on with consent — the flag lies next to the grant, the boundary grows, off clears", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    const on = await cli(["on", "--realm", "@x/one", "--realm", "@x/two", "--auth-dir", dir]).done;
    assert.equal(on.code, 0, on.err);
    assert.match(on.out, /включён/);
    assert.deepEqual(flagOf(dir), { on: true, realms: ["@x/one", "@x/two"] });
    const more = await cli(["on", "--realm", "@x/three", "--auth-dir", dir]).done;
    assert.equal(more.code, 0, more.err);
    assert.deepEqual(
      flagOf(dir).realms,
      ["@x/one", "@x/two", "@x/three"],
      "on extends, not replaces",
    );
    const st = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /включён/);
    assert.match(st.out, /@x\/one, @x\/two, @x\/three/);
    const off = await cli(["off", "--auth-dir", dir]).done;
    assert.equal(off.code, 0, off.err);
    assert.match(off.out, /выключен/);
    assert.deepEqual(flagOf(dir), { on: false, realms: [] });
    const st2 = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st2.code, 0, st2.err);
    assert.match(st2.out, /выключен/);
  } finally {
    await d.stop();
  }
});

test("orchestra: the flag outlives the daemon — a new daemon reads what lies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const first = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
  const on = await cli(["on", "--realm", "@x/kept", "--auth-dir", dir]).done;
  assert.equal(on.code, 0, on.err);
  await first.stop();
  const second = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  try {
    const st = await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /включён/);
    assert.match(st.out, /@x\/kept/);
  } finally {
    await second.stop();
  }
});

test("orchestra: a line that is no known op is answered in the daemon's tongue, and the door stays alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir);
  const ask = (line) =>
    new Promise((resolve, reject) => {
      const s = connect(join(dir, "run", "orchestra.sock"));
      s.setTimeout(10_000, () => {
        s.destroy();
        reject(new Error("the door stayed silent"));
      });
      s.on("error", reject);
      s.on("connect", () => s.write(line + "\n"));
      let buf = "";
      s.on("data", (c) => {
        buf += c;
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        s.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(e);
        }
      });
    });
  try {
    await untilDoor(dir);
    const junk = await ask(JSON.stringify({ op: "levitate", realms: [] }));
    assert.equal(junk.ok, false, JSON.stringify(junk));
    assert.match(junk.said, /неизвестное действие/, JSON.stringify(junk));
    const broken = await ask("{not json");
    assert.equal(broken.ok, false, JSON.stringify(broken));
    assert.match(broken.said, /неизвестное действие/, JSON.stringify(broken));
    // The refusals close their own connections only: a proper ask still served.
    const st = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /выключен/);
  } finally {
    await d.stop();
  }
});
