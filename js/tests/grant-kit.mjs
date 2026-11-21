// The grant's probes: a full bridge in process against the fake sign-in server,
// one grant authorized and then expired, so the next move is the refresh.
// ISKRON_BRIDGE_PATH points them at a past build.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
export const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "0" },
};

function startBridge(url, dir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, url, "--no-browser", "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_DAEMON: "0", ISKRON_BRIDGE_NO_BROWSER: "1", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
  proc.stdout.on("data", (c) => {
    out += c;
    for (let nl; (nl = out.indexOf("\n")) >= 0;) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  proc.stderr.resume();
  return {
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

export const linkIn = (text) =>
  /(http:\/\/127\.0\.0\.1:\d+\/login(?:\?k=[\w-]+)?|https?:\/\/\S*\/authorize\?\S+)/.exec(
    text || "",
  )?.[1] ?? null;
const fileOf = (dir, end) =>
  join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(end)),
  );
export const storeFile = (dir) => fileOf(dir, ".json");
export const readStore = (dir) => JSON.parse(readFileSync(storeFile(dir), "utf8"));
export const grantLog = (dir) => {
  try {
    return readFileSync(join(dir, "grant.log"), "utf8");
  } catch {
    return "";
  }
};
export const lock = (dir) => {
  try {
    return JSON.parse(readFileSync(fileOf(dir, ".auth-pending"), "utf8"));
  } catch {
    return null;
  }
};
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(check, what, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(50);
  }
}
export const published = (dir) => grantLog(dir).match(/authorization flow published/g)?.length ?? 0;
// Five minutes on: the machine's stretch of a standing refusal is over.
export function ageRefusal(dir) {
  const path = storeFile(dir) + ".grant-state";
  const gs = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...gs, refused_at: Date.now() - 6 * 60_000 }));
}

export async function withGrant(opts, fn) {
  const fake = await startFakeNks(opts);
  const dir = mkdtempSync(join(tmpdir(), "iskron-grant-"));
  const bridges = [];
  const spawnBridge = (env) => {
    const b = startBridge(fake.mcpUrl, dir, env);
    bridges.push(b);
    return b;
  };
  try {
    const first = spawnBridge();
    const url = linkIn((await first.call("initialize", 1, INIT)).error?.message);
    assert.ok(url, "a first login must be offered");
    await (await fetch(url, { redirect: "follow" })).text();
    await waitFor(() => !!readStore(dir).tokens?.access_token, "the first grant");
    await first.stop();
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fn({ fake, dir, spawnBridge });
  } finally {
    await Promise.all(bridges.map((b) => b.stop()));
    await fake.stop();
  }
}
