// Пробы «конец агента закрывает место» (граф @nks/nks-dev, узел #7493): настоящие тонкие
// мосты через настоящий демон машины на фейке NKS.
//   смерть   — харнес убит или закрыл вход без метки: до окна место живо, после окна
//              демон снимает его своим revoke и стирает запись держания;
//   окно     — новый мост той же папки вернул место внутри окна: оно не снимается;
//   отлучка  — метка iskron/away: место и запись переживают окно, та же сессия
//              возвращает место по записи сразу;
//   конец    — iskron/end (удалённая сессия OpenCode): снято сразу, тихо, без слова стопа;
//   Esc      — отменённый вызов места не трогает.
// ISKRON_BRIDGE_PATH наводит пробы на другую копию моста — на прежней сборке смерть
// места не снимает, а away и end основного места не исполняются.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_lifeend";
const DEATH_MS = 2_500;
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "pi-iskron", version: "0" },
};

function startBridge(serverUrl, authDir) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir], {
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const journalOf = (dir) => {
  try {
    return readFileSync(join(dir, "run", "daemon.log"), "utf8");
  } catch {
    return "";
  }
};
const daemonPids = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);

async function waitFor(what, fn, ms = 15_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await delay(50);
  }
}

async function withFake(fn) {
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true });
  const dir = mkdtempSync(join(tmpdir(), "iskron-lifeend-"));
  const procs = [];
  const bridge = async () => {
    const b = startBridge(fake.mcpUrl, dir);
    procs.push(b);
    const r = await b.request("initialize", INIT);
    assert.ok(r.result, `initialize: ${JSON.stringify(r)}\n${b.stderr}`);
    b.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return b;
  };
  try {
    await fn({ fake, dir, bridge });
  } finally {
    for (const b of procs) b.proc.kill("SIGKILL");
    await Promise.all(procs.map((b) => b.gone()));
    for (const pid of daemonPids(dir))
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const stand = (b, name) =>
  b.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name },
  });
const closed = (fake, name) => fake.state.closedPlaces.has(`931:${name}`);
const recordOf = (dir, name) => holdFilePathOf(dir, `${name}--931--nks-dev`);

async function stood(b, name) {
  const r = await stand(b, name);
  assert.ok(!r.result?.isError, textOf(r));
  return r;
}

for (const [how, end] of [
  ["killed", (b) => b.proc.kill("SIGKILL")],
  ["closed its stdin (Claude Code's exit, no hooks)", (b) => b.proc.stdin.end()],
])
  test(`the harness ${how} without a mark: the seat lives through the window and closes after it`, async () => {
    await withFake(async ({ fake, dir, bridge }) => {
      const a = await bridge();
      await stood(a, "die-x");
      assert.ok(existsSync(recordOf(dir, "die-x")), "the hold record is written");
      end(a);
      await a.gone();
      await delay(DEATH_MS / 2);
      assert.ok(!closed(fake, "die-x"), "within the window the seat is not closed");
      await waitFor("the seat closed after the window", () => closed(fake, "die-x"), 15_000).catch(
        (e) => {
          throw new Error(`${e.message}\n${journalOf(dir)}`);
        },
      );
      await waitFor("the hold record dropped", () => !existsSync(recordOf(dir, "die-x")), 5_000);
      assert.match(journalOf(dir), /without an announced absence — closing its seats/);
    });
  });

// The platform keeps a channel's main seat while seats of other graphs stand on it: the
// seats beside go first, then the main one.
test("a dead agent's seat beside in another graph closes with its main seat", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-b");
    const rb = await a.request("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "drugoy", karta: 48, name: "die-b" },
    });
    assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
    a.proc.kill("SIGKILL");
    await a.gone();
    await waitFor(
      "both seats closed",
      () => closed(fake, "die-b") && fake.state.closedPlaces.has("48:die-b"),
      15_000,
    ).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
  });
});

test("a new bridge of the folder takes the seat back within the window: it is not closed after it", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-r");
    a.proc.stdin.end();
    await a.gone();
    const b = await bridge(); // an MCP reconnect: the same folder, a new bridge
    const r = await stand(b, "die-r");
    assert.ok(!r.result?.isError, textOf(r));
    assert.match(textOf(r), /die-r/);
    await delay(DEATH_MS + 2_000);
    assert.ok(!closed(fake, "die-r"), `the returned seat stays:\n${journalOf(dir)}`);
    assert.match(journalOf(dir), /die-r--931--nks-dev is held again — not closed/);
  });
});

test("an announced absence keeps the seat past the window, and the same session takes it back at once", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await a.request("iskron/resume", { session: "ses-away" }); // the plugin names the session
    await stood(a, "die-a");
    const away = await a.request("iskron/away");
    assert.equal(away.result?.away, true, `away is taken: ${JSON.stringify(away)}`);
    a.proc.stdin.end();
    await a.gone();
    await delay(DEATH_MS + 2_000);
    assert.ok(!closed(fake, "die-a"), `the absent seat is not closed:\n${journalOf(dir)}`);
    assert.ok(existsSync(recordOf(dir, "die-a")), "its hold record waits");
    const b = await bridge();
    const started = Date.now();
    const back = await b.request("iskron/resume", {
      key: "die-a--931--nks-dev",
      session: "ses-away",
    });
    assert.equal(back.result?.resumed, true, JSON.stringify(back));
    assert.ok(back.result?.own, "returned as the session's own seat");
    assert.ok(Date.now() - started < 10_000, "no wait for a probe");
  });
});

test("the plugin's end of a deleted session revokes the main seat at once, quietly", async () => {
  await withFake(async ({ fake, bridge }) => {
    const a = await bridge();
    await stood(a, "die-e");
    const r = await a.request("iskron/end");
    assert.equal(r.result?.ended, true, JSON.stringify(r));
    assert.ok(
      r.result.revoked.some((s) => s.name === "die-e"),
      `revoked by the bridge itself: ${JSON.stringify(r)}`,
    );
    assert.ok(closed(fake, "die-e"), "the seat is off the board at once");
    await delay(300);
    const stop = a.notifications.filter((n) => n.params?.data?.kind === "stopped");
    assert.equal(stop.length, 0, `no stop word: ${JSON.stringify(stop)}`);
  });
});

test("a cancelled call (Esc) leaves the seat alone past the window", async () => {
  await withFake(async ({ fake, bridge }) => {
    const a = await bridge();
    await stood(a, "die-c");
    a.send({
      jsonrpc: "2.0",
      id: "esc-1",
      method: "tools/call",
      params: { name: "iskron_orient", arguments: { realm: "nks-dev" } },
    });
    a.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "esc-1" } });
    await delay(DEATH_MS + 1_000);
    assert.ok(!closed(fake, "die-c"), "the seat stays");
    assert.equal(a.proc.exitCode, null, "the bridge lives");
  });
});
