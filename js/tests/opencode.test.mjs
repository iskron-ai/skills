// Behavioural probe for the OpenCode plugin shipped in
// skills/establish-mcp/scripts/opencode-plugin.js — the door that gives an
// OpenCode 2 session three halves of Iskron: the iskron_* tools under their own
// names (raised over a child iskron-bridge), the live channel, delivered as a
// prompt into the session that holds the standing, and a «/» command for every
// installed skill of the delivery.
//
// The plugin is an ordinary module with a default export {id, setup(ctx)}: the
// probe calls setup with a stand-in context and reads what it registered.
// Three seams keep that honest:
//
//   • the bridge is a REAL child process — tests/fake-bridge.mjs, aimed at by
//     ISKRON_BRIDGE_PATH; the spawn/NDJSON/pagination path is not imitated.
//   • the standing socket is held by the bridge, not the plugin: the channel
//     half only reads the bridge's notifications, and the fake bridge emits
//     those from a file (FB_EVENTS) the probe appends to.
//   • the module is loaded from a COPY in a temp dir, HOME points there too,
//     so the home-copy candidate for the bridge is the probe's to decide.
//
// The shipped file imports nothing: the stand-in context is the whole surface.
// Transforms are replayed the way OpenCode replays them — a reload rebuilds the
// registry from the registered callbacks.
//
// ISKRON_OPENCODE_PLUGIN points the probe at any copy (a past revision, a
// broken one) so it can be shown red before a fix. Run with `make test-opencode`.
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";
import {
  closing,
  directWord,
  graphPosed,
  legacyRoom,
  ME_ID,
  PLATFORM,
  progress,
  roomFrame,
  said as saidFrame,
  unknownKind,
} from "./room-frames.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE =
  process.env.ISKRON_OPENCODE_PLUGIN ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "opencode-plugin.js");
const FAKE_BRIDGE = join(HERE, "fake-bridge.mjs");
/** The real bridge of this checkout — for the one probe that measures the plugin's stop against it. */
const REAL_BRIDGE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");

const SANDBOX = mkdtempSync(join(tmpdir(), "iskron-opencode-"));
const COPY = join(SANDBOX, "iskron.js");
copyFileSync(SOURCE, COPY);
process.env.HOME = SANDBOX;
process.env.ISKRON_BRIDGE_AUTH_DIR = join(SANDBOX, "auth");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** The markers keep.ts leaves next to the grant when a plugin stops with a holding bridge — one file per instance. */
const lostMarkers = () => {
  const dir = process.env.ISKRON_BRIDGE_AUTH_DIR;
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("opencode-lost") && f.endsWith(".json"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
};

// ── the context the plugin is handed ─────────────────────────────────────────

/** A replayable registry: every transform callback re-runs on reload, as in OpenCode. */
function registry() {
  const transforms = [];
  let current = new Map();
  const replay = () => {
    const m = new Map();
    const editor = {
      add: (d) => m.set(d.name, d),
      remove: (id) => m.delete(id),
      get: (id) => m.get(id),
      list: () => [...m.values()],
      update() {},
      namespace() {},
    };
    for (const t of transforms) t(editor);
    current = m;
  };
  return {
    transform: async (cb) => {
      transforms.push(cb);
      replay();
      return { dispose: async () => {} };
    },
    reload: async () => replay(),
    get: () => current,
  };
}

function fakeCtx({ sessions = [], skills = [], gone = new Set() } = {}) {
  const prompts = [];
  const tools = registry();
  const commands = registry();
  const queue = [];
  let wake = null;
  const stderr = [];
  const ctx = {
    tool: { transform: tools.transform, reload: tools.reload },
    command: { transform: commands.transform, reload: commands.reload },
    session: {
      // A deleted session is a thrown NotFound in OpenCode; an unlisted one is
      // simply a root the probe never described.
      get: async ({ sessionID }) => {
        if (gone.has(sessionID)) throw new Error(`Session not found: ${sessionID}`);
        return sessions.find((x) => x.id === sessionID) ?? { id: sessionID };
      },
      prompt: async (o) => {
        prompts.push(o);
        return {};
      },
    },
    skill: { list: async () => ({ location: { directory: SANDBOX }, data: skills }) },
    event: {
      subscribe: async function* ({ signal } = {}) {
        while (!signal?.aborted) {
          if (queue.length) {
            yield queue.shift();
            continue;
          }
          await new Promise((r) => {
            wake = r;
            signal?.addEventListener("abort", r, { once: true });
          });
        }
      },
    },
  };
  return {
    ctx,
    prompts,
    tools: () => tools.get(),
    commands: () => commands.get(),
    emit: (ev) => {
      queue.push(ev);
      wake?.();
    },
    stderr,
  };
}

const ENV_KEYS = [
  "ISKRON_BRIDGE_PATH",
  "ISKRON_MCP_HANDSHAKE_MS",
  "ISKRON_MCP_AUTH_POLL_MS",
  "ISKRON_BRIDGE_IDLE_MS",
  "ISKRON_BRIDGE_REAP_MS",
  "FB_LOG",
  "FB_MODE",
  "FB_AUTHED",
  "FB_TOOLS",
  "FB_PAGINATE",
  "FB_TOOLS_FILE",
  "FB_CHANGED",
  "FB_REPLY",
  "FB_EVENTS",
  "FB_CALLS",
  "FB_RESUME",
  "ISKRON_BRIDGE_WATCH_MS",
  "ISKRON_BRIDGE_URL",
  "ISKRON_BRIDGE_TOKEN",
  "ISKRON_BRIDGE_NO_BROWSER",
];

let seq = 0;
async function loadPlugin(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
  return (await import(`${pathToFileURL(COPY).href}?n=${++seq}`)).default;
}

// The plugin speaks to the human through the service's stderr: the probe
// listens there instead of a TUI toast.
function captureStderr(into) {
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    into.push(String(chunk));
    return write(chunk, ...rest);
  };
  return () => (process.stderr.write = write);
}

/** A loaded plugin: registries in hand, cleanup at hand. */
async function plugin(env = {}, ctxOpts = {}) {
  // A plugin stopped with a holding bridge leaves a marker for the next instance
  // (keep.ts); the probes share one auth dir, so each starts clean unless it is
  // the marker itself that is under test.
  if (!ctxOpts.keepMarker) for (const f of lostMarkers()) rmSync(f, { force: true });
  const def = await loadPlugin(env);
  assert.equal(def.id, "iskron", "the default export must be a definition with an id");
  const rec = fakeCtx(ctxOpts);
  const restore = captureStderr(rec.stderr);
  rec.cleanup = await def.setup(rec.ctx);
  rec.said = () => rec.stderr.join("");
  rec.stop = async () => {
    await rec.cleanup?.();
    restore();
  };
  rec.call = (name, input, sessionID) => {
    const t = rec.tools().get(name);
    assert.ok(t, `tool ${name} must be registered`);
    return t.execute(input, { sessionID, agent: "build", messageID: "m", id: "c" });
  };
  return rec;
}

function bridgeEnv(name, extra = {}) {
  const log = join(SANDBOX, `${name}.log`);
  const reply = join(SANDBOX, `${name}.reply`);
  const events = join(SANDBOX, `${name}.events`);
  writeFileSync(reply, "");
  writeFileSync(events, "");
  return {
    log,
    reply,
    events,
    env: {
      ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
      FB_LOG: log,
      FB_REPLY: reply,
      FB_EVENTS: events,
      ...extra,
    },
  };
}

const pidsOf = (log) =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => Number(l.split(/\s+/)[1]));
const pidOf = (log) => pidsOf(log)[0];
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check, what, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const BRIDGE_TOOLS = ["iskron_bridge", "iskron_channel", "iskron_orient"];
const names = (rec) => [...rec.tools().keys()].sort();
const serverTools = (rec) => until(() => names(rec).length === 3, "the server's tools", 8000);

// ── tools ────────────────────────────────────────────────────────────────────

test("every bridge tool stands under its own name, with the server's JSON Schema as its input", async () => {
  const b = bridgeEnv("own-names", { FB_PAGINATE: "1" });
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    assert.deepEqual(names(rec), BRIDGE_TOOLS);
    const channel = rec.tools().get("iskron_channel");
    assert.equal(channel.description.split("\n")[0], "Живой канал делателя.");
    assert.deepEqual(channel.input.properties.action.enum, ["connect", "mint", "register"]);
    assert.deepEqual(channel.input.required, ["action"]);
    assert.match(rec.said(), /тулов в сессии: 2 \(с сервера\)/);
    const status = await rec.call("iskron_bridge", {}, "s-0").then((r) => r.content);
    assert.match(status, /тулов iskron_\*: 2/);
    assert.match(
      status,
      /сборка: мост v\S+\+[0-9a-f]{8}, плагин v\S+/,
      "the status names both builds — the doer answers which build holds without reading files",
    );
  } finally {
    await rec.stop();
  }
});

// The server changed its tools under a live bridge (a rollout), and the bridge
// says notifications/tools/list_changed (#5406): the plugin re-reads the list
// and reloads its transforms — the session sees the new tool without a restart.
test("list_changed from the bridge re-reads the tools and reloads them", async () => {
  const toolsFile = join(SANDBOX, "changed-tools.json");
  const flag = join(SANDBOX, "changed-flag");
  const b = bridgeEnv("list-changed", { FB_TOOLS_FILE: toolsFile, FB_CHANGED: flag });
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-lc");
    const channel = {
      name: "iskron_channel",
      description: "Живой канал делателя.",
      inputSchema: { type: "object", properties: { action: { type: "string" } } },
    };
    const fresh = {
      name: "iskron_new",
      description: "Новый тул.",
      inputSchema: { type: "object" },
    };
    writeFileSync(toolsFile, JSON.stringify([channel, fresh]));
    writeFileSync(flag, "");
    await until(() => rec.tools().has("iskron_new"), "the new tool after list_changed");
    assert.match(rec.said(), /сервер сменил тулы/);
  } finally {
    await rec.stop();
  }
});

// The bridge runs from the OpenCode server's cwd, not from the session's working
// copy: the plugin hands iskron_stand the session's directory as cwd, and the
// bridge derives the repository part of the name from it (r5 #5108).
test("iskron_stand is given the session's directory as cwd; an explicit cwd is left alone", async () => {
  const calls = join(SANDBOX, "stand-cwd.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("stand-cwd", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      {
        name: "iskron_stand",
        description: "Занять стояние одним вызовом.",
        inputSchema: { type: "object", properties: { realm: { type: "string" } } },
      },
      {
        name: "iskron_orient",
        description: "Ориентация.",
        inputSchema: { type: "object", properties: {} },
      },
    ]),
  });
  // SessionInfo of OpenCode 2 carries the directory under location, not at the
  // top (@opencode/plugin 2.0.4) — the shape skill.list mirrors above.
  const rec = await plugin(b.env, {
    sessions: [
      { id: "s-dir", location: { directory: "/work/of/the-session" } },
      // A subagent in its own worktree that stands gets a bridge of its own
      // (#5154) — and so its own name from its own directory; the root's
      // standing is never renamed by it, because it never touches the root's bridge.
      { id: "s-child", parentID: "s-dir", location: { directory: "/tmp/worktree-of-child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "s-dir");
    await rec.call("iskron_orient", {}, "s-dir");
    await rec.call(
      "iskron_stand",
      { realm: "nks-dev", karta: "#931", cwd: "/said/by/agent" },
      "s-dir",
    );
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "s-unknown");
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "s-child");
    // The bridge's own requests (iskron/resume for a session with a directory)
    // ride the same log; here only the tool calls are judged.
    const sent = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => !c.name.startsWith("iskron/"));
    assert.equal(sent[0].name, "iskron_stand");
    assert.equal(
      sent[0].arguments.cwd,
      "/work/of/the-session",
      "the session's directory rides as cwd — the bridge's own cwd is the server's",
    );
    assert.equal(sent[1].name, "iskron_orient");
    assert.equal(sent[1].arguments.cwd, undefined, "other tools get no cwd");
    assert.equal(sent[2].arguments.cwd, "/said/by/agent", "an explicit cwd is not overridden");
    assert.equal(
      sent[3].arguments.cwd,
      undefined,
      "a session without a directory sends none — the bridge falls back to its cwd",
    );
    assert.equal(
      sent[4].arguments.cwd,
      "/tmp/worktree-of-child",
      "a child session that stands does so through a bridge of its own, under its own directory (#5154)",
    );
  } finally {
    await rec.stop();
  }
});

test("a call is proxied to the bridge and its text comes back as the tool's content", async () => {
  const b = bridgeEnv("proxy");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    writeFileSync(b.reply, "Живой ответ графа");
    const out = await rec.call("iskron_orient", {}, "s-1");
    assert.equal(out.content, "Живой ответ графа");
    writeFileSync(b.reply, "__ERROR__ключ не тот");
    await assert.rejects(
      () => rec.call("iskron_channel", { action: "connect" }, "s-1"),
      /ключ не тот/,
      "a refused tool must surface as a thrown error, not as text",
    );
  } finally {
    await rec.stop();
  }
});

test("cleanup kills every bridge the plugin spawned", async () => {
  const b = bridgeEnv("dispose");
  const rec = await plugin(b.env);
  await serverTools(rec);
  await rec.call("iskron_orient", {}, "s-1");
  await rec.call("iskron_orient", {}, "s-2");
  const pids = pidsOf(b.log);
  assert.equal(pids.length, 2, "two root sessions, two bridges");
  assert.ok(pids.every(alive), "the bridges must be running while the plugin lives");
  await rec.stop();
  await until(() => pids.every((p) => !alive(p)), "every bridge to die after cleanup");
});

test("the spare bridge of an idle location is released once the server's list is in, and a later call raises a fresh one", async () => {
  const b = bridgeEnv("spare-idle", { ISKRON_BRIDGE_IDLE_MS: 200, ISKRON_BRIDGE_REAP_MS: 100 });
  const rec = await plugin(b.env);
  try {
    await until(() => /\(с сервера\)/.test(rec.said()), "the server's list");
    const pid = pidOf(b.log);
    await until(() => !alive(pid), "the idle spare to be released", 3000);
    assert.match((await rec.call("iskron_bridge", {}, "s-idle")).content, /мостов живых: 0/);
    writeFileSync(b.reply, "после простоя");
    assert.equal((await rec.call("iskron_orient", {}, "s-idle")).content, "после простоя");
    assert.equal(pidsOf(b.log).length, 2, "a fresh bridge for the session, not the released one");
  } finally {
    await rec.stop();
  }
});

test("no bridge on the machine: no tools, and the plugin says where it looked", async () => {
  const rec = await plugin({ ISKRON_BRIDGE_PATH: join(SANDBOX, "no-such-bridge.mjs") });
  try {
    assert.equal(rec.tools().size, 0);
    assert.match(rec.said(), /мост не найден/);
    assert.match(rec.said(), /no-such-bridge\.mjs/);
    assert.match(rec.said(), /iskron-bridge\.mjs/, "the home copy must be among the candidates");
  } finally {
    await rec.stop();
  }
});

test("a bridge stuck in someone's browser: tools come from the last list at once, a call waits for it", async () => {
  // First a good run to leave a tools list behind.
  const ok = bridgeEnv("cache-fill");
  const filled = await plugin(ok.env);
  await serverTools(filled);
  await filled.stop();
  const b = bridgeEnv("cache-use", { FB_MODE: "mute" });
  const rec = await plugin(b.env);
  try {
    assert.deepEqual(names(rec), BRIDGE_TOOLS, "setup must not wait for the bridge");
    assert.match(rec.said(), /из прошлого списка/);
    // The call must not answer before the bridge does — here, never.
    const call = rec.call("iskron_orient", {}, "s-2");
    let settled = false;
    call.then(
      () => (settled = true),
      () => (settled = true),
    );
    await delay(300);
    assert.equal(settled, false, "a call over a mute bridge must keep waiting, not answer");
  } finally {
    await rec.stop();
  }
});

// A bridge with no grant answers every request -32001 «authorization required»
// and keeps its browser flow listening on loopback until the human finishes.
// Stopping it then kills the callback: the login goes through at the server and
// the redirect lands on a refused connection.

test("first run without a grant and without a last list: setup returns at once, iskron_bridge names the login, the tools come after it", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-fresh-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir; // no opencode-tools.json there
  const authed = join(SANDBOX, "first-login.authed");
  const b = bridgeEnv("first-login", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    ISKRON_MCP_AUTH_POLL_MS: 50,
  });
  const rec = await plugin(b.env);
  try {
    assert.deepEqual(names(rec), ["iskron_bridge"], "the status tool is there before the login");
    await until(() => /нужен вход/.test(rec.said()), "the login line");
    assert.match(rec.said(), /127\.0\.0\.1:43265\/authorize/, "the line names the login link");
    const status = (await rec.call("iskron_bridge", {}, "s-login")).content;
    assert.match(status, /вход: НЕ ВЫПОЛНЕН/);
    assert.match(
      status,
      /127\.0\.0\.1:43265\/authorize/,
      "the session can learn the address itself",
    );
    assert.match(status, /ssh -L/, "a headless machine is told the way in");
    await delay(400);
    const pid = pidOf(b.log);
    assert.ok(alive(pid), "the bridge holding the browser flow must not be stopped");
    assert.equal(pidsOf(b.log).length, 1, "the login is waited for, not restarted");
    writeFileSync(authed, "");
    writeFileSync(join(authDir, "fake_grant.json"), "{}"); // the grant lands next to the tools cache
    await serverTools(rec);
    writeFileSync(b.reply, "ответ после входа");
    const out = await rec.call("iskron_orient", {}, "s-login");
    assert.equal(out.content, "ответ после входа");
    assert.equal(pidsOf(b.log).length, 1, "the first session takes the bridge that saw the login");
    assert.match((await rec.call("iskron_bridge", {}, "s-login")).content, /вход: есть/);
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
    process.env.ISKRON_BRIDGE_AUTH_DIR = prevAuth;
  }
});

test("a last list and no grant: tools come from the list, a call refuses with the address instead of hanging, and passes after the login", async () => {
  const authed = join(SANDBOX, "cached-login.authed");
  const b = bridgeEnv("cached-login", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    ISKRON_MCP_AUTH_POLL_MS: 50,
  });
  const rec = await plugin(b.env);
  try {
    assert.match(rec.said(), /из прошлого списка/);
    await until(() => /нужен вход/.test(rec.said()), "the login line");
    await assert.rejects(
      () => rec.call("iskron_orient", {}, "s-cached"),
      /127\.0\.0\.1:43265\/authorize/,
      "a call before the login must hand the agent the address, not wait for a human it cannot reach",
    );
    writeFileSync(authed, "");
    writeFileSync(join(process.env.ISKRON_BRIDGE_AUTH_DIR, "fake_grant.json"), "{}");
    await until(() => /с сервера/.test(rec.said()), "the server's list after the login", 8000);
    writeFileSync(b.reply, "ответ после входа");
    assert.equal((await rec.call("iskron_orient", {}, "s-cached")).content, "ответ после входа");
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
  }
});

test("a login met again later in the same process is announced again, not swallowed", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-again-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  const authed = join(SANDBOX, "again.authed");
  const grant = join(authDir, "fake_grant.json");
  const b = bridgeEnv("again", { FB_MODE: "auth", FB_AUTHED: authed, ISKRON_MCP_AUTH_POLL_MS: 50 });
  const rec = await plugin(b.env);
  const lines = () => (rec.said().match(/нужен вход/g) ?? []).length;
  try {
    await until(() => lines() === 1, "the first login line");
    writeFileSync(authed, "");
    writeFileSync(grant, "{}");
    await serverTools(rec);
    writeFileSync(b.reply, "ответ");
    await rec.call("iskron_orient", {}, "s-first");
    // The grant dies mid-work: the next root session's bridge meets the login again.
    rmSync(authed);
    rmSync(grant);
    await assert.rejects(() => rec.call("iskron_orient", {}, "s-second"), /нужен вход/);
    await until(() => lines() === 2, "the second login line");
    writeFileSync(authed, "");
    writeFileSync(grant, "{}");
    let out = null;
    for (const deadline = Date.now() + 5000; out === null && Date.now() < deadline;) {
      out = await rec.call("iskron_orient", {}, "s-second").catch(() => null);
      if (out === null) await delay(50);
    }
    assert.ok(out, "the second session's call must pass after the login");
    assert.equal(out.content, "ответ");
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
    process.env.ISKRON_BRIDGE_AUTH_DIR = prevAuth;
  }
});

// ── channel ──────────────────────────────────────────────────────────────────

const frame = (body) => ({
  type: "message",
  id: "msg-1",
  body,
  provenance: {
    from_standing: "@alari:telegram-bot",
    from_karta_seq: 1226,
    auth: "pat",
    via: "hook",
  },
});
const event = (kind, extra) => JSON.stringify({ kind, ...extra }) + "\n";

test("each root session gets its own bridge, and a frame goes to the session whose bridge brought it", async () => {
  const b = bridgeEnv("frame");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-a");
    await rec.call("iskron_channel", { action: "connect" }, "s-b");
    const [pidA, pidB] = pidsOf(b.log);
    assert.ok(pidA && pidB && pidA !== pidB, "two sessions must stand on two bridges");
    appendFileSync(
      `${b.events}.${pidA}`,
      event("frame", { frame: { type: "hello", pending: 0 }, raw: "{}" }),
    );
    await until(() => /канал слушает/.test(rec.said()), "the hello line");
    assert.equal(rec.prompts.length, 0, "hello must not wake the agent");
    appendFileSync(`${b.events}.${pidB}`, event("frame", { frame: frame("для второй"), raw: "" }));
    appendFileSync(`${b.events}.${pidA}`, event("frame", { frame: frame("для первой"), raw: "" }));
    await until(() => rec.prompts.length === 2, "both frames to be prompted");
    const to = Object.fromEntries(rec.prompts.map((p) => [p.sessionID, p.text]));
    assert.match(to["s-a"], /для первой/);
    assert.match(to["s-b"], /для второй/);
    assert.equal(
      rec.prompts[0].delivery,
      "steer",
      "a live frame steers into the running turn; queue would surface one frame per turn (#5233)",
    );
    assert.match(
      to["s-a"],
      /^Кадр канала Искрона от делателя роли #1226 — стояние @alari:telegram-bot\nprovenance: \{"from_standing":"@alari:telegram-bot","from_karta_seq":1226,"auth":"pat","via":"hook"\}\nframe: \{"id":"msg-1"\}\n\nдля первой$/,
      "provenance must reach the agent as the platform saw it",
    );
  } finally {
    await rec.stop();
  }
});

test("a subagent session works through its root's bridge", async () => {
  const b = bridgeEnv("subagent");
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", time: { updated: 1 } },
      { id: "child", parentID: "root", time: { updated: 2 } },
      { id: "grandchild", parentID: "child", time: { updated: 3 } },
    ],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "root");
    await rec.call("iskron_orient", {}, "child");
    assert.equal(pidsOf(b.log).length, 1, "the child must not raise a bridge of its own");
    // The birth event names the PARENT, not the root: a grandchild announced
    // this way must still resolve to the root's bridge (#5294, finding 4).
    rec.emit({ type: "session.created", data: { sessionID: "child", parentID: "root" } });
    rec.emit({ type: "session.created", data: { sessionID: "grandchild", parentID: "child" } });
    await delay(100);
    await rec.call("iskron_orient", {}, "grandchild");
    assert.equal(pidsOf(b.log).length, 1, "a grandchild must not raise a bridge of its own either");
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("frame", { frame: { type: "message", body: "x" }, raw: "" }),
    );
    await until(() => rec.prompts.length === 1, "the frame to be prompted");
    assert.equal(
      rec.prompts[0].sessionID,
      "root",
      "the frame goes to the root, never the subagent",
    );
  } finally {
    await rec.stop();
  }
});

test("a frame from a bridge nobody owns yet goes to the freshest root session the plugin has seen", async () => {
  const b = bridgeEnv("root");
  const rec = await plugin(b.env, {
    sessions: [
      { id: "old", time: { updated: 1 } },
      { id: "child", parentID: "old", time: { updated: 9 } },
      { id: "fresh", time: { updated: 5 } },
    ],
  });
  try {
    await serverTools(rec);
    // No session list in OpenCode 2: the plugin learns sessions from session.created.
    rec.emit({ type: "session.created", data: { sessionID: "old" } });
    rec.emit({ type: "session.created", data: { sessionID: "fresh" } });
    await delay(50);
    // A subagent's birth names its parent in the event itself and refreshes that root.
    rec.emit({ type: "session.created", data: { sessionID: "child", parentID: "old" } });
    await delay(50);
    appendFileSync(b.events, event("frame", { frame: { type: "message", body: "x" }, raw: "" }));
    await until(() => rec.prompts.length === 1, "the frame to be prompted");
    assert.equal(
      rec.prompts[0].sessionID,
      "old",
      "the freshest ROOT seen — a subagent is never the addressee",
    );
  } finally {
    await rec.stop();
  }
});

test("a frame for a session that is gone or archived is re-addressed to a live root, and every delivery is logged by frame and session", async () => {
  const b = bridgeEnv("archived");
  const sessions = [
    { id: "holder", time: { updated: 1 } },
    { id: "other", time: { updated: 2 } },
  ];
  const gone = new Set();
  const rec = await plugin(b.env, { sessions, gone });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "holder");
    rec.emit({ type: "session.created", data: { sessionID: "other" } });
    await delay(50);
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("frame", { frame: frame("живому"), raw: "" }),
    );
    await until(() => rec.prompts.length === 1, "the first frame");
    assert.equal(rec.prompts[0].sessionID, "holder");
    assert.match(rec.said(), /кадр msg-1 вложен в сессию holder/, "delivery is visible in the log");
    // The holder's session goes to the archive behind the agent's back.
    sessions[0].time.archived = Date.now();
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("frame", { frame: frame("после архива"), raw: "" }),
    );
    await until(() => rec.prompts.length === 2, "the re-addressed frame");
    assert.equal(rec.prompts[1].sessionID, "other", "a frame never goes into an archived session");
    assert.match(rec.said(), /сессия holder закрыта или в архиве/);
    // Nothing live at all — the other session is deleted (get throws): loud, not silent.
    gone.add("other");
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("frame", { frame: frame("некуда"), raw: "" }),
    );
    await until(() => /ВЛОЖИТЬ НЕКУДА/.test(rec.said()), "the loud refusal");
    assert.equal(rec.prompts.length, 2);
  } finally {
    await rec.stop();
  }
});

test("a frame with no session seen at all is said aloud, not lost silently", async () => {
  const b = bridgeEnv("nobody");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    appendFileSync(b.events, event("frame", { frame: { type: "message", body: "x" }, raw: "" }));
    await until(() => /ВЛОЖИТЬ НЕКУДА/.test(rec.said()), "the loud refusal");
    assert.equal(rec.prompts.length, 0);
  } finally {
    await rec.stop();
  }
});

test("a dead token is loud: an error line and a prompt that names the move", async () => {
  const b = bridgeEnv("dead");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-holder");
    appendFileSync(`${b.events}.${pidOf(b.log)}`, event("dead", { code: 4001 }));
    await until(() => rec.prompts.length === 1, "the dead-token prompt");
    assert.equal(rec.prompts[0].sessionID, "s-holder");
    assert.match(rec.prompts[0].text, /токен мёртв/);
    assert.match(rec.prompts[0].text, /mint/);
    assert.match(rec.said(), /\[iskron\/error\] .*токен мёртв/, "the human must see it too");
  } finally {
    await rec.stop();
  }
});

test("a stale burst is one prompt into the holder's session, bodies included", async () => {
  const b = bridgeEnv("stale");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-stale");
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("stale", {
        frames: [{ id: "s1" }],
        text: "Лежалых кадров: 1\n\nпочта предшественника",
      }),
    );
    await until(() => rec.prompts.length === 1, "the stale prompt");
    assert.equal(rec.prompts[0].sessionID, "s-stale");
    assert.match(rec.prompts[0].text, /почта предшественника/);
    assert.equal(
      rec.prompts[0].delivery,
      "queue",
      "a stale burst is not urgent: it waits for the turn to end",
    );
  } finally {
    await rec.stop();
  }
});

test("an eviction is loud in OpenCode: a prompt into the holder's session naming the place beside and take=true on the human's word", async () => {
  const b = bridgeEnv("evicted");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-evicted");
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("evicted", { code: 4000, text: "ДЕЛАТЕЛЬ: место отняли" }),
    );
    await until(() => rec.prompts.length === 1, "the eviction prompt");
    assert.equal(rec.prompts[0].sessionID, "s-evicted");
    assert.match(rec.prompts[0].text, /место отняли/);
    assert.match(
      rec.prompts[0].text,
      /встанет рядом на имя\.N; отбить место \(take=true\) — только словом человека/,
    );
  } finally {
    await rec.stop();
  }
});

test("a deleted session takes its bridge — and so its standing — down with it", async () => {
  const b = bridgeEnv("forget");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "gone");
    const pid = pidOf(b.log);
    assert.ok(alive(pid));
    rec.emit({ type: "session.deleted", data: { sessionID: "gone" } });
    await until(() => !alive(pid), "the session's bridge to die");
    // The next call from a new session gets a fresh bridge, not the dead one.
    await rec.call("iskron_orient", {}, "next");
    assert.equal(pidsOf(b.log).length, 2);
  } finally {
    await rec.stop();
  }
});

// ── keeping the hearing (graph nks-dev: #5140) ───────────────────────────────

// The field case: the reaper stopped a bridge that held a standing, because the
// plugin learnt of holding only from the local socket's «attached», which the
// bridge never sends it. Now holding is fed by observable events — the answer
// of stand/connect/register, the bridge's own «held», the hello frame — and a
// holding bridge is never reaped for idleness.
test("a bridge that stands is never reaped for idleness: holding comes from the tool's answer, from «held» and from hello — not from a local attach", async () => {
  // Every call below raises a bridge with a handshake (~150 ms): the idle
  // threshold must outlast that, or the word would land on a reaped bridge.
  const b = bridgeEnv("hold-keep", { ISKRON_BRIDGE_IDLE_MS: 1000, ISKRON_BRIDGE_REAP_MS: 100 });
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-answer");
    await rec.call("iskron_orient", {}, "s-word");
    const byWord = pidsOf(b.log).at(-1);
    appendFileSync(`${b.events}.${byWord}`, event("held", { key: "proba--931--nks-dev" }));
    await rec.call("iskron_orient", {}, "s-hello");
    const byHello = pidsOf(b.log).at(-1);
    appendFileSync(
      `${b.events}.${byHello}`,
      event("frame", { frame: { type: "hello", pending: 0 }, raw: "{}" }),
    );
    await rec.call("iskron_orient", {}, "s-idle");
    const [byAnswer, , , idle] = pidsOf(b.log);
    await until(() => /мост держит стояние proba--931--nks-dev/.test(rec.said()), "the held line");
    await until(() => /канал слушает/.test(rec.said()), "the hello line");
    await until(() => !alive(idle), "the idle bridge to be reaped", 4000);
    await delay(300);
    assert.ok(alive(byAnswer), "the bridge whose connect succeeded must survive the idle reaper");
    assert.ok(alive(byWord), "the bridge that said «held» must survive the idle reaper");
    assert.ok(alive(byHello), "the bridge whose hello arrived must survive the idle reaper");
    // «released» hands the bridge back to the reaper.
    appendFileSync(`${b.events}.${byWord}`, event("released", { text: "снято" }));
    await until(() => !alive(byWord), "a released bridge to be reaped again", 4000);
  } finally {
    await rec.stop();
  }
});

test("a backlog burst — the wake with everything that waited — is one prompt into the holder's session", async () => {
  const b = bridgeEnv("backlog");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-backlog");
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("backlog", {
        pending: 2,
        frames: [{ id: "w1" }, { id: "w2" }],
        text: "Побудка: кадров 2 (ожидало в очереди: 2)\n\nпервое\n\nвторое",
      }),
    );
    await until(() => rec.prompts.length === 1, "the backlog prompt");
    assert.equal(rec.prompts[0].sessionID, "s-backlog");
    assert.match(rec.prompts[0].text, /Побудка: кадров 2/);
    assert.match(rec.prompts[0].text, /второе/);
    assert.equal(rec.prompts[0].delivery, "queue");
    assert.match(rec.said(), /пачка побудки \(2\) вложен/);
    await delay(200);
    assert.equal(rec.prompts.length, 1, "one burst, one prompt — never one per frame");
  } finally {
    await rec.stop();
  }
});

// A new root session asks its bridge to take back the place of its directory
// before the first call: the record a previous plugin instance left on disk
// (an evicted location, a restart) names the directory, and the bridge finds it.
test("a new root session with a directory asks its bridge to resume that directory's place before the first call, and stands by the answer", async () => {
  const calls = join(SANDBOX, "resume.calls");
  const resume = join(SANDBOX, "resume.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: true,
      key: "k--931--nks-dev",
      pending: 3,
      word: "возврат места с диска",
    }),
  );
  const b = bridgeEnv("resume", {
    FB_CALLS: calls,
    FB_RESUME: resume,
    ISKRON_BRIDGE_IDLE_MS: 200,
    ISKRON_BRIDGE_REAP_MS: 100,
  });
  const rec = await plugin(b.env, {
    sessions: [{ id: "s-dir", location: { directory: "/work/of/the-session" } }],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_orient", {}, "s-dir");
    const sent = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(sent[0].name, "iskron/resume", "the resume goes first");
    assert.equal(sent[0].arguments.cwd, "/work/of/the-session");
    assert.equal(sent[1].name, "iskron_orient", "the tool call waits for the resume");
    assert.match(rec.said(), /сессия s-dir — возврат места с диска/);
    const pid = pidOf(b.log);
    await delay(600);
    assert.ok(alive(pid), "a resumed place is a held place: the reaper leaves the bridge alone");
    // A session without a directory has nothing to resume by: no request.
    writeFileSync(calls, "");
    await rec.call("iskron_orient", {}, "s-nodir");
    const again = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.deepEqual(
      again.map((c) => c.name),
      ["iskron_orient"],
      "no directory — no resume request",
    );
  } finally {
    await rec.stop();
  }
});

// The loss of hearing is said into the session, and the keeper brings the
// bridge back: a holding bridge that dies is announced at once, and the next
// tick of the watch raises a fresh bridge that asks to resume the place.
// A place the bridge returns by itself is taken without any move of the agent,
// under a name read from the directory's record — and the directory does not
// tell two places of one role apart (#5366). The taken name goes into the
// session as a prompt, like the loss of hearing; the log line alone is deaf.
test("a place resumed by the bridge itself is announced into the session with its name and the directory's other places", async () => {
  const calls = join(SANDBOX, "resumed.calls");
  const resume = join(SANDBOX, "resumed.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: true,
      key: "brat--931--nks-dev",
      pending: 0,
      word: "возврат места с диска; в том же каталоге записи и других мест: proba--931--nks-dev",
      others: ["proba--931--nks-dev"],
    }),
  );
  const b = bridgeEnv("resumed", { FB_CALLS: calls, FB_RESUME: resume });
  const rec = await plugin(b.env, {
    sessions: [{ id: "s-shared", location: { directory: "/work/shared" } }],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_orient", {}, "s-shared");
    await until(
      () => rec.prompts.some((p) => /сам вернул место/.test(p.text)),
      "the resumed prompt",
    );
    const word = rec.prompts.find((p) => /сам вернул место/.test(p.text));
    assert.equal(word.sessionID, "s-shared");
    assert.match(word.text, /место brat--931--nks-dev/, "the taken name is said");
    assert.match(
      word.text,
      /других мест: proba--931--nks-dev/,
      "the directory's other place is said",
    );
    assert.match(word.text, /iskron_stand/, "the way to take one's own place is said");
    assert.equal(word.delivery, "steer", "into the going turn, not after it");
  } finally {
    await rec.stop();
  }
});

test("a holding bridge that dies is announced into its session as lost hearing, and the watch raises a fresh bridge that resumes the place", async () => {
  const calls = join(SANDBOX, "lost.calls");
  const resume = join(SANDBOX, "lost.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      holding: true,
      resumed: true,
      key: "lost--931--nks-dev",
      pending: 1,
      word: "возврат места с диска",
    }),
  );
  const b = bridgeEnv("lost", { FB_CALLS: calls, FB_RESUME: resume, ISKRON_BRIDGE_WATCH_MS: 300 });
  const rec = await plugin(b.env, {
    sessions: [{ id: "s-lost", location: { directory: "/work/lost" } }],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-lost");
    const pid = pidOf(b.log);
    appendFileSync(`${b.events}.${pid}`, event("held", { key: "lost--931--nks-dev" }));
    await until(() => /мост держит стояние lost--931--nks-dev/.test(rec.said()), "the held line");
    process.kill(pid, "SIGKILL"); // the harness, the OS, an update — not the plugin
    await until(() => rec.prompts.some((p) => /слух потерян/.test(p.text)), "the loss prompt");
    const loss = rec.prompts.find((p) => /слух потерян/.test(p.text));
    assert.equal(loss.sessionID, "s-lost");
    assert.match(loss.text, /слух потерян в \d\d:\d\d/);
    assert.match(loss.text, /iskron_stand/);
    assert.match(rec.said(), /\[iskron\/error\] .*слух потерян/, "the human sees it too");
    await until(() => pidsOf(b.log).length === 2, "the watch to raise a fresh bridge", 5000);
    await until(
      () =>
        readFileSync(calls, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
          .some(
            (c) =>
              c.name === "iskron/check" &&
              c.arguments.cwd === "/work/lost" &&
              c.arguments.key === "lost--931--nks-dev",
          ),
      "the fresh bridge to be asked to check and resume the place by its key",
      5000,
    );
    await until(
      () => /сторож слуха вернул место сессии s-lost/.test(rec.said()),
      "the return line",
    );
    // The watch's return is the same return without a move of the agent (#5366):
    // the taken name goes into the session, not only into the log.
    await until(
      () => rec.prompts.some((p) => /сам вернул место/.test(p.text) && p.sessionID === "s-lost"),
      "the watch's resumed prompt",
    );
  } finally {
    await rec.stop();
  }
});

test("a bridge stopped by the plugin itself is not a lost hearing, and the watch forgets a deleted session", async () => {
  const b = bridgeEnv("own-stop", { ISKRON_BRIDGE_WATCH_MS: 200 });
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-own");
    const pid = pidOf(b.log);
    rec.emit({ type: "session.deleted", data: { sessionID: "s-own" } });
    await until(() => !alive(pid), "the session's bridge to die");
    await delay(700);
    assert.ok(!/слух потерян/.test(rec.said()), "the plugin's own stop is silent");
    assert.equal(rec.prompts.length, 0);
    assert.equal(
      pidsOf(b.log).length,
      1,
      "the watch must not raise a bridge for a deleted session",
    );
  } finally {
    await rec.stop();
  }
});

// A plugin stopped with a holding bridge (a restart, an evicted location) leaves
// a marker next to the grant; the next instance says the loss aloud into the
// first live session instead of standing silent over an empty board.
test("stopping the plugin with a holding bridge leaves a marker, and the next instance says the loss into the first session", async () => {
  const calls = join(SANDBOX, "marker.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("marker", { FB_CALLS: calls });
  const first = await plugin(b.env, {
    sessions: [{ id: "s-held", location: { directory: "/work/held" } }],
  });
  await serverTools(first);
  await first.call("iskron_channel", { action: "connect" }, "s-held");
  // The bridge's «held» names the key — the marker carries it for a resume by key.
  appendFileSync(`${b.events}.${pidOf(b.log)}`, event("held", { key: "proba--931--nks-dev" }));
  await until(() => /мост держит стояние proba--931--nks-dev/.test(first.said()), "the held line");
  await first.stop();
  assert.equal(lostMarkers().length, 1, "one marker file for this instance");
  const written = JSON.parse(readFileSync(lostMarkers()[0], "utf8"));
  assert.deepEqual(written.entries, [
    { session: "s-held", dir: "/work/held", key: "proba--931--nks-dev", child: false },
  ]);
  const second = await plugin(b.env, {
    keepMarker: true,
    sessions: [{ id: "s-back", location: { directory: "/work/held" } }],
  });
  try {
    assert.match(second.said(), /слух был потерян в \d\d:\d\d/);
    assert.match(second.said(), /proba--931--nks-dev/);
    assert.equal(lostMarkers().length, 0, "the marker is said once and gone");
    await serverTools(second);
    await second.call("iskron_orient", {}, "s-next");
    await until(() => second.prompts.length === 1, "the loss to be said into the first session");
    assert.equal(second.prompts[0].sessionID, "s-next");
    assert.match(second.prompts[0].text, /слух был потерян/);
    assert.match(second.prompts[0].text, /iskron_stand/);
    // The session of the lost directory resumes by the marker's key, not by directory alone.
    writeFileSync(calls, "");
    await second.call("iskron_orient", {}, "s-back");
    const sent = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(sent[0].name, "iskron/resume");
    assert.deepEqual(sent[0].arguments, { key: "proba--931--nks-dev", cwd: "/work/held" });
  } finally {
    await second.stop();
  }
  // A plugin with nothing held leaves no marker.
  assert.equal(lostMarkers().length, 0);
});

// The keeper's check must not count as activity: a slot whose bridge no longer
// holds anything is reaped for idleness like any other, and leaves the watch.
test("the watch does not refresh idleness: a slot whose bridge holds nothing is reaped and leaves the watch", async () => {
  const resume = join(SANDBOX, "unheld.answer");
  writeFileSync(resume, JSON.stringify({ holding: false, resumed: false, word: "места нет" }));
  const b = bridgeEnv("unheld", {
    FB_RESUME: resume,
    ISKRON_BRIDGE_WATCH_MS: 150,
    ISKRON_BRIDGE_IDLE_MS: 600,
    ISKRON_BRIDGE_REAP_MS: 100,
  });
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-unheld");
    const pid = pidOf(b.log);
    appendFileSync(
      `${b.events}.${pid}`,
      event("released", { key: "proba--931--nks-dev", text: "снято" }),
    );
    await until(() => !alive(pid), "the unheld bridge to be reaped despite the watch", 4000);
    await delay(500);
    assert.equal(
      pidsOf(b.log).length,
      1,
      "the watch has let the session go — no bridge is raised for it",
    );
  } finally {
    await rec.stop();
  }
});

// The plugin's stop must give the bridge time to clear the busy line: the
// bridge publishes an empty status with a 3 s ceiling, and a hard kill at 2 s
// left a busy line on the board over an empty place (r5 #5140).
test("stopping the plugin lets the real bridge clear the busy line before the hard kill", async () => {
  const fake = await startFakeNks({ pat: "nks_pat_plugin" });
  const rec = await plugin({
    ISKRON_BRIDGE_PATH: REAL_BRIDGE,
    ISKRON_BRIDGE_URL: fake.mcpUrl,
    ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
    ISKRON_BRIDGE_NO_BROWSER: "1",
  });
  let stopped = false;
  try {
    await until(() => rec.tools().has("iskron_stand"), "the bridge's own tool", 15000);
    const out = await rec.call(
      "iskron_stand",
      { realm: "nks-dev", karta: 931, name: "proba", status: "работаю" },
      "s-real",
    );
    assert.match(out.content, /Занятость: работаю/, out.content);
    assert.equal(fake.state.status, "работаю");
    // Against the real bridge the status names a real version on both sides;
    // the fake bridge carries no VERSION and only proves the shape (v?+hash).
    assert.match(
      (await rec.call("iskron_bridge", {}, "s-real")).content,
      /сборка: мост v\d+\.\d+\.\d+\+[0-9a-f]{8}, плагин v\d+\.\d+\.\d+/,
      "both builds carry a real version when the bridge is the real one",
    );
    await fake.control({ statusDelayMs: 2500 }); // slower than the old 2 s kill, faster than the bridge's 3 s ceiling
    stopped = true;
    await rec.stop();
    await until(
      () => fake.state.status === "",
      "the busy line to be cleared by the leaving bridge",
      8000,
    );
  } finally {
    if (!stopped) await rec.stop();
    await fake.stop();
  }
});

// ── commands ─────────────────────────────────────────────────────────────────

test("every installed skill with `slash: true` becomes a «/» command that loads the skill and hands over the human's words", async () => {
  const dir = mkdtempSync(join(SANDBOX, "skills-"));
  const skill = (id, head) => {
    mkdirSync(join(dir, id));
    const path = join(dir, id, "SKILL.md");
    writeFileSync(path, `---\n${head}\n---\n# ${id}\n`);
    return { id, name: id, description: `Дверь ${id}. Вторая фраза.`, path, content: "" };
  };
  const skills = [
    skill("iskron", 'name: iskron\nslash: true\ndescription: "Дверь"'),
    skill("plain", 'name: plain\ndescription: "Без слеша"'),
    {
      id: "opencode",
      name: "opencode",
      description: "builtin",
      path: "/builtin/opencode.md",
      content: "",
    },
  ];
  const rec = await plugin({ ISKRON_BRIDGE_PATH: join(SANDBOX, "no-such-bridge.mjs") }, { skills });
  try {
    assert.deepEqual([...rec.commands().keys()], ["iskron"]);
    const cmd = rec.commands().get("iskron");
    assert.equal(cmd.description, "Дверь iskron.");
    await cmd.execute({
      sessionID: "s-h",
      prompt: { text: "  что висит?  ", files: [] },
      delivery: "steer",
    });
    assert.equal(rec.prompts.length, 1);
    assert.equal(rec.prompts[0].sessionID, "s-h");
    assert.equal(rec.prompts[0].delivery, "steer");
    assert.deepEqual(rec.prompts[0].files, [], "the prompt's attachments travel along");
    assert.match(rec.prompts[0].text, /Загрузи скилл `iskron` инструментом `skill`/);
    assert.match(rec.prompts[0].text, /\n\nчто висит\?$/);
    // A skill installed later shows up after skill.updated.
    skills.push(skill("design", 'name: design\nslash: true\ndescription: "Проектирование"'));
    rec.emit({ type: "skill.updated", data: {} });
    await until(() => rec.commands().has("design"), "the new command");
  } finally {
    await rec.stop();
  }
});

// Keep the sandbox's auth dir existing for the cache tests that run first.
mkdirSync(process.env.ISKRON_BRIDGE_AUTH_DIR, { recursive: true });

// ── one standing per bridge (graph nks-dev: #5154) ───────────────────────────

// A subagent runs in a CHILD session of the root that stands; through the
// root's bridge its own iskron_stand replaced the parent's place. Now a child's
// standing call raises a bridge of its own: the root's bridge keeps its place,
// the child's frames go to the child, its revoke and its death touch only its
// own bridge; a child that only reads still goes through the root's bridge.
test("a child session that stands gets a bridge of its own: the root keeps its place, frames and revoke stay with the child, a reading child inherits the root's bridge", async () => {
  const calls = join(SANDBOX, "child.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("child", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      {
        name: "iskron_stand",
        description: "Занять стояние одним вызовом.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "iskron_channel",
        description: "Живой канал делателя.",
        inputSchema: { type: "object", properties: { action: { type: "string" } } },
      },
      { name: "iskron_orient", description: "Ориентация.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child-worktree" } },
      { id: "reader", parentID: "root", location: { directory: "/work/reader" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    const rootPid = pidOf(b.log);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child");
    assert.equal(pidsOf(b.log).length, 2, "the child's standing raises a bridge of its own");
    const childPid = pidsOf(b.log)[1];
    await rec.call("iskron_orient", {}, "child");
    await rec.call("iskron_orient", {}, "reader");
    await rec.call("iskron_channel", { action: "revoke", karta: "#931" }, "child");
    assert.equal(pidsOf(b.log).length, 2, "a reading child raises nothing");
    const sent = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => !c.name.startsWith("iskron/"));
    // Which bridge served what is judged by the pid each fake bridge stamps on the call.
    const who = (pid) => (pid === rootPid ? "root" : pid === childPid ? "child" : "?");
    assert.deepEqual(
      sent.map((c) => [
        c.name,
        c.arguments.action ?? c.arguments.karta ?? "",
        c.arguments.cwd,
        who(c.pid),
      ]),
      [
        ["iskron_stand", "#2816", "/work/root", "root"],
        ["iskron_stand", "#931", "/work/child-worktree", "child"],
        ["iskron_orient", "", undefined, "child"],
        ["iskron_orient", "", undefined, "root"],
        ["iskron_channel", "revoke", undefined, "child"],
      ],
      "the child stands under its own directory through its own bridge; the reader's read is served by the root's",
    );
    // Which bridge got what: the fake logs per process only through events, so
    // judge by the frames — a frame on the child's bridge lands in the child.
    appendFileSync(`${b.events}.${childPid}`, event("frame", { frame: frame("ребёнку"), raw: "" }));
    appendFileSync(`${b.events}.${rootPid}`, event("frame", { frame: frame("корню"), raw: "" }));
    await until(() => rec.prompts.length === 2, "both frames");
    const to = Object.fromEntries(rec.prompts.map((p) => [p.sessionID, p.text]));
    assert.match(to.child, /ребёнку/);
    assert.match(to.root, /корню/);
    // The child's end takes its own bridge down and only its own.
    rec.emit({ type: "session.deleted", data: { sessionID: "child" } });
    await until(() => !alive(childPid), "the child's bridge to die");
    assert.ok(alive(rootPid), "the root's bridge — and so its place — survives the child");
    await rec.call("iskron_orient", {}, "reader");
    assert.equal(pidsOf(b.log).length, 2, "the reader still inherits the root's bridge");
  } finally {
    await rec.stop();
  }
});

// A child's place can outlive the child: OpenCode sends no «subagent finished»
// event, so the child's bridge keeps holding. A frame on that place must not be
// re-addressed to the root — there stands another standing (#5167): it is said
// aloud and stays in the place's history instead.
test("a frame on the place of a child session that is gone is not re-addressed to the root: loud, and left in the history", async () => {
  const gone = new Set();
  const b = bridgeEnv("child-gone", {
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
    gone,
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child");
    const [rootPid, childPid] = pidsOf(b.log);
    assert.ok(rootPid && childPid, "two bridges");
    gone.add("child"); // the subagent's session is no more; its bridge still holds
    appendFileSync(`${b.events}.${childPid}`, event("frame", { frame: frame("ребёнку"), raw: "" }));
    await until(() => /корню не переадресую/.test(rec.said()), "the loud line");
    await delay(200);
    assert.equal(rec.prompts.length, 0, "the root must not receive the child's frame");
    // The root's own frames still reach the root.
    appendFileSync(`${b.events}.${rootPid}`, event("frame", { frame: frame("корню"), raw: "" }));
    await until(() => rec.prompts.length === 1, "the root's frame");
    assert.equal(rec.prompts[0].sessionID, "root");
  } finally {
    await rec.stop();
  }
});

// Two standing calls of one child in one batch of tools (iskron_stand and a
// register at once) must share ONE child bridge: a second bridge overwritten
// in the map would be seen by no reaper, no stop() and no marker, yet hold a
// place on the board.
test("two simultaneous standing calls of one child session share one child bridge", async () => {
  const calls = join(SANDBOX, "child-race.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("child-race", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
      {
        name: "iskron_channel",
        description: "Канал.",
        inputSchema: { type: "object", properties: { action: { type: "string" } } },
      },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/race" } },
      { id: "child", parentID: "root", location: { directory: "/work/race" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    await Promise.all([
      rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child"),
      rec.call("iskron_channel", { action: "register", karta: "#931" }, "child"),
    ]);
    assert.equal(pidsOf(b.log).length, 2, "one bridge for the child, however many calls at once");
    const childPid = pidsOf(b.log)[1];
    const served = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => c.arguments?.karta === "#931")
      .map((c) => c.pid);
    assert.deepEqual(
      served,
      [childPid, childPid],
      "both calls were served by the same child bridge",
    );
  } finally {
    await rec.stop();
  }
});

// A fresh child bridge may meet the login: the call must hand the address
// back at once, as the root's path does, never hang on a human it cannot reach.
test("a child bridge raised into a pending login answers with the login address instead of hanging", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-child-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  const authed = join(SANDBOX, "child-login.authed");
  writeFileSync(authed, "");
  writeFileSync(join(authDir, "fake_grant.json"), "{}");
  const b = bridgeEnv("child-login", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    ISKRON_MCP_AUTH_POLL_MS: 50,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/login" } },
      { id: "child", parentID: "root", location: { directory: "/work/login" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    rmSync(authed); // the grant dies before the child stands
    await assert.rejects(
      () => rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child"),
      /нужен вход/,
      "the child's call must refuse with the address, not wait",
    );
    assert.equal(pidsOf(b.log).length, 2, "the child bridge is raised and kept for the login");
    writeFileSync(authed, "");
    writeFileSync(join(authDir, "fake_grant.json"), "{ }");
    let out = null;
    for (const deadline = Date.now() + 5000; out === null && Date.now() < deadline;) {
      out = await rec
        .call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child")
        .catch(() => null);
      if (out === null) await delay(50);
    }
    assert.ok(out, "the child's call passes after the login");
    assert.equal(
      pidsOf(b.log).length,
      2,
      "the same child bridge served it — the login was waited for, not restarted",
    );
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
    process.env.ISKRON_BRIDGE_AUTH_DIR = prevAuth;
  }
});

// The loss marker of an instance whose root AND child both held places in one
// directory: the child's record must not become the root's hint, or the root
// would come back onto the child's place after a restart.
test("a child's held place in the loss marker is flagged and never hints the root's return", async () => {
  const calls = join(SANDBOX, "marker-child.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("marker-child", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
      { name: "iskron_orient", description: "Ориентация.", inputSchema: { type: "object" } },
    ]),
  });
  const sessions = [
    { id: "root", location: { directory: "/work/same" } },
    { id: "child", parentID: "root", location: { directory: "/work/same" } },
  ];
  const first = await plugin(b.env, { sessions });
  await until(() => first.tools().has("iskron_stand"), "the stand tool", 8000);
  await first.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
  await first.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child");
  const [rootPid, childPid] = pidsOf(b.log);
  appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "root--2816--nks-dev" }));
  appendFileSync(`${b.events}.${childPid}`, event("held", { key: "child--931--nks-dev" }));
  await until(
    () => /мост держит стояние child--931--nks-dev/.test(first.said()),
    "the child's held line",
  );
  await until(
    () => /мост держит стояние root--2816--nks-dev/.test(first.said()),
    "the root's held line",
  );
  await first.stop();
  const written = JSON.parse(readFileSync(lostMarkers()[0], "utf8"));
  assert.deepEqual(
    written.entries.sort((x, y) => x.session.localeCompare(y.session)),
    [
      { session: "child", dir: "/work/same", key: "child--931--nks-dev", child: true },
      { session: "root", dir: "/work/same", key: "root--2816--nks-dev", child: false },
    ],
  );
  const second = await plugin(b.env, { keepMarker: true, sessions });
  try {
    await until(() => second.tools().has("iskron_orient"), "the tools", 8000);
    writeFileSync(calls, "");
    await second.call("iskron_orient", {}, "root");
    const sent = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(sent[0].name, "iskron/resume");
    assert.deepEqual(
      sent[0].arguments,
      { key: "root--2816--nks-dev", cwd: "/work/same" },
      "the root resumes by ITS key — the child's record of the same directory is no hint",
    );
  } finally {
    await second.stop();
  }
});

// A child bridge that dies is replaced by a child bridge — never by the root's:
// the child's next call must be served by a new child pid, and the replacement
// asks to resume the child's place by its key at once, not on the watch's tick.
test("a dead child bridge is replaced by a fresh child bridge that resumes the child's place by key, and never by the root's bridge", async () => {
  const calls = join(SANDBOX, "child-dead.calls");
  const resume = join(SANDBOX, "child-dead.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: true,
      key: "child--931--nks-dev",
      pending: 0,
      word: "возврат места с диска",
    }),
  );
  const b = bridgeEnv("child-dead", {
    FB_CALLS: calls,
    FB_RESUME: resume,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
      { name: "iskron_orient", description: "Ориентация.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/dead" } },
      { id: "child", parentID: "root", location: { directory: "/work/dead" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child");
    const [rootPid, childPid] = pidsOf(b.log);
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "child--931--nks-dev" }));
    await until(
      () => /мост держит стояние child--931--nks-dev/.test(rec.said()),
      "the child's held line",
    );
    process.kill(childPid, "SIGKILL"); // the child's bridge dies — not the plugin's doing
    await until(() => !alive(childPid), "the child's bridge to die");
    writeFileSync(calls, "");
    await rec.call("iskron_orient", {}, "child");
    const sent = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const fresh = pidsOf(b.log)[2];
    assert.ok(
      fresh && fresh !== rootPid && fresh !== childPid,
      "a third bridge, the child's replacement",
    );
    assert.deepEqual(
      sent.map((c) => [c.name, c.pid === rootPid ? "root" : c.pid === fresh ? "child'" : "?"]),
      [
        ["iskron/resume", "child'"],
        ["iskron_orient", "child'"],
      ],
      "the replacement resumes the child's place first, then serves the read — the root's bridge sees nothing",
    );
    assert.deepEqual(
      sent[0].arguments,
      { key: "child--931--nks-dev" },
      "a child resumes by key only, never by the shared directory",
    );
    assert.match(rec.said(), /сессия child — возврат места с диска/);
    assert.ok(alive(rootPid), "the root's bridge is untouched");
  } finally {
    await rec.stop();
  }
});

// ── room frames (api 0.71.0: envelope flattened ahead of provenance and body) ──

const envelopeOf = (text) =>
  JSON.parse(
    text
      .split("\n")
      .find((l) => l.startsWith("frame: "))
      .slice(7),
  );

test("a room frame reaches the agent with its whole envelope; said defer queues, a platform record with no author is a wake-up", async () => {
  const b = bridgeEnv("room");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-room");
    const [pid] = pidsOf(b.log);
    const said = saidFrame("defer", 41);
    appendFileSync(`${b.events}.${pid}`, event("frame", { frame: said, raw: "" }));
    await until(() => rec.prompts.length === 1, "the room frame to be prompted");
    assert.equal(
      rec.prompts[0].delivery,
      "queue",
      "said with stack=defer must not interrupt the running turn (#4957)",
    );
    const text = rec.prompts[0].text;
    assert.match(
      text,
      /^Кадр канала Искрона от делателя роли #48/,
      "a participant's word is a doer's word, by via+auth",
    );
    assert.match(
      text,
      /слово ДЕЛА «Стенд»: слово от Алексей \(@aleksei:probe\)/,
      "the room line says the kind in words",
    );
    const envelope = envelopeOf(text);
    assert.deepEqual(
      envelope.room,
      said.room,
      "the room envelope must reach the agent, not be dropped by a key whitelist",
    );
    assert.equal(envelope.event_kind, "room.said");
    assert.equal(envelope.stack, "defer");
    assert.equal(envelope.entry_id, 41);

    const closed = roomFrame("closed", {
      entry_id: 42,
      author: PLATFORM,
      fields: { reason: "consensus" },
      status: "closed",
    });
    appendFileSync(`${b.events}.${pid}`, event("frame", { frame: closed, raw: "" }));
    await until(() => rec.prompts.length === 2, "the platform record to be prompted");
    assert.equal(rec.prompts[1].delivery, "steer", "closed steers into the running turn");
    assert.match(
      rec.prompts[1].text,
      /^Кадр канала Искрона от ПЛАТФОРМЫ — побудка, не человек и не делатель\nзапись ДЕЛА «Стенд»: дело закрыто: consensus\n/,
      "a room record without an author is the platform speaking, not an unknown doer",
    );
  } finally {
    await rec.stop();
  }
});

// The dictionary of room kinds (#5851): event_kind decides, stack counts only on said.
test("room kinds: closing steers a busy agent despite stack=defer and says who may object; progress and an unknown kind queue; said follows its stack", async () => {
  const b = bridgeEnv("room-kinds");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-kinds");
    const [pid] = pidsOf(b.log);
    const send = async (frame, i) => {
      appendFileSync(`${b.events}.${pid}`, event("frame", { frame, raw: JSON.stringify(frame) }));
      await until(() => rec.prompts.length === i, `prompt ${i}`);
      return rec.prompts[i - 1];
    };
    const c = closing();
    const p1 = await send(c, 1);
    assert.equal(p1.delivery, "steer", "closing interrupts the running turn, stack=defer or not");
    assert.match(
      p1.text,
      /ведущий Алексей \(@aleksei:probe\) предлагает закрыть дело до 2026-09-23T10:05:00Z; свидетельства: 41/,
    );
    assert.match(
      p1.text,
      /ты можешь возразить — iskron_case\(action="object", in_reply_to=50\) \(прежнее имя iskron_room\)/,
    );
    assert.deepEqual(envelopeOf(p1.text).line, c.line, "the frame JSON carries line unchanged");
    assert.match(p1.text, /\n\nсделано, см\. 41$/, "the body passes through unchanged");

    const p2 = await send(progress(), 2);
    assert.equal(p2.delivery, "queue", "progress batches");
    assert.match(p2.text, /Алексей \(@aleksei:probe\): \[tests\] пробы зелёные = ok; без сети/);

    const p3 = await send(unknownKind(), 3);
    assert.equal(
      p3.delivery,
      "queue",
      "an unknown kind never interrupts, even with stack=interrupt",
    );
    assert.match(p3.text, /род weather мосту неизвестен/);

    const p4 = await send(saidFrame("interrupt", 62), 4);
    assert.equal(p4.delivery, "steer", "said with stack=interrupt steers");
    const p5 = await send(saidFrame("defer", 63), 5);
    assert.equal(p5.delivery, "queue", "said with stack=defer queues");

    const p6 = await send(roomFrame("invite", { entry_id: 64, key: `invite:${ME_ID}` }), 6);
    assert.equal(p6.delivery, "steer", "an invite to my own standing id interrupts");
    assert.match(p6.text, new RegExp(`${ME_ID} приглашён`));
    const p7 = await send(
      roomFrame("invite", {
        entry_id: 65,
        key: "invite:5744a929-982c-4efe-88ff-480ab66f61b8",
        fields: { standing: { name: "Прораб", standing: "@other:x" } },
      }),
      7,
    );
    assert.equal(p7.delivery, "queue", "an invite to someone else batches");
    assert.match(
      p7.text,
      /Прораб \(@other:x\) приглашён/,
      "the invite names the invitee, not the raw id",
    );
    const p8 = await send(roomFrame("opened", { entry_id: 66 }), 8);
    assert.equal(p8.delivery, "queue", "opened does not interrupt");
    const p9 = await send(roomFrame("invite", { entry_id: 67, key: "invite:@tester:proba" }), 9);
    assert.equal(p9.delivery, "steer", "an invite to my own standing address interrupts too");
    // may_object carries standing ids only: my address there is not me, another id is not me.
    const notMine = closing();
    notMine.line.fields.may_object = ["@tester:proba", "9b2e4d6f-1a3c-4e5b-9d7f-0c2e4a6b8d1f"];
    const p10 = await send(notMine, 10);
    assert.equal(p10.delivery, "steer", "closing interrupts even when I may not object");
    assert.match(p10.text, /возражать не тебе/);
    assert.doesNotMatch(p10.text, /ты можешь возразить/);
  } finally {
    await rec.stop();
  }
});

// Today's production (api 0.86.0) sends no event_kind: a room frame keeps main's way —
// its own stack, whatever its old kind — and frames that are not room frames never meet
// the dictionary. A guard: it holds main's behaviour, so it is green on main by design.
test("room kinds leave non-room frames and the old room shape as on main: every old kind by its own stack, no unknown path", async () => {
  const b = bridgeEnv("room-legacy");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-legacy");
    const [pid] = pidsOf(b.log);
    const cases = [
      [directWord(), "steer"],
      [graphPosed(), "steer"],
      [legacyRoom("text", "interrupt", 71), "steer"],
      [legacyRoom("text", "defer", 72), "queue"],
      [legacyRoom("text", undefined, 73), "steer"],
      [legacyRoom("auto", "interrupt", 74), "steer"],
      [legacyRoom("direct", "interrupt", 75), "steer"],
      [legacyRoom("digest", "defer", 76), "queue"],
      [legacyRoom("important", "interrupt", 77), "steer"],
      [legacyRoom("ledger", "defer", 78), "queue"],
    ];
    for (const [i, [frame, way]] of cases.entries()) {
      appendFileSync(`${b.events}.${pid}`, event("frame", { frame, raw: JSON.stringify(frame) }));
      await until(() => rec.prompts.length === i + 1, `prompt ${i + 1}`);
      assert.equal(rec.prompts[i].delivery, way, `${frame.id} must go ${way}`);
    }
    assert.match(
      rec.prompts[0].text,
      /^Кадр канала Искрона от делателя роли #48 — стояние @alari:sosed\n/,
    );
    assert.doesNotMatch(rec.prompts[0].text, /ДЕЛА/, "a direct word is not a room word");
    assert.doesNotMatch(
      rec.prompts[1].text,
      /ДЕЛА|мосту неизвестен/,
      "a graph event is not a room frame",
    );
    assert.match(rec.prompts[2].text, /слово ДЕЛА «Стенд», род text, стопка interrupt/);
    assert.match(rec.prompts[5].text, /запись ДЕЛА «Стенд», род auto, стопка interrupt\n/);
    assert.match(rec.prompts[7].text, /запись ДЕЛА «Стенд», род digest, стопка defer\n/);
    assert.ok(
      rec.prompts.every((p) => !/мосту неизвестен/.test(p.text)),
      "no old kind takes the unknown path",
    );
  } finally {
    await rec.stop();
  }
});

test("a doer's word without a standing is still a doer's word: silence of from_standing is not the platform (#2287)", async () => {
  const b = bridgeEnv("origin-guard");
  const rec = await plugin(b.env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-og");
    const [pid] = pidsOf(b.log);
    const human = {
      type: "message",
      id: "og-1",
      body: "слово человека без стояния",
      provenance: { auth: "oidc", user: "dmitry", user_karta_seq: 1226 },
    };
    appendFileSync(`${b.events}.${pid}`, event("frame", { frame: human, raw: "" }));
    await until(() => rec.prompts.length === 1, "the frame to be prompted");
    assert.doesNotMatch(
      rec.prompts[0].text,
      /от ПЛАТФОРМЫ/,
      "no from_standing outside a room is honest silence, not the platform",
    );
    assert.equal(rec.prompts[0].delivery, "steer");
  } finally {
    await rec.stop();
  }
});
