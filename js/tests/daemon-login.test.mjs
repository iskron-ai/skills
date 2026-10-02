// Демон без сессий и вход без клика (bridge/daemon-idle.ts, граф nks-dev: #6620):
// брошенный вход держит демона не дольше ISKRON_BRIDGE_ORPHAN_FLOW_MS, вернувшаяся
// сессия — как прежде. Без личного токена; ISKRON_BRIDGE_PATH — другая копия.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "p", version: "0" },
};
const ENV = {
  ISKRON_BRIDGE_DAEMON: "1",
  ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
  ISKRON_BRIDGE_DAEMON_IDLE_MS: "500",
  ISKRON_BRIDGE_ORPHAN_FLOW_MS: "2000",
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_TOKEN: "",
};

function startBridge(serverUrl, dir) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", dir], {
    env: { ...process.env, ...ENV },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const answers = [];
  const lines = createInterface({ input: proc.stdout });
  lines.on("line", (l) => l.trim() && answers.push(JSON.parse(l)));
  const exited = new Promise((r) => proc.once("exit", r));
  return {
    proc,
    async login() {
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT }) + "\n",
      );
      const a = await waitFor("the answer", () => answers.find((m) => m.id === 1));
      const link = /http:\/\/127\.0\.0\.1:\d+\/login\?k=[\w-]+/.exec(a.error?.message ?? "")?.[0];
      assert.ok(link, `expected a login link, got ${JSON.stringify(a)}`);
      return link;
    },
    leave: () => (proc.stdin.end(), exited),
    stop: () => (proc.kill("SIGKILL"), exited),
  };
}

const attempt = (fn, otherwise) => {
  try {
    return fn();
  } catch {
    return otherwise;
  }
};
const journalOf = (dir) => attempt(() => readFileSync(join(dir, "run", "daemon.log"), "utf8"), "");
const daemonPids = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);
const alive = (pid) => attempt(() => process.kill(pid, 0), false);
const listening = (port) =>
  new Promise((r) => {
    const s = connect({ host: "127.0.0.1", port });
    s.once("connect", () => (s.destroy(), r(true)));
    s.once("error", () => r(false));
  });
const granted = (dir) =>
  attempt(() => {
    const f = readdirSync(dir).find((n) => n.endsWith(".json"));
    return !!JSON.parse(readFileSync(join(dir, f), "utf8")).tokens?.access_token;
  }, false);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, ms = 15_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await pause(50);
  }
}

async function withFake(fn) {
  const fake = await startFakeNks({});
  const dir = mkdtempSync(join(tmpdir(), "iskron-daemon-login-"));
  const procs = [];
  const bridge = () => (procs.push(startBridge(fake.mcpUrl, dir)), procs.at(-1));
  try {
    await fn({ dir, bridge });
  } finally {
    await Promise.all(procs.map((b) => b.stop()));
    for (const pid of daemonPids(dir)) if (alive(pid)) process.kill(pid, "SIGKILL");
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const click = (link) =>
  fetch(link).then((r) => (assert.equal(r.status, 200, "the login link lands"), r.text()));

test("a login nobody clicks does not keep a daemon with no sessions past the limit", async () => {
  await withFake(async ({ dir, bridge }) => {
    const one = bridge();
    const link = await one.login();
    const [pid] = await waitFor("the daemon", () => daemonPids(dir).length && daemonPids(dir));
    await one.leave();
    await waitFor("the daemon to leave at the limit", () => !alive(pid), 10_000);
    assert.match(journalOf(dir), /the login unclicked for 2s — the daemon leaves/);
    assert.equal(await listening(+new URL(link).port), false, "the login's port is free");
    // Следующий мост начинает вход: перенимает его на той же ссылке, и клик садится.
    const next = bridge();
    assert.equal(await next.login(), link, "the next bridge takes the login over on its link");
    await click(link);
    await waitFor("the grant", () => granted(dir));
  });
});

test("a session back before the limit keeps the daemon and its login", async () => {
  await withFake(async ({ dir, bridge }) => {
    const one = bridge();
    const link = await one.login();
    const [pid] = await waitFor("the daemon", () => daemonPids(dir).length && daemonPids(dir));
    await one.leave();
    await waitFor("the idle wait on the login", () =>
      /staying for the human's click/.test(journalOf(dir)),
    );
    const two = bridge();
    assert.equal(await two.login(), link, "the returning session joins the same login");
    await pause(3000);
    assert.ok(alive(pid), "a session back before the limit keeps the daemon");
    assert.ok(await listening(+new URL(link).port), "the login still listens");
    await click(link);
    await waitFor("the grant", () => granted(dir));
    await two.leave();
    await waitFor("the daemon to leave after its window", () => !alive(pid), 10_000);
    assert.equal(daemonPids(dir).length, 1, "no second daemon was raised");
  });
});
