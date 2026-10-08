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
//
// The suite runs as one file per subject (standing-*.test.mjs): each sets
// ISKRON_STANDING_PART before importing this module, and only the tests under
// its `part(...)` mark register — every subject within the per-file time limit.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeCodex } from "./fake-codex.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import {
  ack,
  addressed,
  addressedBody,
  addressedInFlight,
  addressedLeft,
  answer,
  ask,
  askWithdrawn,
  auto,
  body as bodyFrame,
  bodyAborted,
  bodyLapsed,
  BORIS,
  closing,
  directWord,
  graphPosed,
  joinedMember,
  leftExpired,
  legacyRoom,
  ME,
  MY_KARTA,
  myAnswer,
  nodeBound,
  nodeOp,
  progress,
  reask,
  replyInFlight,
  roleInvite,
  roomFrame,
  said,
  saidInFlight,
  unknownKind,
  withdraw,
  withheld,
} from "./room-frames.mjs";

// Часть свода, которую регистрирует этот файл-предмет (шапка выше); без неё — весь свод.
const ONLY = process.env.ISKRON_STANDING_PART ?? "";
let current = "core";
const part = (name) => void (current = name);
const test = (...args) => (!ONLY || ONLY === current ? nodeTest(...args) : undefined);

// Чем запускать поставку: node по умолчанию; ISKRON_NODE подставляет другой рантайм
// (например, `opencode` под BUN_BE_BUN=1 — Bun, встроенный в OpenCode).
const NODE = process.env.ISKRON_NODE || process.execPath;

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "standing-probe", version: "0" },
};
const CONNECT = { realm: "nks-dev", action: "connect", karta: 931, name: "proba" };

// --- a harness that also keeps the bridge's notifications ------------------
function startBridge(serverUrl, authDir, extraEnv = {}) {
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    // ISKRON_BRIDGE_DAEMON=0 — полный мост в процессе: эти пробы о нём, не о шве.
    env: { ...process.env, ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_BRIDGE_DAEMON: "0", ...extraEnv },
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
function runClient(sub, dir, key, timeoutMs = 8000, extraEnv = {}, flags = ["--auth-dir", dir]) {
  const proc = spawn(NODE, [FILE, sub, ...(key ? [key] : []), ...flags], {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  // Строки stdout с отметкой прихода: паузы между событиями Monitor меряются по ним.
  const lines = [];
  let part = "";
  proc.stdout.on("data", (c) => {
    out += c;
    const at = Date.now();
    const got = (part + c).split("\n");
    part = got.pop();
    for (const s of got) lines.push({ at, s });
  });
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
    get lines() {
      return lines;
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
    text.includes("iskron_stand(realm, status)"),
    "the block must name the status call, not a file — iskron_stand, the bridge's own (#6509)",
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

// Своё close или revoke отпускает место словом моста (released), не уходом:
// сторож говорит то же слово одной строкой и выходит нулём, без общей тревоги
// «мост отпустил стояние или ушёл» и без ненулевого кода (#6638).
/**
 * Дом подставного Codex — под TMPDIR пробы, убирается после неё. Имя короткое: путь
 * сокета app-server-control под ним должен влезть в предел unix-сокета (104 у macOS).
 */
function codexHome(t) {
  const home = mkdtempSync(join(tmpdir(), "cxd-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

async function codexDoor(t, opts = {}) {
  const home = codexHome(t);
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(
    join(home, "app-server-control", "app-server-control.sock"),
    log,
    opts,
  );
  t.after(() => door.stop());
  return { CODEX_HOME: home, CODEX_THREAD_ID: "thread-own" };
}
const OWN_WORD = {
  ru: { close: /канал закрыт своим close этой сессии/, revoke: /снято своим revoke/ },
  en: {
    close: /the channel was closed by this session's own close/,
    revoke: /revoked by this session/,
  },
};
const OWN_ARGS = {
  close: { action: "close", realm: "nks-dev" },
  revoke: { action: "revoke", realm: "nks-dev", karta: 931, standing: "proba" },
};
for (const lang of ["ru", "en"])
  for (const sub of ["watchdog", "watchdog-exit", "watchdog-codex"])
    for (const action of ["close", "revoke"])
      test(`${sub} after one's own ${action} on the ${lang} surface: the bridge's word in one line, exit 0, no alarm`, async (t) => {
        const env = { ISKRON_BRIDGE_LANG: lang };
        const { fake, dir, bridge, key } = await connected(t, { env });
        await waitFor(() => fake.state.ws.size === 1, "the socket");
        const extra = sub === "watchdog-codex" ? await codexDoor(t) : {};
        const wd = runClient(sub, dir, key, 10_000, { ...env, ...extra });
        await waitFor(
          () => /слушаю стояние|listening on standing/.test(wd.out + wd.err),
          "the watchdog to attach",
        );
        const reply = await bridge.call("tools/call", 7, {
          name: "iskron_channel",
          arguments: OWN_ARGS[action],
        });
        assert.ok(!reply.result?.isError, JSON.stringify(reply));
        const r = await wd.done;
        const all = wd.out + wd.err;
        assert.equal(r.exit, 0, `one's own ${action} is not a lost bridge:\n${all}`);
        assert.doesNotMatch(all, /ДЕЛАТЕЛЬ|DOER/, `no alarm on one's own ${action}:\n${all}`);
        const said = all.split("\n").filter((l) => OWN_WORD[lang][action].test(l));
        assert.equal(said.length, 1, `the bridge's word in one line:\n${all}`);
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
  const home = codexHome(t);
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
  assert.match(turn.params.input[0].text, /^@alari:sosед\n/);
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
  const home = codexHome(t);
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
  const home = codexHome(t);
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
  const home = codexHome(t);
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
  await waitFor(() => wd.out.includes("и ещё строка"), "the frame to reach the watchdog");
  // A re-read or a cut body is said in the first line's tail («тело: …», #6081).
  assert.ok(!wd.out.includes("тело: "), `a whole body re-read or marked truncated:\n${wd.out}`);
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

// 4000 is an eviction, not a dead token (the platform's own word): another holder
// has the place, and reopening the same address would evict it in turn (seen live:
// ping-pong of two bridges of one session after a daemon handover). The bridge
// yields aloud at once and never reopens the taken address; taking it back is the
// human's (#5012, #5033, #6550). It is not left deaf either: it stands beside on
// name.N with hearing by itself, and the busy line goes from there (#6706).
test("an eviction yields aloud at once, never reopens the taken address, stands beside, and the busy line still goes out", async (t) => {
  const { fake, dir, bridge, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  // The fake keeps a closed socket in its set until both ends finish: count
  // sockets the bridge OPENED, not those the fake still holds.
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((s) => !known.has(s));
  await fake.control({ ws_close: 4000 });
  assert.ok(
    !bridge.notifications.some((n) => n.params?.data?.kind === "dead"),
    "an eviction must not be announced as a dead token",
  );
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
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "resumed"),
    "the word about the seat beside",
  );
  await new Promise((r) => setTimeout(r, 2500));
  const taken = new Set([...known].map((s) => fake.state.wsAddress.get(s)));
  assert.equal(
    fresh().filter((s) => taken.has(fake.state.wsAddress.get(s))).length,
    0,
    "after yielding the bridge must not reopen the taken address",
  );
  assert.equal(fresh().length, 1, "one socket — the seat beside");
  // A watchdog re-armed after that listens to the seat beside, not to nothing.
  const beside = key.replace(/^proba--/, "proba.2--");
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".key")),
    "the standing is kept: the key file stays",
  );
  const again = runClient("watchdog", dir, beside, 6000);
  await waitFor(() => again.out.includes("слушаю стояние"), "the re-armed watchdog to attach");
  again.proc.kill("SIGKILL");
  await again.done;
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
  await waitFor(
    () => wd.out.includes("роль #48 (@alari:sosед)"),
    "the frame to reach the watchdog",
  );
  await new Promise((r) => setTimeout(r, 300));
  const lines = wd.out.split("\n");
  assert.ok(
    lines.some((l) => l.startsWith("роль #48 (@alari:sosед)")),
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
  // Строка моста и строка writing в карте моментов двери iskron — одна строка.
  const door = readFileSync(join(HERE, "..", "..", "skills", "iskron", "SKILL.md"), "utf8");
  const row = door.match(/^\| перед `iskron_add_\*`[^|]*\| \*\*writing\*\*: (.+) \|$/m)?.[1];
  assert.ok(row, "the door's moment map lacks the writing row");
  assert.ok(
    byName.iskron_add_vimarsha.includes(`Момент скилла writing: ${row}`),
    "the bridge's writing-moment line drifted from the door's moment map",
  );
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
  // hello — доказательство держания, не слово делателю: в счёт не входит (#5671).
  assert.match(again.out, /слушаю стояние \S+ \(1 кадр задним числом\)/, again.out);
  again.proc.kill("SIGKILL");
  await again.done;
});

// #5671: every reopen of the socket leaves its hello in the ring, and a re-armed
// watchdog used to count them all as frames «back-dated» — a count that grew from
// arming to arming with nothing for the doer to read. Hello replays once, the
// latest; the count names only the frames the watchdog will print.
test("a re-armed watchdog counts back-dated only what it prints: the hellos of reopens neither count nor pile up", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  for (let i = 0; i < 2; i++) {
    const before = new Set(fake.state.ws);
    await fake.control({ ws_close: 1001 }); // the service drops the socket: the bridge reopens, a new hello lands in the ring
    await waitFor(
      () => [...fake.state.ws].some((s) => !before.has(s)),
      `reopen ${i + 1} of the socket`,
    );
  }
  await new Promise((r) => setTimeout(r, 300));
  for (let arming = 1; arming <= 2; arming++) {
    const wd = runClient("watchdog", dir, key, 6000);
    await waitFor(() => wd.out.includes("слушаю стояние"), `arming ${arming} to attach`);
    await new Promise((r) => setTimeout(r, 400));
    assert.doesNotMatch(
      wd.out,
      /задним числом/,
      `arming ${arming}: only hellos — no call to read:\n${wd.out}`,
    );
    assert.equal(
      (wd.out.match(/"type":"hello"/g) ?? []).length,
      1,
      `arming ${arming}: one hello, the latest — proof of holding, not a pile:\n${wd.out}`,
    );
    wd.proc.kill("SIGKILL");
    await wd.done;
  }
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "m-9", body: "слово мимо сторожа" }),
  });
  await new Promise((r) => setTimeout(r, 300));
  const wd = runClient("watchdog", dir, key, 6000);
  await waitFor(() => wd.out.includes("слово мимо сторожа"), "the unseen word");
  await waitSeen(standings, "m-9");
  assert.match(wd.out, /слушаю стояние \S+ \(1 кадр задним числом\)\n/, wd.out);
  assert.ok(
    wd.out.indexOf("слушаю стояние") < wd.out.indexOf("слово мимо сторожа"),
    `the listening line comes first:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// The listening line waits for the ring the bridge named; the watchdog's last word must
// not wait behind it. A door gone (or a dead token) before the ring is out is loud: the
// listening line, the alarm, exit 1 — never a silent exit 0.
for (const [what, after] of [
  ["the door closes", (sock) => setTimeout(() => sock.destroy(), 100)],
  [
    "a dead token comes",
    (sock) => sock.write(JSON.stringify({ kind: "dead", code: 4001, text: "токен мёртв" }) + "\n"),
  ],
]) {
  test(`${what} before the ring the bridge named is out: the watchdog says so and exits 1`, async (t) => {
    const { socketPathOf } = await import("../shared/standings.ts");
    const dir = mkdtempSync(join(tmpdir(), "iskron-ring-"));
    const key = "ring--931--nks-dev";
    const path = socketPathOf(dir, key);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const door = createServer((sock) => {
      sock.write(JSON.stringify({ kind: "attached", key, buffered: 3 }) + "\n");
      sock.write(JSON.stringify({ kind: "frame", raw: '{"type":"hello"}' }) + "\n");
      after(sock);
    });
    await new Promise((r) => door.listen(path, r));
    t.after(() => door.close());
    const wd = runClient("watchdog", dir, key, 6000);
    const { exit } = await wd.done;
    assert.equal(exit, 1, `exit ${exit}:\n${wd.out}`);
    assert.match(wd.out, /слушаю стояние ring--931--nks-dev\n\{"type":"hello"\}\n/, wd.out);
    assert.match(wd.out, /ДЕЛАТЕЛЬ|токен мёртв/, wd.out);
  });
}

// A handover inside the ring's wait re-attaches: the listening line of the first
// attach still waits in the queue, and it says its own ring — not the next one's.
test("a handover before the ring is out: each listening line carries its own ring's hello", async (t) => {
  const { socketPathOf } = await import("../shared/standings.ts");
  const dir = mkdtempSync(join(tmpdir(), "iskron-ring-"));
  const key = "ring--931--nks-dev";
  const path = socketPathOf(dir, key);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let n = 0;
  const door = createServer((sock) => {
    const i = ++n;
    sock.write(JSON.stringify({ kind: "attached", key, buffered: i === 1 ? 2 : 1 }) + "\n");
    sock.write(JSON.stringify({ kind: "frame", raw: `{"type":"hello","n":${i}}` }) + "\n");
    if (i === 1) {
      sock.write(JSON.stringify({ kind: "handover" }) + "\n");
      setTimeout(() => sock.destroy(), 50);
    } else setTimeout(() => sock.destroy(), 300);
  });
  await new Promise((r) => door.listen(path, r));
  t.after(() => door.close());
  const wd = runClient("watchdog", dir, key, 6000);
  await wd.done;
  assert.match(wd.out, /слушаю стояние ring--931--nks-dev\n\{"type":"hello","n":1\}\n/, wd.out);
  assert.match(wd.out, /слушаю стояние ring--931--nks-dev\n\{"type":"hello","n":2\}\n/, wd.out);
});

// A bridge raised anew under a place a previous bridge of this auth dir held
// (plugin restart, /mcp reconnect) takes the place back from disk — the same
// address, no connect; a revoke or a dead token forgets the record (#5061).
test("a bridge restarted under a held place resumes it from disk: same address, no connect, the old busy line not published anew", async (t) => {
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
  // Окно платформы, пока доска ещё читает мёртвого «слушающим», — без «только
  // register» (#6706): stand.test.mjs, «a stopped holder listening».
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

// #6649: место держалось дольше срока записи без новой занятости, и плагин
// перезапустили — SIGTERM моста. Срок записи — простой места без сокета: он
// считается от этого ухода, иначе запись уходила просроченной и место с диска
// не возвращалось, хотя у платформы оно живо.
test("a place held longer than the record's life without a new busy line survives a SIGTERM: the record is renewed at leaving and the next bridge resumes the place", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const st0 = await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "status", text: "до ухода" },
  });
  assert.ok(!st0.result?.isError, JSON.stringify(st0));
  const path = join(
    standings,
    readdirSync(standings).find((f) => f.endsWith(".hold")),
  );
  const rec = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...rec, at: Date.now() - 7 * 3600 * 1000 }));
  // A neighbour bridge opening its door sweeps the standings: a held place's record stays.
  const other = startBridge(fake.mcpUrl, dir);
  t.after(() => other.stop());
  assert.ok((await other.call("initialize", 1, INIT)).result);
  const near = await other.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "sosed" },
  });
  assert.ok(!near.result?.isError, JSON.stringify(near));
  assert.ok(existsSync(path), "a neighbour's sweep leaves the record of a held place");
  bridge.proc.kill("SIGTERM"); // the plugin restarts and asks its bridges to go
  await waitFor(
    () => bridge.proc.exitCode !== null || bridge.proc.signalCode !== null,
    "the bridge to exit",
  );
  assert.ok(existsSync(path), "the record outlives a SIGTERM");
  const kept = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(Date.now() - kept.at < 60_000, `the record's life counts from the leaving: ${kept.at}`);
  assert.equal(kept.status, "до ухода", "the busy line stays in the record");
  assert.equal(kept.url, rec.url, "the same address");

  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });
  const connects = fake.state.counts.connect;
  const st = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const said = (st.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!st.result?.isError, said);
  assert.match(said, /возврат места с диска после перезапуска моста/, said);
  assert.equal(fake.state.counts.connect, connects, "the place is resumed, not rotated");
});

// #147 [140] 4: a session that left its seat (socket closed, address kept) and then goes
// renews the record with the socket's last life, not leaving the old at behind.
test("a session gone after leaving its seat renews the hold record with the socket's last life", async (t) => {
  const { fake, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const left = await bridge.call("tools/call", 4, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  assert.ok(!left.result?.isError, JSON.stringify(left));
  const path = join(
    standings,
    readdirSync(standings).find((f) => f.endsWith(".hold")),
  );
  const rec = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...rec, at: Date.now() - 5 * 3600 * 1000 }));
  bridge.proc.kill("SIGTERM");
  await waitFor(
    () => bridge.proc.exitCode !== null || bridge.proc.signalCode !== null,
    "the bridge to exit",
  );
  const kept = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(Date.now() - kept.at < 60_000, `the record's at is the socket's last life: ${kept.at}`);
  assert.equal(kept.left, true, "still a left seat");
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
  assert.match(said, /встаю рядом на proba\.2/, said);
  await fake.control({ ws_close: 4001 });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "dead"),
    "the dead token to reach the harness",
  );
  // 4001 too is answered by connect: mint answers 409 once the channel is back (#5189).
  const dead = bridge.notifications.find((n) => n.params?.data?.kind === "dead").params.data.text;
  assert.match(dead, /зови connect/, dead);
  assert.doesNotMatch(dead, /mint/, dead);
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

part("hearing");
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
  // A platform wake opens a window of its own; the neighbour's word next to it is a direct
  // word — it never rides in a wake batch: it comes alone and whole.
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
    ["wake"],
  );
  assert.ok(frames().includes("peer"), "the neighbour's word as its own notification");
  assert.match(backlogs()[1].params.data.text, /Прямых слов 1 — не здесь/);
  assert.match(backlogs()[1].params.data.text, /платформа — побудка/);
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
  // Each frame outside a case batch is its own Monitor event, a pause apart: the pause
  // is shortened here — this probe is about marks, not pacing.
  const wd = runClient("watchdog", dir, key, 60_000, { ISKRON_WATCHDOG_ALONE_MS: "5" });
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
  const home = codexHome(t);
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
  const home = codexHome(t);
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
  // Место уже держит этот мост, и вызов со status — только занятость (#6509); каталог
  // всё равно ложится в запись держания.
  assert.match(said, /^занятость @tester:proba: на вахте/, said);
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
  // Другой каталог и другая сессия: не её место. Та же сессия из другого каталога —
  // перенос сессии, её место (проба ниже).
  const wrong = await second.call("iskron/resume", 2, {
    cwd: "/nowhere/else",
    session: "ses-chuzhaya",
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
  // The same session returns: the busy line is its own word, and it comes back (#6017).
  assert.match(back.result.word, /занятость возвращена: на вахте/);
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
  assert.equal(fake.state.counts.status_posts, posts + 1, "the session's own busy line is back");
  assert.equal(fake.state.status, "на вахте");
  const again = await second.call("iskron/resume", 4, { cwd, session: "ses-vahta" });
  assert.equal(again.result?.resumed, true, "a held place answers «held», not a second resume");
  assert.match(again.result.word, /уже держит/);
  assert.equal(fresh().length, 1, "no second socket for a place already held");
  assert.match(
    readFileSync(join(dir, "standings.log"), "utf8"),
    /resumed-from-disk proba--931--nks-dev: pending 2/,
  );
});

// Запись держания прежнего моста несёт отправленную строку; сервер кладёт её иной —
// слово возврата называет doing ответа, не строку записи (дело №234 [139]).
test("iskron/resume names the busy line the server accepted, not the one in the hold record", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-session-dir-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-norm" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd, status: "на вахте" },
  });
  const hold = join(
    standings,
    readdirSync(standings).find((f) => f.endsWith(".hold")),
  );
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  const rec = JSON.parse(readFileSync(hold, "utf8"));
  writeFileSync(hold, JSON.stringify({ ...rec, status: "на   вахте" })); // запись прежнего моста
  await fake.control({ statusNormalize: true });
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const back = await second.call("iskron/resume", 2, { cwd, session: "ses-norm" });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.equal(fake.state.status, "на вахте");
  assert.match(back.result.word, /занятость возвращена: на вахте/, back.result.word);
});

// OpenCode moves a session between folders (graph nks-dev: #6550, rule 3): the
// instance of its new folder asks by the new directory and the same session — the
// record that session stood is its place, whatever directory it names.
test("iskron/resume of a session moved to another folder takes back the place it stood, by the session", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const before = mkdtempSync(join(tmpdir(), "iskron-moved-from-"));
  const after = mkdtempSync(join(tmpdir(), "iskron-moved-to-"));
  await bridge.call("iskron/resume", 4, { cwd: before, session: "ses-moved" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd: before },
  });
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const back = await second.call("iskron/resume", 2, { cwd: after, session: "ses-moved" });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.equal(back.result.key, "proba--931--nks-dev");
  assert.equal(fake.state.counts.connect, 1, "the place is resumed, not rotated");
});

// A resume whose hello does not come in time is not a verdict on the place: the
// hold record stays, so the plugin's watch can try again — dropping it left the
// session nothing to return by (graph nks-dev: #6137). A dead token still drops it
// (the stale-record probe above).
test("iskron/resume without a hello in time keeps the hold record, and the next resume takes the place back", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-mute-dir-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-mute" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  await fake.control({ ws_mute: true }); // the next socket opens, but no hello comes
  const holdFile = () =>
    join(
      standings,
      readdirSync(standings).find((f) => f.endsWith(".hold")),
    );
  const before = readFileSync(holdFile(), "utf8");
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const mute = await second.call("iskron/resume", 2, { cwd, session: "ses-mute" });
  assert.equal(mute.result?.resumed, false, JSON.stringify(mute));
  assert.ok(
    readdirSync(standings).some((f) => f.endsWith(".hold")),
    "a missing hello must not drop the hold record — there is nothing to return by without it",
  );
  // …nor make it younger: a failed attempt that re-stamps «at» would outlive the
  // record's age limit forever, one attempt at a time.
  assert.equal(
    JSON.parse(readFileSync(holdFile(), "utf8")).at,
    JSON.parse(before).at,
    "a failed resume must leave the record's time as it was",
  );
  assert.match(mute.result.word, /hello не пришёл — запись цела/, mute.result.word);
  const back = await second.call("iskron/resume", 3, { cwd, session: "ses-mute" });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.match(back.result.word, /возврат места с диска/);
  assert.equal(fake.state.counts.connect, 1, "the place is resumed, not rotated");
});

// The record a failed resume puts back is the one it read — unless another path
// took the place meanwhile (a connect of this bridge, a second bridge on the same
// auth dir): a fresh address on disk is not overwritten by the old one.
test("a failed resume does not put the old record back over a fresher one written meanwhile", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-race-dir-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-race" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  await fake.control({ ws_mute: true });
  const holdFile = join(
    standings,
    readdirSync(standings).find((f) => f.endsWith(".hold")),
  );
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const pending = second.call("iskron/resume", 2, { cwd, session: "ses-race" });
  await new Promise((r) => setTimeout(r, 1000)); // inside the 4 s wait for hello
  const fresher = {
    ...JSON.parse(readFileSync(holdFile, "utf8")),
    url: "ws://127.0.0.1:9/channel/ws/fresher",
    at: Date.now(),
  };
  writeFileSync(holdFile, JSON.stringify(fresher) + "\n");
  const mute = await pending;
  assert.equal(mute.result?.resumed, false, JSON.stringify(mute));
  assert.equal(
    JSON.parse(readFileSync(holdFile, "utf8")).url,
    fresher.url,
    "the fresher record written meanwhile must stay",
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
test("iskron/resume by the session that stood returns its own place, not the freshest, with its own busy line; leave lets it go and sticks against the watch and the directory", async (t) => {
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
  // Its own line — the same session said it — comes back with the place.
  assert.match(back.result.word, /занятость возвращена: свод двух фаз/);
  assert.match(back.result.word, /iskron_channel\(action="leave"\)/);
  await waitFor(() => fresh().length === 1, "the socket reopened on the saved address");
  assert.equal(fake.state.counts.status_posts, posts + 1, "only the session's own line");
  assert.equal(fake.state.status, "свод двух фаз");
  const left = await back4.call("tools/call", 3, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  assert.ok(!left.result?.isError, JSON.stringify(left));
  assert.match(left.result?.content?.[0]?.text ?? "", /ушёл с места proba--931--nks-dev/);
  // A leave by word sticks: the plugin's watch does not bring the place back…
  // Count socket openings, not live sockets: the left one closes meanwhile.
  const upgrades = () => fake.state.counts.ws_upgrades;
  const opened = upgrades();
  const check = await back4.call("iskron/check", 4, { cwd, session: "ses-proba" });
  assert.equal(check.result?.holding, false, JSON.stringify(check));
  assert.equal(check.result.resumed, false);
  assert.match(check.result.word, /отпущено словом/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(upgrades(), opened, "no socket reopened by the watch after a leave");
  // …nor does a restarted bridge by the directory, even for the same session.
  back4.proc.kill("SIGKILL");
  await waitFor(() => back4.proc.signalCode !== null, "the bridge to die");
  const back5 = startBridge(fake.mcpUrl, dir);
  t.after(() => back5.stop());
  assert.ok((await back5.call("initialize", 1, INIT)).result);
  const after = await back5.call("iskron/resume", 2, { cwd, session: "ses-proba" });
  assert.equal(after.result?.resumed, false, JSON.stringify(after));
  assert.match(after.result.word, /отпущено словом держателя/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(upgrades(), opened, "no socket reopened by the directory after a leave");
  // Only iskron_stand by name brings it back (the board has let the closed socket go).
  await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });
  const stood = await back5.call("tools/call", 3, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  const stoodText = (stood.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!stood.result?.isError, stoodText);
  assert.match(stoodText, /возврат места с диска/, stoodText);
  await waitFor(() => upgrades() === opened + 1, "the place taken back by name");
  assert.equal(
    holdOf(join(dir, "standings"), "proba--931--nks-dev")?.left,
    undefined,
    "the leave mark is gone once the place is held again",
  );
});

/** The hold record of a key, read off the standings directory (file names are hashed). */
function holdOf(standings, key) {
  for (const f of readdirSync(standings).filter((x) => x.endsWith(".hold"))) {
    const r = JSON.parse(readFileSync(join(standings, f), "utf8"));
    if (r.key === key) return r;
  }
  return null;
}

// A record of a pre-upgrade build carries no session. The directory alone must
// not return it (that is #6017), but the answer must not be silent either: it
// names the place and the way back by name (iskron_stand).
test("iskron/resume names a place of a pre-session build in the directory instead of resuming it or staying silent", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-legacy-dir-"));
  // A bridge never told its session writes a record without one — as an old build did.
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd, status: "старая сборка" },
  });
  assert.equal(holdOf(join(dir, "standings"), "proba--931--nks-dev")?.session, undefined);
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  const known = new Set(fake.state.ws);
  const posts = fake.state.counts.status_posts;
  const next = startBridge(fake.mcpUrl, dir);
  t.after(() => next.stop());
  assert.ok((await next.call("initialize", 1, INIT)).result);
  const r = await next.call("iskron/resume", 2, { cwd, session: "ses-novaya" });
  assert.equal(r.result?.resumed, false, JSON.stringify(r));
  assert.deepEqual(r.result.legacy, ["proba"], "the pre-session place is named");
  assert.match(
    r.result.word,
    /есть место прежней сборки без сессии: proba — вернуть: iskron_stand\(name="proba"\)/,
  );
  await new Promise((res) => setTimeout(res, 300));
  assert.equal([...fake.state.ws].filter((x) => !known.has(x)).length, 0, "not resumed");
  assert.equal(fake.state.counts.status_posts, posts, "no busy line");
});

// The same pre-session record, but its bridge is alive in another session: the
// place is not offered back by name — that call would give attribution only,
// no hearing, and the agent would stop to ask the human (graph nks-dev: #6594).
test("iskron/resume does not offer back a pre-session place whose socket a live bridge of another session holds", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-legacy-live-"));
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  assert.equal(holdOf(join(dir, "standings"), "proba--931--nks-dev")?.session, undefined);
  const next = startBridge(fake.mcpUrl, dir);
  t.after(() => next.stop());
  assert.ok((await next.call("initialize", 1, INIT)).result);
  const r = await next.call("iskron/resume", 2, { cwd, session: "ses-novaya" });
  assert.equal(r.result?.resumed, false, JSON.stringify(r));
  assert.equal(
    r.result.legacy,
    undefined,
    `the live neighbour's place is not offered: ${r.result.word}`,
  );
  assert.doesNotMatch(r.result.word, /вернуть: iskron_stand\(name="proba"\)/, r.result.word);
});

// The session's own record — stood by it — while a live bridge of another process
// holds its socket (two plugin instances reloaded at once, graph nks-dev: #6626):
// the resume takes nothing and names the place as held elsewhere, so the plugin
// tells the session the return failed instead of leaving it to think it stands.
test("iskron/resume of the session's own place whose socket a live bridge holds names it as held elsewhere", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-elsewhere-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-1" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  const next = startBridge(fake.mcpUrl, dir);
  t.after(() => next.stop());
  assert.ok((await next.call("initialize", 1, INIT)).result);
  const r = await next.call("iskron/resume", 2, { cwd, session: "ses-1" });
  assert.equal(r.result?.resumed, false, JSON.stringify(r));
  assert.deepEqual(r.result.elsewhere, ["proba--931--nks-dev"], r.result.word);
  assert.equal(fake.state.ws.size, 1, "the live holder keeps its socket");
});

// A bridge no session was named to must not inherit the session of the record:
// the id belongs to the process that was told it, not to the file. The seat a
// named session stood on is that session's (#6706): the bridge stands beside and
// leaves the record as it was.
test("a bridge with no named session does not carry the previous holder's session into the record", async (t) => {
  const { fake, dir, bridge } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-inherit-dir-"));
  await bridge.call("iskron/resume", 4, { cwd, session: "ses-prezhnyaya" });
  await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  const standings = join(dir, "standings");
  assert.equal(holdOf(standings, "proba--931--nks-dev")?.session, "ses-prezhnyaya");
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  const next = startBridge(fake.mcpUrl, dir);
  t.after(() => next.stop());
  assert.ok((await next.call("initialize", 1, INIT)).result);
  const st = await next.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  const said = (st.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.doesNotMatch(said, /возврат места с диска/, said);
  assert.match(said, /стояние (?:@tester:)?proba\.2 — /, said);
  assert.equal(
    holdOf(standings, "proba--931--nks-dev")?.session,
    "ses-prezhnyaya",
    "the named session's record is left as it was",
  );
  assert.equal(
    holdOf(standings, "proba.2--931--nks-dev")?.session,
    undefined,
    "the new process was told no session — its record carries none",
  );
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
  // Reopens are counted by upgrades: a reopen closes the previous socket, and the fake now
  // drops a closed socket (it used to keep every one — the count once rode on that).
  const ups = fake.state.counts.ws_upgrades;
  const fresh = () => ({ length: fake.state.counts.ws_upgrades - ups });
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

// #6649: the plugin idle longer than the hold record's term (6 h; seen 30–32 h) — the
// record went by its term, iskron_stand takes the seat back, but the platform had let
// the place expire and it left all its cases. The return that finds no record of the
// named seat says so, and the next iskron_stand repeats it: check mine, join again.
test("a return whose hold record went by its term says to check iskron_case mine after iskron_stand — and the stand that takes the seat says it too", async (t) => {
  const own = { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } };
  const { fake, dir, bridge, standings } = await connected(t, { init: own });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  for (const f of readdirSync(standings).filter((x) => x.endsWith(".hold")))
    unlinkSync(join(standings, f)); // the record gone by its term
  const next = startBridge(fake.mcpUrl, dir);
  t.after(() => next.stop());
  assert.ok((await next.call("initialize", 1, own)).result);
  const back = await next.call("iskron/resume", 2, { key: "proba--931--nks-dev" });
  assert.equal(back.result?.resumed, false, JSON.stringify(back));
  assert.match(back.result.word, /после iskron_stand проверь iskron_case\(action="mine"\)/);
  const st = await next.call("tools/call", 3, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  const said = (st.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!st.result?.isError, said);
  assert.match(said, /место могло истечь у платформы[\s\S]*войди в свои дела заново/);
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

// #5048: OpenCode 2.0.24 gives one folder as /private/tmp/… and as /tmp/…; the record's
// directory was compared as a string and missed the folder's own records.
test("a hold record's directory matches the same folder by another path (a link and its target)", async (t) => {
  const own = { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } };
  const { fake, dir, bridge } = await connected(t, { init: own });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const real = mkdtempSync(join(tmpdir(), "iskron-canon-real-"));
  const link = `${real}-link`;
  symlinkSync(real, link);
  await bridge.call("iskron/resume", 4, { cwd: link, session: "ses-1" });
  const stood = await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd: link },
  });
  assert.ok(!stood.result?.isError, JSON.stringify(stood));
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  const next = startBridge(fake.mcpUrl, dir);
  t.after(() => next.stop());
  assert.ok((await next.call("initialize", 1, own)).result);
  // Another session of the same folder, by the target's path and with a trailing slash.
  const other = await next.call("iskron/resume", 2, { cwd: `${real}/`, session: "ses-2" });
  assert.equal(other.result?.resumed, false, JSON.stringify(other));
  assert.match(other.result.word, /не стояла \(proba--931--nks-dev\)/, "the folder's record seen");
});

// A bridge that leads a parked place (leave) must not be talked into another
// record of the same directory: holdStanding of a different key would kill the
// parked socket and forget the name. A leave by word sticks against a resume;
// iskron_stand by name returns to the parked place.
test("a bridge leading a place left by word is not talked into a fresher record of the directory by iskron/resume, and returns to its place by iskron_stand", async (t) => {
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

  // The place was left by word: the plugin's watch does not bring it back (#6017)…
  const watched = await bridge.call("iskron/check", 10, { cwd });
  assert.equal(watched.result?.holding, false, JSON.stringify(watched));
  assert.equal(watched.result.resumed, false);
  // …and a resume neither brings it back nor talks the bridge into the fresher
  // record of the same directory.
  const refused = await bridge.call("iskron/resume", 7, { cwd });
  assert.equal(refused.result?.resumed, false, JSON.stringify(refused));
  assert.match(refused.result.word, /отпущено словом держателя \(leave\): proba--931--nks-dev/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fresh().length, 0, "neither the left place nor the fresher one is opened");
  // iskron_stand by name is the way back — to the parked place, not the fresher record.
  const back = await bridge.call("tools/call", 9, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd },
  });
  assert.ok(!back.result?.isError, JSON.stringify(back));
  assert.match(
    (back.result?.content ?? []).map((c) => c.text ?? "").join("\n"),
    /возврат на место, с которого мост уходил/,
  );
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
    /занятость @tester:proba/,
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
  assert.match(said(st), /занятость @tester:proba/, said(st));
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
  // «me» — роль самого человека: занимать её мост даёт только по его настройке (#6550 п.2).
  const bridge = startBridge(fake.mcpUrl, dir, { ISKRON_BRIDGE_OWNER_ROLE: "1" });
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

part("rooms");
// ── room kinds for watchdogs (#5851): the bridge batches, an interrupt flushes first ──

const sendRoom = (fake, frame) => fake.control({ ws_send: JSON.stringify(frame) });
/** Слово мне со стопкой прерывания — адресованное будит; счёт ждавших идёт перед ним (#6574). */
const nudge = (fake, id = 999) => sendRoom(fake, { ...said("interrupt", id), addressee: ME });
/** Пачка из одних счётов хода не будит: окно прошло — ни строки; затем слово мне — счёт перед ним. */
async function quietThenNudge(fake, wd, ms, id) {
  await new Promise((r) => setTimeout(r, ms));
  assert.ok(!wd.out.includes("записей"), `a batch of counts printed on its own:\n${wd.out}`);
  await nudge(fake, id);
  await waitFor(() => wd.out.includes(`[${id ?? 999}]`), "the word to me", 3000);
}

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
  // #6574: пачка несёт счёт по делам, неадресованные записи — без текста.
  const batch = flat.indexOf("записей 2, тебе 0");
  const close = flat.indexOf("предлагает закрыть дело");
  assert.ok(batch >= 0, `the batch count head:\n${wd.out}`);
  assert.ok(close > batch, `the batch goes out before closing, not after:\n${wd.out}`);
  assert.ok(!wd.out.includes("пробы зелёные"), `progress text leaked:\n${wd.out}`);
  assert.ok(!wd.out.includes("стопкой defer"), `said defer text leaked:\n${wd.out}`);
  assert.match(
    wd.out,
    /целиком — iskron_case\(realm="nks-dev", action="history", room=7, since=43\)/,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a room batch of counts alone prints nothing after its window and rides before the next word to me; an unknown kind batches and is written to the bridge log", async (t) => {
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
  await quietThenNudge(fake, wd, 2500);
  assert.ok(wd.out.includes("записей 2, тебе 0"), `the count before the word to me:\n${wd.out}`);
  assert.ok(Date.now() - sent >= 1800, "the batch waited for its window");
  // #6574: неадресованные записи — числом, текст не доставляется.
  assert.ok(!wd.out.includes("пробы зелёные"), `progress text leaked:\n${wd.out}`);
  assert.ok(!wd.out.includes("мосту неизвестен"), `unknown kind words leaked:\n${wd.out}`);
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
  await quietThenNudge(fake, wd, 2500);
  assert.ok(wd.out.includes("записей 1, тебе 0"), `the count before the word to me:\n${wd.out}`);
  assert.ok(Date.now() - sent >= 1800, "auto waited for the batch window, not interrupting");
  // #6574: auto — запись дела не месту, текст не доставляется; счёт и указатель.
  assert.ok(!wd.out.includes("дочернее дело №12 закрыто"), `auto words leaked:\n${wd.out}`);
  assert.match(wd.out, /iskron_case\(realm="nks-dev", action="history", room=7, since=79\)/);
  assert.ok(!wd.out.includes("неизвестен"), `auto printed as unknown:\n${wd.out}`);
  assert.ok(
    !bridge.stderr.includes("неизвестен"),
    `unknown-kind line in the log:\n${bridge.stderr}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Room kinds batched through the bridge: one batch of frames — счёт по делам (#6574),
// адресованные месту — строками; неадресованные текстом не доставляются.
async function batchOf(t, frames) {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 10_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  for (const f of frames) await sendRoom(fake, f);
  const head = `записей ${frames.length}`;
  await quietThenNudge(fake, wd, 1800);
  assert.ok(wd.out.includes(head), `the batch count before the word to me:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
  return wd.out;
}

// left on expiry (battle form, api 0.89.6): the author is the platform, the one who left — fields.standing.
// #6574: записи не месте — числом; слова записей текстом в ход не идут.
test("left and joined ride in the batch by count, their words do not arrive as text", async (t) => {
  const out = await batchOf(t, [leftExpired(84), joinedMember(85)]);
  assert.match(out, /№7 «Стенд»: записей 2, тебе 0/);
  assert.ok(!out.includes("вышел"), `left words leaked:\n${out}`);
  assert.ok(!out.includes("вошёл"), `joined words leaked:\n${out}`);
});

// node with op and reasoning — the agreed form, not yet seen on the wire.
test("node records of every op ride in the batch by count, without their words", async (t) => {
  const out = await batchOf(t, [
    nodeOp("updated", 87),
    nodeOp("bound", 88),
    nodeOp("deleted", 89),
    nodeOp("undeleted", 90),
  ]);
  assert.match(out, /№7 «Стенд»: записей 4, тебе 0/);
  assert.ok(!out.includes("узел #4057"), `node words leaked:\n${out}`);
  assert.ok(!out.includes("js-bundle"), `node names leaked:\n${out}`);
});

test("a bound node rides in the batch by count as well", async (t) => {
  const out = await batchOf(t, [nodeBound(86)]);
  assert.match(out, /№7 «Стенд»: записей 1, тебе 0/);
  assert.ok(!out.includes("в деле узел"), `node words leaked:\n${out}`);
});

// ── one event, once into the turn: as text or by count (#5842, #6563) ──
part("events");
// Копия дела, ждущая счётом где бы то ни было — в окне побудки, в удержанной шапке
// сторожа, — гаснет перед кадром инбокса своего события (#5842, #6563).
test("a wake-up window does not count a case copy whose inbox frame is in the same window", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "800" },
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const backlogs = () => bridge.notifications.filter((n) => n.params?.data?.kind === "backlog");
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 2 }) });
  await sendRoom(fake, { ...nodeOp("updated", 91), event_id: 77 });
  await fake.control({ ws_send: graphEvent("inbox-1", 77, "событие семьдесят семь") });
  await waitFor(() => backlogs().length === 1, "the backlog notification");
  const text = backlogs()[0].params.data.text;
  assert.ok(
    !/записей/.test(text),
    `the case copy of the inbox event is counted in the wake batch:\n${text}`,
  );
});

// Копия дела гаснет только перед копией инбокса, вошедшей в ход ТЕКСТОМ: копия инбокса
// за пределом показанных пачкой (её назвало лишь число) копии дела не гасит — ни в
// пачке, ни меткой отданного после неё (граф @nks/nks-dev, узел #5842).
const others = (n, from, extra) =>
  Array.from({ length: n }, (_, i) => graphEvent(`other-${from + i}`, from + i, "другое", extra));

test("an inbox frame past the shown part of a wake-up window leaves its case copy counted, and a later case copy offered", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "800" },
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const backlogs = () => bridge.notifications.filter((n) => n.params?.data?.kind === "backlog");
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 23 }) });
  await sendRoom(fake, { ...nodeOp("updated", 91), event_id: 77 });
  await fake.control({
    ws_send_many: [
      ...others(20, 1001),
      graphEvent("inbox-1", 77, "событие семьдесят семь"),
      graphEvent("inbox-2", 78, "событие семьдесят восемь"),
    ],
  });
  await waitFor(() => backlogs().length === 1, "the backlog notification");
  const text = backlogs()[0].params.data.text;
  assert.ok(!text.includes("событие семьдесят"), `an inbox frame past the cut was shown:\n${text}`);
  assert.match(text, /записей 1/, `the case copy of a counted-only inbox frame vanished:\n${text}`);
  await sendRoom(fake, { ...nodeOp("updated", 92), event_id: 78 });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.frame?.id === "room-msg-92"),
    "the later case copy offered",
  );
});

test("a stale inbox frame past the shown part of its burst leaves a held case copy counted under the Monitor watchdog", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "4000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, { ...nodeOp("updated", 98), event_id: 84 });
  await fake.control({
    ws_send_many: [
      ...others(20, 2001, { stale: true }),
      graphEvent("inbox-8", 84, "событие восемьдесят четыре", { stale: true }),
    ],
  });
  await waitFor(() => wd.out.includes("Лежалых кадров: 21"), "the stale batch");
  assert.ok(
    !wd.out.includes("событие восемьдесят четыре"),
    `the inbox frame was shown:\n${wd.out}`,
  );
  await quietThenNudge(fake, wd, 4500, 993);
  assert.match(
    wd.out,
    /записей 1/,
    `the case copy of a counted-only inbox frame vanished:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a stale inbox frame past the shown part of its burst neither swallows a live case copy nor marks its event shown", async (t) => {
  const { fake, bridge } = await connected(t, {
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const offered = (id) => bridge.notifications.some((n) => n.params?.data?.frame?.id === id);
  await fake.control({
    ws_send_many: [
      ...others(20, 3001, { stale: true }),
      graphEvent("inbox-9", 85, "событие восемьдесят пять", { stale: true }),
      graphEvent("inbox-10", 86, "событие восемьдесят шесть", { stale: true }),
    ],
  });
  await sendRoom(fake, { ...nodeOp("updated", 101), event_id: 85 });
  await waitFor(() => offered("room-msg-101"), "the case copy beside the waiting burst");
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "stale"),
    "the stale batch",
  );
  await sendRoom(fake, { ...nodeOp("updated", 102), event_id: 86 });
  await waitFor(() => offered("room-msg-102"), "the case copy after the burst");
});

test("a count the Monitor watchdog holds unprinted loses the case copy whose inbox frame comes next", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, { ...nodeOp("updated", 93), event_id: 79 });
  await new Promise((r) => setTimeout(r, 1500)); // bridge window flushed; watchdog holds the count unprinted
  assert.ok(!wd.out.includes("записей"), "count alone is not printed");
  await fake.control({ ws_send: graphEvent("inbox-3", 79, "событие семьдесят девять") });
  await waitFor(() => wd.out.includes("событие семьдесят девять"), "the inbox frame");
  assert.ok(
    !wd.out.includes("записей"),
    `the held count of the case copy rode with the inbox frame of the same event:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a count the exit watchdog holds loses the case copy whose inbox frame wakes it", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 20_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, { ...nodeOp("updated", 94), event_id: 80 });
  await waitFor(() => wd.err.includes("счёт ждёт ближайшей побудки"), "the batch held", 6000);
  await fake.control({ ws_send: graphEvent("inbox-4", 80, "событие восемьдесят") });
  await wd.done;
  assert.ok(
    !wd.out.includes("записей"),
    `exit watchdog: case copy counted beside its inbox frame:\n${wd.out}`,
  );
});

test("a count the exit watchdog holds loses the case copy whose stale inbox frame its burst shows", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 20_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, { ...nodeOp("updated", 99), event_id: 87 });
  await waitFor(() => wd.err.includes("счёт ждёт ближайшей побудки"), "the batch held", 6000);
  await fake.control({
    ws_send: graphEvent("inbox-11", 87, "событие восемьдесят семь", { stale: true }),
  });
  await waitFor(() => wd.err.includes("событие восемьдесят семь"), "the stale batch in the log");
  await nudge(fake, 994);
  await wd.done;
  assert.ok(wd.out.includes("[994]"), `the word to me:\n${wd.out}`);
  assert.ok(
    !wd.out.includes("записей"),
    `exit watchdog: case copy counted after its stale inbox frame was shown:\n${wd.out}`,
  );
});

test("a count the Codex watchdog holds loses the case copy whose inbox frame goes into the thread", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t);
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 15_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await sendRoom(fake, { ...nodeOp("updated", 95), event_id: 81 });
  await new Promise((r) => setTimeout(r, 1500)); // окно моста ушло; счёт ждёт ближайшего хода
  await fake.control({ ws_send: graphEvent("inbox-5", 81, "событие восемьдесят один") });
  await waitFor(() => readFileSync(log, "utf8").includes("turn/start"), "the frame in the thread");
  const turns = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((c) => c.method === "turn/start");
  assert.equal(turns.length, 1, JSON.stringify(turns));
  assert.match(turns[0].params.input[0].text, /событие восемьдесят один/);
  assert.doesNotMatch(turns[0].params.input[0].text, /записей/);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Лежалая копия инбокса входит в ход текстом пачки лежалых — у Monitor и Codex, как у
// плагинов: ждущий счёт копии дела её события не повторяет (#5842, #6563).
test("a count the Monitor watchdog holds loses the case copy whose stale inbox frame it prints", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, { ...nodeOp("updated", 96), event_id: 82 });
  await new Promise((r) => setTimeout(r, 1500)); // окно моста ушло; счёт ждёт непечатным
  await fake.control({
    ws_send: graphEvent("inbox-6", 82, "событие восемьдесят два", { stale: true }),
  });
  await waitFor(() => wd.out.includes("событие восемьдесят два"), "the stale batch");
  await fake.control({ ws_send: JSON.stringify({ id: "live-6", type: "message", body: "живое" }) });
  await waitFor(() => wd.out.includes("живое"), "the live frame");
  assert.ok(
    !wd.out.includes("записей"),
    `the held count of the case copy rode after its stale inbox frame:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a live case copy dies before the stale inbox copy of its event waiting in the bridge's burst", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({
    ws_send: graphEvent("inbox-8", 84, "событие восемьдесят четыре", { stale: true }),
  });
  await sendRoom(fake, { ...nodeOp("updated", 98), event_id: 84 });
  await waitFor(() => wd.out.includes("событие восемьдесят четыре"), "the stale batch");
  await new Promise((r) => setTimeout(r, 1500)); // окно дела моста ушло бы
  await fake.control({ ws_send: JSON.stringify({ id: "live-8", type: "message", body: "живое" }) });
  await waitFor(() => wd.out.includes("живое"), "the live frame");
  assert.ok(
    !wd.out.includes("записей"),
    `the case copy was counted beside its stale inbox frame:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Пачка лежалых ушла сторожу, а метку отданного он ставит лишь после печати: копия дела,
// пришедшая в этот промежуток, гаснет у моста — событие уже показано текстом.
test("a case copy coming while the Monitor watchdog still prints the stale burst that shows its inbox copy is not counted", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 30_000, { ISKRON_WATCHDOG_ALONE_MS: "4000" });
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ id: "live-ra", type: "message", body: "живое-а" }),
  });
  await waitFor(() => wd.out.includes("живое-а"), "the first live frame");
  await fake.control({
    ws_send: graphEvent("inbox-r", 91, "событие девяносто один", { stale: true }),
  });
  await new Promise((r) => setTimeout(r, 1800)); // пачка ушла сторожу, он ещё ждёт паузы
  await sendRoom(fake, { ...nodeOp("updated", 99), event_id: 91 });
  await new Promise((r) => setTimeout(r, 1500)); // окно дела моста ушло бы
  await fake.control({
    ws_send: JSON.stringify({ id: "live-rb", type: "message", body: "живое-б" }),
  });
  await waitFor(() => wd.out.includes("живое-б"), "the second live frame", 20_000);
  assert.ok(wd.out.includes("событие девяносто один"), wd.out);
  assert.ok(
    !wd.out.includes("записей"),
    `the case copy was counted beside the text of its event:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Живой кадр инбокса, пока сторож не прицеплен, текстом не вошёл: вытесненный из кольца
// неотданным, он не гасит копию дела своего события — та доходит счётом (#5842).
// Находки второго круга (класс «одно событие — один раз в ход»).
// №1: запись дела от человека входит текстом — и её событие тоже; копия инбокса того же
// события второй раз текстом не входит.
test("a human case record delivered as text marks its event: the inbox copy of it is not delivered again", async (t) => {
  const { fake, bridge } = await connected(t, {
    init: { ...INIT, clientInfo: { name: "opencode-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const offered = (id) => bridge.notifications.some((n) => n.params?.data?.frame?.id === id);
  const rec = nodeOp("updated", 120);
  await sendRoom(fake, {
    ...rec,
    event_id: 401,
    provenance: { ...rec.provenance, as_person: true },
  });
  await waitFor(() => offered("room-msg-120"), "the human record as text");
  await fake.control({ ws_send: graphEvent("inbox-h", 401, "событие четыреста один") });
  await fake.control({
    ws_send: JSON.stringify({ id: "live-h", type: "message", body: "живое-ч" }),
  });
  await waitFor(() => offered("live-h"), "the live frame after it");
  assert.equal(offered("inbox-h"), false, "the event went in as text twice");
});

// №2: сторож выхода помечает только кадр, который напечатал, — не весь повтор кольца:
// событие, чей кадр инбокса он не напечатал, потом доходит хотя бы счётом.
test("the exit watchdog marks only the frame it printed, not the whole replay: an unprinted event still reaches the doer", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "500" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({
    ws_send_many: [
      graphEvent("inbox-x1", 311, "событие триста одиннадцать"),
      graphEvent("inbox-x2", 312, "событие триста двенадцать"),
    ],
  });
  await new Promise((r) => setTimeout(r, 300));
  const w1 = runClient("watchdog-exit", dir, key, 20_000);
  await w1.done;
  assert.ok(w1.out.includes("событие триста одиннадцать"), w1.out);
  await fake.control({
    ws_send_many: Array.from({ length: 21 }, (_, i) =>
      JSON.stringify({ id: `fx-${i}`, type: "message", body: `fx ${i}` }),
    ),
  });
  await sendRoom(fake, { ...nodeOp("updated", 312), event_id: 312 });
  await new Promise((r) => setTimeout(r, 1000));
  const w2 = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => w2.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ id: "live-x", type: "message", body: "живое-х" }),
  });
  await waitFor(() => w2.out.includes("живое-х"), "the live frame");
  assert.ok(
    w2.out.includes("событие триста двенадцать") || w2.out.includes("записей 1"),
    `the event the exit watchdog never printed reached the doer neither as text nor by count:\n${w2.out}`,
  );
  w2.proc.kill("SIGKILL");
  await w2.done;
});

// №3: «задним числом N» — после отсечения: копия дела, чьё событие повтор отдаёт текстом,
// не кадр повтора.
test("the back-dated count a watchdog is told on attach is the frames it gets, after the cut", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "500" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({ ws_send: graphEvent("inbox-b", 321, "событие триста двадцать один") });
  await sendRoom(fake, { ...nodeOp("updated", 321), event_id: 321 });
  await new Promise((r) => setTimeout(r, 1000)); // окно дела ушло в пустой сокет; оба в кольце
  const wd = runClient("watchdog", dir, key, 20_000);
  // Живой кадр сразу за прицеплением: названный мостом лишний кадр повтора засчитал бы его.
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await new Promise((r) => setTimeout(r, 200));
  await fake.control({
    ws_send: JSON.stringify({ id: "live-b", type: "message", body: "живое-б2" }),
  });
  await waitFor(() => wd.out.includes("живое-б2"), "the live frame");
  assert.ok(wd.out.includes("событие триста двадцать один"), wd.out);
  // Повтор — кадр инбокса; копия дела его события отсечена и не названа.
  assert.match(wd.out, /слушаю стояние \S+ \(1 кадр задним числом\)/, wd.out);
  assert.ok(!wd.out.includes("записей"), wd.out);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("an inbox frame no watchdog heard and the ring dropped leaves its case copy counted", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({
    ws_send_many: [
      graphEvent("inbox-p", 301, "событие триста один"),
      ...Array.from({ length: 21 }, (_, i) =>
        JSON.stringify({ id: `fill-${i}`, type: "message", body: `fill ${i}` }),
      ),
      JSON.stringify({ ...nodeOp("updated", 301), event_id: 301 }),
    ],
  });
  await new Promise((r) => setTimeout(r, 1200));
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ id: "live-p", type: "message", body: "живое-п" }),
  });
  await waitFor(() => wd.out.includes("живое-п"), "the live frame");
  assert.ok(
    wd.out.includes("событие триста один") || wd.out.includes("записей 1"),
    `the event reached the doer neither as text nor by count:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Кольцо, повторяя прицепившемуся кадр инбокса текстом, не отдаёт рядом счётом копию дела
// того же события.
test("the ring replays an inbox frame as text and not the case copy of its event beside it", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "500" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({ ws_send: graphEvent("inbox-q", 302, "событие триста два") });
  await sendRoom(fake, { ...nodeOp("updated", 302), event_id: 302 });
  await new Promise((r) => setTimeout(r, 1000)); // окно дела ушло в пустой сокет; оба в кольце
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("событие триста два"), "the replayed inbox frame");
  await fake.control({
    ws_send: JSON.stringify({ id: "live-q", type: "message", body: "живое-к" }),
  });
  await waitFor(() => wd.out.includes("живое-к"), "the live frame");
  assert.ok(!wd.out.includes("записей"), `counted beside its text on replay:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Дом подставного Codex — под TMPDIR пробы и убирается вместе с ней.
test("the fake Codex home lives under the probe's TMPDIR and is gone after its test", async (t) => {
  let home = "";
  await t.test("a door", async (st) => {
    home = (await codexDoor(st)).CODEX_HOME;
  });
  assert.ok(home.startsWith(realpathSync(tmpdir())) || home.startsWith(tmpdir()), home);
  assert.equal(existsSync(home), false, `${home} is left behind`);
});

// Сторож вынул ждущую копию дела, когда пачка лежалых показала её событие текстом, но
// отданной её не пометил; перевзведённому сторожу кольцо её не повторяет — событие уже
// отдано текстом (повтор кольца, door.ts).
test("a re-armed watchdog is not handed again from the ring a case copy whose event a stale burst already showed as text", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const arm = async () => {
    const w = runClient("watchdog", dir, key, 20_000);
    await waitFor(() => w.out.includes("слушаю стояние"), "the watchdog to attach");
    return w;
  };
  const w1 = await arm();
  await sendRoom(fake, { ...nodeOp("updated", 99), event_id: 91 });
  await new Promise((r) => setTimeout(r, 1500)); // окно дела ушло; счёт ждёт непечатным
  w1.proc.kill("SIGKILL");
  await w1.done;
  const w2 = await arm();
  await fake.control({
    ws_send: graphEvent("inbox-rr", 91, "событие девяносто один", { stale: true }),
  });
  await waitFor(() => w2.out.includes("событие девяносто один"), "the stale burst");
  w2.proc.kill("SIGKILL");
  await w2.done;
  const w3 = await arm();
  await fake.control({
    ws_send: JSON.stringify({ id: "live-rr", type: "message", body: "живое-з" }),
  });
  await waitFor(() => w3.out.includes("живое-з"), "the live frame");
  assert.ok(
    !w3.out.includes("записей"),
    `the ring handed the case copy again after its event was shown as text:\n${w3.out}`,
  );
  w3.proc.kill("SIGKILL");
  await w3.done;
});

// Пачка лежалых судится в миг отдачи, не составления: лежалая копия дела, чьё событие
// живая копия инбокса внесла текстом раньше, пачкой не считается — и когда сторож ещё
// не пометил этот текст (тред не принял ход, очередь печати занята).
test("a stale case copy whose event a live inbox frame already took into the Codex thread is not counted by the stale burst", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t, { turnDelayMs: 3000 });
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 30_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await sendRoom(fake, { ...nodeOp("updated", 101), event_id: 93, stale: true });
  await fake.control({ ws_send: graphEvent("inbox-p1", 93, "событие девяносто три") });
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start")
      .map((c) => c.params.input[0].text);
  await new Promise((r) => setTimeout(r, 2500)); // пачка лежалых ушла бы сторожу
  await fake.control({
    ws_send: JSON.stringify({ id: "live-p1", type: "message", body: "живое" }),
  });
  await waitFor(
    () => turns().some((x) => x.includes("живое")),
    "the live frame in the thread",
    20_000,
  );
  assert.ok(
    turns().some((x) => x.includes("событие девяносто три")),
    JSON.stringify(turns()),
  );
  for (const text of turns()) assert.doesNotMatch(text, /записей/, text);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Гасит только вошедшее в ход: лежалая копия в ещё не отданной пачке живую копию той же
// записи не гасит — пачка ушла в пустой сокет (сторож выхода между выходом и перевзводом),
// а живая копия в кольце доходит перевзведённому сторожу — один раз.
test("a live case copy is not swallowed by a stale copy waiting in an unsent burst: with the socket empty the event reaches the exit watchdog once", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "500" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await sendRoom(fake, { ...nodeOp("updated", 110), event_id: 501, stale: true });
  await sendRoom(fake, { ...nodeOp("updated", 111), event_id: 501 });
  await new Promise((r) => setTimeout(r, 2000)); // пачка лежалых и окно дела ушли в пустой сокет
  const wd = runClient("watchdog-exit", dir, key, 20_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await nudge(fake, 996);
  await wd.done;
  assert.ok(wd.out.includes("[996]"), `the word to me:\n${wd.out}`);
  const counted = wd.out.match(/записей 1/g) ?? [];
  assert.equal(counted.length, 1, `the event reached the doer ${counted.length} times:\n${wd.out}`);
});

// Копия, удержанная старшей копией того же рода в кольце, доходит ею — один раз; кольцо
// здесь полно, но не вытесняет (страж удержания кольцом, fanout.ts redundantEvent).
test("a copy held back by an unprinted ring copy reaches the watchdog once through that copy", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  await fake.control({
    ws_send_many: [
      graphEvent("inbox-ra", 503, "событие пятьсот три"),
      graphEvent("inbox-rb", 503, "событие пятьсот три"),
      ...Array.from({ length: 19 }, (_, i) =>
        JSON.stringify({ id: `fr-${i}`, type: "message", body: `fr ${i}` }),
      ),
    ],
  });
  await new Promise((r) => setTimeout(r, 500));
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("fr 18"), "the replayed ring");
  const got = wd.out.match(/событие пятьсот три/g) ?? [];
  assert.equal(got.length, 1, `the event reached the watchdog ${got.length} times:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("two live copies of one event reach an attached Monitor watchdog once", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({
    ws_send_many: [
      graphEvent("inbox-ma", 504, "событие пятьсот четыре"),
      graphEvent("inbox-mb", 504, "событие пятьсот четыре"),
      JSON.stringify({ id: "live-m", type: "message", body: "живое-м" }),
    ],
  });
  await waitFor(() => wd.out.includes("живое-м"), "the live frame");
  const got = wd.out.match(/событие пятьсот четыре/g) ?? [];
  assert.equal(got.length, 1, `the event reached the watchdog ${got.length} times:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Тред отказал ходу с текстом события: его текст не вошёл — копия дела того события,
// ждавшая счётом, не гаснет перед ним и входит в следующий ход.
test("a turn the Codex thread refused does not swallow the waiting count of a case copy of its event", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "300" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t, { turnDelayMs: 2000, refuseTurns: 1 });
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 30_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({ ws_send: graphEvent("inbox-x", 505, "событие пятьсот пять") });
  await new Promise((r) => setTimeout(r, 100));
  await sendRoom(fake, { ...nodeOp("updated", 113), event_id: 505 });
  await new Promise((r) => setTimeout(r, 700)); // копия ждёт счётом, ход с текстом ещё без ответа
  await fake.control({
    ws_send: JSON.stringify({ id: "live-x1", type: "message", body: "живое-1" }),
  });
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start")
      .map((c) => c.params.input[0].text);
  await waitFor(
    () => turns().some((x) => x.includes("живое-1")),
    "the live frame in the thread",
    20_000,
  );
  await waitFor(() => wd.err.includes("turn refused"), "the refusal");
  await fake.control({
    ws_send: JSON.stringify({ id: "live-x2", type: "message", body: "живое-2" }),
  });
  await waitFor(() => turns().some((x) => x.includes("живое-2")), "the next live frame", 20_000);
  assert.ok(
    turns().some((x) => /записей 1/.test(x)),
    `the case copy's count was swallowed by a refused turn: ${JSON.stringify(turns())}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Дверь закрылась под ходом с текстом события: лежалая копия дела, ждавшая при нём, в
// закрытую дверь не уходит — входит счётом в следующую открытую, ровно раз.
test("a stale burst held by a turn whose Codex door closed goes into the next opened door once", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t, { turnDelayMs: 3000, closeTurns: 1 });
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 30_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({ ws_send: graphEvent("inbox-c", 607, "событие шестьсот семь") });
  await new Promise((r) => setTimeout(r, 100));
  await sendRoom(fake, { ...nodeOp("updated", 121), event_id: 607, stale: true });
  await waitFor(() => /дверь закрылась|door closed/.test(wd.err), "the door to close", 20_000);
  await fake.control({
    ws_send: JSON.stringify({ id: "live-c1", type: "message", body: "живое-c1" }),
  });
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start")
      .map((c) => c.params.input[0].text);
  await waitFor(
    () => turns().some((x) => x.includes("живое-c1")),
    "the live frame in the thread",
    20_000,
  );
  await new Promise((r) => setTimeout(r, 300));
  const counted = turns().filter((x) => /записей 1/.test(x));
  assert.equal(
    counted.length,
    1,
    `the event went in ${counted.length} times: ${JSON.stringify(turns())}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Пустая шапка — ход в тред не начинается: метки ждавших пишутся, turn/start с пустым текстом нет.
test("on its own close the Codex watchdog starts no empty turn when the waiting count holds only a copy of an event already in the thread", async (t) => {
  const { fake, dir, bridge, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t, { turnDelayMs: 4000 });
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 30_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({ ws_send: graphEvent("inbox-e", 502, "событие пятьсот два") });
  await new Promise((r) => setTimeout(r, 200));
  await sendRoom(fake, { ...nodeOp("updated", 112), event_id: 502 });
  await new Promise((r) => setTimeout(r, 1200)); // окно дела ушло: копия ждёт счётом у сторожа
  const reply = await bridge.call("tools/call", 7, {
    name: "iskron_channel",
    arguments: { action: "close", realm: "nks-dev" },
  });
  assert.ok(!reply.result?.isError, JSON.stringify(reply));
  await wd.done;
  const turns = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.method === "turn/start")
    .map((c) => c.params.input[0].text);
  assert.ok(
    turns.some((x) => x.includes("событие пятьсот два")),
    JSON.stringify(turns),
  );
  assert.ok(!turns.includes(""), `an empty turn went into the thread: ${JSON.stringify(turns)}`);
});

// Ход уходит в тред Codex с мига постановки во вложение, не с открытия двери: пачка
// лежалых, судимая, пока дверь открывается, не считает событие, уже отданное текстом.
test("a stale case copy whose event went into the Codex thread while the door was still opening is not counted", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t, { upgradeDelayMs: 4000 });
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 30_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({ ws_send: graphEvent("inbox-d", 95, "событие девяносто пять") });
  await new Promise((r) => setTimeout(r, 200));
  await sendRoom(fake, { ...nodeOp("updated", 103), event_id: 95, stale: true });
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start")
      .map((c) => c.params.input[0].text);
  await new Promise((r) => setTimeout(r, 2000)); // пачка лежалых разобрана, дверь ещё открывается
  await fake.control({ ws_send: JSON.stringify({ id: "live-d", type: "message", body: "живое" }) });
  await waitFor(
    () => turns().some((x) => x.includes("живое")),
    "the live frame in the thread",
    20_000,
  );
  assert.ok(
    turns().some((x) => x.includes("событие девяносто пять")),
    JSON.stringify(turns()),
  );
  for (const text of turns()) assert.doesNotMatch(text, /записей/, text);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Сторож новый, мост старый: пачка лежалых прежней формы — первые 20 кадров и метки
// сверх них (unshown, у копий инбокса — `evs:`) — отдаётся её текстом со счётом
// «не вошло»; сверх показанных событие вошло лишь числом и метится `cevs:`: копия дела
// того события потом доходит счётом. Кадр снят кодом моста origin/main 5e620dae
// (его StaleBurst, 22 лежалых кадра инбокса) — old-bridge-stale.json.
test("a stale burst of the old bridge's form keeps its left-out count and marks the unshown as named by number, not as text", async (t) => {
  const { socketPathOf } = await import("../shared/standings.ts");
  const old = JSON.parse(readFileSync(join(HERE, "old-bridge-stale.json"), "utf8"));
  assert.ok(old.unshown.includes("evs:300"), "the fixture is the old bridge's form");
  const dir = mkdtempSync(join(tmpdir(), "iskron-oldstale-"));
  const key = "old--931--nks-dev";
  const path = socketPathOf(dir, key);
  const seenPath = join(dir, "old.seen");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const copy = { ...nodeOp("updated", 120), event_id: 300 };
  const live = { id: "live-o", type: "message", body: "живое-о" };
  const put = (sock, ev) => sock.write(JSON.stringify(ev) + "\n");
  const door = createServer((sock) => {
    put(sock, { kind: "attached", key, buffered: 0, seen: seenPath });
    put(sock, old);
    put(sock, { kind: "note", text: "шапка", batch: { at: 0, of: 1 } });
    put(sock, { kind: "frame", raw: JSON.stringify(copy), frame: copy, batch: { at: 1, of: 1 } });
    put(sock, { kind: "frame", raw: JSON.stringify(live), frame: live });
  });
  await new Promise((r) => door.listen(path, r));
  t.after(() => door.close());
  const wd = runClient("watchdog", dir, key, 8000);
  await waitFor(() => wd.out.includes("живое-о"), "the live frame");
  assert.match(wd.out, /не вошло 2/, `the left-out count was lost:\n${wd.out}`);
  assert.match(
    wd.out,
    /записей 1/,
    `the case copy of an event named only by number vanished:\n${wd.out}`,
  );
  await waitFor(
    () => existsSync(seenPath) && readFileSync(seenPath, "utf8").includes("s-21"),
    "the unshown marked",
  );
  const seen = readFileSync(seenPath, "utf8").split("\n");
  assert.ok(seen.includes("cevs:300") && !seen.includes("evs:300"), seen.join(" "));
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a stale case copy whose event a live inbox frame already took into the Monitor queue is not counted by the stale burst", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 30_000, { ISKRON_WATCHDOG_ALONE_MS: "4000" });
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ id: "live-p0", type: "message", body: "живое-0" }),
  });
  await waitFor(() => wd.out.includes("живое-0"), "the first live frame");
  await sendRoom(fake, { ...nodeOp("updated", 102), event_id: 94, stale: true });
  await fake.control({ ws_send: graphEvent("inbox-p2", 94, "событие девяносто четыре") });
  await new Promise((r) => setTimeout(r, 2500)); // пачка лежалых ушла бы сторожу
  await fake.control({
    ws_send: JSON.stringify({ id: "live-p2", type: "message", body: "живое-2" }),
  });
  await waitFor(() => wd.out.includes("живое-2"), "the last live frame", 25_000);
  assert.ok(wd.out.includes("событие девяносто четыре"), wd.out);
  assert.ok(
    !wd.out.includes("записей"),
    `the stale burst counted the event shown as text:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a case copy coming while the Codex watchdog still hands the stale burst into the thread is not counted", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t, { turnDelayMs: 3000 });
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 30_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await fake.control({
    ws_send: graphEvent("inbox-rc", 92, "событие девяносто два", { stale: true }),
  });
  await new Promise((r) => setTimeout(r, 1800)); // пачка ушла сторожу, ход в тред ещё не ответил
  await sendRoom(fake, { ...nodeOp("updated", 100), event_id: 92 });
  await new Promise((r) => setTimeout(r, 1500));
  await fake.control({
    ws_send: JSON.stringify({ id: "live-rc", type: "message", body: "живое" }),
  });
  const turns = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .filter((c) => c.method === "turn/start")
          .map((c) => c.params.input[0].text)
      : [];
  await waitFor(
    () => turns().some((x) => x.includes("живое")),
    "the live frame in the thread",
    20_000,
  );
  assert.ok(
    turns().some((x) => x.includes("событие девяносто два")),
    JSON.stringify(turns()),
  );
  for (const text of turns()) assert.doesNotMatch(text, /записей/, text);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a count the Codex watchdog holds loses the case copy whose stale inbox frame goes into the thread", async (t) => {
  const { fake, dir, key } = await connected(t, { env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" } });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const extra = await codexDoor(t);
  const log = join(extra.CODEX_HOME, "door.log");
  const wd = runClient("watchdog-codex", dir, key, 15_000, extra);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await sendRoom(fake, { ...nodeOp("updated", 97), event_id: 83 });
  await new Promise((r) => setTimeout(r, 1500)); // окно моста ушло; счёт ждёт ближайшего хода
  await fake.control({
    ws_send: graphEvent("inbox-7", 83, "событие восемьдесят три", { stale: true }),
  });
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start")
      .map((c) => c.params.input[0].text);
  await waitFor(() => existsSync(log) && turns().length === 1, "the stale batch in the thread");
  await fake.control({ ws_send: JSON.stringify({ id: "live-7", type: "message", body: "живое" }) });
  await waitFor(() => turns().length === 2, "the live frame in the thread");
  assert.match(turns()[0], /событие восемьдесят три/);
  for (const text of turns()) assert.doesNotMatch(text, /записей/, text);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Строки работы одного ключа (room.id, line.key) в пачке сворачиваются в последнюю
// (#6718): счёт называет записи после свёртки и сменённые числом; строка bad и
// адресованное месту слово не сворачиваются; отданными метятся все кадры пачки.
test("progress lines of one key fold into the last in a watchdog batch: the count says how many were superseded; bad and the word to me stay", async (t) => {
  const { fake, dir, key, standings } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  for (const id of [44, 45, 46]) await sendRoom(fake, progress(id));
  await sendRoom(
    fake,
    roomFrame("progress", { entry_id: 47, key: "tests", line: { done: "упало", verdict: "bad" } }),
  );
  await sendRoom(fake, { ...said("defer", 48), addressee: ME });
  await waitFor(() => wd.out.includes("[48]"), "the batch with the word to me");
  assert.match(wd.out, /№7 «Стенд»: записей 3, тебе 1, сменённых строк ключа 2/, wd.out);
  for (const id of [44, 45, 46, 47, 48]) await waitSeen(standings, `room-msg-${id}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// Одно событие графа приходит месту двумя кадрами: инбоксом роли (via=graph,
// event_id в теле) и записью дела (via=room, event_id на верхнем уровне конверта,
// дело №248, #6563). Метка одна — ev:<N>: копия дела после отданного события гаснет;
// копия дела, пришедшая первой, — только счёт и кадр инбокса не глушит.
test("a case record carrying the event_id of a delivered inbox frame is dropped; one that came first does not swallow the inbox frame", async (t) => {
  const { fake, dir, key, bridge, standings } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await fake.control({ ws_send: graphEvent("inbox-1", 77, "событие семьдесят семь") });
  await waitFor(() => wd.out.includes("событие семьдесят семь"), "the inbox frame");
  await waitSeen(standings, "ev:77");
  await sendRoom(fake, { ...nodeOp("updated", 91), event_id: 77 });
  await waitFor(() => bridge.stderr.includes("carries ev:77 already offered"), "the copy dropped");
  await quietThenNudge(fake, wd, 1500, 990);
  assert.ok(
    !wd.out.includes("записей"),
    `the case copy of a delivered event was counted:\n${wd.out}`,
  );
  // Копия дела первой, ещё в пачке: кадр инбокса — текстом и вынимает её — счёта нет (#5842).
  await sendRoom(fake, { ...nodeOp("updated", 92), event_id: 78 });
  await fake.control({ ws_send: graphEvent("inbox-2", 78, "событие семьдесят восемь") });
  await waitFor(
    () => wd.out.includes("событие семьдесят восемь"),
    "the inbox frame after its case copy",
  );
  await waitSeen(standings, "ev:78"); // текст события помечен — копию дела не считает никто
  await quietThenNudge(fake, wd, 1500, 992);
  assert.ok(!wd.out.includes("записей"), `the waiting case copy was counted too:\n${wd.out}`);
  // Копия дела, уже отданная счётом, события не держит: кадр инбокса — текстом.
  await sendRoom(fake, { ...nodeOp("updated", 93), event_id: 79 });
  await new Promise((r) => setTimeout(r, 1500));
  await nudge(fake, 991);
  await waitFor(() => wd.out.includes("[991]"), "the word to me");
  await waitSeen(standings, "room-msg-93");
  await fake.control({ ws_send: graphEvent("inbox-3", 79, "событие семьдесят девять") });
  await waitFor(
    () => wd.out.includes("событие семьдесят девять"),
    "the inbox frame after a counted case copy",
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// #6569: такт внимания приходит раз в час, у каждого свой id; пока делатель занят и сторож
// не взведён, такты копились в кольце, и каждый взвод уходил на старшем — четыре кадра
// одного такта подряд. Кольцо отдаёт последний такт, прежние свёрнуты и помечены отданными.
// Провенанс такта — wake="look_up" (слово стюарда api, на проводе не наблюдён).
const tact = (n) =>
  JSON.stringify({
    type: "message",
    id: `tact-${n}`,
    provenance: { via: "platform", wake: "look_up" },
    body: `Час на «вахта ${n}» — подними голову`,
  });
const tactsInRing = async (fake) => {
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  for (const n of [1, 2, 3]) await fake.control({ ws_send: tact(n) });
  await new Promise((r) => setTimeout(r, 300));
};

test("tacts that waited in the ring: the exit watchdog leaves on the last, the next arm gets none of the earlier", async (t) => {
  const { fake, dir, key, standings } = await connected(t);
  await tactsInRing(fake);
  const first = runClient("watchdog-exit", dir, key);
  assert.equal((await first.done).exit, 0, first.err);
  assert.match(first.out, /вахта 3/);
  assert.doesNotMatch(first.out, /вахта [12]/, `an earlier tact woke the doer:\n${first.out}`);
  for (const n of [1, 2, 3]) await waitSeen(standings, `tact-${n}`);
  const second = runClient("watchdog-exit", dir, key, 4000);
  await waitFor(() => second.err.includes("слушаю стояние"), "the second arm to attach");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(second.proc.exitCode, null, `an earlier tact woke the next arm:\n${second.out}`);
  second.proc.kill("SIGKILL");
  await second.done;
});

test("tacts that waited in the ring: the Monitor watchdog prints the last only", async (t) => {
  const { fake, dir, key } = await connected(t);
  await tactsInRing(fake);
  const wd = runClient("watchdog", dir, key);
  await waitFor(() => wd.out.includes("вахта 3"), "the last tact");
  await new Promise((r) => setTimeout(r, 500));
  assert.doesNotMatch(wd.out, /вахта [12]/, `an earlier tact was printed:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("tacts that waited in the ring: the Codex watchdog puts the last only into the thread", async (t) => {
  const { fake, dir, key } = await connected(t);
  await tactsInRing(fake);
  const home = codexHome(t);
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-9",
  });
  await waitFor(() => readFileSync(log, "utf8").includes("вахта 3"), "the last tact in the thread");
  await new Promise((r) => setTimeout(r, 500));
  assert.doesNotMatch(
    readFileSync(log, "utf8"),
    /вахта [12]/,
    "an earlier tact entered the thread",
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

part("rooms");
// A word in two phases (#5893 §4.5b): the batch carries them by count (#6574);
// a body to me still reaches the Monitor watchdog at once, whole.
test("a said in flight, deferred bodies and aborts ride in the batch by count, printing nothing alone; a body of my word reaches the watchdog at once, the count before it", async (t) => {
  const { fake, dir, key, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const sent = Date.now();
  await sendRoom(fake, saidInFlight(54));
  await sendRoom(fake, bodyFrame(55, 54));
  await sendRoom(fake, bodyAborted(57, 56));
  await sendRoom(fake, bodyLapsed(59, 58));
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(!wd.out.includes("[54]"), `a said in flight interrupted:\n${wd.out}`);
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(!wd.out.includes("записей"), `a batch of counts printed on its own:\n${wd.out}`);
  // Тело моего слова — слово мне: сразу и целиком, счёт ждавших — перед ним.
  const mine = bodyFrame(61, 60, "текст моего слова");
  mine.stack = "interrupt";
  mine.addressee = ME;
  await sendRoom(fake, mine);
  await waitFor(() => wd.out.includes("текст моего слова"), "body of my word printed", 1500);
  const flat = wd.out.replace(/\n/g, " ");
  assert.ok(
    flat.indexOf("записей 4, тебе 0") >= 0 &&
      flat.indexOf("записей 4, тебе 0") < flat.indexOf("текст моего слова"),
    `the count rides before the body of my word:\n${wd.out}`,
  );
  assert.ok(Date.now() - sent >= 1800, "the batch waited for its window");
  // #6574: слова чужих фаз текстом не приходят — только счёт и указатель.
  assert.ok(!wd.out.includes("в полёте"), `words of a flight leaked:\n${wd.out}`);
  assert.ok(!wd.out.includes("оборвано"), `words of an abort leaked:\n${wd.out}`);
  assert.ok(!wd.out.includes("неизвестен"), `body printed as unknown:\n${wd.out}`);
  assert.ok(!bridge.stderr.includes("неизвестен"), `unknown-kind line:\n${bridge.stderr}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// #6574: слово без адресата — запись дела не месту: даже со стопкой прерывания
// оно приходит числом, пачкой; текстом в ход идут только адресованные места.
test("a said with stack interrupt and no addressee rides in the batch by count, its words do not arrive", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, said("interrupt", 62));
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(!wd.out.includes("стопкой interrupt"), `an unaddressed word interrupted:\n${wd.out}`);
  await quietThenNudge(fake, wd, 2500, 63);
  assert.ok(wd.out.includes("записей 1, тебе 0"), `the count before the word to me:\n${wd.out}`);
  assert.equal(
    wd.out.split("стопкой interrupt").length - 1,
    1,
    `only the word to me as text, the unaddressed one not:\n${wd.out}`,
  );
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
  await waitFor(() => wd.out.includes("[68] "), "the invite to my role printed", 3000);
  assert.match(wd.out, /Алексей \(@aleksei:probe\) зовёт 🚚 Поставщик плитки в дело/);
  // #6574: отзыв приглашения мне — адресованная запись, строкой в пачке;
  // приглашение чужой роли — числом в шапке, без строки.
  assert.match(wd.out, /№7 «Стенд»: записей 2, тебе 1/);
  assert.match(wd.out, /\[71\] приглашение отозвано, отзывает Алексей/);
  assert.ok(!wd.out.includes("[69] "), `another role's invite got a line:\n${wd.out}`);
  const flat = wd.out.replace(/\n/g, " ");
  assert.ok(
    flat.indexOf("записей 2, тебе 1") < flat.indexOf("[68] "),
    `the batch goes out before the invite to my role:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A batch of counts alone is no wake (#6574): the exit watchdog stays; its count
// head goes out with the next wake, before the word that brings it.
test("the exit watchdog does not leave on a batch of counts alone: the count head rides the next wake", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, progress(46, "a"));
  await sendRoom(fake, progress(48, "b"));
  await waitFor(() => wd.err.includes("счёт ждёт ближайшей побудки"), "the batch held", 6000);
  assert.equal(wd.proc.exitCode, null, `the exit watchdog left on counts alone: ${wd.out}`);
  assert.equal(wd.out, "", `counts alone printed:\n${wd.out}`);
  await nudge(fake, 49);
  const r = await wd.done;
  assert.equal(r.exit, 0, `the word to me must wake: ${wd.err}`);
  // #6574: числа приходят шапкой перед словом; строки кадров не доставляются.
  assert.match(wd.out, /^№7 «Стенд»: записей 2, тебе 0[^\n]*\n№7 «Стенд» \[49\] /);
  assert.ok(
    !wd.out.includes("[46] ") && !wd.out.includes("[48] "),
    `frame lines handed over:\n${wd.out}`,
  );
});

test("the exit watchdog: closing flushes the batch of counts, the watchdog leaves on closing with the count before it", async (t) => {
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
  assert.match(first.out, /^№7 «Стенд»: записей 1, тебе 0/);
  assert.match(first.out, /iskron_case\(realm="nks-dev", action="history", room=7, since=48\)/);
  assert.ok(!first.out.includes("[49] "), `progress words handed over:\n${first.out}`);
  assert.match(first.out, /\n№7 «Стенд» \[50\] ведущий [^\n]*предлагает закрыть дело/);
  const second = runClient("watchdog-exit", dir, key, 3000);
  const r2 = await second.done;
  assert.equal(r2.exit, null, `nothing is handed twice:\n${second.out}`);
});

// Своё close отдаёт неотданную пачку перед released: сторож Codex выходит нулём
// только после того, как её счёт лёг в тред, — как на dead (#6638).
test("watchdog-codex on one's own close puts the batch the bridge flushed into the thread before it exits 0", async (t) => {
  const { fake, dir, bridge, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "30000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = codexHome(t);
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(
    join(home, "app-server-control", "app-server-control.sock"),
    log,
  );
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15_000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-flush",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await sendRoom(fake, progress(49));
  await new Promise((r) => setTimeout(r, 500));
  assert.doesNotMatch(readFileSync(log, "utf8"), /записей/, "the batch is still held");
  const reply = await bridge.call("tools/call", 7, {
    name: "iskron_channel",
    arguments: { action: "close", realm: "nks-dev" },
  });
  assert.ok(!reply.result?.isError, JSON.stringify(reply));
  const r = await wd.done;
  assert.equal(r.exit, 0, `one's own close is not a lost bridge:\n${wd.err}`);
  assert.match(
    readFileSync(log, "utf8"),
    /turn\/start[^\n]*записей 1, тебе 0/,
    `the flushed batch reached the thread before the exit:\n${wd.err}`,
  );
});

// Дверь приняла сокет и молчит на upgrade: ожидание пачки на своём отпускании —
// с пределом, по нему одна громкая строка и ненулевой выход, не вечное молчание.
test("watchdog-codex on one's own close behind a door that never answers the upgrade exits loudly within the limit", async (t) => {
  const { fake, dir, bridge, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "30000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = codexHome(t);
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(
    join(home, "app-server-control", "app-server-control.sock"),
    log,
    { mute: true },
  );
  t.after(() => door.stop());
  const wd = runClient("watchdog-codex", dir, key, 15_000, {
    CODEX_HOME: home,
    CODEX_THREAD_ID: "thread-mute",
  });
  await waitFor(() => wd.err.includes("слушаю стояние"), "the codex watchdog to attach");
  await sendRoom(fake, progress(49));
  await new Promise((r) => setTimeout(r, 500));
  const reply = await bridge.call("tools/call", 7, {
    name: "iskron_channel",
    arguments: { action: "close", realm: "nks-dev" },
  });
  assert.ok(!reply.result?.isError, JSON.stringify(reply));
  const r = await wd.done;
  assert.notEqual(r.exit, null, `the watchdog hung past the limit:\n${wd.err}`);
  assert.notEqual(r.exit, 0, `an unsent batch is not a quiet exit:\n${wd.err}`);
  assert.equal(wd.err.split("не дождался вложения").length - 1, 1, `one loud line:\n${wd.err}`);
});

test("a full room batch of counts and the rest past it are not dropped: both counts ride before the next word to me", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "30000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  for (let i = 0; i < 21; i++) await sendRoom(fake, progress(200 + i, `key-${i}`));
  await quietThenNudge(fake, wd, 1500);
  assert.ok(wd.out.includes("записей 20, тебе 0"), `the full batch's count:\n${wd.out}`);
  assert.ok(wd.out.includes("записей 1, тебе 0"), `the rest flushed before the word:\n${wd.out}`);
  // #6574: полная пачка — один счёт; кадры не теряются и не получают строк.
  assert.ok(!wd.out.includes("[219] "), `a per-frame line leaked:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

part("words");
// ── An addressed word not to me (#6081): no body, no wake; #6574: words not to
// the seat are one count of the case in the batch. To me — whole and by its stack. ──

const ASIDE = "Алексей (@aleksei:probe) → @boris:probe";
/** Строка счёта дела проб без адресованных месту (#6574). */
const countOf = (n, since) =>
  `№7 «Стенд»: записей ${n}, тебе 0 — адресованных месту нет; ` +
  `целиком — iskron_case(realm="nks-dev", action="history", room=7, since=${since}).`;

test("(а) an addressed word not to me with stack interrupt does not wake the Monitor watchdog and prints a count without its body", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, addressed(80));
  await quietThenNudge(fake, wd, 2800);
  assert.ok(wd.out.includes(countOf(1, 79)), `the count before the word to me:\n${wd.out}`);
  assert.ok(!wd.out.includes(ASIDE), `a line of a word not to me:\n${wd.out}`);
  assert.ok(!wd.out.includes("тайное слово"), `the body of a word not to me leaked:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("(а2) an addressed word whose addressee has left the case (addressee_left) is a word to all — a count, its text stays in history", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, addressedLeft(89));
  await quietThenNudge(fake, wd, 2200);
  assert.ok(wd.out.includes(countOf(1, 88)), `the count before the word to me:\n${wd.out}`);
  assert.ok(!wd.out.includes("явное слово 89"), `a word to all printed whole:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("(б) three addressed words of one pair in a row are one count «записей 3» — Monitor and the exit watchdog", async (t) => {
  const { fake, dir, key, standings } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  for (const id of [81, 82, 83]) await sendRoom(fake, addressed(id, BORIS, "defer"));
  await quietThenNudge(fake, wd, 2200, 997);
  assert.ok(wd.out.includes(countOf(3, 80)), wd.out);
  assert.ok(!wd.out.includes(ASIDE), wd.out);
  assert.ok(!wd.out.includes("тайное слово"), wd.out);
  // Убитый между печатью 997 и его пометкой сторож отдал бы его кольцом сторожу
  // выхода — законный повтор, который будит его раньше пачки (#5516).
  await waitSeen(standings, "room-msg-997");
  wd.proc.kill("SIGKILL");
  await wd.done;
  const ex = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => ex.err.includes("hello"), "hello to be noted");
  for (const id of [84, 85, 86]) await sendRoom(fake, addressed(id));
  await waitFor(() => ex.err.includes("счёт ждёт ближайшей побудки"), "the batch held", 6000);
  await nudge(fake, 998);
  const r = await ex.done;
  assert.equal(r.exit, 0, `the word to me must wake: ${ex.err}`);
  assert.ok(ex.out.includes(countOf(3, 83)), ex.out);
  assert.ok(!ex.out.includes(ASIDE), ex.out);
});

test("(в) an addressed word to me with stack interrupt wakes the Monitor watchdog at once and whole, after the asides waiting before it", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, addressed(86));
  // The addressee as a place object (the form asked of the api) and as an address string.
  await sendRoom(fake, addressed(87, { standing: ME, name: "proba" }));
  await waitFor(() => wd.out.includes("тайное слово 87"), "the word to me, whole", 3000);
  await sendRoom(fake, addressed(88, ME));
  await waitFor(() => wd.out.includes("тайное слово 88"), "the word to me, whole", 3000);
  assert.match(wd.out, /слово от Алексей \(@aleksei:probe\)/);
  const flat = wd.out.replace(/\n/g, " ");
  const aside = flat.indexOf(countOf(1, 85));
  assert.ok(aside >= 0 && aside < flat.indexOf("тайное слово 87"), `the count first:\n${wd.out}`);
  assert.doesNotMatch(wd.out, /ответ:/, "delivery asks no answer (#6574)");
  assert.ok(!wd.out.includes("тайное слово 86"), `the body of a word not to me leaked:\n${wd.out}`);
  assert.ok(!wd.out.includes(`→ ${ME}`), `a word to me was folded as an aside:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("(г) a word without an addressee between two asides is not to me either: one count of three", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, addressed(90, BORIS, "defer"));
  await sendRoom(fake, said("defer", 91));
  await sendRoom(fake, addressed(92, BORIS, "defer"));
  await quietThenNudge(fake, wd, 2200);
  assert.ok(wd.out.includes(countOf(3, 89)), wd.out);
  assert.ok(!wd.out.includes("слово со стопкой defer"), wd.out);
  assert.ok(!wd.out.includes(ASIDE), wd.out);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("(д) an addressed word not to me in flight and then its body with stack interrupt: one count, no body, no wake", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, addressedInFlight(94));
  await sendRoom(fake, addressedBody(95, 94));
  await new Promise((r) => setTimeout(r, 900));
  assert.ok(!wd.out.includes("тайное тело 94"), `the body woke at once:\n${wd.out}`);
  await quietThenNudge(fake, wd, 2000);
  assert.ok(wd.out.includes(countOf(2, 93)), wd.out);
  assert.equal(
    wd.out.split("записей").length - 1,
    1,
    `the body made a count of its own:\n${wd.out}`,
  );
  assert.ok(!wd.out.includes("тайное тело"), `the body of a word not to me leaked:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("(е) a word whose body the platform withheld (body_withheld) is not to me under Monitor: a count, №N first", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, withheld(96));
  await quietThenNudge(fake, wd, 2200);
  assert.match(wd.out, new RegExp(`^${countOf(1, 95).replace(/[()[\].]/g, "\\$&")}$`, "m"));
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// ── Monitor glues lines that come within ~200 ms into one event and cuts it by
// length: a human's word right after a case batch vanished in the cut tail. ──

const HUMAN_TEXT =
  "стоп, пачку пока не разбирай: сперва ответь на вопрос про мост — сторож съедал " +
  "слово человека, пришедшее сразу за пачкой дела, и агент его не видел. Проверь " +
  "это пробой и доложи словами, что увидел. Конец слова: ХВОСТ-ЦЕЛ.";
const HUMAN = {
  from_standing: "@dmitry:bridge",
  from_karta_seq: 1226,
  auth: "pat",
  via: "hook",
  as_person: true,
  user: "dmitry",
};
const humanWord = (id = "human-1", body = HUMAN_TEXT) => ({
  type: "message",
  id,
  body,
  provenance: HUMAN,
});
/** Слово делателя через hook — прямое, не кадр дела. */
const doerWord = (id, body) => ({
  type: "message",
  id,
  body,
  provenance: { from_standing: "@aleksei:probe", from_karta_seq: 48, auth: "pat", via: "hook" },
});

test("a human word right after a case batch goes out alone under Monitor: a pause of 250 ms before and after it, its text whole; a human word never waits in the batch", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 25_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  for (let i = 0; i < 6; i++) await sendRoom(fake, said("defer", 300 + i));
  await sendRoom(fake, humanWord());
  await sendRoom(fake, { ...said("interrupt", 311), addressee: ME });
  await waitFor(() => wd.out.includes("стопкой interrupt"), "the frame after the human word", 5000);
  const lines = wd.lines;
  const first = lines.findIndex((l) => l.s.startsWith("человек @dmitry"));
  // The word ends with its text (no answer line, #6574): the pause comes after that.
  const last = lines.findIndex((l, i) => i > first && l.s.includes("ХВОСТ-ЦЕЛ."));
  assert.ok(first > 0 && last >= first, `the human word printed:\n${wd.out}`);
  assert.ok(wd.out.includes(HUMAN_TEXT), `the human word's text whole:\n${wd.out}`);
  assert.ok(
    lines.slice(0, first).some((l) => l.s.includes("записей 6, тебе 0")),
    `the batch went first:\n${wd.out}`,
  );
  const before = lines[first].at - lines[first - 1].at;
  const after = lines[last + 1].at - lines[last].at;
  assert.ok(before >= 250, `a pause before the human word: ${before} ms\n${wd.out}`);
  assert.ok(after >= 250, `a pause after the human word: ${after} ms\n${wd.out}`);
  // A human's word in a case with stack defer does not wait for the batch window.
  await sendRoom(fake, said("defer", 320));
  const inCase = roomFrame("said", {
    entry_id: 321,
    key: "said",
    stack: "defer",
    author: { kind: "standing", standing: "@dmitry:bridge", name: "Дмитрий", karta: { seq: 1226 } },
    body: "слово человека в деле со стопкой defer",
  });
  inCase.provenance.as_person = true;
  await sendRoom(fake, inCase);
  await waitFor(
    () => wd.out.includes("слово человека в деле со стопкой defer"),
    "the human word in the case at once, not after the window",
    3000,
  );
  assert.match(
    wd.out,
    /^№7 [^\n]*\[321\] [^\n]*— человек/m,
    `printed alone, a human's:\n${wd.out}`,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A human's word in two phases (#5953): the word in flight carries no text and waits by
// the dictionary; its body (no as_person on it) is the human's word and comes alone.
test("a human's word in two phases wakes the exit watchdog once, and that one event carries the text", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  const inFlight = saidInFlight(80);
  inFlight.provenance.as_person = true;
  await sendRoom(fake, inFlight);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(wd.proc.exitCode, null, `a word in flight woke it empty:\n${wd.out}`);
  await sendRoom(fake, bodyFrame(81, 80, "текст слова человека ЦЕЛ"));
  const r = await wd.done;
  assert.equal(r.exit, 0, `the body must wake: ${wd.err}`);
  assert.ok(wd.out.includes("текст слова человека ЦЕЛ"), `the text in the event:\n${wd.out}`);
  assert.ok(!wd.out.includes("в полёте"), `no empty word in flight beside it:\n${wd.out}`);
  // Nothing is left to wake the next arm: the word in flight went with its body.
  const next = runClient("watchdog-exit", dir, key, 3000);
  const r2 = await next.done;
  assert.equal(r2.exit, null, `the next arm woke on:\n${next.out}`);
});

// An entry's number is its own in each case (#6576): the same number in two
// cases names two entries, and the frame id is the channel's, not the entry's.
const CASE_8 = { id: "r-8", seq: 8, zachin: "Другое", realm: "nks-dev", status: "open" };
const inCase8 = (frame) => ({ ...frame, id: `${frame.id}-case-8`, room: CASE_8 });
const caseNumbered = (frame) => ({ ...frame, id: `${frame.id}-by-case`, numbering: "case" });

test("a human's word in flight in one case does not claim the body of another case's word under the same number", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const inFlight = saidInFlight(80);
  inFlight.provenance.as_person = true;
  await sendRoom(fake, inFlight);
  await sendRoom(fake, inCase8(saidInFlight(80)));
  await sendRoom(fake, inCase8(bodyFrame(81, 80, "тело слова агента в деле 8")));
  await sendRoom(fake, bodyFrame(81, 80, "текст слова человека в деле 7 ЦЕЛ"));
  await waitFor(() => wd.out.includes("в деле 7 ЦЕЛ"), "the human's body in case 7", 5000);
  assert.ok(
    !wd.out.includes("тело слова агента в деле 8"),
    `the other case's body went as the human's word:\n${wd.out}`,
  );
  assert.match(wd.out, /^№7 [^\n]*— человек/m, `case 7's body is the human's:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a change of numbering forgets the words in flight: an old number claims a body under the new one neither for the human nor for me", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const inFlight = saidInFlight(80);
  inFlight.provenance.as_person = true;
  await sendRoom(fake, inFlight);
  await sendRoom(fake, { ...saidInFlight(82), addressee: ME });
  await sendRoom(fake, caseNumbered(saidInFlight(80)));
  await sendRoom(fake, caseNumbered(bodyFrame(81, 80, "тело слова агента по новой нумерации")));
  await sendRoom(fake, caseNumbered(saidInFlight(82)));
  await sendRoom(fake, caseNumbered(bodyFrame(83, 82, "тело чужого слова 82 по новой нумерации")));
  await sendRoom(fake, caseNumbered({ ...said("interrupt", 999), addressee: ME }));
  await waitFor(() => wd.out.includes("[999]"), "the word to me", 5000);
  assert.doesNotMatch(
    wd.out,
    /— человек/,
    `a body under the new numbering went as the human's word:\n${wd.out}`,
  );
  for (const text of ["тело слова агента по новой нумерации", "тело чужого слова 82"])
    assert.ok(!wd.out.includes(text), `a body under the new numbering went as text:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A word to me in two phases (#6574): the exit watchdog leaves on the word in
// flight, its body comes to a new process that never saw the flight. The bridge
// saw both phases: it marks the body addressed on the frame itself, and its
// .seen keeps the flight across its own restart.
test("a reply to me in two phases: the exit watchdog wakes on the word in flight, the next arm gets its body as text", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => first.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, replyInFlight(54));
  const r1 = await first.done;
  assert.equal(r1.exit, 0, `the word in flight to me wakes: ${first.err}`);
  const next = runClient("watchdog-exit", dir, key, 6000);
  await waitFor(() => next.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, bodyFrame(55, 54, "текст ответа мне ЦЕЛ"));
  const r2 = await next.done;
  assert.equal(r2.exit, 0, `the body of a word to me must wake the next arm: ${next.err}`);
  assert.ok(next.out.includes("текст ответа мне ЦЕЛ"), `the body as text:\n${next.out}`);
});

test("a reply to me in two phases across a bridge restart: the body is still known as mine", async (t) => {
  const { fake, dir, key, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => first.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, replyInFlight(64));
  assert.equal((await first.done).exit, 0, `the word in flight to me wakes: ${first.err}`);
  bridge.proc.kill("SIGKILL");
  await waitFor(() => bridge.proc.signalCode !== null, "the first bridge to exit");
  await waitFor(() => fake.state.ws.size === 0, "the fake to see the socket close");
  const second = startBridge(fake.mcpUrl, dir, { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" });
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });
  const st = await second.call("tools/call", 2, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.ok(!st.result?.isError, JSON.stringify(st));
  await waitFor(() => fake.state.ws.size === 1, "the place resumed");
  const next = runClient("watchdog-exit", dir, key, 6000);
  await waitFor(() => next.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, bodyFrame(65, 64, "ответ после перезапуска ЦЕЛ"));
  const r2 = await next.done;
  assert.equal(r2.exit, 0, `the body of a word to me must wake after the restart: ${next.err}`);
  assert.ok(next.out.includes("ответ после перезапуска ЦЕЛ"), `the body as text:\n${next.out}`);
});

// A question in the case (#6867; the bridge's share — #6868, #6655): a question
// to my role waits in the batch in words; the answer to it interrupts and the
// waiting batch goes first.
test("question kinds under the Monitor watchdog: a question to my role waits in words; the answer to my seat interrupts after it", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, ask(90));
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(!wd.out.includes("спрашивает роль"), `the question interrupted:\n${wd.out}`);
  await sendRoom(fake, answer(91, 90, ME));
  await waitFor(() => wd.out.includes("отвечает на [90]"), "the answer to be printed");
  const flat = wd.out.replace(/\n/g, " ");
  const q = flat.indexOf("спрашивает роль 🚚 Поставщик плитки");
  assert.ok(q >= 0, `the question to me in words:\n${wd.out}`);
  assert.ok(flat.indexOf("отвечает на [90]") > q, `the batch goes before the answer:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// #6868: an answer to another's question is a count; an answer by another seat
// of my role to the question asked of me closes it — in words, not waking, as
// the ack to me; the answer to another seat does not fold into it.
test("question kinds under the Monitor watchdog: another seat's answer to my question and an ack to me ride in words; an answer to another's question is a count", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, ask(90));
  await sendRoom(fake, answer(91, 90, BORIS)); // my role's other seat answered the asker Boris
  await sendRoom(fake, answer(96, 95, BORIS)); // a question I was never asked
  // The other seat's answer told me my question is out: its later withdrawal is a count.
  await sendRoom(fake, askWithdrawn(98, 90));
  await sendRoom(fake, ack(97, 96, ME));
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(!wd.out.includes("отвечает на"), `an answer not to me interrupted:\n${wd.out}`);
  await nudge(fake);
  await waitFor(() => wd.out.includes("[999]"), "the word to me", 3000);
  const flat = wd.out.replace(/\n/g, " ");
  assert.match(flat, /записей 5, тебе 3/, wd.out);
  assert.doesNotMatch(flat, /вопрос \[90\] снят/, `told twice:\n${wd.out}`);
  assert.match(flat, /отвечает на \[90\]/, `the answer to my question in words:\n${wd.out}`);
  assert.match(flat, /ответ \[96\] принят/, `the ack to me in words:\n${wd.out}`);
  assert.doesNotMatch(flat, /отвечает на \[95\]/, `another's answer leaked:\n${wd.out}`);
  // The seat's memory of questions grows by questions to me, not by others' lines.
  const asks = readdirSync(join(dir, "standings"))
    .filter((x) => x.endsWith(".asks"))
    .map((x) => readFileSync(join(dir, "standings", x), "utf8"))
    .join("");
  assert.doesNotMatch(asks, /#95\n/, `another's question in the seat's memory:\n${asks}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// #6868 and the fold of a key's lines (#6718): the question kinds and the
// withdrawal of a question to me do not fold into a later line of the same key.
test("question kinds under the Monitor watchdog: a question to me, its withdrawal and an ack do not fold into a later line of the key", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const withdrawn = askWithdrawn(91, 90);
  withdrawn.line.verdict = "partial";
  await sendRoom(fake, ask(90));
  await sendRoom(fake, withdrawn);
  await sendRoom(fake, ack(92, 89, ME));
  await sendRoom(
    fake,
    roomFrame("progress", {
      entry_id: 93,
      key: "выкат: сегодня?",
      line: { done: "дальше", verdict: "ok" },
    }),
  );
  await new Promise((r) => setTimeout(r, 1000));
  await nudge(fake);
  await waitFor(() => wd.out.includes("[999]"), "the word to me", 3000);
  const flat = wd.out.replace(/\n/g, " ");
  assert.match(flat, /спрашивает роль/, `the question folded:\n${wd.out}`);
  assert.match(flat, /вопрос \[90\] снят/, `the withdrawal folded:\n${wd.out}`);
  assert.match(flat, /ответ \[89\] принят/, `the ack folded:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// The withdrawal of a question to me names only the ask's number: the exit
// watchdog gets it in a new process, and the bridge may have restarted since
// the ask. The bridge keeps the ask in the seat's .seen and marks the withdrawal.
// A re-ask of another role on its key, answered or not, puts it out the same way:
// the last line of the key is no longer my question (#6867, #6778).
// The platform hands a frame again when the bridge died in its batch window: the
// replayed withdrawal is still mine, though the first receipt put the question out.
// The open question outlives the day of .seen: its memory is the seat's .asks.
for (const [what, closer, words, answered, replayed, askAgain, evicted] of [
  ["a withdrawn question", () => askWithdrawn(91, 90), "вопрос [90] снят", false, false],
  [
    "a question re-asked of another role",
    () => ask(91, MY_KARTA + 1),
    "[91] Алексей",
    false,
    false,
  ],
  [
    "a question I answered, re-asked of another role,",
    () => reask(91, MY_KARTA + 1, 89),
    "[91] Алексей",
    true,
    false,
  ],
  [
    "a replayed withdrawal of a question",
    () => askWithdrawn(91, 90),
    "вопрос [90] снят",
    false,
    true,
  ],
  // The question itself handed again does not put itself out.
  [
    "a withdrawal of a replayed question",
    () => askWithdrawn(91, 90),
    "вопрос [90] снят",
    false,
    false,
    true,
  ],
  [
    "a withdrawal of a question older than .seen keeps",
    () => askWithdrawn(91, 90),
    "вопрос [90] снят",
    false,
    false,
    false,
    true,
  ],
])
  test(`${what} to me across a bridge restart: the exit watchdog wakes on it in words`, async (t) => {
    const { fake, dir, key, bridge } = await connected(t, {
      env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" },
    });
    await waitFor(() => fake.state.ws.size === 1, "the socket");
    const first = runClient("watchdog-exit", dir, key, 15_000);
    await waitFor(() => first.err.includes("hello"), "hello to be noted");
    await sendRoom(fake, ask(90));
    assert.equal((await first.done).exit, 0, `the question to me wakes: ${first.err}`);
    assert.ok(first.out.includes("спрашивает роль"), `the question in words:\n${first.out}`);
    // I answered the asker myself: my answer does not put the question out
    if (answered) await sendRoom(fake, myAnswer(89, 90));
    if (askAgain) await sendRoom(fake, ask(90)); // the platform hands the question again
    if (replayed) await sendRoom(fake, closer()); // received, then the bridge dies in its window
    await new Promise((r) => setTimeout(r, 300));
    bridge.proc.kill("SIGKILL");
    await waitFor(() => bridge.proc.signalCode !== null, "the first bridge to exit");
    await waitFor(() => fake.state.ws.size === 0, "the fake to see the socket close");
    // A day of traffic later .seen no longer holds the question.
    if (evicted)
      for (const f of readdirSync(join(dir, "standings")).filter((x) => x.endsWith(".seen")))
        writeFileSync(join(dir, "standings", f), "");
    const second = startBridge(fake.mcpUrl, dir, { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" });
    t.after(() => second.stop());
    assert.ok((await second.call("initialize", 1, INIT)).result);
    await fake.control({ places: [{ karta: "931", name: "proba", listening: false }] });
    const st = await second.call("tools/call", 2, {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: "proba" },
    });
    assert.ok(!st.result?.isError, JSON.stringify(st));
    await waitFor(() => fake.state.ws.size === 1, "the place resumed");
    const next = runClient("watchdog-exit", dir, key, 6000);
    await waitFor(() => next.err.includes("hello"), "hello to be noted");
    await sendRoom(fake, closer());
    const r2 = await next.done;
    assert.equal(r2.exit, 0, `${what} must wake after the restart: ${next.err}`);
    assert.ok(next.out.includes(words), `${what} in words:\n${next.out}`);
  });

// A batch whose every frame was handed already (#6574): its head went out with
// them and does not wait to ride before another's line.
test("the Monitor watchdog: the head of a batch of frames already handed does not ride before the next line", async (t) => {
  const { fake, dir, key, standings } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "2500" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const warm = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => warm.out.includes("слушаю стояние"), "the watchdog to attach");
  await nudge(fake, 990);
  await waitFor(() => warm.out.includes("[990]"), "the word to me", 3000);
  await waitSeen(standings, "room-msg-990");
  warm.proc.kill("SIGKILL");
  await warm.done;
  // Frames pass the bridge unseen and wait in its batch; meanwhile another
  // reader hands them — the watchdog armed next reads them as handed.
  await sendRoom(fake, { ...said("defer", 70), addressee: ME });
  await sendRoom(fake, progress(71));
  for (const f of readdirSync(standings).filter((x) => x.endsWith(".seen")))
    writeFileSync(join(standings, f), "room-msg-70\nroom-msg-71\n", { flag: "a" });
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await new Promise((r) => setTimeout(r, 3000));
  await nudge(fake, 991);
  await waitFor(() => wd.out.includes("[991]"), "the word to me", 3000);
  assert.ok(!wd.out.includes("записей 2"), `the handed batch's head rode again:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a case batch under Monitor is short: a count head with a pointer to read it whole with since, then a line per record to me, no envelopes", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  // The first record carries its entry_id in the journal line only: since is read from there too.
  const first = { ...said("defer", 400), addressee: ME };
  delete first.entry_id;
  await sendRoom(fake, first);
  for (let i = 1; i < 5; i++) await sendRoom(fake, said("defer", 400 + i));
  const long = "длинное слово ".repeat(40) + "НЕ-ДОЛЖНО-ВОЙТИ";
  await sendRoom(fake, {
    ...roomFrame("said", { entry_id: 405, key: "said", stack: "defer", body: long }),
    addressee: ME,
  });
  await sendRoom(fake, closing());
  await waitFor(() => wd.out.includes("ты можешь возразить"), "closing to be printed", 5000);
  const lines = wd.lines.map((l) => l.s);
  const head = lines.findIndex((s) => s.includes("записей 6, тебе 2"));
  assert.ok(head >= 0, `the batch head:\n${wd.out}`);
  // How to read it whole stands in the head: a cut takes the tail, not the head.
  assert.match(
    lines[head],
    /^№7 «Стенд»: записей 6, тебе 2 — адресованные строками ниже; целиком — iskron_case\(realm="nks-dev", action="history", room=7, since=399\)\.$/,
  );
  // No hint about an «older tool without since»: the delivery ships the tool with since.
  assert.doesNotMatch(wd.out, /старый тул|older tool/);
  const body = lines.slice(head + 1, head + 3);
  // A line only for a record to me (#6574); the case's zachin — on its first line only (#6081).
  assert.match(
    body[0],
    /^№7 «Стенд» \[400\] слово от Алексей \(@aleksei:probe\): слово со стопкой defer$/,
  );
  assert.ok(body[1].startsWith("№7 [405] "), body[1]);
  assert.ok(body[1].endsWith("…") && !body[1].includes("НЕ-ДОЛЖНО-ВОЙТИ"), body[1]);
  assert.ok(!lines[head + 3]?.startsWith("№7 [4"), "two lines, the rest by count");
  assert.ok(!body.some((s) => s.includes('{"')), "no envelopes in the batch");
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("a lone interrupting said to me under Monitor prints whole and short: case, entry, full text once, no answer call, no batch", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const text = "прерывающее слово ".repeat(15) + "КОНЕЦ-ЦЕЛ";
  await sendRoom(fake, {
    ...roomFrame("said", { entry_id: 500, key: "said", stack: "interrupt", body: text }),
    addressee: ME,
  });
  await waitFor(() => wd.out.includes("КОНЕЦ-ЦЕЛ"), "the said printed", 3000);
  assert.ok(wd.out.includes(text), `the text whole:\n${wd.out}`);
  assert.match(wd.out, /^№7 «Стенд» \[500\] слово от Алексей/m);
  assert.equal(wd.out.split("КОНЕЦ-ЦЕЛ").length - 1, 1, `the text once:\n${wd.out}`);
  const own = wd.out.slice(wd.out.indexOf("№7 «Стенд» [500]")); // hello выше печатается как есть
  assert.ok(!own.includes('{"'), `no raw JSON:\n${own}`);
  assert.doesNotMatch(wd.out, /ответ: iskron_case/, "delivery asks no answer (#6574)");
  assert.ok(!wd.out.includes("записей"), `no batch:\n${wd.out}`);
  assert.ok(!wd.out.includes('iskron_case(action="history"'), `no batch pointer:\n${wd.out}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// A wake of 25 frames after the place came back: a direct word (a human's or a doer's, via
// hook) never rides in the wake batch — each comes alone and whole; the head names the rest.
const WAKE_HUMAN = "слово человека в побудке, позиция 22 — ЦЕЛИКОМ-22";
const WAKE_DOER = "слово делателя в побудке, позиция 24 — ЦЕЛИКОМ-24";
const wakeFrames = (extra = {}) =>
  Array.from({ length: 25 }, (_, i) =>
    JSON.stringify(
      i === 21
        ? { ...humanWord("wk-22", WAKE_HUMAN), ...extra }
        : i === 23
          ? { ...doerWord("wk-24", WAKE_DOER), ...extra }
          : { type: "message", id: `wk-${i + 1}`, body: `ожидавшее-${i + 1}`, ...extra },
    ),
  );

for (const name of ["opencode-iskron", "pi-iskron"]) {
  test(`a wake of 25 frames for ${name}: the direct words at 22 and 24 come alone and whole, the batch names what did not fit`, async (t) => {
    const { fake, bridge } = await connected(t, {
      env: { ISKRON_BRIDGE_BACKLOG_MS: "800" },
      init: { ...INIT, clientInfo: { name, version: "1" } },
    });
    await waitFor(() => fake.state.ws.size === 1, "the socket");
    const data = () => bridge.notifications.map((n) => n.params?.data ?? {});
    await fake.control({
      ws_send_many: [JSON.stringify({ type: "hello", pending: 25 }), ...wakeFrames()],
    });
    await waitFor(() => data().some((d) => d.kind === "backlog"), "the wake batch", 5000);
    const alone = data().filter((d) => d.kind === "frame" && d.frame?.type === "message");
    for (const [id, text] of [
      ["wk-22", WAKE_HUMAN],
      ["wk-24", WAKE_DOER],
    ]) {
      const got = alone.find((d) => d.frame.id === id);
      assert.ok(got, `${id} comes as its own notification`);
      assert.equal(got.frame.body, text, `${id} whole`);
    }
    const burst = data().find((d) => d.kind === "backlog");
    assert.ok(
      !burst.frames.some((f) => ["wk-22", "wk-24"].includes(f.id)),
      "no direct word in the batch",
    );
    assert.match(
      burst.text,
      /Побудка: кадров 23 \(ожидало в очереди: 25\), здесь первые 20, не вошло 3/,
    );
    assert.match(burst.text, /Прямых слов 2 — не здесь/);
  });
}

// #6574: the count of a case in a wake counts every record of it — «тебе N» are
// the lines below, never «none of them yours» above a line addressed to the seat.
test("a wake with a record to the seat and one not, of one case: one count «записей 2, тебе 1», then the line to the seat", async (t) => {
  const { fake, bridge } = await connected(t, {
    env: { ISKRON_BRIDGE_BACKLOG_MS: "800" },
    init: { ...INIT, clientInfo: { name: "pi-iskron", version: "1" } },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const data = () => bridge.notifications.map((n) => n.params?.data ?? {});
  const mine = { ...said("defer", 45), addressee: ME };
  await fake.control({
    ws_send_many: [
      JSON.stringify({ type: "hello", pending: 2 }),
      JSON.stringify(progress(44)),
      JSON.stringify(mine),
    ],
  });
  await waitFor(() => data().some((d) => d.kind === "backlog"), "the wake batch", 5000);
  const burst = data().find((d) => d.kind === "backlog");
  assert.match(burst.text, /\n№7 «Стенд»: записей 2, тебе 1 — адресованные строками ниже; /);
  assert.doesNotMatch(burst.text, /тебе 0/, burst.text);
  assert.match(burst.text, /\[45\] слово от Алексей[^\n]*\nслово со стопкой defer/);
  assert.doesNotMatch(burst.text, /пробы зелёные/, burst.text);
});

test("a stale burst of 25 frames for the Monitor watchdog: the direct words at 22 and 24 print alone and whole, the batch names what did not fit", async (t) => {
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog");
  await fake.control({ ws_send_many: wakeFrames({ stale: true }) });
  await waitFor(() => /Лежалых кадров: \d+/.test(wd.out), "the stale batch", 6000);
  await waitFor(
    () => wd.out.includes("ЦЕЛИКОМ-22") && wd.out.includes("ЦЕЛИКОМ-24"),
    "both direct words",
    3000,
  );
  assert.ok(wd.out.includes(WAKE_HUMAN) && wd.out.includes(WAKE_DOER), wd.out);
  assert.match(wd.out, /Лежалых кадров: 23, здесь первые 20, не вошло 3/);
  assert.match(wd.out, /^человек @dmitry/m);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("watchdog-codex: progress starts no turn; closing carries the batch count into the thread ahead of itself, one turn", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "10000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = codexHome(t);
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
  await waitFor(() => turns().length === 1, "closing in the thread");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(turns().length, 1, "a batch of counts starts no turn of its own");
  const [second] = turns().map((c) => c.params.input[0].text);
  // #6574: a ledger line not to the seat rides into the thread as a count, no words.
  assert.ok(
    second.startsWith(
      '№7 «Стенд»: записей 1, тебе 0 — адресованных месту нет; целиком — iskron_case(realm="nks-dev", action="history", room=7, since=46).\n',
    ),
    second,
  );
  assert.match(second, /предлагает закрыть дело/);
  assert.match(
    second,
    /ты можешь возразить — iskron_case\(action="object", in_reply_to=50\) \(прежнее имя iskron_room\)/,
  );
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// #6574 on re-arm: records not to the seat, held as a count and not yet handed,
// come back from the bridge's ring to the next watchdog — still a count, no wake.
test("the exit watchdog re-armed after a batch of counts alone does not wake on the replayed counts", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => first.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, progress(46));
  await waitFor(() => first.err.includes("счёт ждёт ближайшей побудки"), "the batch held", 6000);
  first.proc.kill("SIGKILL");
  await first.done;
  const wd = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the watchdog to attach");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(wd.proc.exitCode, null, `the re-armed watchdog woke on a count:\n${wd.out}`);
  assert.equal(wd.out, "", `the replayed count printed:\n${wd.out}`);
  await nudge(fake, 49);
  const r = await wd.done;
  assert.equal(r.exit, 0, `the word to me must wake: ${wd.err}`);
  assert.match(wd.out, /^№7 «Стенд»: записей 1, тебе 0[^\n]*\n№7 «Стенд» \[49\] /);
  assert.ok(!wd.out.includes("[46] "), `the replayed record's line:\n${wd.out}`);
});

test("the Monitor watchdog re-armed after a batch of counts alone prints nothing for the replayed counts", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => first.out.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, progress(46));
  await new Promise((r) => setTimeout(r, 1800));
  first.proc.kill("SIGKILL");
  await first.done;
  const wd = runClient("watchdog", dir, key, 15_000);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  await new Promise((r) => setTimeout(r, 1500));
  const after = wd.out.slice(wd.out.indexOf("слушаю стояние"));
  assert.ok(!after.includes("[46]") && !after.includes("записей"), `a count woke:\n${after}`);
  await nudge(fake, 49);
  await waitFor(() => wd.out.includes("[49]"), "the word to me", 3000);
  assert.match(wd.out, /№7 «Стенд»: записей 1, тебе 0[^\n]*\n№7 «Стенд» \[49\] /);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

test("watchdog-codex re-armed after a batch of counts alone starts no turn on the replayed counts", async (t) => {
  const { fake, dir, key } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "800" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const home = codexHome(t);
  const sock = join(home, "app-server-control", "app-server-control.sock");
  const log = join(home, "door.log");
  writeFileSync(log, "");
  const door = await startFakeCodex(sock, log);
  t.after(() => door.stop());
  const env = { CODEX_HOME: home, CODEX_THREAD_ID: "thread-rearm" };
  const turns = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.method === "turn/start");
  const first = runClient("watchdog-codex", dir, key, 15_000, env);
  await waitFor(() => first.err.includes("слушаю стояние"), "the watchdog to attach");
  await sendRoom(fake, progress(47));
  await new Promise((r) => setTimeout(r, 1800));
  first.proc.kill("SIGKILL");
  await first.done;
  const wd = runClient("watchdog-codex", dir, key, 15_000, env);
  await waitFor(() => wd.err.includes("слушаю стояние"), "the watchdog to attach");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(turns().length, 0, `the replayed count started a turn: ${JSON.stringify(turns())}`);
  wd.proc.kill("SIGKILL");
  await wd.done;
});

// The exit watchdog leaving on a batch: the records after its line were named in
// the head it printed — handed, they are marked and come back to nobody.
test("the exit watchdog leaving on a batch marks the counted records after its line as handed", async (t) => {
  const { fake, dir, key, standings } = await connected(t, {
    env: { ISKRON_BRIDGE_ROOM_BATCH_MS: "1000" },
  });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog-exit", dir, key, 15_000);
  await waitFor(() => wd.err.includes("hello"), "hello to be noted");
  await sendRoom(fake, { ...said("defer", 70), addressee: ME });
  await sendRoom(fake, progress(71));
  const r = await wd.done;
  assert.equal(r.exit, 0, `the word to me must wake: ${wd.err}`);
  assert.match(wd.out, /записей 2, тебе 1/);
  await waitSeen(standings, "room-msg-71");
});

// Today's production (api 0.86.0) sends no event_kind: every old room frame, whatever its
// kind or stack, and every non-room frame reach a watchdog at once, as on main. Guards of
// main's behaviour — green on main by design.
const LEGACY_AT_ONCE = () => [
  [directWord(), "прямое слово соседа"],
  [graphPosed(), '"vimarsha_seq":5829'],
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
  assert.ok(!wd.out.includes("записей"), `no batch without event_kind:\n${wd.out}`);
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
  const home = codexHome(t);
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

// Английская поверхность (граф nks-dev: #6080): мост и сторожа, которых он называет
// в своём блоке, говорят уход, возврат и hello без кириллицы. Язык сторож берёт
// из команды моста (`--lang`), не из своего окружения: оно ему язык не называет.
const CYRILLIC = /[А-Яа-яЁё]/;
const NO_LANG_ENV = { ISKRON_BRIDGE_LANG: "", ISKRON_BRIDGE_URL: "" };

/** Флаги, которыми блок моста велит запускать сторожа `sub`. */
function flagsOfBlock(text, sub) {
  const tail = new RegExp(`${sub} \\S+((?: --[\\w-]+ (?:"[^"]*"|\\S+))*)`).exec(text)?.[1] ?? "";
  return (tail.match(/--[\w-]+ (?:"[^"]*"|\S+)/g) ?? []).flatMap((f) => {
    const at = f.indexOf(" ");
    return [f.slice(0, at), f.slice(at + 1).replace(/^"|"$/g, "")];
  });
}

test("English surface: leave, resume and hello — the bridge and the three watchdogs it names print no Cyrillic", async (t) => {
  const { fake, dir, bridge, text, key } = await connected(t, {
    env: { ISKRON_BRIDGE_LANG: "en" },
  });
  // Прозу о месте несёт сервер (фейк — по-русски); блок моста — его слово.
  const block = text.slice(text.indexOf("[iskron-bridge]"));
  assert.doesNotMatch(block, CYRILLIC, block);
  assert.match(text, /--lang en/, "the block names the language to the watchdog");
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const spawnWd = (sub, env = {}) =>
    runClient(sub, dir, key, 20_000, { ...NO_LANG_ENV, ...env }, flagsOfBlock(text, sub));
  const mon = spawnWd("watchdog");
  await waitFor(() => mon.out.includes("listening on standing"), "the Monitor watchdog to attach");
  await waitFor(() => mon.out.includes('"type":"hello"'), "hello at the Monitor watchdog");
  const exit = spawnWd("watchdog-exit");
  await waitFor(() => exit.err.includes("not a reason to wake"), "hello at the exit watchdog");
  for (const wd of [mon, exit]) {
    assert.doesNotMatch(wd.out + wd.err, CYRILLIC, `${wd.out}${wd.err}`);
    wd.proc.kill("SIGKILL");
    await wd.done;
  }
  // Тело кадра — слово соседа (фейк — по-русски): в stderr Codex-сторожа — только его слова.
  const home = mkdtempSync("/tmp/cxe-");
  const door = await startFakeCodex(
    join(home, "app-server-control", "app-server-control.sock"),
    join(home, "door.log"),
  );
  t.after(() => door.stop());
  const codex = spawnWd("watchdog-codex", { CODEX_HOME: home, CODEX_THREAD_ID: "thread-en" });
  await waitFor(() => codex.err.includes("listening on standing"), "the Codex watchdog to attach");
  await waitFor(() => codex.err.includes("not a reason to wake"), "hello at the Codex watchdog");
  await sendRoom(fake, directWord());
  await waitFor(() => codex.err.includes("frame put into thread"), "a frame into the thread");
  assert.doesNotMatch(codex.out + codex.err, CYRILLIC, `${codex.out}${codex.err}`);
  codex.proc.kill("SIGKILL");
  await codex.done;
  const left = await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  const leftText = left.result?.content?.[0]?.text ?? "";
  assert.ok(!left.result?.isError, leftText);
  assert.match(leftText, /busyness cleared/, leftText);
  assert.doesNotMatch(leftText, CYRILLIC, leftText);
  const back = await bridge.call("tools/call", 6, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", status: "back" },
  });
  const backText = (back.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.ok(!back.result?.isError, backText);
  assert.match(backText, /hello received/, backText);
  // «(Вебхук #N создан → …)» — проза сервера внутри строки хука, не слово моста.
  const bridgeWords = backText.replace(/\(Вебхук[^)]*\)/, "");
  assert.doesNotMatch(bridgeWords, CYRILLIC, bridgeWords);
});
