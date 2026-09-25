// Probe for the standing held BY THE BRIDGE (graph nks-dev: #4233, #4234,
// #4235) — the socket a `connect` answer shows once is taken by the bridge
// itself, held with the channel discipline, and handed on without its secret:
// to a local watchdog client (the `watchdog` / `watchdog-exit` subcommands) and
// as MCP notifications. The fake NKS serves a real WebSocket for it, sends
// hello first, and pushes frames or close codes on /control.
//
// ISKRON_BRIDGE_PATH points the same probe at any copy: against the previous
// bridge the connect answer carries no listener block and no local socket
// appears — the red this probe exists to show.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeCodex } from "./fake-codex.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import {
  auto,
  closing,
  directWord,
  graphPosed,
  legacyRoom,
  MY_KARTA,
  progress,
  roleInvite,
  said,
  unknownKind,
  withdraw,
} from "./room-frames.mjs";

// Чем запускать поставку: node по умолчанию; ISKRON_NODE подставляет другой рантайм
// (например, `opencode` под BUN_BE_BUN=1 — Bun, встроенный в OpenCode).
const NODE = process.env.ISKRON_NODE || process.execPath;

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "standing-probe", version: "0" },
};
const CONNECT = { realm: "nks-dev", action: "connect", karta: 931, name: "proba" };

// --- a harness that also keeps the bridge's notifications ------------------
function startBridge(serverUrl, authDir, extraEnv = {}) {
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_BROWSER: "1", ...extraEnv },
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
      if (msg.id === undefined && msg.method) {
        notifications.push(msg);
        continue;
      }
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  return {
    proc,
    notifications,
    get stderr() {
      return stderr;
    },
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id})`)), 15_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return p;
    },
    stop: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.stdin.end();
            setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
          }),
  };
}

async function waitFor(check, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// The login link is the bridge's own loopback address (it mints the sign-in page as it is opened).
const authorizeUrlIn = (text) =>
  /(http:\/\/127\.0\.0\.1:\d+\/login\?k=[\w-]+)/.exec(text || "")?.[1] ?? null;

/** A bridge that has authorized and connected a standing; returns everything the tests read. */
async function connected(t, { env = {}, init = INIT, fakeOpts = {}, dir: given } = {}) {
  const fake = await startFakeNks(fakeOpts);
  const dir = given ?? mkdtempSync(join(tmpdir(), "iskron-standing-"));
  const grants = () => readdirSync(dir).filter((f) => f.endsWith(".json")).length;
  const grantsBefore = grants();
  const bridge = startBridge(fake.mcpUrl, dir, env);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const pending = await bridge.call("initialize", 1, init);
  const url = authorizeUrlIn(pending.error?.message);
  assert.ok(url, `expected an authorize URL, got ${JSON.stringify(pending)}`);
  const res = await fetch(url, { redirect: "follow" });
  await res.text();
  await waitFor(() => grants() > grantsBefore, "the exchanged tokens to reach the store");
  const initReply = await bridge.call("initialize", 2, init);
  assert.ok(initReply.result, `initialize after the grant: ${JSON.stringify(initReply)}`);
  const reply = await bridge.call("tools/call", 3, { name: "iskron_channel", arguments: CONNECT });
  const text = (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const key = /watchdog (\S+)/.exec(text)?.[1];
  return { fake, dir, bridge, reply, text, key, standings: join(dir, "standings") };
}

// Сторож метит кадр в .seen сразу после печати; убить его в этот зазор — законная
// повторная доставка «хотя бы раз», а не то, что проверяют пробы памяти доставленного (#5516).
const waitSeen = (standings, id) =>
  waitFor(
    () =>
      readdirSync(standings).some(
        (f) =>
          f.endsWith(".seen") && readFileSync(join(standings, f), "utf8").split("\n").includes(id),
      ),
    `the watchdog to mark ${id} delivered`,
  );

// The watchdog is given the auth dir the way the bridge's own block names it —
// the `--auth-dir` flag, never a variable the bridge was not started with. One
// lever for both halves, or a drift between their roots would pass green here.
function runClient(sub, dir, key, timeoutMs = 8000, extraEnv = {}) {
  const proc = spawn(NODE, [FILE, sub, ...(key ? [key] : []), "--auth-dir", dir], {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  const done = new Promise((resolve) => {
    const t = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exit: null });
    }, timeoutMs);
    proc.once("exit", (code) => {
      clearTimeout(t);
      resolve({ exit: code });
    });
  });
  return {
    proc,
    done,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

test("connect through the bridge: the bridge holds the socket and the answer names the listener", async (t) => {
  const { fake, dir, bridge, text, key, standings } = await connected(t);
  assert.ok(
    text.includes("[iskron-bridge]"),
    `the connect answer carries no bridge block:\n${text}`,
  );
  assert.ok(key, "the block must name the key the watchdog is called with");
  assert.ok(text.includes(`watchdog ${key}`) && text.includes(`watchdog-exit ${key}`));
  assert.ok(
    text.includes(`watchdog ${key} --auth-dir "${dir}"`),
    `a bridge off the default auth dir must tell the watchdog where to look:\n${text}`,
  );
  assert.ok(
    text.includes('iskron_channel(action="status"'),
    "the block must name the status call, not a file",
  );
  await waitFor(() => fake.state.ws.size === 1, "the bridge to open the standing socket");
  const held = readdirSync(standings);
  assert.ok(
    held.some((f) => f.endsWith(".sock")),
    `no local standing socket for the watchdog in ${standings} (${held.join(", ")});\nbridge said:\n${bridge.stderr}`,
  );
  assert.ok(
    held.some((f) => f.endsWith(".key")),
    "the readable key must lie next to the socket",
  );
  await waitFor(
    () =>
      bridge.notifications.some(
        (n) =>
          n.method === "notifications/message" &&
          n.params?.logger === "iskron-channel" &&
          n.params?.data?.frame?.type === "hello",
      ),
    "the hello frame to reach the harness as a notification",
  );
});

test("watchdog attaches with no secret and prints what the service sends", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, undefined);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({ ws_send: JSON.stringify({ type: "message", body: "привет, сосед" }) });
  await waitFor(() => wd.out.includes("привет, сосед"), "the frame to be printed by the watchdog");
  assert.ok(
    bridge.notifications.some((n) => n.params?.data?.frame?.body === "привет, сосед"),
    "the same frame must ride to the harness as a notification",
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A frame that landed while no watchdog was attached rides to the next one from
// the ring — and is then delivered: re-arming the watchdog (Monitor ends every
// 30 minutes) must not bring it again, only the proof of holding (hello).
test("a frame handed to a watchdog from the ring is not handed to the next one again", async (t) => {
  const { fake, dir, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "m-ring-1", body: "пришло без сторожа" }),
  });
  await new Promise((r) => setTimeout(r, 300));
  const first = runClient("watchdog", dir, undefined);
  await waitFor(() => first.out.includes("пришло без сторожа"), "the first watchdog to get it");
  await waitSeen(standings, "m-ring-1");
  first.proc.kill("SIGKILL");
  await first.done;
  const second = runClient("watchdog", dir, undefined);
  await waitFor(() => second.out.includes("слушаю стояние"), "the second watchdog to attach");
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!second.out.includes("пришло без сторожа"), `delivered once:\n${second.out}`);
  second.proc.kill("SIGKILL");
  await second.done;
});

// The exit watchdog leaves on the first frame: the rest of a batch that
// waited without a listener is NOT delivered yet, so the next arm must get it.
test("a batch from the ring is not lost to a watchdog that exits on the first frame", async (t) => {
  const { fake, dir } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  for (const [id, body] of [
    ["m-a", "первое без сторожа"],
    ["m-b", "второе без сторожа"],
  ])
    await fake.control({ ws_send: JSON.stringify({ type: "message", id, body }) });
  await new Promise((r) => setTimeout(r, 300));
  const first = runClient("watchdog-exit", dir, undefined);
  const r1 = await first.done;
  assert.equal(r1.exit, 0, first.err);
  const second = runClient("watchdog-exit", dir, undefined);
  const r2 = await second.done;
  assert.equal(r2.exit, 0, `the second arm must get the frame the first did not: ${second.err}`);
  assert.ok(
    (first.out + second.out).includes("первое") && (first.out + second.out).includes("второе"),
    `both frames delivered, one per arm:\n${first.out}\n---\n${second.out}`,
  );
});

// The platform may send a delivered frame again (same id, after the place came
// back): no client gets it a second time — the bridge checks before it broadcasts.
test("a frame the platform sends again is not printed twice", async (t) => {
  const { fake, dir } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, undefined, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  const frame = JSON.stringify({ type: "message", id: "R-1", body: "одно слово дважды" });
  await fake.control({ ws_send: frame });
  await waitFor(() => wd.out.includes("одно слово дважды"), "the first print");
  await new Promise((r) => setTimeout(r, 200));
  await fake.control({ ws_send: frame });
  await new Promise((r) => setTimeout(r, 600));
  wd.proc.kill("SIGKILL");
  await wd.done;
  assert.equal(wd.out.split("одно слово дважды").length - 1, 1, wd.out);
});

// One graph event is fanned out to every place of a role, each copy under its
// own frame id with the same event_id in the body; a sibling place's copies come
// back stale when the socket reopens (#5829). The doer hears the event once: a
// second live copy, a stale copy, and a copy after the watchdog is re-armed are
// all dropped; a stale re-send of a frame already delivered is not re-offered.
// The frame as the platform emits a graph event: via=graph, an object body, a numeric event_id.
const graphEvent = (id, eventId, reason, extra = {}) =>
  JSON.stringify({
    type: "message",
    id,
    content_type: "application/json",
    provenance: { via: "graph" },
    body: {
      realm_slug: "nks-dev",
      event_kind: "posed_to",
      vimarsha_seq: 5829,
      vimarsha_version: 1,
      event_id: eventId,
      reason,
    },
    ...extra,
  });

test("one graph event fanned out under several frame ids reaches the watchdog once; a stale re-send of a delivered frame is dropped", async (t) => {
  const { fake, dir, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, undefined, 30_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  await fake.control({ ws_send: graphEvent("fan-1", 42, "событие сорок два") });
  await waitFor(() => wd.out.includes("событие сорок два"), "the first copy");
  await waitSeen(standings, "fan-1");
  await fake.control({ ws_send: graphEvent("fan-2", 42, "событие сорок два") });
  await fake.control({ ws_send: graphEvent("fan-3", 42, "событие сорок два", { stale: true }) });
  // A doer's word that happens to carry event_id-looking JSON is a word, not an event.
  await fake.control({
    ws_send: JSON.stringify({
      type: "message",
      id: "word-1",
      provenance: { via: "direct", from_karta_seq: 7 },
      body: JSON.stringify({ event_id: 42, reason: "слово делателя" }),
    }),
  });
  await waitFor(() => wd.out.includes("слово делателя"), "a doer's word with event_id text");
  // A plain frame delivered live, then handed back stale under the same id.
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "plain-1", body: "простое слово" }),
  });
  await waitFor(() => wd.out.includes("простое слово"), "the plain frame");
  await waitSeen(standings, "plain-1");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "plain-1", stale: true, body: "простое слово" }),
  });
  await new Promise((r) => setTimeout(r, 2500)); // past the stale burst window
  assert.equal(wd.out.split("событие сорок два").length - 1, 1, `one event, one print:\n${wd.out}`);
  assert.equal(wd.out.split("простое слово").length - 1, 1, `delivered once:\n${wd.out}`);
  assert.ok(!wd.out.includes("Лежалых кадров"), `nothing stale left to offer:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
  // Re-armed: yet another copy of the same event stays quiet, a new event is heard.
  const again = runClient("watchdog", dir, undefined, 20_000);
  await waitFor(() => again.out.includes("слушаю стояние"), "the re-armed watchdog");
  await fake.control({ ws_send: graphEvent("fan-4", 42, "событие сорок два") });
  await fake.control({ ws_send: graphEvent("fan-5", 43, "событие сорок три") });
  await waitFor(() => again.out.includes("событие сорок три"), "a new event to be heard");
  await new Promise((r) => setTimeout(r, 300));
  again.proc.kill("SIGKILL");
  await again.done;
  assert.ok(!again.out.includes("событие сорок два"), `a copy after re-arm:\n${again.out}`);
});

// A copy pushed out of the ring before anyone took it does not hold the event:
// a later copy — here a stale one — is still offered.
test("a copy evicted from the ring undelivered does not swallow the event: a later stale copy reaches the watchdog", async (t) => {
  const { fake, dir } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({ ws_send: graphEvent("ev-a", 90, "вытесненное событие") });
  for (let i = 1; i <= 20; i++)
    await fake.control({
      ws_send: JSON.stringify({ type: "message", id: `fill-${i}`, body: `заполнитель ${i}` }),
    });
  await new Promise((r) => setTimeout(r, 300));
  const wd = runClient("watchdog", dir, undefined, 20_000);
  await waitFor(() => wd.out.includes("заполнитель 20"), "the ring replay");
  assert.ok(!wd.out.includes("вытесненное событие"), "the first copy is out of the ring");
  await fake.control({ ws_send: graphEvent("ev-b", 90, "вытесненное событие", { stale: true }) });
  await waitFor(() => wd.out.includes("вытесненное событие"), "the stale copy to be offered");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// The bridge's own memory dies with it; the watchdog's ev: mark in .seen is what
// keeps an event printed before a restart from being printed again after it.
test("a copy of an event printed before the bridge restarted is not printed again after it", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, undefined, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  await fake.control({ ws_send: graphEvent("rs-1", 70, "до перезапуска моста") });
  await waitFor(() => wd.out.includes("до перезапуска моста"), "the first print");
  await waitSeen(standings, "rs-1");
  await new Promise((r) => setTimeout(r, 200)); // the event mark follows the id mark
  wd.proc.kill("SIGKILL");
  await wd.done;
  bridge.proc.kill("SIGKILL");
  await waitFor(() => bridge.proc.signalCode !== null, "the first bridge to exit");
  await waitFor(() => fake.state.ws.size === 0, "the fake to see the socket close");
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });
  const st = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.ok(!st.result?.isError, JSON.stringify(st));
  await waitFor(() => fake.state.ws.size === 1, "the place resumed");
  const next = runClient("watchdog", dir, undefined, 20_000);
  await waitFor(() => next.out.includes("слушаю стояние"), "the watchdog after the restart");
  await fake.control({ ws_send: graphEvent("rs-2", 70, "до перезапуска моста") });
  await fake.control({ ws_send: graphEvent("rs-3", 71, "после перезапуска") });
  await waitFor(() => next.out.includes("после перезапуска"), "a new event to be heard");
  await new Promise((r) => setTimeout(r, 300));
  next.proc.kill("SIGKILL");
  await next.done;
  assert.ok(!next.out.includes("до перезапуска моста"), `printed again:\n${next.out}`);
});

// Stale wakes nobody; a live copy of the same event must still wake the exit
// watchdog, even when a stale copy of it arrived first.
test("a live copy of an event wakes the exit watchdog even when its stale copy came first", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 8000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await fake.control({ ws_send: graphEvent("ws-1", 80, "будит живая копия", { stale: true }) });
  await fake.control({ ws_send: graphEvent("ws-2", 80, "будит живая копия") });
  const r = await wd.done;
  assert.equal(r.exit, 0, `the live copy must wake: ${wd.err}`);
  assert.ok(wd.out.includes("будит живая копия"), wd.out);
});

// The same on the live path: an exit watchdog attached while two frames land
// back to back takes the first; the second is written to it but not delivered.
test("a live batch is not lost to an attached watchdog that exits on the first frame", async (t) => {
  const { fake, dir } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog-exit", dir, undefined);
  await waitFor(
    () => first.err.includes("слушаю") || first.out.includes("слушаю"),
    "the first arm",
    5000,
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  for (const [id, body] of [
    ["L-a", "живое первое"],
    ["L-b", "живое второе"],
  ])
    await fake.control({ ws_send: JSON.stringify({ type: "message", id, body }) });
  assert.equal((await first.done).exit, 0, first.err);
  const second = runClient("watchdog-exit", dir, undefined);
  assert.equal((await second.done).exit, 0, `the second arm gets the rest: ${second.err}`);
  const both = first.out + second.out;
  assert.ok(both.includes("живое первое") && both.includes("живое второе"), both);
});

test("a dead-token close leaves the watchdog loudly and reaches the harness as an error", async (t) => {
  const { fake, dir, bridge, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({ ws_close: 4001 });
  const r = await wd.done;
  assert.notEqual(r.exit, null, "the watchdog is still alive after a 4001 close");
  assert.notEqual(r.exit, 0, "the watchdog exited 0 on a dead token");
  assert.match(wd.out, /токен мёртв/);
  await waitFor(
    () =>
      bridge.notifications.some(
        (n) => n.params?.level === "error" && n.params?.data?.kind === "dead",
      ),
    "the dead-token notification",
  );
  await waitFor(
    () => !readdirSync(standings).some((f) => f.endsWith(".sock")),
    "the local socket to be withdrawn",
  );
});

// Drops against a live service used to end the holding: the place was thrown
// away while the grant was alive (graph nks-dev: #4664). Now the bridge keeps
// it, reopens slower, and says so once; the Monitor watchdog stays attached.
test("drops against a live service keep the place: the bridge reopens, the watchdog stays and prints the word", async (t) => {
  process.env.ISKRON_CHANNEL_FLAP_MS = "300,600";
  t.after(() => delete process.env.ISKRON_CHANNEL_FLAP_MS);
  const { fake, dir, bridge, key, standings } = await connected(t);
  await fake.control({ versionUp: true });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 30_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const told = () => bridge.notifications.some((n) => n.params?.data?.kind === "alive");
  const current = () => [...fake.state.ws].at(-1) ?? null;
  // The first socket may already be older than a fast drop; up to five closes.
  // Each round closes the newest socket and waits for the bridge to open another.
  let prev = current();
  for (let i = 0; i < 5 && !told(); i++) {
    await fake.control({ ws_close: 1011 });
    await waitFor(
      () => told() || (current() && current() !== prev),
      `the bridge to reopen after close ${i + 1}`,
    );
    prev = current();
  }
  await waitFor(told, "the word to the doer");
  await waitFor(() => current() && current() !== prev, "the bridge to reopen after the pause");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".sock")),
    "the local socket must stay: the place is kept",
  );
  await waitFor(() => /служба отвечает/.test(wd.out), "the watchdog to print the word");
  assert.equal(wd.proc.exitCode, null, "the watchdog must stay attached — the holding goes on");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// One standing per bridge (#5154): a new name is a deliberate move — iskron_stand
// with take=true; a bare connect under another name is refused, see below.
test("standing under a new name with take=true re-keys the hold: the block and the key file follow the name", async (t) => {
  const { fake, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the first socket");
  const reply = await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "vtoraya", take: true },
  });
  const text = (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const key2 = /watchdog (\S+)/.exec(text)?.[1];
  assert.ok(
    key2 && key2.startsWith("vtoraya--"),
    `the block still names the old standing:\n${text}`,
  );
  await waitFor(
    () =>
      readdirSync(standings).some((f) => f.endsWith(".key")) &&
      readdirSync(standings)
        .filter((f) => f.endsWith(".key"))
        .every((f) => readFileSync(join(standings, f), "utf8").trim() === key2),
    "the key file to carry the new name only",
  );
});

test("watchdog-codex puts a message frame into the Codex thread through the app-server door", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  // The door lives under a short home: a unix socket path is limited to ~104 bytes.
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-42",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0 }) });
  await fake.control({
    ws_send: JSON.stringify({
      type: "message",
      body: "Слово соседа",
      provenance: { from_standing: "@alari:sosед" },
    }),
  });
  await waitFor(
    () => readFileSync(log, "utf8").includes("turn/start"),
    "the frame to reach the door",
  );
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.ok(
    calls.some((c) => c.method === "initialize"),
    "the door is initialized first",
  );
  const turn = calls.find((c) => c.method === "turn/start");
  assert.equal(turn.params.threadId, "thread-42", "the frame goes to THIS thread");
  assert.match(turn.params.input[0].text, /Слово соседа/);
  assert.match(turn.params.input[0].text, /стояние @alari:sosед/);
  assert.equal(
    calls.filter((c) => c.method === "turn/start").length,
    1,
    "hello must not wake the thread",
  );
  // A dead token is loud through the same door, and the watchdog leaves non-zero.
  await fake.control({ ws_close: 4001 });
  const r = await wd.done;
  assert.notEqual(r.exit, 0, "the watchdog must leave non-zero on a dead token");
  assert.match(wd.err, /токен мёртв/);
});

// A frame put into the Codex thread is delivered (#5428): the fallback exit
// watchdog armed after it must not wake the doer on the same frame again.
test("a frame put into the Codex thread is marked delivered — the fallback exit watchdog does not repeat it", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-7",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "cx-1", body: "в тред Codex" }),
  });
  await waitFor(() => readFileSync(log, "utf8").includes("turn/start"), "the frame in the thread");
  await new Promise((r) => setTimeout(r, 200));
  wd.proc.kill("SIGKILL");
  await wd.done;
  const fallback = runClient("watchdog-exit", dir, key, 2500);
  const r = await fallback.done;
  assert.ok(!fallback.out.includes("в тред Codex"), `woke twice on one frame:\n${fallback.out}`);
  assert.equal(r.exit, null, "nothing new — the fallback keeps waiting");
});

// Delivered is what the thread ACCEPTED: a refused turn/start (a thread the
// daemon does not know) marks nothing, and the fallback exit watchdog gets it.
test("a frame the Codex thread refused is not marked — the fallback exit watchdog gets it", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "no-such-thread",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "cx-refused", body: "тред не принял" }),
  });
  await waitFor(() => wd.err.includes("тред не принял кадр"), "the refusal said aloud");
  assert.ok(
    !wd.err.includes("кадр вложен в тред"),
    `«вложен» is said only on acceptance:\n${wd.err}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
  const fallback = runClient("watchdog-exit", dir, key);
  assert.equal((await fallback.done).exit, 0, fallback.err);
  assert.ok(fallback.out.includes("тред не принял"), fallback.out);
});

// A frame that arrived between two arms of the Codex watchdog is in the ring,
// undelivered: the next arm puts it into the thread instead of skipping it.
test("a frame that waited in the ring reaches the Codex thread on the next arm", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "cx-gap", body: "между взводами" }),
  });
  await new Promise((r) => setTimeout(r, 300));
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-9",
  });
  await waitFor(
    () => readFileSync(log, "utf8").includes("между взводами"),
    "the gap frame in the thread",
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("watchdog-codex refuses to guess: no thread id or no door is a code-2 exit that names the move", async (t) => {
  const { dir, key } = await connected(t);
  const noThread = await runClient("watchdog-codex", dir, key, 5000, { CODEX_THREAD_ID: "" }).done;
  assert.equal(noThread.exit, 2);
  const noDoor = await runClient("watchdog-codex", dir, key, 5000, {
    CODEX_THREAD_ID: "thread-42",
    CODEX_HOME: mkdtempSync("/tmp/cxn-"),
  }).done;
  assert.equal(noDoor.exit, 2);
});

test("the bridge never re-reads a body: body_chars is a size of the serialised body, not a checksum (#5207)", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const body = 'сказал: "да"\nи ещё строка';
  // No message_full on the fake: any re-read would fail loudly and mark the frame truncated.
  await fake.control({
    ws_send: JSON.stringify({
      type: "message",
      id: "m-whole",
      body,
      body_chars: [...JSON.stringify(body)].length,
      provenance: { from_standing: "@alari:sosед", auth: "oidc" },
    }),
  });
  await waitFor(() => wd.out.includes("m-whole"), "the frame to reach the watchdog");
  const envelope = wd.out.split("\n").find((l) => l.startsWith("frame: "));
  assert.ok(envelope, `no envelope line in:\n${wd.out}`);
  const frame = JSON.parse(envelope.slice("frame: ".length));
  assert.equal(frame.body_read, undefined, "a whole body must not be re-read nor marked truncated");
  assert.ok(wd.out.includes("и ещё строка"), "the doer gets the body as it came");
  await fake.control({ ws_close: 4001 });
  await wd.done;
});

test("watchdog-exit exits 0 on the first message and lets service frames pass", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted, not delivered");
  await fake.control({ ws_send: JSON.stringify({ type: "message", body: "будильник" }) });
  const r = await wd.done;
  assert.equal(r.exit, 0, `watchdog-exit must leave with 0 on a message, got ${r.exit}: ${wd.err}`);
  assert.ok(wd.out.includes("будильник"), "the frame must be printed before the exit");
});

// The bridge replays its ring to every client that attaches; an exit-mode
// watchdog re-armed after a wake met its own frame again and left at once —
// three arms, one wake each, no new frame (graph @nks/nks-dev, node #4469).
// The claim: a frame the doer was already woken on never wakes it again; a
// frame that arrived while nobody was attached still does.
test("watchdog-exit re-armed after a wake does not leave on the frame it already delivered", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog-exit", dir, key);
  await waitFor(() => first.err.includes("hello"), "hello to be noted");
  await fake.control({ ws_send: JSON.stringify({ id: "f-1", type: "message", body: "первый" }) });
  assert.equal(
    (await first.done).exit,
    0,
    `the first arm must leave on the first frame: ${first.err}`,
  );
  assert.ok(first.out.includes("первый"));

  // Re-armed: the ring replays f-1, and that must not be a wake.
  const second = runClient("watchdog-exit", dir, key, 4000);
  await waitFor(() => second.err.includes("слушаю стояние"), "the second arm to attach");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(
    second.proc.exitCode,
    null,
    `the second arm left on a frame already delivered: ${second.out}`,
  );
  // A frame that arrived while nobody was attached is not "already delivered".
  second.proc.kill("SIGKILL");
  await second.done;
  await fake.control({ ws_send: JSON.stringify({ id: "f-2", type: "message", body: "второй" }) });
  await new Promise((r) => setTimeout(r, 300));
  const third = runClient("watchdog-exit", dir, key);
  const r = await third.done;
  assert.equal(
    r.exit,
    0,
    `the third arm must leave on the frame that arrived in the gap: ${third.err}`,
  );
  assert.ok(
    third.out.includes("второй") && !third.out.includes("первый"),
    `only the new frame wakes: ${third.out}`,
  );
});

test("the busy line is a call to one's own standing, answered by the bridge itself: it holds the socket", async (t) => {
  const { fake, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const before = fake.state.counts.mcp;
  const ok = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "чиню мост" },
  });
  assert.ok(!ok.result?.isError, JSON.stringify(ok));
  assert.equal(fake.state.status, "чиню мост", "the line reaches the service's status address");
  assert.equal(fake.state.counts.status_posts, 1);
  assert.equal(
    fake.state.counts.mcp,
    before,
    "the call never goes to the MCP server — it is the bridge's own word",
  );
  // The bridge does not judge the line: the surface's refusal comes back whole.
  const long = await bridge.call("tools/call", 7, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "x".repeat(80) },
  });
  assert.ok(long.result?.isError, "an over-long line is the surface's refusal, passed through");
  assert.match(long.result.content[0].text, /422/);
  assert.match(
    long.result.content[0].text,
    /too long/,
    "the body of the refusal must reach the doer",
  );
  assert.equal(fake.state.status, "чиню мост", "a refused line must not replace the published one");
  assert.ok(
    !readdirSync(standings).some((f) => f.endsWith(".say")),
    "no busy-line file may exist any more",
  );
});

test("status before connect is a teaching refusal from the bridge, not a server call", async (t) => {
  const fake = await startFakeNks();
  const dir = mkdtempSync(join(tmpdir(), "iskron-standing-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const r = await bridge.call("tools/call", 1, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "рано" },
  });
  assert.ok(r.result?.isError);
  assert.match(r.result.content[0].text, /iskron_stand/, "the refusal names the re-identification");
  assert.equal(fake.state.counts.mcp, 0);
});

// A hung connection (graph nks-dev: #5380, #5397): the service stops writing
// without closing. The holder reads the ping interval from hello, sees the
// protocol pings, and after three silent intervals says so and reopens the
// same address. With no ping ever seen the timer is not armed: a runtime that
// cannot see pings must not call a live connection dead.
test("a connection silent past three ping intervals is reopened aloud; unseen pings arm nothing", async (t) => {
  const floor = { ISKRON_CHANNEL_SILENT_FLOOR_MS: "1000" };
  const { fake, bridge } = await connected(t, { env: floor, fakeOpts: { pingMs: 200 } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  // Longer than the 1.6 s window: a timer that ignored the pings would have fired.
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(fake.state.counts.ws_upgrades, 1, "a pinging connection is left alone");
  await fake.control({ ws_hang: true });
  await waitFor(() => fake.state.counts.ws_upgrades >= 2, "the hung socket to be reopened", 8000);
  assert.match(bridge.stderr, /подвисло без закрытия/, "the reopen is said aloud");
  assert.match(bridge.stderr, /могли пропасть/, "a hung socket's frames are not promised back");
  assert.ok(
    bridge.notifications.some((n) => JSON.stringify(n).includes("подвисло")),
    "the harness is told too — pi and OpenCode hear no watchdog",
  );

  // hello promises a ping every 0.2 s, and none ever comes (Bun has no channel to see it by)
  const quiet = await connected(t, { env: floor, fakeOpts: { helloPingS: 0.2 } });
  await waitFor(() => quiet.fake.state.ws.size === 1, "the socket");
  await quiet.fake.control({ ws_hang: true });
  // The window is 1.6 s: by 3 s an armed timer would have spoken, reopen or not.
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(!/подвисло/.test(quiet.bridge.stderr), "no ping seen — no timer, nothing said");
  assert.equal(quiet.fake.state.counts.ws_upgrades, 1, "no ping seen — no reopen");
});

// Only the surface's own words for "no author" buy a re-register (#5380): a
// 409 of another kind — a conflict, a repeated mint — is passed through as is,
// once, and the standing binding is not touched.
test("a 409 that is not about the missing author is not re-bound and repeated", async (t) => {
  const { fake, bridge } = await connected(t);
  const reg = await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "register", karta: 931, name: "proba" },
  });
  assert.ok(!reg.result?.isError, JSON.stringify(reg));
  const before = fake.state.counts.register_standing;
  await fake.control({ send_conflict: "Отказано (409): место сменило версию — перечитай доску" });
  const r = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "send", karta: 931, text: "привет" },
  });
  assert.ok(r.result?.isError, JSON.stringify(r));
  assert.match(r.result.content[0].text, /сменило версию/);
  assert.equal(fake.state.counts.send_conflicts, 1, "the refused call is not repeated");
  assert.equal(fake.state.counts.register_standing, before, "no re-register for a foreign 409");
});

// A rollout changes the server's tools while the harness keeps the list it got
// at the start of the session (#5405). When the bridge re-opens its upstream
// session it compares the fresh list with the one it served and, on a change,
// tells the harness notifications/tools/list_changed — the harness re-reads.
test("a tool list changed under a re-opened session is announced as list_changed", async (t) => {
  const { fake, bridge } = await connected(t);
  const first = await bridge.call("tools/list", 20, {});
  assert.ok(first.result?.tools?.length, JSON.stringify(first));
  await fake.control({ richTools: true, kill_session: true });
  await bridge.call("tools/call", 21, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "list" },
  });
  await waitFor(
    () => bridge.notifications.some((n) => n.method === "notifications/tools/list_changed"),
    "list_changed after the re-opened session found a different list",
  );
  const again = await bridge.call("tools/list", 22, {});
  const had = new Set(first.result.tools.map((x) => x.name));
  assert.ok(
    again.result.tools.some((x) => !had.has(x.name)),
    "the re-read list is the new one",
  );
});

// The shared cache may carry iskron_stand written by another build of the
// bridge; a list served from it must carry THIS build's definition.
test("a cached list serves this build's iskron_stand, not the one another build cached", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await bridge.call("tools/list", 20, {});
  const cacheFile = readdirSync(dir).find((f) => f.endsWith(".server-answers"));
  const cache = JSON.parse(readFileSync(join(dir, cacheFile), "utf8"));
  for (const tool of cache.tools.tools)
    if (tool.name === "iskron_stand") tool.description = "ПРЕЖНЯЯ СБОРКА";
  writeFileSync(join(dir, cacheFile), JSON.stringify(cache));
  await bridge.stop();
  await fake.stop(); // no network: the second bridge answers from the cache
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  await second.call("initialize", 1, INIT);
  const listed = await second.call("tools/list", 2, {});
  assert.ok(listed.result?.tools, `served from the cache: ${JSON.stringify(listed)}`);
  const stand = listed.result.tools.find((x) => x.name === "iskron_stand");
  assert.ok(stand && !stand.description.includes("ПРЕЖНЯЯ СБОРКА"), JSON.stringify(stand));
});

// The shared answers cache keeps the form the harness gets — with the bridge's
// own tool — or the next start without network serves a list without it, and a
// cached list must not read as a changed one once the session opens (#5405).
test("the re-check keeps the bridge's own tool in the cache and a cached list is not a change", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await bridge.call("tools/list", 20, {});
  await fake.control({ kill_session: true });
  await bridge.call("tools/call", 21, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "list" },
  });
  await new Promise((r) => setTimeout(r, 800));
  const cacheFile = readdirSync(dir).find((f) => f.endsWith(".server-answers"));
  assert.ok(cacheFile, readdirSync(dir).join(","));
  assert.match(
    readFileSync(join(dir, cacheFile), "utf8"),
    /iskron_stand/,
    "the cache keeps iskron_stand",
  );
  // A second bridge serves the list from that cache before its session opens,
  // then opens it: the server did not change, so the harness hears nothing.
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  await fake.control({ kill_session: true });
  await second.call("initialize", 1, INIT);
  const listed = await second.call("tools/list", 2, {});
  assert.ok(
    listed.result.tools.some((x) => x.name === "iskron_stand"),
    JSON.stringify(listed),
  );
  await second.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "list" },
  });
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(
    !second.notifications.some((n) => n.method === "notifications/tools/list_changed"),
    "a list served from the cache is not a change",
  );
  assert.ok(
    !bridge.notifications.some((n) => n.method === "notifications/tools/list_changed"),
    "an unchanged list says nothing",
  );
});

test("a re-opened session with the same tool list says nothing", async (t) => {
  const { fake, bridge } = await connected(t);
  await bridge.call("tools/list", 20, {});
  await fake.control({ kill_session: true });
  await bridge.call("tools/call", 21, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "list" },
  });
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(
    !bridge.notifications.some((n) => n.method === "notifications/tools/list_changed"),
    "no list_changed for an unchanged list",
  );
});

// The contour's ping is its liveness cadence, not a keepalive (#5380): at 5 s,
// three intervals are the contour's own patience, and a harness's event loop
// stalls that long. The holder's silence has its own floor — a short ping does
// not make a healthy connection read hung.
test("the silence window has a floor of its own: a short ping does not shorten it", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_CHANNEL_SILENT_FLOOR_MS: "3500" },
    fakeOpts: { pingMs: 200 },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await new Promise((r) => setTimeout(r, 500));
  await fake.control({ ws_hang: true });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(fake.state.counts.ws_upgrades, 1, "three short intervals are not yet silence");
  assert.ok(!/подвисло/.test(bridge.stderr), bridge.stderr);
  await waitFor(() => fake.state.counts.ws_upgrades >= 2, "the reopen past the floor", 8000);
});

// The five-call path names the place too (#5174): an agent's own connect and
// register carry the bridge's build sign next to the agent's attrs, and the
// re-bind after a rebuilt session carries both — attrs replace whole.
test("proxied connect and the re-bind after a rebuilt session carry model and attrs whole", async (t) => {
  const fake = await startFakeNks();
  const dir = mkdtempSync(join(tmpdir(), "iskron-standing-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const pending = await bridge.call("initialize", 1, INIT);
  await fetch(authorizeUrlIn(pending.error?.message), { redirect: "follow" }).then((r) => r.text());
  await waitFor(() => readdirSync(dir).some((f) => f.endsWith(".json")), "the grant");
  await bridge.call("initialize", 2, INIT);
  const own = { worktree: "w1" };
  await bridge.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { ...CONNECT, karta: "#931", name: " proba ", model: "opus-5", attrs: own },
  });
  await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "register", karta: 931, name: "proba" },
  });
  const connect = fake.state.placeArgs.find((x) => x.action === "connect");
  assert.equal(connect?.model, "opus-5", JSON.stringify(fake.state.placeArgs));
  assert.equal(connect?.attrs?.worktree, "w1", "the agent's own attrs ride");
  assert.equal(connect?.attrs?.build?.name, "iskron-bridge", "the build sign rides next to them");
  const before = fake.state.placeArgs.length;
  await fake.control({ kill_session: true });
  await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "send", karta: 931, text: "после пересборки" },
  });
  const rebind = fake.state.placeArgs.slice(before).find((x) => x.action === "register");
  assert.ok(rebind, `a re-bind happened: ${JSON.stringify(fake.state.placeArgs.slice(before))}`);
  assert.equal(rebind.attrs?.build?.name, "iskron-bridge", "the re-bind keeps the build sign");
  assert.equal(rebind.attrs?.worktree, "w1", "the re-bind keeps the agent's attrs");
  assert.equal(rebind.model, "opus-5");
});

// Two bridges under one grant — a session with both the plugin's and the user's
// iskron entry (graph nks-dev: #5395): the one that holds no place must name the
// bridge that does and the whole handover path, not a bare take=true that would
// pull the socket from under the session's own watchdog.
test("status on a second bridge names the live holder and the whole handover path", async (t) => {
  const { fake, dir, bridge, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const ok = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "первый" },
  });
  assert.ok(!ok.result?.isError, JSON.stringify(ok));
  // A long watch without a new busy line: the record is older than the idle
  // window, yet the bridge lives — liveness is the socket, and reading spares it.
  const standingsDir = join(dir, "standings");
  const holdFile = readdirSync(standingsDir).find((f) => f.endsWith(".hold"));
  const rec = JSON.parse(readFileSync(join(standingsDir, holdFile), "utf8"));
  writeFileSync(
    join(standingsDir, holdFile),
    JSON.stringify({ ...rec, at: Date.now() - 7 * 3600_000 }),
  );
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  const init = await second.call("initialize", 1, INIT);
  assert.ok(init.result, `the second bridge shares the grant: ${JSON.stringify(init)}`);
  const r = await second.call("tools/call", 2, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "второй" },
  });
  assert.ok(r.result?.isError, JSON.stringify(r));
  const said = r.result.content[0].text;
  assert.ok(said.includes(key), `the refusal names the held place:\n${said}`);
  assert.match(said, /держат живые мосты/, said);
  assert.match(said, /тем же набором тулов/, said);
  assert.match(said, /только по слову человека/, said);
  assert.match(said, /очередь места connect не трогает/, said);
  assert.equal(fake.state.status, "первый", "the refused line changes nothing");
  assert.equal(fake.state.ws.size, 1, "the refusal takes no socket");
  assert.ok(
    readdirSync(standingsDir).includes(holdFile),
    "the refusal must not erase the live holder's record",
  );
});

// The status address answering 404 means another connect turned it (#5395):
// the refusal carries the same whole path, not a bare take=true.
test("a turned status address is refused with the whole handover path", async (t) => {
  const { fake, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({ statusGone: true });
  const r = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "после поворота" },
  });
  assert.ok(r.result?.isError, JSON.stringify(r));
  const said = r.result.content[0].text;
  assert.match(said, /404/, said);
  assert.match(said, /тем же набором тулов/, said);
  assert.match(said, /только по слову человека/, said);
  assert.match(said, /очередь места connect не трогает/, said);
});

// The secret never leaves the bridge (graph nks-dev: #4233, #5033): the connect
// answer the agent reads carries neither the socket nor the status address, so
// no harness door can open the socket itself and evict the bridge.
test("the connect answer hides the socket and status addresses; the listener block stays", async (t) => {
  const { text } = await connected(t);
  assert.ok(text.includes("[iskron-bridge]"), text);
  assert.ok(!/wss?:\/\//.test(text), `the socket address leaked to the agent:\n${text}`);
  assert.ok(!/\/channel\/status\//.test(text), `the status address leaked to the agent:\n${text}`);
  assert.match(text, /адрес сокета держит мост/);
});

// 4000 is an eviction, not a dead token (the platform's own word): the bridge
// reopens once; a second eviction within the window means another holder has
// the place — the bridge yields aloud, keeps the binding and the status address,
// and the busy line is still the standing's word (#5012, #5033).
test("an eviction reopens once; the second yields aloud, and the busy line still goes out", async (t) => {
  const { fake, dir, bridge, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  // The fake keeps a closed socket in its set until both ends finish: count
  // sockets the bridge OPENED, not those the fake still holds.
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((s) => !known.has(s));
  await fake.control({ ws_close: 4000 });
  await waitFor(() => fresh().length === 1, "the bridge to reopen once after the eviction");
  for (const s of fresh()) known.add(s);
  assert.ok(
    !bridge.notifications.some((n) => n.params?.data?.kind === "dead"),
    "an eviction must not be announced as a dead token",
  );
  await fake.control({ ws_close: 4000 });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "evicted"),
    "the eviction to reach the harness",
  );
  const ev = bridge.notifications.find((n) => n.params?.data?.kind === "evicted");
  assert.equal(ev.params.level, "warning");
  assert.match(ev.params.data.text, /место отняли/);
  assert.match(ev.params.data.text, /take=true/);
  const r = await wd.done;
  assert.notEqual(r.exit, 0, "the Monitor watchdog leaves loudly on an eviction");
  assert.match(wd.out, /место отняли/);
  // A watchdog re-armed after that must not sit silent on a place the bridge no longer hears.
  const again = runClient("watchdog", dir, key, 6000);
  const r2 = await again.done;
  assert.notEqual(
    r2.exit,
    0,
    `a re-armed watchdog must leave loudly, not listen to nothing: ${again.out}`,
  );
  assert.match(again.out, /место отняли/);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(fresh().length, 0, "after yielding the bridge must not keep reopening");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".key")),
    "the standing is kept: the key file stays",
  );
  const st = await bridge.call("tools/call", 8, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "после вытеснения" },
  });
  assert.ok(
    !st.result?.isError,
    `the busy line is the standing's word, socket or not: ${JSON.stringify(st)}`,
  );
  assert.equal(fake.state.status, "после вытеснения");
});

// The Monitor of Claude Code cuts a single line past ~500 characters and joins
// lines of one burst into one event: a message frame is printed as the same
// text pi and OpenCode get, the body in lines (#5011, #5033).
test("the Monitor watchdog prints a message frame as text in lines, none longer than the Monitor cut", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const body = "слово соседа ".repeat(60).trim();
  await fake.control({
    ws_send: JSON.stringify({
      type: "message",
      id: "m-wide",
      body,
      provenance: { from_standing: "@alari:sosед", from_karta_seq: 48, auth: "oidc" },
    }),
  });
  await waitFor(() => wd.out.includes("m-wide"), "the frame to reach the watchdog");
  const lines = wd.out.split("\n");
  assert.ok(
    lines.some((l) => l.startsWith("Кадр канала Искрона от делателя роли #48")),
    wd.out,
  );
  assert.ok(
    lines.every((l) => [...l].length <= 500),
    `a line longer than the Monitor cut: ${lines.find((l) => [...l].length > 500)}`,
  );
  assert.ok(wd.out.replace(/\n/g, " ").includes(body), "the whole body reaches the doer");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A replay the service makes after a session rebuild comes with stale: true
// under new ids (#4881): it wakes nobody — the exit watchdog waits past it and
// the harness gets one note per burst, not a prompt per frame.
test("stale frames wake nobody: the exit watchdog waits past them, the harness gets one note", async (t) => {
  const { fake, dir, bridge, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 12_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  for (const i of [1, 2, 3]) {
    await fake.control({
      ws_send: JSON.stringify({
        id: `st-${i}`,
        type: "message",
        stale: true,
        body: `лежалый ${i}`,
      }),
    });
  }
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(wd.proc.exitCode, null, `the exit watchdog left on a stale frame: ${wd.out}`);
  await waitFor(
    () => wd.err.includes("Лежалых кадров: 3"),
    "the burst to reach the client as one event",
  );
  assert.ok(wd.err.includes("лежалый 2"), "the bodies ride in the burst — stale mail is not lost");
  assert.ok(
    !bridge.notifications.some((n) => /лежалый/.test(n.params?.data?.frame?.body ?? "")),
    "a stale frame must not ride to the harness as a prompt of its own",
  );
  const burst = bridge.notifications.find((n) => n.params?.data?.kind === "stale");
  assert.ok(burst, "one stale event for the burst");
  assert.equal(burst.params.data.frames.length, 3);
  assert.match(burst.params.data.text, /лежалый 3/);
  await fake.control({ ws_send: JSON.stringify({ id: "live-1", type: "message", body: "живое" }) });
  const r = await wd.done;
  assert.equal(r.exit, 0, `a live frame after the stale ones must wake: ${wd.err}`);
  assert.ok(wd.out.includes("живое") && !wd.out.includes("лежалый"), wd.out);
});

// The bridge keeps the memory of delivered frames for every mode: a frame the
// Monitor watchdog already printed does not wake an exit watchdog armed later,
// while a frame nobody was attached for still does.
test("a frame delivered under the Monitor watchdog does not wake an exit watchdog armed later", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const mon = runClient("watchdog", dir, key);
  await waitFor(() => mon.out.includes("слушаю стояние"), "the Monitor watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ id: "seen-1", type: "message", body: "первый" }),
  });
  await waitFor(() => mon.out.includes("первый"), "the frame to be printed");
  await waitSeen(standings, "seen-1");
  mon.proc.kill("SIGKILL");
  await mon.done;
  const exit = runClient("watchdog-exit", dir, key, 4000);
  await waitFor(() => exit.err.includes("слушаю стояние"), "the exit watchdog to attach");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(
    exit.proc.exitCode,
    null,
    `the exit watchdog left on a frame already delivered: ${exit.out}`,
  );
  exit.proc.kill("SIGKILL");
  await exit.done;
  await fake.control({
    ws_send: JSON.stringify({ id: "seen-2", type: "message", body: "второй" }),
  });
  await new Promise((r) => setTimeout(r, 300));
  const again = runClient("watchdog-exit", dir, key);
  const r = await again.done;
  assert.equal(r.exit, 0, `the frame that arrived in the gap must wake: ${again.err}`);
  assert.ok(again.out.includes("второй") && !again.out.includes("первый"), again.out);
});

test("tools/list carries the writing-moment line on write tools only", async (t) => {
  const { bridge, fake } = await connected(t);
  await fake.control({ richTools: true });
  const list = await bridge.call("tools/list", 4, {});
  const byName = Object.fromEntries((list.result?.tools ?? []).map((x) => [x.name, x.description]));
  assert.ok(
    byName.iskron_add_vimarsha?.includes("[мост] Момент скилла writing"),
    "add tool lacks the line",
  );
  assert.ok(byName.iskron_batch?.includes("[мост] Момент скилла writing"), "batch lacks the line");
  assert.ok(!byName.iskron_orient?.includes("[мост]"), "a read tool must stay untouched");
  assert.ok(
    byName.iskron_channel?.includes('action="status"'),
    "the channel tool must announce the bridge's own status action",
  );
});

test("watchdog with nothing held tells the doer to name itself with iskron_stand", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-empty-"));
  const wd = runClient("watchdog", dir, undefined, 5000);
  const r = await wd.done;
  assert.equal(r.exit, 2);
  assert.match(wd.err, /iskron_stand/);
});

// Leaving the place — the move between an absence and a revoke (graph nks-dev:
// #4895): the socket is closed and the busy line cleared, while the address,
// the queue and the hooks stay; coming back reopens the same address.
test("leave by the doer's word: socket closed, busy line cleared, place kept; iskron_stand comes back without a connect", async (t) => {
  const { fake, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  // The fake keeps a closed socket in its set until both ends finish: count
  // sockets the bridge OPENED, not those the fake still holds.
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  await fake.control({ richTools: true });
  const list = await bridge.call("tools/list", 4);
  const channel = list.result.tools.find((x) => x.name === "iskron_channel");
  assert.match(channel.description, /action="leave"/, "the move is announced on the tool");
  assert.match(
    channel.description,
    /в pi и OpenCode кадр приходит уведомлением, и мост места не бросает/,
    "the line must not promise a self-leave to a harness whose bridge never leaves (#5140)",
  );
  const st = await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "работаю" },
  });
  assert.ok(!st.result?.isError, JSON.stringify(st));
  const before = fake.state.counts.mcp;
  const left = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  const text = left.result?.content?.[0]?.text ?? "";
  assert.ok(!left.result?.isError, text);
  assert.match(text, /ушёл с места/, text);
  assert.match(text, /занятость снята/, text);
  assert.equal(fake.state.counts.mcp, before, "leave is the bridge's own move — no server call");
  assert.match(bridge.stderr, /left the standing: по слову делателя/);
  assert.equal(fake.state.status, "", "the busy line is cleared");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".key")),
    "the place is kept: the key file stays",
  );
  assert.ok(
    !bridge.notifications.some((n) => ["dead", "evicted"].includes(n.params?.data?.kind)),
    "leaving is neither a dead token nor an eviction",
  );
  const back = await bridge.call("tools/call", 7, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", status: "вернулся" },
  });
  const said = (back.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!back.result?.isError, said);
  assert.match(said, /возврат на место/, said);
  assert.equal(fake.state.counts.connect, 1, "coming back reopens the same address — no connect");
  await waitFor(() => fresh().length === 1, "the socket to reopen on the same address");
  assert.match(said, /hello получен/, said);
  assert.equal(fake.state.status, "вернулся");
});

test("a harness that hears only through a watchdog: nobody listening past the threshold, the bridge leaves by itself; a watchdog attaching brings it back", async (t) => {
  const { fake, dir, bridge, key } = await connected(t, { env: { ISKRON_BRIDGE_DEAF_MS: "1500" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const st = await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "работаю" },
  });
  assert.ok(!st.result?.isError, JSON.stringify(st));
  await waitFor(
    () => /left the standing: никто не слушает/.test(bridge.stderr),
    "the bridge to leave on deafness",
    6000,
  );
  await waitFor(() => fake.state.status === "", "the busy line to be cleared");
  const wd = runClient("watchdog", dir, key, 8000);
  await waitFor(() => fresh().length === 1, "a listener to bring the standing back");
  await waitFor(() => /мост вернулся на место/.test(bridge.stderr), "the return to be logged");
  await waitFor(
    () => fake.state.status === "работаю",
    "the busy line cleared by the leave to come back with the place",
  );
  assert.ok(
    bridge.notifications.some(
      (n) => n.params?.data?.kind === "note" && /вернулся на место/.test(n.params.data.text),
    ),
    "the return is announced to the harness",
  );
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(
    fresh().length,
    1,
    "with a listener attached the bridge stays and does not leave again",
  );
  assert.equal((bridge.stderr.match(/left the standing/g) ?? []).length, 1);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("pi and OpenCode hear by notification: their bridge never leaves for want of a watchdog", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_DEAF_MS: "800" },
    init: { ...INIT, clientInfo: { name: "pi-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(!/left the standing/.test(bridge.stderr), "the socket is still held");
});

for (const way of ["stdin", "SIGINT"]) {
  test(`the end of the session (${way}) clears the busy line, the key file first`, async (t) => {
    const { fake, bridge, standings } = await connected(t);
    await waitFor(() => fake.state.ws.size === 1, "the socket");
    const st = await bridge.call("tools/call", 4, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", action: "status", text: "работаю" },
    });
    assert.ok(!st.result?.isError, JSON.stringify(st));
    if (way === "stdin") await bridge.stop();
    else bridge.proc.kill("SIGINT");
    await waitFor(() => fake.state.status === "", "the busy line to be cleared at exit");
    await waitFor(() => bridge.proc.exitCode !== null, "the bridge to exit");
    assert.ok(
      !readdirSync(standings).some((f) => f.endsWith(".key")),
      "the key file must not outlive the bridge",
    );
  });
}

// A watchdog re-armed after a Monitor expiry must not carry the same frames a
// second time: the bridge remembers what a local client already received.
test("a re-armed watchdog gets hello and only the frames no local client has seen", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => first.out.includes("слушаю стояние"), "the first watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "m-1", body: "первое слово" }),
  });
  await waitFor(() => first.out.includes("первое слово"), "the frame to reach the first watchdog");
  await waitSeen(standings, "m-1");
  first.proc.kill("SIGKILL");
  await first.done;
  await fake.control({
    ws_send: JSON.stringify({
      type: "message",
      id: "m-2",
      body: "второе слово, пока никто не слушал",
    }),
  });
  await new Promise((r) => setTimeout(r, 300));
  const again = runClient("watchdog", dir, key, 6000);
  await waitFor(
    () => again.out.includes("второе слово"),
    "the unseen frame to reach the re-armed watchdog",
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.match(again.out, /"type":"hello"/, "hello is replayed: proof of holding");
  assert.ok(
    !again.out.includes("первое слово"),
    `a delivered frame must not come a second time:\n${again.out}`,
  );
  assert.match(again.out, /слушаю стояние \S+ \(2 кадра задним числом\)/, again.out);
  again.proc.kill("SIGKILL");
  await again.done;
});

// A bridge raised anew under a place a previous bridge of this auth dir held
// (plugin restart, /mcp reconnect) takes the place back from disk — the same
// address, no connect; a revoke or a dead token forgets the record (#5061).
test("a bridge restarted under a held place resumes it from disk: same address, no connect, the old busy line not published anew; while the board still reads «слушает» — only register", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const st0 = await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "до перезапуска" },
  });
  assert.ok(!st0.result?.isError, JSON.stringify(st0));
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".hold")),
    "the hold record is written",
  );
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  bridge.proc.kill("SIGKILL"); // the plugin restarts: its bridges go down without a revoke
  await waitFor(() => bridge.proc.signalCode !== null, "the first bridge to exit");
  await waitFor(() => fake.state.ws.size === 0, "the fake to see the socket close");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".hold")),
    "the record outlives the bridge",
  );

  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  // The platform's grace window: the board still reads «слушает» for a while after the
  // predecessor died — the canon says only register then; the record waits.
  await fake.control({ places: [{ karta: "931", name: "proba", listening: true }] });
  const early = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const saidEarly = (early.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.match(saidEarly, /прежний мост этого каталога, а он мёртв/, saidEarly);
  assert.match(saidEarly, /вернёт место с диска/, "the answer names the way back");
  assert.equal(fresh().length, 0, "no socket is opened while the board reads «слушает»");
  assert.equal(fake.state.counts.connect, 1);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });

  const posts = fake.state.counts.status_posts;
  const st = await second.call("tools/call", 3, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const said = (st.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!st.result?.isError, said);
  assert.match(said, /возврат места с диска после перезапуска моста/, said);
  assert.equal(fake.state.counts.connect, 1, "the place is resumed, not rotated");
  assert.equal(fresh().length, 1, "one socket reopened on the saved address");
  assert.match(said, /Сокет держит этот мост/, said);
  // The busy line is the holder's word about its work: a resume does not publish
  // it again under a fresh stamp (graph nks-dev: #6017).
  assert.match(said, /прежняя строка занятости не возвращена/, said);
  assert.doesNotMatch(said, /Занятость возвращена/, said);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.state.counts.status_posts, posts, "no busy line is published by the resume");
  const write = await second.call("tools/call", 4, {
    name: "iskron_add_phenomenon",
    arguments: { name: "после перезапуска" },
  });
  const text = (write.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!/unattributed/.test(text), `a write after the resume must carry the author:\n${text}`);

  const rv = await second.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "revoke", karta: 931, standing: "proba" },
  });
  assert.ok(!rv.result?.isError, JSON.stringify(rv));
  assert.ok(
    !readdirSync(standings).some((f) => f.endsWith(".hold")),
    "a revoke forgets the record",
  );
});

test("a stale hold record is dropped quietly: no dead-token alarm, the place is taken anew; an expired record is never read", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const hold = readdirSync(standings).find((f) => f.endsWith(".hold"));
  const path = join(standings, hold);
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  // The platform no longer knows the token: the socket is refused with 4001 on open.
  await fake.control({ ws_refuse: 4001 }); // one refusal: the resume dies, the connect after it is served
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const st = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const said = (st.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!st.result?.isError, said);
  assert.match(said, /connect и register|connect \(сокет теперь у этого моста\)/, said);
  assert.ok(
    !second.notifications.some((n) => n.params?.data?.kind === "dead"),
    "a stale record must not sound the dead-token alarm",
  );
  assert.equal(fake.state.counts.connect, 2, "the place is taken anew by connect");
  assert.match(said, /hello получен/, "the fresh place is heard");
  // An expired record (older than the place's idle life) is dropped unread.
  const rec = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...rec, at: Date.now() - 7 * 3600 * 1000 }));
  second.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  const third = startBridge(fake.mcpUrl, dir);
  t.after(() => third.stop());
  assert.ok((await third.call("initialize", 1, INIT)).result);
  const st3 = await third.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const said3 = (st3.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(
    !/возврат места с диска/.test(said3),
    `an expired record must not be resumed:\n${said3}`,
  );
  assert.equal(fake.state.counts.connect, 3);
});

test("a dead token forgets the hold record; a live holder's place is not taken from disk", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  // A second bridge of the same dir must not resume a place a live bridge holds.
  const other = startBridge(fake.mcpUrl, dir);
  t.after(() => other.stop());
  assert.ok((await other.call("initialize", 1, INIT)).result);
  const st = await other.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const said = (st.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!/возврат места с диска/.test(said), `a live holder keeps its place:\n${said}`);
  assert.match(said, /слушает другой держатель/, said);
  await fake.control({ ws_close: 4001 });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "dead"),
    "the dead token to reach the harness",
  );
  await waitFor(
    () => !readdirSync(standings).some((f) => f.endsWith(".hold")),
    "a dead token to forget the record",
  );
});

// A seat the platform no longer knows («no such standing — take it with
// connect») used to drop only the binding: the socket and the hold record
// stayed, the bridge still «led» a place it could not name, and the next
// connect under any place replaced the held socket silently (#5168).
test("a seat gone at the platform releases the hold too: socket closed aloud, record dropped, the next connect is a fresh start", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  // The fake keeps a closed socket in its set until both ends finish: count
  // sockets the bridge OPENED, not those the fake still holds.
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const reg = await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { ...CONNECT, action: "register" },
  });
  assert.match(reg.result.content[0].text, /теперь говорит от стояния/);
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".hold")),
    "the place is held before the seat expires",
  );
  // The session turns over and the replayed register is refused as «seat gone».
  await fake.control({ kill_session: true, standingSeatGoneNext: 1 });
  await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "list" },
  });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "released"),
    "the release to be said aloud, not done silently",
  );
  await waitFor(
    () =>
      /released .*места нет.*\(record dropped\)/.test(
        readFileSync(join(dir, "standings.log"), "utf8"),
      ),
    "the standing's journal to name the seat gone and the record dropped",
  );
  assert.ok(
    !readdirSync(standings).some((f) => f.endsWith(".hold")),
    "a seat the platform forgot is not kept on disk",
  );
  // The bridge leads nothing now: a connect under another name is a fresh
  // place, not a silent replacement of a held one.
  const connects = fake.state.counts.connect;
  const again = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { ...CONNECT, name: "proba-2" },
  });
  const said = (again.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!again.result?.isError, `a fresh connect after a gone seat must pass:\n${said}`);
  assert.ok(!/уже ведёт место/.test(said), said);
  assert.equal(fake.state.counts.connect, connects + 1, "a fresh connect, not a resume");
  await waitFor(() => fresh().length === 1, "the new place's socket");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".hold")),
    "the new place is held on disk",
  );
});

// ── keeping the hearing (graph nks-dev: #5140) ───────────────────────────────

// The OpenCode plugin has no local socket client, so «attached» never reached
// it and a holding bridge looked idle. The bridge now says «held» and
// «released» as notifications — the plugin's flag is fed by the bridge's word.
test("the bridge says «held» and «released» as notifications, and journals the standing's life next to grant.log", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "held"),
    "the «held» notification",
  );
  const held = bridge.notifications.find((n) => n.params?.data?.kind === "held");
  assert.match(held.params.data.key, /^proba--931--nks-dev$/);
  const rv = await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "revoke", karta: 931, standing: "proba" },
  });
  assert.ok(!rv.result?.isError, JSON.stringify(rv));
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "released"),
    "the «released» notification",
  );
  const journal = readFileSync(join(dir, "standings.log"), "utf8");
  assert.match(journal, /held proba--931--nks-dev/, journal);
  assert.match(journal, /released proba--931--nks-dev/, journal);
  assert.match(journal, /pid=\d+ v\d/, "every line carries pid and build, like grant.log");
});

// After hello with pending > 0 the platform hands over everything that waited
// at once; a frame of the platform itself (a wake) is the other trigger. Either
// opens a short window, and what arrives in it rides as ONE backlog
// notification — frames by received_at, bodies included — not a prompt per frame.
test("hello with pending and a platform wake each open a backlog window: the frames in it ride as one notification by received_at, a lone frame still rides alone", async (t) => {
  // The window is for harnesses that hear by notification; a watchdog harness
  // keeps its frame-by-frame socket and gets no window (Claude Code, Codex).
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "600" },
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const backlogs = () => bridge.notifications.filter((n) => n.params?.data?.kind === "backlog");
  const frames = () =>
    bridge.notifications
      .filter((n) => n.params?.data?.kind === "frame")
      .map((n) => n.params.data.frame?.id);
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 2 }) });
  await fake.control({
    ws_send: JSON.stringify({
      id: "q2",
      type: "message",
      body: "второе в очереди",
      received_at: "2026-09-17T15:30:00Z",
    }),
  });
  await fake.control({
    ws_send: JSON.stringify({
      id: "q1",
      type: "message",
      body: "первое в очереди",
      received_at: "2026-09-17T15:15:00Z",
    }),
  });
  await waitFor(() => backlogs().length === 1, "the backlog notification");
  const burst = backlogs()[0].params.data;
  assert.deepEqual(
    burst.frames.map((f) => f.id),
    ["q1", "q2"],
    "the queue is handed over in the order it was received, not the order it came",
  );
  assert.equal(burst.pending, 2);
  assert.match(burst.text, /Побудка: кадров 2 \(ожидало в очереди: 2\)/);
  assert.match(burst.text, /первое в очереди[\s\S]*второе в очереди/);
  assert.match(burst.text, /action="history"/, "the rest is pointed at, not dropped");
  assert.ok(
    !frames().includes("q1") && !frames().includes("q2"),
    "no prompt per frame for a queued frame",
  );
  // A platform wake opens a window of its own; the neighbour's word next to it rides along.
  await fake.control({
    ws_send: JSON.stringify({
      id: "wake",
      type: "message",
      body: "Час на одном и том же — подними голову",
      provenance: { auth: "none", via: "platform" },
    }),
  });
  await fake.control({
    ws_send: JSON.stringify({
      id: "peer",
      type: "message",
      body: "слово соседа",
      provenance: { from_karta_seq: 48 },
    }),
  });
  await waitFor(() => backlogs().length === 2, "the wake's backlog");
  assert.deepEqual(
    backlogs()[1].params.data.frames.map((f) => f.id),
    ["wake", "peer"],
  );
  assert.match(backlogs()[1].params.data.text, /от ПЛАТФОРМЫ — побудка/);
  // Outside a window a frame rides alone, as before.
  await new Promise((r) => setTimeout(r, 800));
  await fake.control({ ws_send: JSON.stringify({ id: "alone", type: "message", body: "одно" }) });
  await waitFor(() => frames().includes("alone"), "the lone frame as its own notification");
  assert.equal(backlogs().length, 2);
});

// pi and OpenCode hear by notification: the notification IS the delivery, so a
// delivered frame is remembered in .seen without a local client, and the same
// id handed over again (after a resume from disk) wakes nobody twice.
test("for a client that hears by notification a delivered frame is remembered in .seen, and a repeat by id is not raised again", async (t) => {
  const { fake, bridge, standings } = await connected(t, {
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const sent = JSON.stringify({ id: "r-1", type: "message", body: "раз" });
  await fake.control({ ws_send: sent });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.frame?.id === "r-1"),
    "the frame",
  );
  await waitFor(
    () =>
      readdirSync(standings).some(
        (f) => f.endsWith(".seen") && readFileSync(join(standings, f), "utf8").includes("r-1"),
      ),
    "the id to be remembered without a local client",
  );
  await fake.control({ ws_send: sent });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(
    bridge.notifications.filter((n) => n.params?.data?.frame?.id === "r-1").length,
    1,
    "the same frame must not wake the agent twice",
  );
  assert.match(bridge.stderr, /frame r-1 came again/);
});

// A day's queue handed again (graph nks-dev: #5831, #5828): after a reconnect the
// platform re-sends frames it already delivered, live and stale alike. None may
// reach the doer twice — the memory of delivery holds a day's traffic (ids and
// event marks), and for pi and OpenCode the bridge marks everything it hands
// over, the stale batch included.
const DAY = 190;
const dayFrame = (i, extra = {}) =>
  i % 2
    ? graphEvent(`day-${i}`, 7000 + i, `день-${i}-`, extra)
    : JSON.stringify({ type: "message", id: `day-${i}`, body: `день-${i}-`, ...extra });
const OPENCODE_INIT = { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } };
/** Frame ids a notified client was handed — alone, in a stale batch, in a wake batch. */
const handedIds = (bridge, from = 0) =>
  bridge.notifications.slice(from).flatMap((n) => {
    const d = n.params?.data;
    return [d?.frame?.id, ...(d?.frames ?? []).map((f) => f?.id)].filter(
      (x) => typeof x === "string",
    );
  });
/** Drop the socket and wait for the bridge to open another. */
async function reconnect(fake) {
  const known = new Set(fake.state.ws);
  await fake.control({ ws_close: 1011 });
  await waitFor(() => [...fake.state.ws].some((s) => !known.has(s)), "the bridge to reconnect");
}

test("a day's queue re-sent after a reconnect reaches a notified client once — live, stale and wake batch; a new frame still does", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "400" },
    init: OPENCODE_INIT,
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  // Yesterday: the first ten came as a stale batch, the rest live.
  await fake.control({
    ws_send_many: Array.from({ length: DAY }, (_, i) => dayFrame(i, i < 10 ? { stale: true } : {})),
  });
  await waitFor(
    () => new Set(handedIds(bridge)).size === DAY,
    "yesterday's queue handed over",
    20_000,
  );
  // Today: the socket drops, hello says the whole queue waited, and the platform re-sends it.
  await fake.control({ helloPending: DAY });
  const mark = bridge.notifications.length;
  await reconnect(fake);
  await fake.control({
    ws_send_many: Array.from({ length: DAY }, (_, i) => dayFrame(i, { stale: i % 3 === 0 })),
  });
  await new Promise((r) => setTimeout(r, 2500)); // past the stale and the wake windows
  const again = handedIds(bridge, mark).filter((id) => id.startsWith("day-"));
  assert.equal(again.length, 0, `handed again: ${again.length} (${again.slice(0, 5).join(", ")}…)`);
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "fresh-1", body: "новое" }),
  });
  await waitFor(() => handedIds(bridge, mark).includes("fresh-1"), "a new frame to be handed");
});

// A batch shows its first twenty and names the rest by count and history — all of
// them were handed over, so none comes back after a reconnect.
test("a notified client is not handed again the frames a wake or stale batch named but did not show", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "600" },
    init: OPENCODE_INIT,
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wake = Array.from({ length: 30 }, (_, i) =>
    JSON.stringify({ type: "message", id: `wk-${i}`, body: `побудка ${i}` }),
  );
  const stale = Array.from({ length: 25 }, (_, i) =>
    JSON.stringify({ type: "message", id: `st-${i}`, body: `лежалое ${i}`, stale: true }),
  );
  await fake.control({ ws_send_many: [JSON.stringify({ type: "hello", pending: 30 }), ...wake] });
  await fake.control({ ws_send_many: stale });
  const batches = () =>
    bridge.notifications.filter((n) => /backlog|stale/.test(n.params?.data?.kind));
  await waitFor(() => batches().length === 2, "the wake batch and the stale batch", 5000);
  const told = batches().map((n) => n.params.data.text);
  assert.ok(
    told.some((x) => /кадров 30.*первые 20/.test(x)),
    told.join("\n---\n"),
  );
  const mark = bridge.notifications.length;
  await reconnect(fake);
  await fake.control({
    ws_send_many: [...wake, ...stale.map((s) => s.replace('"stale":true', '"stale":false'))],
  });
  await fake.control({ ws_send_many: stale });
  await new Promise((r) => setTimeout(r, 2200)); // past the stale window
  const again = handedIds(bridge, mark);
  assert.deepEqual(again, [], "handed again");
});

test("the memory of delivery outlives a clean bridge exit: the place taken back hands a notified client nothing it had", async (t) => {
  const { fake, dir, bridge } = await connected(t, { init: OPENCODE_INIT });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({ ws_send: dayFrame(1) });
  await fake.control({ ws_send: dayFrame(2, { stale: true }) });
  await waitFor(
    () => ["day-1", "day-2"].every((id) => handedIds(bridge).includes(id)),
    "both handed",
  );
  const known = new Set(fake.state.ws);
  await bridge.stop(); // stdin closed — the harness is gone, cleanly
  assert.equal(bridge.proc.exitCode, 0, "the bridge left cleanly");
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, OPENCODE_INIT)).result);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });
  const st = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.ok(!st.result?.isError, JSON.stringify(st));
  await waitFor(() => [...fake.state.ws].some((s) => !known.has(s)), "the place taken back");
  for (const s of known) s.destroy(); // the first bridge's socket, if the fake still holds it
  await fake.control({
    ws_send_many: [dayFrame(1), dayFrame(2, { stale: true }), dayFrame(2)],
  });
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "fresh-2", body: "новое" }),
  });
  await waitFor(() => handedIds(second).includes("fresh-2"), "a new frame to be handed");
  await new Promise((r) => setTimeout(r, 1800)); // past the stale window
  const again = handedIds(second).filter((id) => id.startsWith("day-"));
  assert.deepEqual(again, [], "yesterday's frames handed again");
});

test("a day's queue re-sent after a reconnect is not printed again by the Monitor watchdog; a new frame is", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 60_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  const printed = () => (wd.out.match(/день-\d+-/g) ?? []).length;
  await fake.control({ ws_send_many: Array.from({ length: DAY }, (_, i) => dayFrame(i)) });
  await waitFor(() => printed() === DAY, "yesterday's queue printed", 20_000);
  await new Promise((r) => setTimeout(r, 300)); // the last marks follow the last print
  await reconnect(fake);
  await fake.control({
    ws_send_many: Array.from({ length: DAY }, (_, i) => dayFrame(i, { stale: i % 3 === 0 })),
  });
  await new Promise((r) => setTimeout(r, 2500)); // past the stale window
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "fresh-3", body: "новое" }),
  });
  await waitFor(() => wd.out.includes("новое"), "a new frame to be printed");
  wd.proc.kill("SIGKILL");
  await wd.done;
  assert.equal(printed(), DAY, `printed again: ${printed() - DAY}`);
});

// The memory outlives the bridge, and the place key does not name the server,
// while `use en|ru|url` share one grant directory: the memory is per server.
test("the memory of delivery is per server: a mark made against one server does not hide the same id on another", async (t) => {
  const a = await connected(t, { init: OPENCODE_INIT });
  await waitFor(() => a.fake.state.ws.size === 1, "the socket on A");
  await a.fake.control({
    ws_send: JSON.stringify({ type: "message", id: "same-1", body: "на сервере A" }),
  });
  await waitFor(() => handedIds(a.bridge).includes("same-1"), "handed on A");
  await a.bridge.stop();
  const b = await connected(t, { init: OPENCODE_INIT, dir: a.dir });
  await waitFor(() => b.fake.state.ws.size === 1, "the socket on B");
  await b.fake.control({
    ws_send: JSON.stringify({ type: "message", id: "same-1", body: "на сервере B" }),
  });
  await waitFor(() => handedIds(b.bridge).includes("same-1"), "the same id handed on B");
});

/** Drop every .seen file: the bridge loses its word on what was delivered, the client keeps its own. */
const forgetSeenFiles = (standings) => {
  for (const f of readdirSync(standings).filter((x) => x.endsWith(".seen")))
    unlinkSync(join(standings, f));
};

// The watchdog's own memory is the second line behind the bridge: an id it has
// printed is not printed again even when the bridge hands it over again.
test("the Monitor watchdog does not print again an id it printed, even when the bridge hands it over again", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  const once = JSON.stringify({ type: "message", id: "g-1", body: "однажды-g" });
  await fake.control({ ws_send: once });
  await waitSeen(standings, "g-1");
  forgetSeenFiles(standings);
  await fake.control({ ws_send: once });
  await fake.control({ ws_send: JSON.stringify({ type: "message", id: "g-2", body: "потом-g" }) });
  await waitFor(() => wd.out.includes("потом-g"), "the next frame");
  wd.proc.kill("SIGKILL");
  await wd.done;
  assert.equal((wd.out.match(/однажды-g/g) ?? []).length, 1, wd.out);
});

test("the Codex watchdog does not put into the thread again an id it put there, even when the bridge hands it over again", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-5",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  const once = JSON.stringify({ type: "message", id: "cg-1", body: "однажды-cg" });
  await fake.control({ ws_send: once });
  await waitSeen(standings, "cg-1");
  forgetSeenFiles(standings);
  await fake.control({ ws_send: once });
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "cg-2", body: "потом-cg" }),
  });
  await waitFor(() => readFileSync(log, "utf8").includes("потом-cg"), "the next frame");
  wd.proc.kill("SIGKILL");
  await wd.done;
  assert.equal((readFileSync(log, "utf8").match(/однажды-cg/g) ?? []).length, 1);
});

// A stale batch shows twenty and names the rest by count: the watchdog that
// printed it marks them all, or a reconnect brings the unshown back.
const staleBurst = (n) =>
  Array.from({ length: n }, (_, i) =>
    JSON.stringify({ type: "message", id: `sb-${i}`, body: `лежалое-${i}-`, stale: true }),
  );

test("the Monitor watchdog marks the frames a stale batch named but did not show — none comes back after a reconnect", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 30_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  const shown = () => (wd.out.match(/лежалое-\d+-/g) ?? []).length;
  await fake.control({ ws_send_many: staleBurst(25) });
  await waitFor(() => /Лежалых кадров: 25, здесь первые 20/.test(wd.out), "the stale batch");
  await new Promise((r) => setTimeout(r, 300)); // the marks follow the print
  assert.equal(shown(), 20);
  await reconnect(fake);
  await fake.control({
    ws_send_many: staleBurst(25).map((s) => s.replace('"stale":true', '"stale":false')),
  });
  await fake.control({ ws_send: JSON.stringify({ type: "message", id: "sb-new", body: "новое" }) });
  await waitFor(() => wd.out.includes("новое"), "a new frame to be printed");
  wd.proc.kill("SIGKILL");
  await wd.done;
  assert.equal(shown(), 20, `printed again: ${shown() - 20}`);
});

test("the Codex watchdog marks the frames a stale batch named but did not show once the thread takes it", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-6",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({ ws_send_many: staleBurst(25) });
  await waitFor(() => wd.err.includes("кадр вложен в тред"), "the stale batch in the thread");
  await waitSeen(standings, "sb-24");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// The plugin cannot pass anything to a bridge it spawned before the session
// existed; instead it asks the bridge to resume by the session's directory,
// which iskron_stand wrote into the hold record.
test("iskron/resume by the session's directory: a bridge restarted after the plugin's death takes the place back, registers, and only for the right directory", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-session-dir-"));
  // The plugin names its session to the bridge first (its resume, before any call).
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-vahta" });
  const stand = await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd, status: "на вахте" },
  });
  const said = (stand.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.match(said, /сокет уже держит этот мост — register/, said);
  const hold = readdirSync(standings).find((f) => f.endsWith(".hold"));
  const rec = JSON.parse(readFileSync(join(standings, hold), "utf8"));
  assert.equal(rec.cwd, cwd, "the record names the directory");
  assert.equal(rec.session, "ses-vahta", "the record names the session that stood");
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  await fake.control({ helloPending: 2 });
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const wrong = await second.call("iskron/resume", 2, {
    cwd: "/nowhere/else",
    session: "ses-vahta",
  });
  assert.equal(wrong.result?.resumed, false, JSON.stringify(wrong));
  assert.equal(fresh().length, 0, "another directory's place is not touched");
  const registers = fake.state.counts.register_standing;
  const posts = fake.state.counts.status_posts;
  const back = await second.call("iskron/resume", 3, { cwd, session: "ses-vahta" });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.equal(back.result.pending, 2, "the answer says how many frames waited");
  assert.match(back.result.word, /возврат места с диска/);
  assert.match(back.result.word, /register/);
  assert.match(back.result.word, /прежняя строка занятости не возвращена/);
  assert.match(back.result.word, /iskron_channel\(action="leave"\)/, "the way to let go is named");
  assert.equal(fake.state.counts.connect, 1, "the place is resumed, not rotated");
  assert.equal(fresh().length, 1, "one socket reopened on the saved address");
  assert.equal(
    fake.state.counts.register_standing,
    registers + 1,
    "the session is attributed by register",
  );
  assert.ok(
    second.notifications.some((n) => n.params?.data?.kind === "held"),
    "the resumed place is said as «held»",
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.state.counts.status_posts, posts, "the old busy line is not published anew");
  const again = await second.call("iskron/resume", 4, { cwd, session: "ses-vahta" });
  assert.equal(again.result?.resumed, true, "a held place answers «held», not a second resume");
  assert.match(again.result.word, /уже держит/);
  assert.equal(fresh().length, 1, "no second socket for a place already held");
  assert.match(
    readFileSync(join(dir, "standings.log"), "utf8"),
    /resumed-from-disk proba--931--nks-dev: pending 2/,
  );
});

// Two standings of one role from one working copy, both sessions gone without a
// way back. Two holders in one directory, stood by two sessions (#5366); the
// plugin names its session in every resume. Returns the fake, the grant
// directory and the shared session directory.
async function twoDeadHolders(t) {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-shared-dir-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-proba" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd, status: "свод двух фаз" },
  });
  const brother = startBridge(fake.mcpUrl, dir);
  t.after(() => brother.stop());
  assert.ok((await brother.call("initialize", 1, INIT)).result);
  await new Promise((r) => setTimeout(r, 20)); // the brother's record is the fresher one
  await brother.call("iskron/resume", 2, { cwd, session: "ses-brat" });
  const stood = await brother.call("tools/call", 3, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "brat", cwd, status: "жду архитектора" },
  });
  assert.match((stood.result?.content ?? []).map((c) => c.text ?? "").join("\n"), /brat/);
  await waitFor(() => fake.state.ws.size === 2, "both sockets");
  bridge.proc.kill("SIGKILL");
  brother.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the sockets to close");
  return { fake, dir, cwd };
}

// A session that never stood makes its first call in the same directory: the
// directory alone must give it neither place, and no busy line of a dead holder
// may reach the board under a fresh stamp (graph nks-dev: #6017).
test("iskron/resume by a directory of two dead holders gives a session that never stood no place and publishes no busy line", async (t) => {
  const { fake, dir, cwd } = await twoDeadHolders(t);
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const posts = fake.state.counts.status_posts;
  const registers = fake.state.counts.register_standing;
  const third = startBridge(fake.mcpUrl, dir);
  t.after(() => third.stop());
  assert.ok((await third.call("initialize", 1, INIT)).result);
  const stranger = await third.call("iskron/resume", 2, { cwd, session: "ses-novaya" });
  assert.equal(stranger.result?.resumed, false, JSON.stringify(stranger));
  assert.match(stranger.result.word, /эта сессия не стояла/);
  const bare = await third.call("iskron/resume", 3, { cwd });
  assert.equal(bare.result?.resumed, false, `no session named: ${JSON.stringify(bare)}`);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fresh().length, 0, "no socket is opened for a place this session never held");
  assert.equal(fake.state.counts.register_standing, registers, "no register");
  assert.equal(fake.state.counts.status_posts, posts, "no busy line is published");
  // Not taken, not erased: the holders' records wait for their own sessions.
  assert.equal(
    readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".hold")).length,
    2,
    "both records are left for their holders",
  );
});

// The legitimate return: the session that stood gets ITS place back — not the
// freshest of the directory — without the old busy line, and can let it go by
// leave without ending the channel.
test("iskron/resume by the session that stood returns its own place, not the freshest, without its old busy line, and leave lets it go", async (t) => {
  const { fake, dir, cwd } = await twoDeadHolders(t);
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const posts = fake.state.counts.status_posts;
  const back4 = startBridge(fake.mcpUrl, dir);
  t.after(() => back4.stop());
  assert.ok((await back4.call("initialize", 1, INIT)).result);
  const back = await back4.call("iskron/resume", 2, { cwd, session: "ses-proba" });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.equal(
    back.result.key,
    "proba--931--nks-dev",
    "the session's own record, not the freshest",
  );
  assert.deepEqual(back.result.others, ["brat--931--nks-dev"], "the neighbour is named");
  assert.match(back.result.word, /прежняя строка занятости не возвращена/);
  assert.match(back.result.word, /iskron_channel\(action="leave"\)/);
  await waitFor(() => fresh().length === 1, "the socket reopened on the saved address");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.state.counts.status_posts, posts, "the old busy line is not published anew");
  const left = await back4.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  assert.ok(!left.result?.isError, JSON.stringify(left));
  assert.match(left.result?.content?.[0]?.text ?? "", /ушёл с места proba--931--nks-dev/);
});

// The plugin's watch: every N minutes a session that stood asks its bridge
// `iskron/check` — a held place the board reads deaf with frames waiting has
// its socket reopened on the same address; a listening one is left alone.
test("iskron/check: a held place the board reads deaf with waiting frames gets its socket reopened; a listening one is left alone", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const fine = await bridge.call("iskron/check", 5, { cwd: "" });
  assert.equal(fine.result?.holding, true, JSON.stringify(fine));
  assert.equal(fine.result.listening, true);
  assert.equal(fresh().length, 0, "a listening place is not reopened");
  // «не слушает» alone decides; the «не доставлено N» counter is only reported
  // (its prose is observed live once — a counter is not a contract).
  await fake.control({
    places: [{ karta: 931, name: "proba", listening: false, pending: 0 }],
    helloPending: 2,
  });
  const deaf = await bridge.call("iskron/check", 6, { cwd: "" });
  assert.equal(deaf.result?.reopened, true, JSON.stringify(deaf));
  assert.equal(deaf.result.pending, 0);
  await waitFor(() => fresh().length === 1, "the socket to be reopened on the same address");
  assert.equal(fake.state.counts.connect, 1, "no connect — the same address");
  assert.match(
    readFileSync(join(dir, "standings.log"), "utf8"),
    /reopen proba--931--nks-dev: board reads deaf/,
  );
});

// A board that keeps reading the place deaf after a reopen must not have its
// socket torn every tick forever: two fruitless reopens in a row, and the third
// tick says so aloud (once, into the session) instead of reopening.
test("iskron/check stops reopening after two fruitless reopens and says so aloud once; hearing back resets the count", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const deaf = () => fake.control({ places: [{ karta: 931, name: "proba", listening: false }] });
  // The fake reads the board off the socket: each reopen makes it «слушает» again,
  // so the probe re-deafens the board after each one, as a stuck server would.
  await deaf();
  const first = await bridge.call("iskron/check", 5, {});
  assert.equal(first.result?.reopened, true, JSON.stringify(first));
  await waitFor(() => fresh().length === 1, "the first reopen");
  await deaf();
  const second = await bridge.call("iskron/check", 6, {});
  assert.equal(second.result?.reopened, true, JSON.stringify(second));
  await waitFor(() => fresh().length === 2, "the second reopen");
  await deaf();
  const third = await bridge.call("iskron/check", 7, {});
  assert.equal(third.result?.reopened, false, JSON.stringify(third));
  assert.equal(third.result.stuck, true, "the third tick gives up instead of reopening");
  assert.match(third.result.word, /не рву/);
  assert.match(third.result.word, /take=true/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fresh().length, 2, "no third socket");
  const lost = () => bridge.notifications.filter((n) => n.params?.data?.kind === "lost");
  assert.equal(lost().length, 1, "the word goes to the session once");
  assert.match(lost()[0].params.data.text, /не слушающим и после 2 переоткрытий/);
  const fourth = await bridge.call("iskron/check", 8, {});
  assert.equal(fourth.result.stuck, true);
  assert.equal(lost().length, 1, "said once, not every tick");
  assert.match(readFileSync(join(dir, "standings.log"), "utf8"), /gave up after 2/);
  // Hearing back resets the count: the next deafness is reopened again.
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  const back = await bridge.call("iskron/check", 9, {});
  assert.equal(back.result.word, "слушаю");
  await deaf();
  const again = await bridge.call("iskron/check", 10, {});
  assert.equal(again.result?.reopened, true, "after hearing came back, deafness is reopened anew");
  await waitFor(() => fresh().length === 3, "the reopen after the reset");
});

// ── cold review of the fix (r5 #5140): what it left open ─────────────────────

// A hold record keyed by the directory alone would let the OpenCode plugin take
// a place Claude Code stood in the same working copy, and a session stand under
// a new name left the old record to be resurrected by every later session.
test("a hold record names its harness and key: another harness's record is not resumed, one's own is resumed by key, and standing under a new name drops the old record", async (t) => {
  const own = { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } };
  const { fake, dir, bridge, standings } = await connected(t, { init: own });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-harness-dir-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-1" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  const record = () =>
    JSON.parse(
      readFileSync(
        join(
          standings,
          readdirSync(standings).find((f) => f.endsWith(".hold")),
        ),
        "utf8",
      ),
    );
  assert.equal(record().client, "opencode-iskron", "the record names the harness");
  assert.equal(record().key, "proba--931--nks-dev", "the record names the key");
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");

  // Claude Code in the same working copy: the record is not its to take.
  const other = startBridge(fake.mcpUrl, dir);
  t.after(() => other.stop());
  assert.ok(
    (
      await other.call("initialize", 1, {
        ...INIT,
        clientInfo: { name: "claude-code", version: "1" },
      })
    ).result,
  );
  const foreign = await other.call("iskron/resume", 2, { cwd, session: "ses-1" });
  assert.equal(foreign.result?.resumed, false, JSON.stringify(foreign));
  assert.match(foreign.result.word, /своей записи держания .* нет/);
  assert.equal(fresh().length, 0, "another harness's place is never opened");
  await other.stop();

  // The same harness, by key — the exact address the plugin remembers from «held».
  const mine = startBridge(fake.mcpUrl, dir);
  t.after(() => mine.stop());
  assert.ok((await mine.call("initialize", 1, own)).result);
  // The key is a preference, the directory the fallback — never an «or»: a stale
  // key alone resumes nothing, a stale key beside the directory falls back to it.
  const keyOnly = await mine.call("iskron/resume", 2, { key: "drugoe--931--nks-dev" });
  assert.equal(keyOnly.result?.resumed, false, "a wrong key without a directory resumes nothing");
  assert.equal(fresh().length, 0);
  const staleKey = await mine.call("iskron/resume", 3, {
    key: "drugoe--931--nks-dev",
    cwd,
    session: "ses-1",
  });
  assert.equal(staleKey.result?.resumed, true, JSON.stringify(staleKey));
  assert.equal(
    staleKey.result.key,
    "proba--931--nks-dev",
    "a stale key must not silence the directory's live record",
  );
  await waitFor(() => fresh().length === 1, "the socket reopened on the saved address");
  assert.equal(fake.state.counts.connect, 1);

  // Standing under a new name: the bridge leaves the old place itself — its
  // record must not survive to be resumed by the next session.
  const renamed = await mine.call("tools/call", 4, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "vtoraya", cwd, take: true },
  });
  assert.ok(!renamed.result?.isError, JSON.stringify(renamed));
  assert.equal(fake.state.counts.connect, 2);
  const holds = readdirSync(standings).filter((f) => f.endsWith(".hold"));
  assert.equal(holds.length, 1, "one record: the old one is dropped with the old place");
  assert.equal(record().key, "vtoraya--931--nks-dev");
});

// A bridge that leads a parked place (leave) must not be talked into another
// record of the same directory: holdStanding of a different key would kill the
// parked socket and forget the name; the return is to the parked place.
test("a bridge leading a parked place returns to it on iskron/resume and leaves a fresher record of the same directory alone", async (t) => {
  const own = { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } };
  const { fake, dir, bridge, standings } = await connected(t, { init: own });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-parked-dir-"));
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd, status: "парковка" },
  });
  const left = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  assert.match(left.result?.content?.[0]?.text ?? "", /ушёл с места/);
  await waitFor(() => fake.state.status === "", "the busy line cleared by the leave");
  // Another bridge of the same harness and directory stands under a fresher record and dies.
  // The fake keeps a closed socket in its set until both ends finish: count the
  // sockets OPENED after each step, not those the fake still holds.
  const before = new Set(fake.state.ws);
  const other = startBridge(fake.mcpUrl, dir);
  t.after(() => other.stop());
  assert.ok((await other.call("initialize", 1, own)).result);
  const st = await other.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "svezhee", cwd },
  }); // a fresh bridge leads no place yet — no take needed
  assert.ok(!st.result?.isError, JSON.stringify(st));
  await waitFor(() => [...fake.state.ws].some((x) => !before.has(x)), "the fresher place's socket");
  // The other bridge's liveness probes touched the parked bridge's local socket;
  // a probe is not a watchdog, so the parked place must still be parked.
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(fake.state.status, "", "a liveness probe must not bring the parked bridge back");
  other.proc.kill("SIGKILL");
  await waitFor(() => other.proc.signalCode !== null, "the other bridge to die");
  await new Promise((r) => setTimeout(r, 300));
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));

  const back = await bridge.call("iskron/resume", 7, { cwd });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.equal(
    back.result.key,
    "proba--931--nks-dev",
    "the return is to the parked place, not the fresher record",
  );
  assert.match(back.result.word, /возврат на место, с которого мост уходил/);
  await waitFor(() => fresh().length === 1, "the parked place's socket reopened");
  assert.equal(fake.state.counts.connect, 2, "no connect");
  await waitFor(() => fake.state.status === "парковка", "the parked place's busy line back");
  // A record the bridge is rewriting at this very moment is not yet valid JSON —
  // the bridge's own reader skips such a file (resume.ts), the probe waits instead.
  await waitFor(
    () =>
      readdirSync(standings)
        .filter((f) => f.endsWith(".hold"))
        .some((f) => {
          try {
            return (
              JSON.parse(readFileSync(join(standings, f), "utf8")).key === "svezhee--931--nks-dev"
            );
          } catch {
            return false;
          }
        }),
    "the fresher record is left for iskron_stand",
  );
  const status = await bridge.call("tools/call", 8, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "снова" },
  });
  assert.match(
    status.result?.content?.[0]?.text ?? "",
    /занятость proba--931--nks-dev/,
    "the bridge still speaks for its own place",
  );
});

// The memory of delivery is written when the notification goes out — a frame
// waiting in the backlog window is not yet delivered, and a bridge dying in the
// window must not leave it marked; releasing the place flushes the window.
test("for a notified client .seen is written at the flush, not at arrival, and releasing the place flushes the window at once", async (t) => {
  const { fake, bridge, standings } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "1200" },
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const seen = () => {
    const f = readdirSync(standings).find((x) => x.endsWith(".seen"));
    return f ? readFileSync(join(standings, f), "utf8") : "";
  };
  const backlogs = () => bridge.notifications.filter((n) => n.params?.data?.kind === "backlog");
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 2 }) });
  await fake.control({ ws_send: JSON.stringify({ id: "w1", type: "message", body: "раз" }) });
  await fake.control({ ws_send: JSON.stringify({ id: "w2", type: "message", body: "два" }) });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(backlogs().length, 0, "the window is still open");
  assert.ok(
    !seen().includes("w1") && !seen().includes("w2"),
    "a frame in the window is not yet delivered — not in .seen",
  );
  await waitFor(() => backlogs().length === 1, "the flush");
  assert.ok(seen().includes("w1") && seen().includes("w2"), "flushed frames are remembered");
  // A second window, cut short by a release: the frames go out now, not never.
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 1 }) });
  await fake.control({ ws_send: JSON.stringify({ id: "w3", type: "message", body: "три" }) });
  const t0 = Date.now();
  await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "revoke", karta: 931, standing: "proba" },
  });
  await waitFor(() => backlogs().length === 2, "the window flushed by the release", 3000);
  assert.ok(Date.now() - t0 < 1000, "flushed at the release, not at the window's end");
  assert.deepEqual(
    backlogs()[1].params.data.frames.map((f) => f.id),
    ["w3"],
  );
});

// A karta written as «#931» — lawful by the standing skill — must key the hold
// and find its own place on the board the same as «931»; and a neighbour
// «x.proba» must not pass for «proba».
test("iskron/check finds its own place with karta «#931», and a neighbour x.proba is not mistaken for proba", async (t) => {
  const fake = await startFakeNks();
  const dir = mkdtempSync(join(tmpdir(), "iskron-standing-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const pending = await bridge.call("initialize", 1, INIT);
  const url = authorizeUrlIn(pending.error?.message);
  await (await fetch(url, { redirect: "follow" })).text();
  await waitFor(() => readdirSync(dir).some((f) => f.endsWith(".json")), "the grant");
  assert.ok((await bridge.call("initialize", 2, INIT)).result);
  const c = await bridge.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "connect", karta: "#931", name: "proba" },
  });
  const text = (c.result?.content ?? []).map((x) => x.text ?? "").join("\n");
  assert.match(text, /watchdog proba--931--nks-dev/, "the key carries the bare number");
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "register", karta: "#931", name: "proba" },
  });
  // A neighbour whose name ends in «.proba», deaf on the board: not ours.
  await fake.control({ places: [{ karta: 931, name: "x.proba", listening: false, pending: 3 }] });
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const check = await bridge.call("iskron/check", 5, {});
  assert.equal(check.result?.holding, true, JSON.stringify(check));
  assert.equal(check.result.listening, true, "our own line is read, not the neighbour's");
  assert.equal(check.result.word, "слушаю");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fresh().length, 0, "no reopen on the neighbour's deafness");
});

// ── one standing per bridge (graph nks-dev: #5154) ───────────────────────────

// A subagent in a child session of the same bridge stood under another role,
// and the bridge dropped the parent's socket and rewrote its binding in silence.
// Now a bridge that leads a place refuses another place aloud — iskron_stand and
// bare connect/mint/register alike — unless the move is deliberate (take=true);
// the same place with take=true works as before, and a revoke of another place
// never touches the one the bridge holds.
test("a bridge leading a place refuses another role or name without take=true, keeps its socket and binding; take=true on the same place still works; revoke of another place leaves it alone", async (t) => {
  const { fake, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  const said = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const refused = (r, what) => {
    assert.ok(r.result?.isError, `${what} must be refused: ${said(r)}`);
    assert.match(said(r), /уже ведёт место proba--931--nks-dev/, what);
    assert.match(said(r), /take=true/, what);
  };
  // Another name, another role, a bare connect and a bare register under another place.
  refused(
    await bridge.call("tools/call", 5, {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: "vtoraya" },
    }),
    "iskron_stand under another name",
  );
  refused(
    await bridge.call("tools/call", 6, {
      name: "iskron_stand",
      arguments: { realm: "@nks/nks-dev", karta: "#48", name: "proba" },
    }),
    "iskron_stand under another role",
  );
  const mcpBefore = fake.state.counts.mcp;
  refused(
    await bridge.call("tools/call", 7, {
      name: "iskron_channel",
      arguments: { ...CONNECT, name: "vtoraya" },
    }),
    "a bare connect under another name",
  );
  refused(
    await bridge.call("tools/call", 8, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", action: "register", karta: 48, name: "proba" },
    }),
    "a bare register under another role",
  );
  assert.equal(fake.state.counts.mcp, mcpBefore, "a refused call never reaches the server");
  assert.equal(fake.state.counts.connect, 1, "no new place was taken");
  assert.equal(fresh().length, 0, "the parent's socket is untouched");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".key")),
    "the parent's key file stays",
  );
  // The binding is still the parent's: the busy line goes to proba.
  const st = await bridge.call("tools/call", 9, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "родитель" },
  });
  assert.match(said(st), /занятость proba--931--nks-dev/, said(st));
  // The same place — register and stand with take=true — as before.
  const same = await bridge.call("tools/call", 10, {
    name: "iskron_channel",
    arguments: { realm: "@nks/nks-dev", action: "register", karta: "#931", name: "proba" },
  });
  assert.ok(
    !same.result?.isError,
    `the same place spelled differently is not another place: ${said(same)}`,
  );
  const take = await bridge.call("tools/call", 11, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", take: true },
  });
  assert.ok(!take.result?.isError, said(take));
  assert.match(said(take), /connect по take/, said(take));
  assert.equal(fake.state.counts.connect, 2);
  await waitFor(() => fresh().length === 1, "the socket rotated by take on the same place");
  // A revoke of ANOTHER place passes through and leaves ours alone.
  await fake.control({ places: [{ karta: 931, name: "chuzhoe" }] });
  const rv = await bridge.call("tools/call", 12, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "revoke", karta: 931, standing: "chuzhoe" },
  });
  assert.ok(!rv.result?.isError, said(rv));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".key")),
    "revoking another place must not release ours",
  );
  // A deliberate move to another name: take=true — the old place is left, the new one held.
  const moved = await bridge.call("tools/call", 13, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "vtoraya", take: true },
  });
  assert.ok(!moved.result?.isError, said(moved));
  assert.match(said(moved), /watchdog vtoraya--931--nks-dev/);
  assert.equal(fake.state.counts.connect, 3);
});

// Sentinel roles and sloppy spelling must not slip past the one-standing rule:
// `agent` is one's own role by the surface's word, `me` is the human's — a
// connect as `me` under another name is another place; a karta with spaces or
// «#» and a name with a trailing space are the same place, not another.
test("one standing per bridge sees through sentinels and spelling: «me» is another role even under the same name, «agent» and a padded karta or name are the same place — and after each the bridge still knows its own socket", async (t) => {
  const { fake, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const known = new Set(fake.state.ws);
  const said = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const channel = (id, args) =>
    bridge.call("tools/call", id, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", ...args },
    });
  let id = 4;
  // The falsifier of the whole rule: after any call the rule let through, the
  // bridge must still recognize its own socket — «register», with the block.
  const stillOwn = async (after) => {
    const st = await bridge.call("tools/call", ++id, {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: "proba" },
    });
    assert.ok(!st.result?.isError, `${after}: ${said(st)}`);
    assert.match(said(st), /сокет уже держит этот мост — register/, `${after}: ${said(st)}`);
    assert.match(said(st), /\[iskron-bridge\]/, `${after}: the block is lost`);
    assert.equal(fake.state.counts.connect, 1, `${after}: the place must not be rotated`);
  };
  const asMe = await channel(++id, { action: "connect", karta: "me", name: "vtoraya" });
  assert.ok(
    asMe.result?.isError,
    `connect as «me» under another name must be refused: ${said(asMe)}`,
  );
  assert.match(said(asMe), /уже ведёт место proba--931--nks-dev/);
  // «me» is the human's role, not the standing's: the same name under it is another place.
  const meSame = await channel(++id, { action: "register", karta: "me", name: "proba" });
  assert.ok(meSame.result?.isError, `register as «me» under the same name: ${said(meSame)}`);
  assert.match(said(meSame), /то же имя под другой ролью/i, "the advice names the difference");
  const padded = await channel(++id, { action: "connect", karta: " 931", name: "vtoraya" });
  assert.ok(padded.result?.isError, `a padded karta must not slip past: ${said(padded)}`);
  assert.doesNotMatch(said(padded), /то же имя/i, "a different name gets no «same name» advice");
  assert.equal(fake.state.counts.connect, 1, "no place was taken");
  assert.equal(
    [...fake.state.ws].filter((x) => !known.has(x)).length,
    0,
    "the socket is untouched",
  );
  await stillOwn("after the refusals");
  for (const args of [
    { action: "register", karta: "agent", name: "proba" },
    { action: "register", karta: "#931 ", name: "proba " },
  ]) {
    const r = await channel(++id, args);
    assert.ok(!r.result?.isError, `${JSON.stringify(args)} names the same place: ${said(r)}`);
    await stillOwn(`after ${JSON.stringify(args)}`);
  }
});

// The binding is written normalized, the same form the key and the rule compare
// by: a bridge that stood through a padded connect keys its place as the board
// prints it, and a bridge that stood as «me» treats the numeric role as another.
test("a padded connect keys the place as the board prints it; a bridge standing as «me» refuses the numeric role and keeps «me» after a register as «agent»", async (t) => {
  const fake = await startFakeNks();
  const dir = mkdtempSync(join(tmpdir(), "iskron-standing-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const said = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const pending = await bridge.call("initialize", 1, INIT);
  await (await fetch(authorizeUrlIn(pending.error?.message), { redirect: "follow" })).text();
  await waitFor(() => readdirSync(dir).some((f) => f.endsWith(".json")), "the grant");
  assert.ok((await bridge.call("initialize", 2, INIT)).result);
  const standings = join(dir, "standings");
  const keys = () =>
    readdirSync(standings)
      .filter((f) => f.endsWith(".key"))
      .map((f) => readFileSync(join(standings, f), "utf8").trim());
  const c = await bridge.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "connect", karta: " #931 ", name: "proba " },
  });
  assert.ok(!c.result?.isError, said(c));
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  assert.deepEqual(keys(), ["proba--931--nks-dev"], "the key carries the normalized place");
  const own = await bridge.call("tools/call", 4, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.match(said(own), /сокет уже держит этот мост — register/, said(own));
  assert.match(said(own), /\[iskron-bridge\]/);
  assert.equal(fake.state.counts.connect, 1);
  // Now as «me»: revoke frees the bridge, a connect as the human's role leads a
  // place keyed by the sentinel, and the numeric role is another place.
  await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "revoke", karta: 931, standing: "proba" },
  });
  await waitFor(() => keys().length === 0, "the place to be released");
  const me = await bridge.call("tools/call", 6, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "connect", karta: "me", name: "mine" },
  });
  assert.ok(!me.result?.isError, said(me));
  await waitFor(() => keys().length === 1, "the socket as «me»");
  assert.deepEqual(keys(), ["mine--me--nks-dev"]);
  const numeric = await bridge.call("tools/call", 7, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "mine" },
  });
  assert.ok(numeric.result?.isError, `a numeric role is not «me»: ${said(numeric)}`);
  assert.match(said(numeric), /уже ведёт место mine--me--nks-dev/);
  const agent = await bridge.call("tools/call", 8, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "register", karta: "agent", name: "mine" },
  });
  assert.ok(!agent.result?.isError, `«agent» is one's own role: ${said(agent)}`);
  assert.deepEqual(
    keys(),
    ["mine--me--nks-dev"],
    "the sentinel «agent» does not rewrite the remembered role",
  );
  const again = await bridge.call("tools/call", 9, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "mine" },
  });
  assert.ok(again.result?.isError, `still refused after the «agent» register: ${said(again)}`);
  assert.equal(fake.state.counts.connect, 2, "nothing was rotated");
});

// Two real bridges of one auth dir on two places against one fake: the board
// reads both listening, and a revoke of one place closes only its socket — the
// other bridge keeps its place, its socket and its key file.
test("two bridges on two places: the board reads both listening, and revoking one leaves the other's socket and place alone", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the first socket");
  const said = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const st = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "vtoraya" },
  });
  assert.ok(!st.result?.isError, `a fresh bridge leads no place — no take needed: ${said(st)}`);
  await waitFor(() => fake.state.ws.size === 2, "two sockets, one per place");
  const board = said(
    await bridge.call("tools/call", 5, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", action: "list" },
    }),
  );
  assert.match(board, /@tester:proba — [^\n]*слушает/, board);
  assert.match(board, /@tester:vtoraya — [^\n]*слушает/, board);
  assert.equal(readdirSync(standings).filter((f) => f.endsWith(".key")).length, 2);
  const rv = await second.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "revoke", karta: 931, standing: "vtoraya" },
  });
  assert.ok(!rv.result?.isError, said(rv));
  // The fake keeps a closed socket in its set until both ends finish: the
  // socket is judged by the board (the fake reads it off the socket per place)
  // and by what the first bridge was told, not by the set's size.
  await waitFor(
    () =>
      !readdirSync(standings)
        .filter((f) => f.endsWith(".key"))
        .some((f) => readFileSync(join(standings, f), "utf8").trim() === "vtoraya--931--nks-dev"),
    "the revoked place's key to go",
  );
  // The sign that the revoke has run its course: the revoking bridge logs its
  // own quiet release — only then is the neighbour's silence evidence.
  await waitFor(
    () => /standing revoked by this session/.test(second.stderr),
    "the revoke to settle",
  );
  assert.ok(
    !bridge.notifications.some((n) => ["dead", "released"].includes(n.params?.data?.kind)),
    "the first bridge is neither dead nor released by a neighbour's revoke",
  );
  const keys = readdirSync(standings)
    .filter((f) => f.endsWith(".key"))
    .map((f) => readFileSync(join(standings, f), "utf8").trim());
  assert.deepEqual(keys, ["proba--931--nks-dev"], "only the revoked place's key is gone");
  const after = said(
    await bridge.call("tools/call", 6, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", action: "list" },
    }),
  );
  assert.match(after, /@tester:proba — [^\n]*слушает/, after);
  assert.ok(!/@tester:vtoraya/.test(after), "the revoked place is off the board");
});

// ── room kinds for watchdogs (#5851): the bridge batches, an interrupt flushes first ──

const sendRoom = (fake, frame) => fake.control({ ws_send: JSON.stringify(frame) });

test("room kinds under the Monitor watchdog: progress and said defer wait; closing brings the batch first, then itself", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, progress());
  await sendRoom(fake, said("defer", 63));
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(!wd.out.includes("пробы зелёные"), `progress printed before the window:\n${wd.out}`);
  assert.ok(!wd.out.includes("стопкой defer"), `said defer printed before the window:\n${wd.out}`);
  await sendRoom(fake, closing());
  await waitFor(() => wd.out.includes("ты можешь возразить"), "closing to be printed");
  const flat = wd.out.replace(/\n/g, " ");
  const batch = flat.indexOf("Дело: кадров 2");
  const prog = flat.indexOf("[tests] пробы зелёные = ok; без сети");
  const close = flat.indexOf("предлагает закрыть дело");
  assert.ok(batch >= 0 && prog > batch, `the batch head and progress words:\n${wd.out}`);
  assert.ok(close > prog, `the batch goes out before closing, not after:\n${wd.out}`);
  assert.ok(flat.indexOf("стопкой defer") < close, "said defer rides in the batch, before closing");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a room batch alone goes out after its window; an unknown kind batches and is written to the bridge log", async (t) => {
  const { fake, dir, key, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const sent = Date.now();
  await sendRoom(fake, unknownKind());
  await sendRoom(fake, progress(45));
  await waitFor(
    () => bridge.stderr.includes("род weather мосту неизвестен"),
    "the bridge log line",
  );
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(!wd.out.includes("мосту неизвестен"), `an unknown kind interrupted:\n${wd.out}`);
  await waitFor(() => wd.out.includes("пробы зелёные"), "the batch after the window", 8000);
  assert.ok(Date.now() - sent >= 1800, "the batch waited for its window");
  assert.match(wd.out, /Дело: кадров 2/);
  assert.match(wd.out, /род weather мосту неизвестен/);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// auto — a platform record to the parent about its child case (#5893 §4.2, #4925).
test("an auto record about a child case batches in words and leaves no unknown-kind line in the bridge log", async (t) => {
  const { fake, dir, key, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const sent = Date.now();
  await sendRoom(fake, auto("child_closed"));
  await waitFor(() => wd.out.includes("дочернее дело #12 закрыто"), "the batch", 8000);
  assert.ok(Date.now() - sent >= 1800, "auto waited for the batch window, not interrupting");
  assert.match(wd.out, /Дело: кадров 1/);
  assert.ok(!wd.out.includes("неизвестен"), `auto printed as unknown:\n${wd.out}`);
  assert.ok(
    !bridge.stderr.includes("неизвестен"),
    `unknown-kind line in the log:\n${bridge.stderr}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("said with stack interrupt reaches the Monitor watchdog at once", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, said("interrupt", 62));
  await waitFor(() => wd.out.includes("стопкой interrupt"), "said interrupt printed", 3000);
  assert.match(wd.out, /слово от Алексей \(@aleksei:probe\)/);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// api 0.89.6 invites a ROLE: the key carries the role node id, the line's karta its seq.
test("an invite to my role reaches the Monitor watchdog at once; an invite to another role and a withdraw wait in the batch", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, roleInvite(69, MY_KARTA + 1));
  await sendRoom(fake, withdraw(71));
  await sendRoom(fake, roleInvite(68));
  await waitFor(() => wd.out.includes("room-msg-68"), "the invite to my role printed", 3000);
  assert.match(wd.out, /Алексей \(@aleksei:probe\) зовёт 🚚 Поставщик плитки в дело/);
  const flat = wd.out.replace(/\n/g, " ");
  assert.ok(
    flat.indexOf("Дело: кадров 2") >= 0 &&
      flat.indexOf("room-msg-71") < flat.indexOf("room-msg-68"),
    `the other role's invite and the withdraw ride in the batch, flushed first:\n${wd.out}`,
  );
  assert.match(wd.out, /приглашение отозвано, отзывает Алексей/);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A batch flush is a delivery: the exit watchdog prints the whole batch and leaves on it.
test("the exit watchdog leaves at the batch flush with the whole batch, not on its first frame", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, progress(46));
  await sendRoom(fake, progress(48));
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(wd.proc.exitCode, null, `the exit watchdog left before the window: ${wd.out}`);
  const r = await wd.done;
  assert.equal(r.exit, 0, `the flush must wake: ${wd.err}`);
  assert.ok(
    wd.out.includes("room-msg-46") && wd.out.includes("room-msg-48"),
    `the whole batch is handed over:\n${wd.out}`,
  );
});

test("the exit watchdog: closing flushes the batch, the watchdog leaves on it, closing comes on the next arm", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => first.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, progress(49));
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(first.proc.exitCode, null, `the exit watchdog left on a batch frame: ${first.out}`);
  await sendRoom(fake, closing());
  const r1 = await first.done;
  assert.equal(r1.exit, 0);
  assert.ok(first.out.includes("room-msg-49"), `the batch goes first:\n${first.out}`);
  assert.ok(!first.out.includes("room.closing"), `closing waits for the next arm:\n${first.out}`);
  const second = runClient("watchdog-exit", dir, key, 8000);
  const r2 = await second.done;
  assert.equal(r2.exit, 0, `closing must wake the next arm: ${second.err}`);
  assert.match(second.out, /room\.closing/);
  assert.ok(!second.out.includes("room-msg-49"), "the batch is not handed twice");
});

test("a full room batch goes out at once, before its window: nothing is dropped", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "30000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  for (let i = 0; i < 21; i++) await sendRoom(fake, progress(200 + i));
  await waitFor(() => wd.out.includes("room-msg-219"), "the full batch", 5000);
  assert.match(wd.out, /Дело: кадров 20/);
  for (let i = 0; i < 20; i++) assert.ok(wd.out.includes(`room-msg-${200 + i}`), `frame ${i}`);
  assert.ok(!wd.out.includes("room-msg-220"), "the 21st starts the next batch");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("watchdog-codex: progress waits; closing puts the batch into the thread first, then itself", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 20_000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-room",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the watchdog to attach");
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start");
  await sendRoom(fake, progress(47));
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(turns().length, 0, "progress must not enter the thread before the window");
  await sendRoom(fake, closing());
  await waitFor(() => turns().length === 2, "the batch and closing in the thread");
  const [first, second] = turns().map((c) => c.params.input[0].text);
  assert.match(first, /\[tests\] пробы зелёные = ok/);
  assert.match(second, /предлагает закрыть дело/);
  assert.match(
    second,
    /ты можешь возразить — iskron_case\(action="object", in_reply_to=50\) \(прежнее имя iskron_room\)/,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Today's production (api 0.86.0) sends no event_kind: every old room frame, whatever its
// kind or stack, and every non-room frame reach a watchdog at once, as on main. Guards of
// main's behaviour — green on main by design.
const LEGACY_AT_ONCE = () => [
  [directWord(), "прямое слово соседа"],
  [graphPosed(), "graph-1"],
  [legacyRoom("text", "interrupt", 71), "прежний род text со стопкой interrupt"],
  [legacyRoom("direct", "interrupt", 75), "прежний род direct"],
  [legacyRoom("digest", "defer", 76), "прежний род digest"],
  [legacyRoom("auto", "defer", 74), "прежний род auto"],
];

test("room kinds leave the Monitor watchdog's other frames and the old room shape as on main: all print at once", async (t) => {
  const { fake, dir, key, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const cases = LEGACY_AT_ONCE();
  for (const [frame] of cases) await sendRoom(fake, frame);
  await waitFor(() => cases.every(([, mark]) => wd.out.includes(mark)), "all at once", 3000);
  assert.ok(!wd.out.includes("Дело: кадров"), `no batch without event_kind:\n${wd.out}`);
  assert.ok(!bridge.stderr.includes("мосту неизвестен"), "no unknown-kind line for old kinds");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("room kinds leave the exit watchdog's other frames and the old room shape as on main: each wakes it", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  for (const [frame, mark] of LEGACY_AT_ONCE()) {
    const wd = runClient("watchdog-exit", dir, key, 8000);
    await waitFor(() => wd.err.includes("слушаю стояние"), "the exit watchdog to attach");
    await sendRoom(fake, frame);
    const r = await wd.done;
    assert.equal(r.exit, 0, `${frame.id} must wake: ${wd.err}`);
    assert.ok(wd.out.includes(mark), wd.out);
  }
});

test("room kinds leave the Codex thread's other frames and the old room shape as on main: all enter at once", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = mkdtempSync("/tmp/cxd-");
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 20_000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-legacy",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the watchdog to attach");
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start")
      .map((c) => c.params.input[0].text);
  const cases = LEGACY_AT_ONCE();
  for (const [frame] of cases) await sendRoom(fake, frame);
  await waitFor(() => turns().length === cases.length, "every frame at once", 3000);
  turns().forEach((text, i) => assert.ok(text.includes(cases[i][1]), text));
  wd.proc.kill("SIGKILL");
  await wd.done;
});
