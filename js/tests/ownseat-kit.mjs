// Общее у проб своего места и места рядом (ownseat*.test.mjs): мост под пробой,
// подставной сервер и чтение ответа iskron_stand.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

export const NODE = process.env.ISKRON_NODE || process.execPath;
export const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_stand";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "stand-probe", version: "0" },
};

function startBridge(serverUrl, authDir) {
  const notifications = [];
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_DAEMON: "0",
    },
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
      if (msg.id === undefined && msg.method) notifications.push(msg);
      else waiters.get(msg.id)?.(msg);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let id = 0;
  return {
    notifications,
    get stderr() {
      return stderr;
    },
    call(method, params = {}) {
      const myId = ++id;
      const p = new Promise((res, rej) => {
        waiters.set(myId, res);
        setTimeout(() => rej(new Error(`no answer for ${method}`)), 20_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return p;
    },
    stop: () =>
      proc.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.stdin.end();
            setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
          }),
  };
}

export const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
export const placeOf = (r) => /стояние (?:@[^:\s]+:)?(\S+) — роль/.exec(textOf(r))?.[1];
export const until = async (check, what) => {
  for (const end = Date.now() + 10_000; !(await check());) {
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
export const stand = (b, args) => b.call("tools/call", { name: "iskron_stand", arguments: args });
export const channel = (b, args) =>
  b.call("tools/call", { name: "iskron_channel", arguments: args });
export const holdRecord = (dir, key) =>
  readdirSync(join(dir, "standings"))
    .filter((f) => f.endsWith(".hold"))
    .map((f) => JSON.parse(readFileSync(join(dir, "standings", f), "utf8")))
    .find((r) => r.key === key) ?? null;
export const placeArgs = (fake, action) =>
  fake.state.placeArgs.filter((p) => p.action === action).map((p) => p.name);
export const saidKind = (b, kind) => b.notifications.find((n) => n.params?.data?.kind === kind);

export async function setup(t) {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-ownseat-"));
  const cwd = mkdtempSync(join(tmpdir(), "iskron-ownseat-cwd-"));
  t.after(() => fake.stop());
  const up = async (authDir = dir) => {
    const b = startBridge(fake.mcpUrl, authDir);
    t.after(() => b.stop());
    assert.ok((await b.call("initialize", INIT)).result);
    return b;
  };
  return { fake, dir, cwd, up };
}

export const write = (b, realm = "nks-dev") =>
  b.call("tools/call", {
    name: "iskron_add_phenomenon",
    arguments: { realm, name: "x", given_as: "ding" },
  });
export const boardLine = (name) =>
  `  #931 👨‍💻 Роль 能 · @tester:${name} — живой · простой 6h · слушает · сокет был сейчас · открыл @tester\n     📥 http://x/api/channel/in/${name}`;
