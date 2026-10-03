// Driving the bridge for the device-login probes (device.test.mjs): spawned as a
// harness spawns it, spoken to over stdio, against the fake with its device
// side on. Not a test file. ISKRON_BRIDGE_PATH points the probes at another
// build — a past one, to watch them fail on the defect they were written for.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(dirname(fileURLToPath(import.meta.url)), "../../skills/establish-mcp/scripts/iskron.mjs");

export const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "0" },
};

export function startBridge(serverUrl, authDir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_BROWSER: "1", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
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
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  return {
    get stderr() {
      return stderr;
    },
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id})`)), 20_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return p;
    },
    stop: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.kill("SIGKILL");
          }),
  };
}

export async function withFake(opts, fn, env = {}) {
  const fake = await startFakeNks(opts);
  const dir = mkdtempSync(join(tmpdir(), "iskron-device-test-"));
  const bridge = startBridge(fake.mcpUrl, dir, env);
  try {
    await fn({ fake, dir, bridge });
  } finally {
    await bridge.stop();
    await reap(dir);
    await fake.stop();
  }
}

// The pids of this auth dir's processes: the daemon a thin bridge raised by
// default outlives the bridge, and one waiting out a login abandoned with the
// probe never leaves by itself. pgrep finds it by its --auth-dir; where pgrep
// is not, its life lock names it.
function pidsOf(dir) {
  const found = spawnSync("pgrep", ["-f", dir], { encoding: "utf8" });
  if (!found.error) return found.stdout.split("\n").map(Number).filter(Boolean);
  try {
    return [JSON.parse(readFileSync(join(dir, "run", "daemon.lock"), "utf8")).pid];
  } catch {
    return [];
  }
}

/** Every process of the probe's auth dir goes, then the dir itself. */
export async function reap(dir) {
  await killAll(dir);
  rmSync(dir, { recursive: true, force: true });
}

/** Every process of the probe's auth dir goes; what they left on disk stays. */
export async function killAll(dir) {
  for (const pid of pidsOf(dir)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone already */
    }
  }
  await waitFor(() => pidsOf(dir).length === 0, `the processes of ${dir} to go`, 5_000);
}

/** The loopback link and the device link (with its code) an answer hands out. */
export function linksIn(text) {
  const local = /(http:\/\/127\.0\.0\.1:\d+\/login\?k=[\w-]+)/.exec(text ?? "")?.[1] ?? null;
  const device = /(http:\/\/127\.0\.0\.1:\d+\/device-page\?code=(\w+))/.exec(text ?? "");
  return { local, device: device?.[1] ?? null, userCode: device?.[2] ?? null };
}

export async function waitFor(check, what, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not there yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const storeFile = (dir) =>
  join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(".json")),
  );
export const readStore = (dir) => JSON.parse(readFileSync(storeFile(dir), "utf8"));
export const grantLanded = (dir) =>
  waitFor(() => !!readStore(dir).tokens?.access_token, "the grant to reach the store");

export function portListening(port) {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1000, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}
