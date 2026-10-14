// Обвязка проб «конец агента закрывает место» (граф @nks/nks-dev, узел #7493): настоящие
// тонкие мосты через настоящий демон машины на фейке NKS. ISKRON_BRIDGE_PATH наводит пробы на
// другую копию моста.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { holdFilePathOf } from "../shared/standings.ts";
import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_lifeend";
export const DEATH_MS = 2_500;
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "pi-iskron", version: "0" },
};

function startBridge(serverUrl, authDir, args = []) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir, ...args], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_DAEMON: "1",
      ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
      ISKRON_BRIDGE_DAEMON_GRACE_MS: "300",
      ISKRON_BRIDGE_DEATH_MS: String(DEATH_MS),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  const notifications = [];
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined && msg.method) notifications.push(msg);
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let seq = 0;
  const send = (msg) => proc.stdin.write(JSON.stringify(msg) + "\n");
  return {
    proc,
    notifications,
    get stderr() {
      return stderr;
    },
    send,
    request(method, params = {}, id = ++seq) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id})`)), 30_000).unref();
      });
      send({ jsonrpc: "2.0", id, method, params });
      return p;
    },
    gone: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => proc.once("exit", r)),
  };
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
export const journalOf = (dir) => {
  try {
    return readFileSync(join(dir, "run", "daemon.log"), "utf8");
  } catch {
    return "";
  }
};
const daemonPids = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);

export async function waitFor(what, fn, ms = 15_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await delay(50);
  }
}

export async function withFake(fn, opts = {}) {
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true, ...opts });
  const dir = mkdtempSync(join(tmpdir(), "iskron-lifeend-"));
  const homes = [dir];
  const procs = [];
  // Another home of the same account (another machine or grant dir): its own daemon.
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), "iskron-lifeend-other-"));
    homes.push(h);
    return h;
  };
  const bridge = async (at = dir, args = []) => {
    const b = startBridge(fake.mcpUrl, at, args);
    procs.push(b);
    const r = await b.request("initialize", INIT);
    assert.ok(r.result, `initialize: ${JSON.stringify(r)}\n${b.stderr}`);
    b.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return b;
  };
  try {
    await fn({ fake, dir, bridge, home });
  } finally {
    for (const b of procs) b.proc.kill("SIGKILL");
    await Promise.all(procs.map((b) => b.gone()));
    for (const h of homes)
      for (const pid of daemonPids(h))
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
    await fake.stop();
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  }
}

export const stand = (b, name) =>
  b.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name },
  });
export const closed = (fake, name) => fake.state.closedPlaces.has(`931:${name}`);
export const recordOf = (dir, name) => holdFilePathOf(dir, `${name}--931--nks-dev`);

export async function stood(b, name) {
  const r = await stand(b, name);
  assert.ok(!r.result?.isError, textOf(r));
  return r;
}

/** Connect calls the fake has seen. */
export const connectsOf = (fake) =>
  fake.state.calls.filter((c) => c.name === "iskron_channel" && c.arguments.action === "connect")
    .length;
