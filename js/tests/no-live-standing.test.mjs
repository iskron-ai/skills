// The status POST's 404 carrying the rule `no_live_standing` (graph @nks/nks-dev, nodes #4235,
// #11376): the channel is alive but carries no live seat. A busy line does no connect and no
// register — the owner's decision on #4235: the bridge reads its hold record again; a different
// seat address there gets the line once; the same address — the line is NOT set, and the agent
// is told to stand again. A 404 WITHOUT the rule keeps today's word (a turned address).
// ISKRON_BRIDGE_PATH points the bridge at a past build: there the same address registered again.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_live";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "0" },
};
const SEAT = { realm: "nks-dev", karta: 931, name: "live-again" };
const ENV = { ISKRON_BRIDGE_TOKEN: PAT, ISKRON_BRIDGE_NO_UPDATE: "1" };
const REFUSED_404 = /Отказано \(404\)|Refused \(404\)/;
const TURNED = /больше не адресует|no longer addresses/;
const NO_LIVE_SEAT =
  /строка занятости НЕ поставлена: места на канале нет — встань снова \(iskron_stand\)|busy line NOT set: no live seat on the channel — stand again \(iskron_stand\)/;
const textOf = (reply) => (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");

function startBridge(serverUrl, authDir) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...process.env, ISKRON_BRIDGE_DAEMON: "0", ISKRON_BRIDGE_NO_BROWSER: "1", ...ENV },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
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
  return {
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + "\n"),
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(
          () => rej(new Error(`no answer for ${method} (id ${id}) — the bridge went silent`)),
          15_000,
        ).unref();
      });
      this.send({ jsonrpc: "2.0", id, method, params });
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

/** The fake, a grant directory, a bridge with a session and a seat taken; the counters of the seat. */
async function seated(t, fn) {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-live-test-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.ok((await bridge.call("initialize", 1, INIT)).result, "precondition: a session is open");
  bridge.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const stand = (args, id) =>
    bridge.call("tools/call", id, { name: "iskron_stand", arguments: args });
  assert.ok((await stand(SEAT, 2)).result, "precondition: the seat is taken");
  const counts = () => ({
    posts: fake.state.counts.status_requests,
    registers: fake.state.counts.register_standing ?? 0,
  });
  await fn({ fake, dir, stand, counts, holdFile: holdFile(dir) });
}

const holdFile = (dir) => {
  const found = readdirSync(dir, { recursive: true }).find((f) => String(f).endsWith(".hold"));
  return found ? join(dir, String(found)) : null;
};

test("404 no_live_standing on the seat's own address: no register, no second send — the line NOT set, stand again", async (t) => {
  await seated(t, async ({ fake, stand, counts }) => {
    const before = counts();
    await fake.control({ noLiveStanding: 1 });
    const said = await stand({ realm: SEAT.realm, status: "без места" }, 3);
    const text = textOf(said);
    assert.ok(said.result?.isError, `the line did not land, and the reply says so: ${text}`);
    assert.match(text, NO_LIVE_SEAT, text);
    assert.doesNotMatch(text, TURNED, text);
    assert.notEqual(fake.state.status, "без места", "nothing landed");
    assert.equal(counts().registers, before.registers, "no register for a busy line (#4235)");
    assert.equal(counts().posts - before.posts, 1, "the refused POST only, no second send");
  });
});

test("an empty line on no_live_standing is never re-resolved: one POST, no register", async (t) => {
  await seated(t, async ({ fake, stand, counts }) => {
    const before = counts();
    await fake.control({ noLiveStanding: 1 });
    await stand({ realm: SEAT.realm, status: "" }, 3);
    assert.equal(counts().registers, before.registers, "no register");
    assert.equal(counts().posts - before.posts, 1, "no second send of a clear");
  });
});

test("404 no_live_standing while the hold record names a newer address: the line goes there once, no register", async (t) => {
  await seated(t, async ({ fake, stand, counts, holdFile }) => {
    const rec = JSON.parse(readFileSync(holdFile, "utf8"));
    const base = rec.statusUrl.replace(/\/channel\/status\/[^/]+$/, "");
    const newer = `${base}/channel/status/newer-seat-token`;
    writeFileSync(holdFile, JSON.stringify({ ...rec, statusUrl: newer }));
    const before = counts();
    await fake.control({ noLiveStanding: 1 });
    const said = await stand({ realm: SEAT.realm, status: "по новому адресу" }, 3);
    const text = textOf(said);
    assert.ok(!said.result?.isError, `the line landed: ${text}`);
    assert.doesNotMatch(text, REFUSED_404, `the 404 is not passed off as a refusal: ${text}`);
    assert.equal(
      fake.state.lastStatusToken,
      "newer-seat-token",
      "the line went to the address the record names",
    );
    assert.equal(
      counts().registers,
      before.registers,
      "no register: the record named another address",
    );
    assert.equal(counts().posts - before.posts, 2, "the refused POST and its one resend");
  });
});

test("404 no_live_standing at the hold record's address too: NOT set, stand again — two sends, no register, no loop", async (t) => {
  await seated(t, async ({ fake, stand, counts, holdFile }) => {
    const rec = JSON.parse(readFileSync(holdFile, "utf8"));
    const base = rec.statusUrl.replace(/\/channel\/status\/[^/]+$/, "");
    writeFileSync(holdFile, JSON.stringify({ ...rec, statusUrl: `${base}/channel/status/other` }));
    const before = counts();
    await fake.control({ noLiveStanding: 5 });
    const said = await stand({ realm: SEAT.realm, status: "не поставлена" }, 3);
    const text = textOf(said);
    assert.ok(said.result?.isError, text);
    assert.match(text, NO_LIVE_SEAT, text);
    assert.equal(counts().registers, before.registers, "no register");
    assert.equal(counts().posts - before.posts, 2, "the refused POST and its one resend there");
  });
});

// A guard, green on both builds: the rule is the only new meaning of a 404.
test("a 404 WITHOUT the rule keeps today's word: the address was turned, nothing is registered", async (t) => {
  await seated(t, async ({ fake, stand, counts }) => {
    const before = counts();
    await fake.control({ statusGone: true });
    const said = await stand({ realm: SEAT.realm, status: "повёрнутый адрес" }, 3);
    const text = textOf(said);
    assert.ok(said.result?.isError, text);
    assert.match(text, REFUSED_404, text);
    assert.match(text, TURNED, text);
    assert.equal(counts().registers, before.registers, "no register for a turned address");
    assert.equal(counts().posts - before.posts, 1, "no resend");
  });
});
