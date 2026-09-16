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
function startBridge(serverUrl, authDir) {
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_BROWSER: "1" },
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
      proc.exitCode !== null
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
async function connected(t) {
  const fake = await startFakeNks();
  const dir = mkdtempSync(join(tmpdir(), "iskron-standing-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const pending = await bridge.call("initialize", 1, INIT);
  const url = authorizeUrlIn(pending.error?.message);
  assert.ok(url, `expected an authorize URL, got ${JSON.stringify(pending)}`);
  const res = await fetch(url, { redirect: "follow" });
  await res.text();
  await waitFor(
    () => readdirSync(dir).some((f) => f.endsWith(".json")),
    "the exchanged tokens to reach the store",
  );
  const init = await bridge.call("initialize", 2, INIT);
  assert.ok(init.result, `initialize after the grant: ${JSON.stringify(init)}`);
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

test("connect under a new name re-keys the hold: the block and the key file follow the name", async (t) => {
  const { fake, bridge, standings } = await connected(t);
  await waitFor(() => fake.state.ws.size === 1, "the first socket");
  const reply = await bridge.call("tools/call", 5, {
    name: "iskron_channel",
    arguments: { ...CONNECT, name: "vtoraya" },
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
  assert.ok(!wd.err.includes("лежалый 1"), "a stale frame never reaches a local client at all");
  await waitFor(
    () => wd.err.includes("лежалых кадров: 3"),
    "the burst note to reach the client too",
  );
  assert.ok(
    !bridge.notifications.some((n) => /лежалый/.test(n.params?.data?.frame?.body ?? "")),
    "a stale frame must not ride to the harness as a prompt of its own",
  );
  await waitFor(
    () => bridge.notifications.some((n) => /лежалых кадров: 3/.test(n.params?.data?.text ?? "")),
    "one note for the burst",
  );
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

test("watchdog with nothing held tells the doer to connect first", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-empty-"));
  const wd = runClient("watchdog", dir, undefined, 5000);
  const r = await wd.done;
  assert.equal(r.exit, 2);
  assert.match(wd.err, /connect/);
});
