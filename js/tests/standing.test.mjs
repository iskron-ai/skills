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
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeCodex } from "./fake-codex.mjs";
import { startFakeNks } from "./fake-nks.mjs";

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
async function connected(t, { env = {}, init = INIT } = {}) {
  const fake = await startFakeNks();
  const dir = mkdtempSync(join(tmpdir(), "iskron-standing-"));
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
  await waitFor(
    () => readdirSync(dir).some((f) => f.endsWith(".json")),
    "the exchanged tokens to reach the store",
  );
  const initReply = await bridge.call("initialize", 2, init);
  assert.ok(initReply.result, `initialize after the grant: ${JSON.stringify(initReply)}`);
  const reply = await bridge.call("tools/call", 3, { name: "iskron_channel", arguments: CONNECT });
  const text = (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  const key = /watchdog (\S+)/.exec(text)?.[1];
  return { fake, dir, bridge, reply, text, key, standings: join(dir, "standings") };
}

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

test("a truncated frame is read to the end by the bridge before anyone sees it", async (t) => {
  const { fake, dir, bridge, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const wd = runClient("watchdog", dir, key);
  await waitFor(() => wd.out.includes("слушаю стояние"), "the watchdog to attach");
  const full = "Длинное слово соседа, ".repeat(20).trim();
  await fake.control({ message_full: { id: "m-long", text: full } });
  await fake.control({
    ws_send: JSON.stringify({
      type: "message",
      id: "m-long",
      body: full.slice(0, 40) + "...(truncated)",
      body_chars: [...full].length,
      provenance: { from_standing: "@alari:sosед", auth: "oidc" },
    }),
  });
  await waitFor(() => wd.out.includes("m-long"), "the frame to reach the watchdog");
  // The watchdog prints the frame as text — the envelope line carries body_read.
  const envelope = wd.out.split("\n").find((l) => l.startsWith("frame: "));
  assert.ok(envelope, `no envelope line in:\n${wd.out}`);
  const frame = JSON.parse(envelope.slice("frame: ".length));
  assert.equal(frame.body_read, "history");
  assert.ok(
    wd.out.replace(/\n/g, " ").includes(full),
    "the doer must get the whole body, not the cut",
  );
  assert.match(
    wd.out,
    /от делателя роли неизвестной — стояние @alari:sosед/,
    "the bridge stamps who speaks",
  );
  assert.ok(
    bridge.notifications.some((n) => n.params?.data?.frame?.body === full),
    "the plugin-side notification carries the whole body too",
  );
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
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const mon = runClient("watchdog", dir, key);
  await waitFor(() => mon.out.includes("слушаю стояние"), "the Monitor watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ id: "seen-1", type: "message", body: "первый" }),
  });
  await waitFor(() => mon.out.includes("первый"), "the frame to be printed");
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
  const { fake, dir, key } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const first = runClient("watchdog", dir, key, 20_000);
  await waitFor(() => first.out.includes("слушаю стояние"), "the first watchdog to attach");
  await fake.control({
    ws_send: JSON.stringify({ type: "message", id: "m-1", body: "первое слово" }),
  });
  await waitFor(() => first.out.includes("первое слово"), "the frame to reach the first watchdog");
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
test("a bridge restarted under a held place resumes it from disk: same address, no connect, the busy line back; while the board still reads «слушает» — only register", async (t) => {
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
  assert.match(said, /Занятость возвращена с местом: до перезапуска/, said);
  await waitFor(() => fake.state.status === "до перезапуска", "the busy line to come back");
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
  assert.match(reg.result.content[0].text, /зарегистрировано/);
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

// The plugin cannot pass anything to a bridge it spawned before the session
// existed; instead it asks the bridge to resume by the session's directory,
// which iskron_stand wrote into the hold record.
test("iskron/resume by the session's directory: a bridge restarted after the plugin's death takes the place back, registers, and only for the right directory", async (t) => {
  const { fake, dir, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const cwd = mkdtempSync(join(tmpdir(), "iskron-session-dir-"));
  const stand = await bridge.call("tools/call", 5, {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", cwd, status: "на вахте" },
  });
  const said = (stand.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.match(said, /сокет уже держит этот мост — register/, said);
  const hold = readdirSync(standings).find((f) => f.endsWith(".hold"));
  assert.equal(
    JSON.parse(readFileSync(join(standings, hold), "utf8")).cwd,
    cwd,
    "the record names the directory",
  );
  const known = new Set(fake.state.ws);
  const fresh = () => [...fake.state.ws].filter((x) => !known.has(x));
  bridge.proc.kill("SIGKILL");
  await waitFor(() => fake.state.ws.size === 0, "the socket to close");
  await fake.control({ helloPending: 2 });
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", 1, INIT)).result);
  const wrong = await second.call("iskron/resume", 2, { cwd: "/nowhere/else" });
  assert.equal(wrong.result?.resumed, false, JSON.stringify(wrong));
  assert.equal(fresh().length, 0, "another directory's place is not touched");
  const registers = fake.state.counts.register_standing;
  const back = await second.call("iskron/resume", 3, { cwd });
  assert.equal(back.result?.resumed, true, JSON.stringify(back));
  assert.equal(back.result.pending, 2, "the answer says how many frames waited");
  assert.match(back.result.word, /возврат места с диска/);
  assert.match(back.result.word, /register/);
  assert.match(back.result.word, /занятость возвращена: на вахте/);
  assert.equal(fake.state.counts.connect, 1, "the place is resumed, not rotated");
  assert.equal(fresh().length, 1, "one socket reopened on the saved address");
  assert.equal(
    fake.state.counts.register_standing,
    registers + 1,
    "the session is attributed by register",
  );
  await waitFor(() => fake.state.status === "на вахте", "the busy line to come back");
  assert.ok(
    second.notifications.some((n) => n.params?.data?.kind === "held"),
    "the resumed place is said as «held»",
  );
  const again = await second.call("iskron/resume", 4, { cwd });
  assert.equal(again.result?.resumed, true, "a held place answers «held», not a second resume");
  assert.match(again.result.word, /уже держит/);
  assert.equal(fresh().length, 1, "no second socket for a place already held");
  assert.match(
    readFileSync(join(dir, "standings.log"), "utf8"),
    /resumed-from-disk proba--931--nks-dev: pending 2/,
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
  const foreign = await other.call("iskron/resume", 2, { cwd });
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
  const staleKey = await mine.call("iskron/resume", 3, { key: "drugoe--931--nks-dev", cwd });
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
  assert.ok(
    readdirSync(standings)
      .filter((f) => f.endsWith(".hold"))
      .some(
        (f) => JSON.parse(readFileSync(join(standings, f), "utf8")).key === "svezhee--931--nks-dev",
      ),
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
