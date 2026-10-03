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
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";
import {
  addressed,
  addressedBody,
  addressedInFlight,
  addressedLeft,
  auto,
  body as bodyFrame,
  bodyAborted,
  bodyLapsed,
  BORIS,
  closing,
  directWord,
  graphPosed,
  importantBody,
  importantInFlight,
  joinedMember,
  legacyRoom,
  link,
  ME,
  ME_ID,
  MY_KARTA,
  ownBody,
  PLATFORM,
  progress,
  replyInFlight,
  roleInvite,
  roomFrame,
  said as saidFrame,
  saidInFlight,
  unknownKind,
  withdraw,
  withheld,
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
/** The window a case burst gathers in before its one prompt — short under the probes. */
const BATCH_MS = 150;
process.env.ISKRON_OPENCODE_BATCH_MS = String(BATCH_MS);

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

function fakeCtx({
  sessions = [],
  skills = [],
  gone = new Set(),
  inboxIds = false,
  app = { name: "opencode", version: "2.0.18-probe", channel: "latest" },
  location = undefined, // ctx.location — the location this instance is loaded for
} = {}) {
  const prompts = [];
  const synthetics = [];
  const hooks = {};
  const tools = registry();
  const commands = registry();
  const queue = [];
  let wake = null;
  const stderr = [];
  const ctx = {
    app,
    ...(location ? { location } : {}),
    tool: { transform: tools.transform, reload: tools.reload },
    command: { transform: commands.transform, reload: commands.reload },
    session: {
      // A deleted session is a thrown NotFound in OpenCode; an unlisted one is
      // simply a root the probe never described.
      get: async ({ sessionID }) => {
        if (gone.has(sessionID)) throw new Error(`Session not found: ${sessionID}`);
        return sessions.find((x) => x.id === sessionID) ?? { id: sessionID };
      },
      // OpenCode answers a prompt with its inbox item; the id comes back in
      // session.inbox.delivered when a turn takes it. Off by default: most probes need no id.
      prompt: async (o) => {
        prompts.push(o);
        return inboxIds
          ? { id: `inbox-${prompts.length}`, type: "user", delivery: o.delivery }
          : {};
      },
      // A synthetic message — how OpenCode's own subagent tool reports to the parent.
      synthetic: async (o) => {
        synthetics.push(o);
        return { id: `synthetic-${synthetics.length}`, type: "synthetic" };
      },
      // Session hooks: the probe runs "prompt" the way OpenCode does — awaited,
      // on a mutable SessionPrompt, before the prompt reaches the model.
      hook: async (name, cb) => {
        (hooks[name] ??= []).push(cb);
        return { dispose: async () => {} };
      },
    },
    skill: { list: async () => ({ location: { directory: SANDBOX }, data: skills }) },
    model: { list: async () => [{ id: "m1", providerID: "p", limit: { context: 200000 } }] },
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
    synthetics,
    tools: () => tools.get(),
    commands: () => commands.get(),
    hooks,
    /** A prompt into a session through its "prompt" hooks; returns what the model would read. */
    prompt: async (sessionID, text) => {
      const p = { sessionID, messageID: "m", prompt: { text }, delivery: "queue" };
      for (const cb of hooks.prompt ?? []) await cb(p);
      return p.prompt.text;
    },
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
  "FB_DEVICE",
  "FB_DEVICE_FILE",
  "FB_DEVICE_LEFT_S",
  "FB_DEVICE_UNSET",
  "FB_TOOLS",
  "FB_PAGINATE",
  "FB_TOOLS_FILE",
  "FB_CHANGED",
  "FB_REPLY",
  "FB_EVENTS",
  "FB_CALLS",
  "FB_RESUME",
  "FB_STAND_HELD",
  "FB_INITS",
  "FB_NET_UP",
  "FB_DIE_ONCE",
  "FB_ENV",
  "ISKRON_HARNESS_VERSION",
  "ISKRON_SKILLS_ROOT",
  "ISKRON_BRIDGE_WATCH_MS",
  "ISKRON_BRIDGE_URL",
  "ISKRON_BRIDGE_TOKEN",
  "ISKRON_BRIDGE_NO_BROWSER",
  "ISKRON_BRIDGE_LANG",
  "ISKRON_LEAD_IDLE_MS",
  "ISKRON_CHILD_BACK_PAUSE_MS",
  "ISKRON_CHILD_BACK_MS",
  "ISKRON_RESUME_PATIENCE_MS",
  "ISKRON_MOVE_ADOPT_MS",
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

// The plugin is the bridge's handshake client, so clientInfo names the plugin,
// not OpenCode: the host's own version rides to the bridge in its environment
// (ctx.app.version), for attrs.harness_version (#6226). No app — none is claimed.
// ctx.app {name, version, channel} — from the types of @opencode/plugin 2.0.4
// (app.d.ts) only; a live OpenCode's ctx.app is not observed.
test("the plugin hands OpenCode's own version to the bridge it raises", async () => {
  const envLog = join(SANDBOX, "host-version.env");
  const b = bridgeEnv("host-version", { FB_ENV: envLog });
  const rec = await plugin(b.env, {
    app: { name: "opencode", version: "2.0.18", channel: "latest" },
  });
  try {
    // The tools may already stand from the previous list (cache), before the
    // bridge has written its first line — wait for the bridge, not the tools.
    await until(() => existsSync(envLog), "the raised bridge");
    const seen = readFileSync(envLog, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(seen[0]?.harness_version, "2.0.18", JSON.stringify(seen));
  } finally {
    await rec.stop();
  }
  const bareLog = join(SANDBOX, "host-version-bare.env");
  const bare = await plugin(bridgeEnv("host-version-bare", { FB_ENV: bareLog }).env, {
    app: null,
  });
  try {
    await until(() => existsSync(bareLog), "the raised bridge");
    const seen = readFileSync(bareLog, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(seen[0]?.harness_version, null, "no app — the plugin claims no version");
    assert.equal(seen[0]?.skills_root, null, "no establish-mcp among the skills — no set is named");
  } finally {
    await bare.stop();
  }
});

// The plugin's bridge is the home copy, outside any set (#6226): the set it
// names in attrs.skills is the one OpenCode loaded establish-mcp from —
// ctx.skill.list(), as the commands read it.
test("the plugin hands the bridge the root of the skill set that carries establish-mcp", async () => {
  const root = join(SANDBOX, "set-root", "skills");
  const path = join(root, "establish-mcp", "SKILL.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "---\nname: establish-mcp\n---\n");
  const skills = [
    { id: "builtin", name: "builtin", description: "x", path: "/builtin/x.md", content: "" },
    { id: "establish-mcp", name: "establish-mcp", description: "x", path, content: "" },
  ];
  const envLog = join(SANDBOX, "skills-root.env");
  const rec = await plugin(bridgeEnv("skills-root", { FB_ENV: envLog }).env, { skills });
  try {
    await until(() => existsSync(envLog), "the raised bridge");
    const seen = readFileSync(envLog, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(seen[0]?.skills_root, root, JSON.stringify(seen));
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
    await rootHolds(rec, b); // ребёнок встаёт только под местом корня (#6550 п.2)
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

// A handshake refused for good (the network, a session the server closed) is
// repeated with a growing pause, not every AUTH_POLL_MS: in the field one bridge
// re-handshook every 2 s for an hour, up to 1607 times.
test("a handshake refused not for a login is repeated with a growing pause, not at the poll rate", async () => {
  const inits = join(SANDBOX, "backoff.inits");
  writeFileSync(inits, "");
  const b = bridgeEnv("backoff", { FB_MODE: "net", FB_INITS: inits, ISKRON_MCP_AUTH_POLL_MS: 50 });
  const rec = await plugin(b.env);
  try {
    await delay(1600);
    const count = readFileSync(inits, "utf8").split("\n").filter(Boolean).length;
    assert.ok(count >= 2, `the handshake is still repeated (${count})`);
    // 50 ms apart would be ~30 in 1.6 s; doubling from 50 ms is 6 at most.
    assert.ok(count <= 8, `the handshake was repeated at the poll rate: ${count} in 1.6 s`);
  } finally {
    await rec.stop();
  }
});

// The pause comes before a repeat, not after it: once the network is back, the
// repeat that succeeds leads to the tools at once instead of sitting out one more
// (growing) pause first.
test("once the network is back, the tools come right after the handshake that succeeds, not a pause later", async () => {
  const inits = join(SANDBOX, "netup.inits");
  const up = join(SANDBOX, "netup.flag");
  writeFileSync(inits, "");
  rmSync(up, { force: true });
  const b = bridgeEnv("netup", {
    FB_MODE: "net",
    FB_NET_UP: up,
    FB_INITS: inits,
    ISKRON_MCP_AUTH_POLL_MS: 200,
  });
  const rec = await plugin(b.env);
  try {
    const count = () => readFileSync(inits, "utf8").split("\n").filter(Boolean).length;
    await until(() => count() >= 5, "five refused handshakes", 8000);
    writeFileSync(up, ""); // the network is back
    const t0 = Date.now();
    await until(() => /тулов в сессии: \d+ \(с сервера\)/.test(rec.said()), "the tools", 10000);
    const waited = Date.now() - t0;
    // Doubling from 200 ms: the pause due now is 3.2 s; a pause after the good
    // handshake would add the rest of the current one on top (~4.8 s in all).
    assert.ok(waited < 4000, `the tools came ${waited} ms after the network was back`);
  } finally {
    await rec.stop();
  }
});

// A bridge that died is replaced at once, not after the retry pause: meanwhile the
// dead one would be the spare a new session gets, and its first call would fail.
test("a spare bridge that died is replaced at once: the next session's call goes through a live bridge", async () => {
  const once = join(SANDBOX, "die-once.flag");
  writeFileSync(once, "");
  const b = bridgeEnv("die-once", { FB_DIE_ONCE: once, ISKRON_MCP_AUTH_POLL_MS: 5000 });
  const rec = await plugin(b.env);
  try {
    await until(
      () => existsSync(b.log) && pidsOf(b.log).length >= 1 && !alive(pidOf(b.log)),
      "the first bridge to die",
    );
    await delay(300); // the plugin sees the death; the retry pause (5 s) is far from over
    const t0 = Date.now();
    const got = await rec.call("iskron_orient", {}, "s-after-death");
    assert.ok(typeof got.content === "string", "the call went through a live bridge");
    assert.ok(Date.now() - t0 < 3000, "the call did not wait for the retry pause");
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

// The bridge names the same login's sign-in page with a code (#6570): the
// plugin re-tells the login in its own words and must not drop it — on a
// machine without a browser it is the only way in.
test("a login the bridge also offers from another device: the line and the status name the page with the code", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-device-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  const authed = join(SANDBOX, "device-login.authed");
  const page = "https://auth.example/device?code=FAKE1234";
  const b = bridgeEnv("device-login", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    FB_DEVICE: page,
    ISKRON_MCP_AUTH_POLL_MS: 50,
  });
  const rec = await plugin(b.env);
  try {
    await until(() => /нужен вход/.test(rec.said()), "the login line");
    assert.ok(rec.said().includes(page), "the line names the page with the code");
    const status = (await rec.call("iskron_bridge", {}, "s-device")).content;
    assert.ok(status.includes(page), "the status names it too");
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
    process.env.ISKRON_BRIDGE_AUTH_DIR = prevAuth;
  }
});

// A code lives about five minutes; the bridge issues the next one and rewrites
// the login's record beside the grant, or a caller that found it dying puts
// one beside the record. The plugin hears either and asks again — the line and
// the status name the new page, never a dead one.
test("a new code from the bridge: the plugin re-tells the login with the new page", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-device-renew-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  const authed = join(SANDBOX, "device-renew.authed");
  const deviceFile = join(SANDBOX, "device-renew.page");
  const record = join(authDir, "mcp.example_x.json.auth-pending");
  const first = "https://auth.example/device?code=OLD11111";
  const next = "https://auth.example/device?code=NEW22222";
  writeFileSync(deviceFile, first);
  writeFileSync(record, "{}");
  const b = bridgeEnv("device-renew", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    FB_DEVICE_FILE: deviceFile,
    ISKRON_MCP_AUTH_POLL_MS: 50,
  });
  const rec = await plugin(b.env);
  try {
    await until(() => rec.said().includes(first), "the first page");
    writeFileSync(deviceFile, next);
    writeFileSync(record, JSON.stringify({ device: { link: next } }));
    await until(() => rec.said().includes(next), "the new page in a new line");
    const status = (await rec.call("iskron_bridge", {}, "s-device-renew")).content;
    assert.ok(status.includes(next), "the status names the new page");
    assert.ok(!status.includes(first), "and not the dead one");
    const third = "https://auth.example/device?code=THIRD333";
    writeFileSync(deviceFile, third);
    writeFileSync(`${record}.device`, JSON.stringify({ code: { link: third } }));
    await until(() => rec.said().includes(third), "the code a caller put beside the record");
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
    process.env.ISKRON_BRIDGE_AUTH_DIR = prevAuth;
  }
});

// No client for sign-in by code on the server (#6619): the bridge offers no code
// and says why — the plugin passes that word on, beside the tunnel and token.
test("no code because the server has no client: the line and the status name the operator's move", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-device-unset-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  const authed = join(SANDBOX, "device-unset.authed");
  const word =
    "вход по коду на этом сервере не настроен: нет клиента iskron-bridge — ход оператора сервера авторизации";
  const b = bridgeEnv("device-unset", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    FB_DEVICE_UNSET: word,
    ISKRON_MCP_AUTH_POLL_MS: 50,
  });
  const rec = await plugin(b.env);
  try {
    await until(() => /нужен вход/.test(rec.said()), "the login line");
    assert.ok(rec.said().includes(word), `the line names the word: ${rec.said()}`);
    assert.ok(!/с другого устройства/.test(rec.said()), "no page with a code is promised");
    const status = (await rec.call("iskron_bridge", {}, "s-device-unset")).content;
    assert.ok(status.includes(word), "the status names it too");
  } finally {
    writeFileSync(authed, "");
    await rec.stop();
    process.env.ISKRON_BRIDGE_AUTH_DIR = prevAuth;
  }
});

// The bridge names the code's end; with under a minute left the human could not
// make it, so the plugin asks again by itself — the bridge's answer to that is
// a fresh code — and tells the new page with its end.
test("a code with under a minute left: the plugin asks again and tells the fresh page", async () => {
  const authDir = mkdtempSync(join(SANDBOX, "auth-device-dying-"));
  const prevAuth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  const authed = join(SANDBOX, "device-dying.authed");
  const deviceFile = join(SANDBOX, "device-dying.page");
  const first = "https://auth.example/device?code=DYING111";
  const next = "https://auth.example/device?code=FRESH222";
  writeFileSync(deviceFile, first);
  writeFileSync(join(authDir, "mcp.example_x.json.auth-pending"), "{}");
  const b = bridgeEnv("device-dying", {
    FB_MODE: "auth",
    FB_AUTHED: authed,
    FB_DEVICE_FILE: deviceFile,
    FB_DEVICE_LEFT_S: 30,
    ISKRON_MCP_AUTH_POLL_MS: 50,
  });
  const rec = await plugin(b.env);
  try {
    await until(() => rec.said().includes(first), "the first page");
    assert.match(rec.said(), /до \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/, "the line names the end");
    writeFileSync(deviceFile, next);
    await until(() => rec.said().includes(next), "the fresh page, with no record change");
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

/**
 * Корень держит место — его мост сказал «held» с местом: только под ним ребёнок
 * встаёт (своим спутником, #6550 п.2). pid — мост корня (по умолчанию первый поднятый).
 */
async function rootHolds(rec, b, { pid = pidOf(b.log), key = "k-root", place = ROOT_PLACE } = {}) {
  appendFileSync(`${b.events}.${pid}`, event("held", { key, place }));
  await until(() => rec.said().includes(`мост держит стояние ${key}`), `the root's held ${key}`);
}

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
      /^роль #1226 \(@alari:telegram-bot\)\nдля первой$/,
      "who speaks and the text once — short (#6081); delivery asks no answer (#6574)",
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

// #6574: the count waiting for a prompt is the root's; a subagent's prompt does not carry it away.
test("the root's counts ride the root's next prompt, never a subagent's", async () => {
  const b = bridgeEnv("ride-child");
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", time: { updated: 1 } },
      { id: "child", parentID: "root", time: { updated: 2 } },
    ],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "root");
    const f = progress();
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("frame", { frame: f, raw: JSON.stringify(f) }),
    );
    await delay(BATCH_MS * 4);
    assert.equal(rec.prompts.length, 0, "a count wakes no turn");
    const child = await rec.prompt("child", "бриф");
    assert.equal(child, "бриф", `the root's count rode into the subagent's prompt:\n${child}`);
    const root = await rec.prompt("root", "go");
    assert.match(root, /^go\n\n№7 «Стенд»: записей 1, тебе 0/, root);
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
    // connect on every code: mint answers 409 once the channel is back (#5189).
    assert.match(rec.prompts[0].text, /action="connect"/);
    assert.doesNotMatch(rec.prompts[0].text, /mint/, "4001 must not offer mint");
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
// Other places of the directory are not named to it (e2e6: two roots of one folder were
// each named the other's key): the return takes the record this session stood (the
// bridge checks the session), and a foreign key in its word would call it to the foreign.
test("a place resumed by the bridge itself is announced into the session with its name — and only its own", async () => {
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
    assert.doesNotMatch(word.text, /proba--931--nks-dev/, "no other place is named to it");
    assert.match(word.text, /iskron_stand/, "the way to take one's own place is said");
    assert.equal(word.delivery, "steer", "into the going turn, not after it");
  } finally {
    await rec.stop();
  }
});

// A record of a pre-upgrade build carries no session: the directory alone does
// not return it (#6017), but the bridge names it, and the plugin says it into
// the session — its holder takes it back by name instead of losing it silently.
test("a place of a pre-session build, not resumed by the directory, is said into the session with the way back by name", async () => {
  const calls = join(SANDBOX, "legacy.calls");
  const resume = join(SANDBOX, "legacy.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: false,
      word: 'своей записи держания для каталога /work/old нет — есть место прежней сборки без сессии: proba — вернуть: iskron_stand(name="proba")',
      legacy: ["proba"],
    }),
  );
  const b = bridgeEnv("legacy", { FB_CALLS: calls, FB_RESUME: resume });
  const rec = await plugin(b.env, {
    sessions: [{ id: "s-old", location: { directory: "/work/old" } }],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_orient", {}, "s-old");
    await until(
      () => rec.prompts.some((p) => /прежней сборки без сессии/.test(p.text)),
      "the legacy place said into the session",
    );
    const word = rec.prompts.find((p) => /прежней сборки без сессии/.test(p.text));
    assert.equal(word.sessionID, "s-old");
    assert.match(word.text, /iskron_stand\(name="proba"\)/, "the way back by name is said");
  } finally {
    await rec.stop();
  }
});

// A bridge that dies at every start (a broken install) is raised again with a
// growing pause, not every AUTH_POLL_MS: a flat pause made ~1800 spawns an hour
// (graph nks-dev: case №22).
test("a bridge that dies at every start is raised with a growing pause, not a flat one", async () => {
  const b = bridgeEnv("storm", { FB_MODE: "die", ISKRON_MCP_AUTH_POLL_MS: "50" });
  const rec = await plugin(b.env);
  try {
    await delay(1500);
    const spawns = pidsOf(b.log).length;
    assert.ok(spawns >= 2, `the dead bridge is raised again: ${spawns}`);
    assert.ok(spawns <= 8, `spawns in 1.5 s with a 50 ms base pause: ${spawns}`);
  } finally {
    await rec.stop();
  }
});

// The session's spend goes to the holding session's bridge (graph nks-dev: #6271):
// tokens spent from session.usage.updated, the window's fill from the last
// step, the window's size from the step's model — and nothing without a place.
test("usage events reach the holding session's bridge as iskron/usage, with the model's window", async () => {
  const calls = join(SANDBOX, "usage.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("usage", { FB_CALLS: calls, ISKRON_USAGE_DEBOUNCE_MS: 50 });
  const rec = await plugin(b.env, {
    sessions: [{ id: "s-use", location: { directory: "/work/u" } }],
  });
  const usageCalls = () =>
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron/usage");
  try {
    await serverTools(rec);
    const tok = { input: 900, output: 100, reasoning: 0, cache: { read: 50000, write: 1000 } };
    // No place yet: the numbers have nowhere to go.
    rec.emit({ type: "session.usage.updated", data: { sessionID: "s-use", tokens: tok } });
    await delay(200);
    assert.equal(usageCalls().length, 0, "no place, no call");
    await rec.call("iskron_channel", { action: "connect" }, "s-use");
    const pid = pidOf(b.log);
    appendFileSync(`${b.events}.${pid}`, event("held", { key: "use--931--nks-dev" }));
    await until(() => /мост держит стояние use--931--nks-dev/.test(rec.said()), "the held line");
    rec.emit({
      type: "session.step.started",
      data: { sessionID: "s-use", model: { id: "m1", providerID: "p" } },
    });
    rec.emit({ type: "session.step.ended", data: { sessionID: "s-use", tokens: tok } });
    rec.emit({ type: "session.usage.updated", data: { sessionID: "s-use", tokens: tok } });
    await until(() => usageCalls().length > 0, "the usage call");
    assert.deepEqual(usageCalls().at(-1).arguments, {
      tokens: 2000,
      input: 900,
      output: 100,
      cache_read: 50000,
      cache_write: 1000,
      model: "m1",
      context: 51900,
      window: 200000,
    });
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
// session that held instead of standing silent over an empty board.
test("stopping the plugin with a holding bridge leaves a marker, and the next instance says the loss into the session that held", async () => {
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
  writeFileSync(calls, ""); // what the next instance sends, alone
  const second = await plugin(b.env, {
    keepMarker: true,
    sessions: [
      { id: "s-back", location: { directory: "/work/held" } },
      { id: "s-held", location: { directory: "/work/held" } },
    ],
  });
  try {
    assert.match(second.said(), /слух был потерян в \d\d:\d\d/);
    assert.match(second.said(), /proba--931--nks-dev/);
    assert.equal(lostMarkers().length, 0, "the marker is said once and gone");
    const sentBy = () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    // The session that held it resumes by the marker's key, not by directory
    // alone — and at once, without a call of its own (#6137).
    await until(
      () => sentBy().some((c) => c.name === "iskron/resume" && c.arguments.session === "s-held"),
      "the held session's resume",
    );
    assert.deepEqual(sentBy().find((c) => c.name === "iskron/resume").arguments, {
      key: "proba--931--nks-dev",
      cwd: "/work/held",
      session: "s-held",
    });
    await serverTools(second);
    // The loss is said into the session that held the place, not into whichever calls first.
    await second.call("iskron_orient", {}, "s-next");
    await until(() => second.prompts.length >= 1, "the loss to be said");
    const loss = second.prompts.filter((p) => /слух был потерян/.test(p.text));
    assert.deepEqual(
      loss.map((p) => p.sessionID),
      ["s-held"],
      "the loss goes into its own session",
    );
    assert.match(loss[0].text, /iskron_stand/);
    // Another session of the lost directory gets no key: the marker's key is a
    // hint only to the session that held its socket (graph nks-dev: #6017).
    writeFileSync(calls, "");
    await second.call("iskron_orient", {}, "s-back");
    assert.equal(sentBy()[0].name, "iskron/resume");
    assert.deepEqual(sentBy()[0].arguments, { cwd: "/work/held", session: "s-back" });
  } finally {
    await second.stop();
  }
  // A plugin with nothing held leaves no marker.
  assert.equal(lostMarkers().length, 0);
});

// A standing session waits for frames and calls no tool: a return that waits for
// its call never comes, while the loss word promises the place back by itself
// (graph nks-dev: #6137). The next instance takes the place back at once, into
// the session that held it; a place that does not come back is said there too,
// and the session stays under the watch.
async function heldThenStopped(name) {
  const b = bridgeEnv(`${name}-first`);
  const first = await plugin(b.env, {
    sessions: [{ id: "s-held", location: { directory: "/work/held" } }],
  });
  await serverTools(first);
  await first.call("iskron_channel", { action: "connect" }, "s-held");
  appendFileSync(`${b.events}.${pidOf(b.log)}`, event("held", { key: "proba--931--nks-dev" }));
  await until(() => /мост держит стояние proba--931--nks-dev/.test(first.said()), "the held line");
  await first.stop();
  assert.equal(lostMarkers().length, 1, "the marker of the stopped instance");
}

const callsIn = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test("the place of a lost marker comes back at once, without a call of the agent, into the session that held it", async () => {
  await heldThenStopped("eager");
  const calls = join(SANDBOX, "eager.calls");
  const resume = join(SANDBOX, "eager.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: true,
      key: "proba--931--nks-dev",
      pending: 2,
      word: "возврат места с диска",
    }),
  );
  const b = bridgeEnv("eager", { FB_CALLS: calls, FB_RESUME: resume });
  const second = await plugin(b.env, {
    keepMarker: true,
    sessions: [{ id: "s-held", location: { directory: "/work/held" } }],
  });
  try {
    // No tool is called in this instance at all.
    await until(
      () =>
        callsIn(calls).some(
          (c) =>
            c.name === "iskron/resume" &&
            c.arguments.key === "proba--931--nks-dev" &&
            c.arguments.session === "s-held",
        ),
      "the resume by the marker's key without a call",
      1000,
    );
    assert.ok(
      !callsIn(calls).some((c) => !c.name.startsWith("iskron/")),
      "no tool call went out — the resume did not wait for one",
    );
    await until(
      () => second.prompts.some((p) => /слух был потерян/.test(p.text)),
      "the loss word",
      1000,
    );
    const loss = second.prompts.find((p) => /слух был потерян/.test(p.text));
    assert.equal(loss.sessionID, "s-held", "the loss goes into the session that held");
    await until(
      () => second.prompts.some((p) => /сам вернул место/.test(p.text)),
      "the resumed word",
      1000,
    );
    assert.equal(second.prompts.find((p) => /сам вернул место/.test(p.text)).sessionID, "s-held");
  } finally {
    await second.stop();
  }
});

test("a place of a lost marker that does not come back is said into its session with iskron_stand, the watch tries once more and says its outcome too", async () => {
  await heldThenStopped("notback");
  const calls = join(SANDBOX, "notback.calls");
  const resume = join(SANDBOX, "notback.answer");
  writeFileSync(calls, "");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: false,
      holding: false,
      word: "возвращать нечего — proba--931--nks-dev: hello не пришёл — запись цела",
    }),
  );
  const b = bridgeEnv("notback", {
    FB_CALLS: calls,
    FB_RESUME: resume,
    ISKRON_BRIDGE_WATCH_MS: 300,
  });
  const second = await plugin(b.env, {
    keepMarker: true,
    sessions: [{ id: "s-held", location: { directory: "/work/held" } }],
  });
  try {
    await until(
      () => second.prompts.some((p) => /не вернулось/.test(p.text)),
      "the word that the place did not come back",
      1500,
    );
    const word = second.prompts.find((p) => /не вернулось/.test(p.text));
    assert.equal(word.sessionID, "s-held");
    assert.match(word.text, /proba--931--nks-dev/, "the place is named");
    assert.match(word.text, /hello не пришёл/, "the bridge's reason is said");
    assert.match(word.text, /iskron_stand/, "the way to stand is said");
    await until(
      () =>
        callsIn(calls).some(
          (c) => c.name === "iskron/check" && c.arguments.key === "proba--931--nks-dev",
        ),
      "the watch to try the place again",
      3000,
    );
    // The watch tries once: its failure is said too, or the session hears nothing more.
    await until(
      () => second.prompts.some((p) => /на повторе сторожа/.test(p.text)),
      "the word that the watch's retry failed as well",
      3000,
    );
    const again = second.prompts.find((p) => /на повторе сторожа/.test(p.text));
    assert.equal(again.sessionID, "s-held");
    assert.match(again.text, /iskron_stand/);
  } finally {
    await second.stop();
  }
});

// OpenCode loads the plugin once per location, a session's tools go through the
// instance of its location, and an update of the delivery reloads every instance
// at once (graph nks-dev: #6626). An instance that took another location's marker
// would take that session's place back by ITS bridge and tell the session «taken
// back», while the session's calls — its busy line too — went by the bridge of its
// own instance, holding nothing. Each instance takes back its own sessions only.
const LOC_A = { directory: "/work/A" };
const LOC_B = { directory: "/work/B" };
const inLoc = (loc, ...ids) => ({
  location: loc,
  sessions: ids.map((id) => ({ id, location: loc })),
});
const backAnswer = (key) => ({ resumed: true, holding: true, key, word: "возврат места с диска" });

/** A session stands, and its bridge says «held» with the key. */
async function standsHeld(rec, b, calls, session, key) {
  await rec.call("iskron_channel", { action: "connect" }, session);
  const pid = callsIn(calls)
    .filter((c) => c.name === "iskron_channel")
    .at(-1).pid;
  appendFileSync(`${b.events}.${pid}`, event("held", { key }));
  await until(() => rec.said().includes(`мост держит стояние ${key}`), `${key} held`);
}

/** «Taken back by itself» words of an instance, by session, with the key each names. */
const takenBack = (rec) =>
  rec.prompts
    .filter((p) => /сам вернул место/.test(p.text))
    .map((p) => `${p.sessionID}:${/место (\S+)/.exec(p.text)?.[1]}`)
    .sort();

/** Two locations' instances come up on one machine after a reload; returns both, once each resumed. */
async function reloadedLocations(name) {
  const calls = join(SANDBOX, `${name}.calls`);
  const resume = join(SANDBOX, `${name}.resume`);
  writeFileSync(calls, "");
  const bySession = { a1: backAnswer("k-a1"), a2: backAnswer("k-a2"), b1: backAnswer("k-b1") };
  writeFileSync(resume, JSON.stringify({ bySession }));
  const b = bridgeEnv(name, { FB_CALLS: calls, FB_RESUME: resume });
  const second = { A: null, B: null, calls };
  second.A = await plugin(b.env, { ...inLoc(LOC_A, "a1", "a2"), keepMarker: true });
  const resumed = (s) => () =>
    callsIn(calls).some((c) => c.name === "iskron/resume" && c.arguments.session === s);
  try {
    await until(resumed("a1"), "a1's resume");
    await until(resumed("a2"), "a2's resume");
    await delay(300);
    second.B = await plugin(b.env, { ...inLoc(LOC_B, "b1"), keepMarker: true });
    await until(resumed("b1"), "b1's resume", 8000);
    await delay(300);
    return second;
  } catch (e) {
    await second.A.stop();
    await second.B?.stop();
    throw e;
  }
}

// e2e6: two root sessions of one folder both held places; after the reload each got
// the same «hearing was lost … <both keys>» — each named the other's key. A session's
// word names its own places only.
test("after a reload two roots of one folder each hear the loss of their own place only", async () => {
  const calls = join(SANDBOX, "two-roots.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("two-roots", { FB_CALLS: calls });
  const first = await plugin(b.env, inLoc(LOC_A, "a1", "a2"));
  await serverTools(first);
  await standsHeld(first, b, calls, "a1", "k-a1");
  await standsHeld(first, b, calls, "a2", "k-a2");
  await first.stop();
  const second = await plugin(b.env, { ...inLoc(LOC_A, "a1", "a2"), keepMarker: true });
  try {
    const loss = (s) =>
      second.prompts.find((p) => p.sessionID === s && /слух был потерян/.test(p.text));
    await until(() => loss("a1") && loss("a2"), "the loss word in both");
    assert.match(loss("a1").text, /k-a1/);
    assert.doesNotMatch(loss("a1").text, /k-a2/, "a1 is not named a2's place");
    assert.match(loss("a2").text, /k-a2/);
    assert.doesNotMatch(loss("a2").text, /k-a1/, "a2 is not named a1's place");
  } finally {
    await second.stop();
  }
});

test("a reload of every location's instance at once: each takes back only its own sessions' places, and each session hears only its own return", async () => {
  const calls = join(SANDBOX, "locs-first.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("locs-first", { FB_CALLS: calls });
  const firstA = await plugin(b.env, inLoc(LOC_A, "a1", "a2"));
  const firstB = await plugin(b.env, { ...inLoc(LOC_B, "b1"), keepMarker: true });
  await serverTools(firstA);
  await serverTools(firstB);
  await standsHeld(firstA, b, calls, "a1", "k-a1");
  await standsHeld(firstA, b, calls, "a2", "k-a2");
  await standsHeld(firstB, b, calls, "b1", "k-b1");
  await firstA.stop();
  await firstB.stop();
  assert.equal(lostMarkers().length, 2, "a marker per instance");
  const { A, B, calls: sent } = await reloadedLocations("locs");
  try {
    assert.deepEqual(
      takenBack(A),
      ["a1:k-a1", "a2:k-a2"],
      "A tells its own sessions, each its own place",
    );
    assert.deepEqual(takenBack(B), ["b1:k-b1"], "B tells its own session");
    assert.ok(!A.prompts.some((p) => p.sessionID === "b1"), "A says nothing into B's session");
    assert.ok(!B.prompts.some((p) => /^a/.test(p.sessionID)), "B says nothing into A's");
    // The place is bound where the session's calls go: its busy line goes by the bridge that took it back.
    const resumer = callsIn(sent).find(
      (c) => c.name === "iskron/resume" && c.arguments.session === "b1",
    ).pid;
    await serverTools(B);
    await B.call("iskron_orient", {}, "b1");
    assert.equal(
      callsIn(sent).at(-1).pid,
      resumer,
      "b1's call goes by the bridge that holds its place",
    );
  } finally {
    await A.stop();
    await B.stop();
  }
});

// The update itself: the stopped instances are the previous build's, and their
// markers carry no location. Every new instance reads such a file and takes the
// records of its own directory; none takes another location's.
test("a marker of the previous build, without a location: each location's instance takes its own directory's records only", async () => {
  for (const f of lostMarkers()) rmSync(f, { force: true });
  const at = new Date().toISOString();
  const entries = [
    { session: "a1", dir: LOC_A.directory, key: "k-a1", child: false },
    { session: "a2", dir: LOC_A.directory, key: "k-a2", child: false },
    { session: "b1", dir: LOC_B.directory, key: "k-b1", child: false },
  ];
  writeFileSync(
    // pid писавшего — этот процесс: файл живого чужого сервера экземпляр не берёт.
    join(process.env.ISKRON_BRIDGE_AUTH_DIR, `opencode-lost.${process.pid}.legacy.json`),
    JSON.stringify({ at, entries }),
  );
  const { A, B } = await reloadedLocations("locs-legacy");
  try {
    assert.deepEqual(takenBack(A), ["a1:k-a1", "a2:k-a2"]);
    assert.deepEqual(takenBack(B), ["b1:k-b1"]);
    assert.ok(!A.prompts.some((p) => p.sessionID === "b1"), "A says nothing into B's session");
  } finally {
    await A.stop();
    await B.stop();
  }
});

// Two OpenCode servers on one machine each load the plugin for the same folder (seen
// live on a delivery update: run=85c30e6a and run=f88d2cf2 both loaded iskron.js for
// iskron/skills). The marker of one server's instance is that server's: the other,
// taking it, held the session's place by its bridge while the session called tools
// through its own (#6626 again). A marker of a server that is gone (a restart) is taken.
test("a marker written by another live OpenCode server for the same folder is its own; a gone server's marker is taken", async () => {
  for (const f of lostMarkers()) rmSync(f, { force: true });
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const tag = createHash("sha256").update(`${LOC_A.directory}\0`).digest("hex").slice(0, 12);
  const file = join(
    process.env.ISKRON_BRIDGE_AUTH_DIR,
    `opencode-lost.@${tag}.${other.pid}.x.json`,
  );
  const entries = [{ session: "a1", dir: LOC_A.directory, key: "k-a1", child: false }];
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), entries }));
  const calls = join(SANDBOX, "other-server.calls");
  const resume = join(SANDBOX, "other-server.resume");
  writeFileSync(calls, "");
  writeFileSync(resume, JSON.stringify({ bySession: { a1: backAnswer("k-a1") } }));
  const b = bridgeEnv("other-server", { FB_CALLS: calls, FB_RESUME: resume });
  const resumed = () =>
    callsIn(calls).some((c) => c.name === "iskron/resume" && c.arguments.session === "a1");
  const first = await plugin(b.env, { ...inLoc(LOC_A, "a1"), keepMarker: true });
  try {
    await serverTools(first);
    await delay(500);
    assert.ok(!resumed(), "the other live server's session is not taken back from here");
    assert.ok(existsSync(file), "its marker is left to it");
  } finally {
    await first.stop();
  }
  other.kill();
  await until(() => !alive(other.pid), "the other server to go");
  const second = await plugin(b.env, { ...inLoc(LOC_A, "a1"), keepMarker: true });
  try {
    await until(resumed, "the gone server's session taken back");
  } finally {
    await second.stop();
  }
});

// A pid is reused: a live process under the writer's pid long after the writer left would
// hold its marker «a live other server's» for ever. A live server takes its own marker in
// seconds; one older than the term is taken whoever lives under the pid (#147 [88]).
test("a marker of a «live other server» older than the term is taken: its pid may be another process now", async () => {
  for (const f of lostMarkers()) rmSync(f, { force: true });
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const tag = createHash("sha256").update(`${LOC_A.directory}\0`).digest("hex").slice(0, 12);
  const file = join(
    process.env.ISKRON_BRIDGE_AUTH_DIR,
    `opencode-lost.@${tag}.${other.pid}.y.json`,
  );
  const entries = [{ session: "a1", dir: LOC_A.directory, key: "k-a1", child: false }];
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), entries }));
  const old = (Date.now() - 11 * 60_000) / 1000;
  utimesSync(file, old, old);
  const calls = join(SANDBOX, "reused-pid.calls");
  const resume = join(SANDBOX, "reused-pid.resume");
  writeFileSync(calls, "");
  writeFileSync(resume, JSON.stringify({ bySession: { a1: backAnswer("k-a1") } }));
  const b = bridgeEnv("reused-pid", { FB_CALLS: calls, FB_RESUME: resume });
  const rec = await plugin(b.env, { ...inLoc(LOC_A, "a1"), keepMarker: true });
  try {
    await until(
      () => callsIn(calls).some((c) => c.name === "iskron/resume" && c.arguments.session === "a1"),
      "the stale marker taken",
    );
  } finally {
    other.kill();
    await rec.stop();
  }
});

// The session's own place (by its key, or stood by it) is held by a live bridge of
// another session: the resume takes nothing, and the session is told so with the
// way back — not left to believe the place is its own (#6626).
test("a session whose own place a live bridge of another session holds is told the return failed, and how to take it", async () => {
  const resume = join(SANDBOX, "elsewhere.resume");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: false,
      elsewhere: ["k-own"],
      word: "возвращать нечего — k-own: держит живой мост",
    }),
  );
  const calls = join(SANDBOX, "elsewhere.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("elsewhere", {
    FB_CALLS: calls,
    FB_RESUME: resume,
    ISKRON_RESUME_PATIENCE_MS: 1200,
  });
  const rec = await plugin(b.env, inLoc(LOC_A, "s1"));
  try {
    await serverTools(rec);
    await rec.call("iskron_orient", {}, "s1");
    await until(() => rec.prompts.some((p) => /не удался/.test(p.text)), "the word to s1");
    const word = rec.prompts.find((p) => /не удался/.test(p.text));
    assert.equal(word.sessionID, "s1");
    assert.match(word.text, /k-own[\s\S]*другой сессии[\s\S]*iskron_stand\(take=true\)/);
    assert.ok(!rec.prompts.some((p) => /сам вернул место/.test(p.text)));
    // The word comes once, after the wait for the other socket to go — not per attempt.
    const resumes = callsIn(calls).filter((c) => c.name === "iskron/resume").length;
    assert.ok(resumes > 1, `the resume waited for the other bridge's socket: ${resumes}`);
    assert.equal(rec.prompts.filter((p) => /не удался/.test(p.text)).length, 1);
  } finally {
    await rec.stop();
  }
});

// OpenCode moves a session between folders (#6550 rule 3; event session.moved with
// data.location — @opencode/protocol). The session's tools then go through the
// instance of its new folder: the old instance puts out its bridge (the hold record
// stays), the new one takes the place back by the session at once.
test("a session moved to another folder: the old location's instance lets its place go, the new one takes it back at once and says so", async () => {
  const calls = join(SANDBOX, "move.calls");
  const resume = join(SANDBOX, "move.resume");
  writeFileSync(calls, "");
  writeFileSync(resume, JSON.stringify({ bySession: { s1: backAnswer("k-s1") } }));
  const b = bridgeEnv("move", { FB_CALLS: calls, FB_RESUME: resume, ISKRON_MOVE_ADOPT_MS: 200 });
  const A = await plugin(b.env, inLoc(LOC_A, "s1"));
  const B = await plugin(b.env, { ...inLoc(LOC_B), keepMarker: true });
  try {
    await serverTools(A);
    await standsHeld(A, b, calls, "s1", "k-s1");
    const oldPid = callsIn(calls)
      .filter((c) => c.name === "iskron_channel")
      .at(-1).pid;
    const moved = { type: "session.moved", data: { sessionID: "s1", location: LOC_B } };
    // The session now lives in B's folder — both instances read it there.
    A.ctx.session.get = async ({ sessionID }) => ({ id: sessionID, location: LOC_B });
    B.ctx.session.get = A.ctx.session.get;
    const saidBefore = A.prompts.length;
    A.emit(moved);
    B.emit(moved);
    await until(() => !alive(oldPid), "the old instance's bridge of s1 to go");
    const back = () =>
      callsIn(calls).find(
        (c) => c.name === "iskron/resume" && c.arguments.session === "s1" && c.pid !== oldPid,
      );
    await until(back, "the new instance's resume of s1");
    assert.equal(back().arguments.cwd, LOC_B.directory, "asked by its new folder and session");
    await until(() => takenBack(B).length === 1, "the word in s1");
    assert.deepEqual(takenBack(B), ["s1:k-s1"]);
    assert.deepEqual(
      A.prompts.slice(saidBefore),
      [],
      "the old instance says nothing after the move",
    );
    // The live new instance also takes the move's marker — and takes the place once.
    await until(() => lostMarkers().length === 0, "the move's marker taken");
    await delay(300);
    const resumes = callsIn(calls).filter(
      (c) => c.name === "iskron/resume" && c.arguments.session === "s1" && c.pid !== oldPid,
    );
    assert.equal(resumes.length, 1, "one return, not two");
    assert.equal(takenBack(B).length, 1);
  } finally {
    await A.stop();
    await B.stop();
  }
});

// The instance of the new folder is often made by the move itself and loads AFTER
// session.moved (seen live: POST /api/session/{id}/move on serve) — it never sees
// the event. The old instance leaves a marker tagged with the NEW location; the new
// instance takes it at setup and takes the place back at once, without a call.
test("a session moved into a folder whose instance loads after the event: the place comes back at once from the old instance's marker", async () => {
  const calls = join(SANDBOX, "move-late.calls");
  const resume = join(SANDBOX, "move-late.resume");
  writeFileSync(calls, "");
  writeFileSync(resume, JSON.stringify({ bySession: { s1: backAnswer("k-s1") } }));
  const b = bridgeEnv("move-late", { FB_CALLS: calls, FB_RESUME: resume });
  const A = await plugin(b.env, inLoc(LOC_A, "s1"));
  let B = null;
  try {
    await serverTools(A);
    await standsHeld(A, b, calls, "s1", "k-s1");
    A.ctx.session.get = async ({ sessionID }) => ({ id: sessionID, location: LOC_B });
    A.emit({ type: "session.moved", data: { sessionID: "s1", location: LOC_B } });
    await until(() => lostMarkers().length === 1, "the marker for the new folder");
    writeFileSync(calls, "");
    B = await plugin(b.env, { ...inLoc(LOC_B, "s1"), keepMarker: true });
    await until(
      () => callsIn(calls).some((c) => c.name === "iskron/resume" && c.arguments.session === "s1"),
      "the return without a call",
      3000,
    );
    assert.ok(!callsIn(calls).some((c) => !c.name.startsWith("iskron/")), "no tool call needed");
    await until(() => takenBack(B).length === 1, "the word in s1");
    assert.deepEqual(takenBack(B), ["s1:k-s1"]);
    assert.ok(!B.prompts.some((p) => /слух был потерян/.test(p.text)), "a move is no lost hearing");
  } finally {
    await A.stop();
    await B?.stop();
  }
});

// Without the event at the old instance, a take from the new folder evicts the old
// bridge — that is the session's own bridge taking its place: no «taken away» word.
test("an eviction of a session that moved to another folder is not said into it as «taken away»", async () => {
  const calls = join(SANDBOX, "move-evict.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("move-evict", { FB_CALLS: calls });
  const A = await plugin(b.env, inLoc(LOC_A, "s1"));
  try {
    await serverTools(A);
    await standsHeld(A, b, calls, "s1", "k-s1");
    const pid = callsIn(calls)
      .filter((c) => c.name === "iskron_channel")
      .at(-1).pid;
    A.ctx.session.get = async ({ sessionID }) => ({ id: sessionID, location: LOC_B });
    const before = A.prompts.length;
    appendFileSync(`${b.events}.${pid}`, event("evicted", { code: 4000, text: "отняли" }));
    await until(() => /занято из её новой папки/.test(A.said()), "the log line");
    await delay(200);
    assert.deepEqual(A.prompts.slice(before), [], "no «taken away» word into the moved session");
  } finally {
    await A.stop();
  }
});

// A parent moved to another folder: OpenCode leaves its children where they were
// (seen live). The old instance ends each satellite child there — its bridge out,
// the parent told «moved», no «КОНЧЕН» — instead of a second life until the ceiling;
// the child's calls there are refused, never by a root bridge raised for the moved
// parent (#6626). In the new folder its write is refused too, and the parent's revoke
// of it is answered by the plugin, not sent.
test("a parent moved with a satellite child: the old instance ends the child with «moved», refuses its calls, and the new one answers its revoke without sending it", async () => {
  const calls = join(SANDBOX, "move-kids.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("move-kids", { FB_CALLS: calls, FB_TOOLS: LEAD_TOOLS });
  const kids = (loc) => ({
    location: loc,
    sessions: [
      { id: "root", location: loc },
      { id: "child", parentID: "root", location: loc },
    ],
  });
  const A = await plugin(b.env, kids(LOC_A));
  let B = null;
  try {
    await until(() => A.tools().has("iskron_case"), "the tools", 8000);
    await A.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place: ROOT_PLACE }));
    await delay(400);
    await A.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = callsIn(calls)
      .filter((c) => c.name === "iskron_stand")
      .at(-1).pid;
    const sub = { ...ROOT_PLACE, name: SUB };
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
    await until(() => /мост держит стояние k-sub/.test(A.said()), "the child's held word");
    // Only the root moves; the child stays in the old folder.
    const where = { root: LOC_B, child: LOC_A };
    const get = async ({ sessionID }) => ({
      id: sessionID,
      location: where[sessionID],
      ...(sessionID === "child" ? { parentID: "root" } : {}),
    });
    A.ctx.session.get = get;
    A.emit({ type: "session.moved", data: { sessionID: "root", location: LOC_B } });
    await until(() => lostMarkers().length === 1, "the marker for the new folder");
    await until(() => !alive(childPid), "the child's bridge to go with the move");
    await until(() => A.synthetics.some((s) => s.sessionID === "root"), "the word in the parent");
    const toParent = A.synthetics.filter((s) => s.sessionID === "root");
    assert.match(toParent[0].text, /снят переносом родителя[\s\S]*«КОНЧЕН» не будет/);
    assert.equal(toParent[0].resume, false, "it does not wake the parent");
    // queue в занятого родителя после его хода запускал ещё один ход (e2e: 14.217→14.229).
    assert.equal(toParent[0].delivery, "steer", "into the going turn, not one more after it");
    assert.ok(!A.synthetics.some((s) => /КОНЧЕН —/.test(s.text)), "no «КОНЧЕН»");
    const pids = pidsOf(b.log).length;
    await assert.rejects(
      A.call("iskron_case", { realm: "nks-dev", action: "say", room: "#77" }, "child"),
      /кончена/,
    );
    await assert.rejects(A.call("iskron_look", {}, "child"), /родитель этой сессии перенесён/);
    assert.equal(pidsOf(b.log).length, pids, "no bridge raised here for the moved parent");
    B = await plugin(b.env, { ...kids(LOC_B), keepMarker: true });
    B.ctx.session.get = get;
    await until(() => B.tools().has("iskron_case"), "B's tools", 8000);
    const before = callsIn(calls).length;
    await assert.rejects(
      B.call("iskron_case", { realm: "nks-dev", action: "say", room: "#77" }, "child"),
      /кончено переносом родителя/,
    );
    const word = await B.call(
      "iskron_channel",
      { realm: "nks-dev", action: "revoke", standing: `@me:${SUB}` },
      "root",
    );
    assert.match(word.content, /кончённый переносом родителя[\s\S]*не нужен и не послан/);
    assert.ok(
      !callsIn(calls)
        .slice(before)
        .some((c) => c.name === "iskron_channel"),
      "the revoke reached no bridge",
    );
  } finally {
    await A.stop();
    await B?.stop();
  }
});

// The move without the event at the old instance: its reload must not take back the
// place of a session that now lives in another folder — that is #6626 again.
test("a reload after a session moved away: the old folder's instance does not take its place back", async () => {
  const calls = join(SANDBOX, "moved-away.calls");
  const resume = join(SANDBOX, "moved-away.resume");
  writeFileSync(calls, "");
  writeFileSync(resume, JSON.stringify({ bySession: { s1: backAnswer("k-s1") } }));
  const b = bridgeEnv("moved-away", { FB_CALLS: calls, FB_RESUME: resume });
  const first = await plugin(b.env, inLoc(LOC_A, "s1"));
  await serverTools(first);
  await standsHeld(first, b, calls, "s1", "k-s1");
  await first.stop();
  writeFileSync(calls, "");
  const second = await plugin(b.env, {
    location: LOC_A,
    sessions: [{ id: "s1", location: LOC_B }],
    keepMarker: true,
  });
  try {
    await serverTools(second);
    await delay(500);
    assert.ok(
      !callsIn(calls).some((c) => c.name === "iskron/resume" && c.arguments.session === "s1"),
      "no resume of the moved session by the old folder's instance",
    );
    assert.ok(!second.prompts.some((p) => p.sessionID === "s1"), "no word into it from here");
  } finally {
    await second.stop();
  }
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
    await rootHolds(rec, b);
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

// A subagent leads its case with a place of its own (#6002, the owner's word):
// when the root holds a place, the child's bridge is raised as a SATELLITE of it
// (`--satellite`), its iskron_stand carries satellite_of = the root's place, and
// the role is the one the child names — only an unnamed role falls back to the
// root's. The root's place is learnt from the bridge's «held» word.
test("a child session of a standing root raises its bridge as a satellite of the root's place, in the role it names or else the root's", async () => {
  const calls = join(SANDBOX, "satellite.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("satellite", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
      { id: "second", parentID: "root", location: { directory: "/work/second" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    const rootPid = pidOf(b.log);
    const place = { realm: "@nks/nks-dev", karta: "2816", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#48" }, "child");
    await rec.call("iskron_stand", { realm: "nks-dev" }, "second");
    const starts = readFileSync(b.log, "utf8").trim().split("\n");
    assert.equal(starts.length, 3, starts.join("\n"));
    assert.doesNotMatch(starts[0], /--satellite/, "the root's bridge is a session bridge");
    for (const s of starts.slice(1))
      assert.match(s, /--satellite/, "a child's bridge is a satellite");
    const stands = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron_stand")
      .map((c) => [c.arguments.karta, c.arguments.satellite_of]);
    assert.deepEqual(stands, [
      ["#2816", undefined],
      ["#48", "host.repo.opus-5"],
      ["2816", "host.repo.opus-5"],
    ]);
  } finally {
    await rec.stop();
  }
});

// After an eviction the busy line still goes by iskron_stand(status) (#6509,
// #5035), and its answer is a success — but a success of the busy line is not
// holding: the hearing is with another holder. The plugin must not mark the slot
// holding again (a stop would then leave a loss marker for a place it does not
// hear, and the idle reaper would spare it), and a satellite child is still not
// handed the root's role for its status call.
test("an evicted seat's busy line through iskron_stand is not holding: no loss marker for it, and the satellite child is not given the root's role", async () => {
  const calls = join(SANDBOX, "evicted-status.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("evicted-status", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  let stopped = false;
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    const place = { realm: "@nks/nks-dev", karta: "2816", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${pidOf(b.log)}`, event("held", { key: "k-root", place }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#48" }, "child");
    const childPid = pidsOf(b.log)[1];
    const sub = { realm: "@nks/nks-dev", karta: "48", name: "host.repo.opus-5.sub-1" };
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
    await delay(400);
    appendFileSync(
      `${b.events}.${childPid}`,
      event("evicted", { code: 4000, text: "ДЕЛАТЕЛЬ: место отняли" }),
    );
    await delay(400);
    await rec.call("iskron_stand", { realm: "nks-dev", status: "после отъёма" }, "child");
    const last = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron_stand")
      .at(-1);
    assert.equal(last.arguments.karta, undefined, "no root role for the busy line");
    assert.equal(last.arguments.satellite_of, "host.repo.opus-5");
    await rec.stop();
    stopped = true;
    const keys = lostMarkers().flatMap(
      (f) => JSON.parse(readFileSync(f, "utf8")).entries?.map((e) => e.key) ?? [],
    );
    assert.ok(keys.includes("k-root"), `the root still holds: ${JSON.stringify(keys)}`);
    assert.ok(!keys.includes("k-sub"), `the evicted child is not holding: ${JSON.stringify(keys)}`);
  } finally {
    if (!stopped) await rec.stop();
    for (const f of lostMarkers()) rmSync(f, { force: true });
  }
});

// The busy line goes by iskron_stand(status) on the seat the bridge holds (#6509):
// a satellite standing in a role of its own that calls iskron_stand(realm, status)
// must not be handed the root's role — the bridge would take it for another seat
// and go the full way of taking one. The plugin still names satellite_of.
test("a satellite child holding its seat calls iskron_stand with status only: the plugin adds satellite_of but not the root's role", async () => {
  const calls = join(SANDBOX, "satellite-status.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("satellite-status", {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    const place = { realm: "@nks/nks-dev", karta: "2816", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${pidOf(b.log)}`, event("held", { key: "k-root", place }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#48" }, "child");
    const childPid = pidsOf(b.log)[1];
    const sub = { realm: "@nks/nks-dev", karta: "48", name: "host.repo.opus-5.sub-1" };
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
    await delay(400);
    await rec.call("iskron_stand", { realm: "nks-dev", status: "спутник пишет" }, "child");
    const stands = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron_stand")
      .map((c) => [c.arguments.karta, c.arguments.satellite_of, c.arguments.status]);
    assert.deepEqual(stands.at(-1), [undefined, "host.repo.opus-5", "спутник пишет"]);
    // Один список с мостом (shared/busyargs.ts): room_karta — занятие места, и
    // роль корня подставляется, как у всякого вызова занятия.
    await rec.call(
      "iskron_stand",
      { realm: "nks-dev", status: "стучу", room_karta: "#1226" },
      "child",
    );
    const withRoom = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron_stand")
      .at(-1);
    assert.equal(withRoom.arguments.karta, "2816", "room_karta is not a busy-line argument");
  } finally {
    await rec.stop();
  }
});

// A lead subagent (#6625, the steward's form): a child that stood a place of its
// own lives until the outcome of its errand, not until the end of its turn.
// OpenCode keeps the child session alive after a turn, and a frame of its case
// wakes ITS session; the end is an explicit act — its own leave, the launcher's
// revoke of its place, the session's deletion, or the ceiling of a forgotten
// child — and on that end the plugin lays the result into the parent as a
// synthetic marked as the end. The events' form is from the types of
// @opencode/schema (plugin 2.0.4): data.sessionID; data.text of session.text.ended.
const LEAD_TOOLS = JSON.stringify(
  ["iskron_stand", "iskron_channel", "iskron_case", "iskron_look"].map((name) => ({
    name,
    description: "Тул.",
    inputSchema: { type: "object" },
  })),
);
const ROOT_PLACE = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
const SUB = "host.repo.opus-5.sub-1";

/** A root holding a place and a child standing as its satellite on a bridge of its own. */
async function leadChild(name, env = {}, root = ROOT_PLACE, subName = SUB) {
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const b = bridgeEnv(name, { FB_CALLS: calls, FB_TOOLS: LEAD_TOOLS, ...env });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_case"), "the tools", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place: root }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = pidsOf(b.log)[1];
    const sub = { ...root, name: subName };
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
    await until(() => /мост держит стояние k-sub/.test(rec.said()), "the child's held word");
    return { b, rec, rootPid, childPid, sent: () => sentCalls(calls) };
  } catch (e) {
    await rec.stop(); // a failed setup must not keep the probe's process alive
    throw e;
  }
}

/** One turn of the child: started, its text, ended. */
function turn(rec, text, sessionID = "child") {
  rec.emit({ type: "session.execution.started", data: { sessionID } });
  if (text) rec.emit({ type: "session.text.ended", data: { sessionID, ordinal: 0, text } });
  rec.emit({ type: "session.execution.succeeded", data: { sessionID } });
}

const ends = (rec) => rec.synthetics.filter((s) => /КОНЧЕН/.test(s.text));

test("the end of a child's turn ends nothing: its bridge lives, a frame of its case wakes its session and never the root, and the parent hears it is a turn, not the result", async () => {
  const { b, rec, rootPid, childPid } = await leadChild("lead-turn", {
    ISKRON_BRIDGE_WATCH_MS: 200,
  });
  try {
    turn(rec, "жду соседа по делу");
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "root" } });
    await delay(700); // more than three ticks of the hearing watch
    assert.ok(alive(childPid), "the child's bridge lives past the end of its turn");
    assert.ok(alive(rootPid), "the root's end of execution takes nothing down");
    await until(() => rec.synthetics.length === 1, "the word about the turn");
    assert.equal(rec.synthetics[0].sessionID, "root");
    assert.match(
      rec.synthetics[0].text,
      /сдал ход, не поручение[\s\S]*standing="host\.repo\.opus-5\.sub-1"/,
    );
    assert.equal(ends(rec).length, 0, "a turn is not the end");
    appendFileSync(
      `${b.events}.${childPid}`,
      event("frame", { frame: frame("сосед ответил"), raw: "" }),
    );
    await until(() => rec.prompts.length === 1, "the frame of the child's case");
    assert.equal(rec.prompts[0].sessionID, "child", "the frame wakes the child's own session");
    assert.match(rec.prompts[0].text, /сосед ответил/);
    turn(rec, "второй ход");
    await delay(300);
    assert.equal(rec.synthetics.length, 1, "the parent is told about the first turn only");
    assert.ok(
      !rec.prompts.some((p) => p.sessionID === "root"),
      "the root got no frame of the child",
    );
  } finally {
    await rec.stop();
  }
});

// The bridge cuts the base of a satellite's name under the server's 48-sign limit
// (bridge/satellite.ts): a root place longer than 42 signs gives «<cut base>.sub-1».
// The plugin knows its satellite by the bridge's own rule, not by a prefix.
test("a satellite of a root place with a long name — its base cut by the bridge — is still its satellite: its end takes it down", async () => {
  const root = { ...ROOT_PLACE, name: "host-machine.a-very-long-repository-name.opus-5-5" };
  const cut = `${root.name.slice(0, 48 - ".sub-1".length).replace(/[-._]+$/, "")}.sub-1`;
  assert.ok(!cut.startsWith(`${root.name}.sub-`), "the probe's name is cut indeed");
  const { rec, childPid } = await leadChild("lead-long", {}, root, cut);
  try {
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => !alive(childPid), "the satellite's bridge to go with its end");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /место снято/);
    assert.doesNotMatch(ends(rec)[0].text, /не спутником/);
  } finally {
    await rec.stop();
  }
});

test("a child that leaves its place by the outcome is ended: its bridge goes, the parent gets its last word marked as the end, its writes are refused", async () => {
  const { rec, childPid, sent } = await leadChild("lead-leave");
  try {
    rec.emit({ type: "session.execution.started", data: { sessionID: "child" } });
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await delay(300);
    assert.ok(alive(childPid), "a leave said mid-turn waits for the turn's end and its text");
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", text: "Итог: мост починен." },
    });
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } });
    await until(() => !alive(childPid), "the child's bridge to go with its leave");
    await until(() => ends(rec).length === 1, "the end in the parent");
    const [end] = ends(rec);
    assert.equal(end.sessionID, "root");
    assert.match(
      end.text,
      /host\.repo\.opus-5\.sub-1 КОНЧЕН — ушёл с места[\s\S]*конец поручения, не ход[\s\S]*Итог: мост починен\./,
    );
    assert.ok(
      !rec.synthetics.some((s) => /сдал ход/.test(s.text)),
      "the last turn is the end, not a turn",
    );
    const before = sent().length;
    await assert.rejects(
      rec.call("iskron_case", { action: "say" }, "child"),
      /дочерняя сессия кончена/,
    );
    assert.equal(sent().length, before, "the refused write reached no bridge");
  } finally {
    await rec.stop();
  }
});

// The end's word goes into the parent BEFORE the child's bridge is put out: OpenCode
// lays its own synthetic into the parent when the child goes quiet, and the plugin's
// «КОНЧЕН» must stand in the parent's queue ahead of it.
test("a child's end: the word into the parent is laid before the child's bridge is put out", async () => {
  const { rec, childPid } = await leadChild("lead-order");
  const synthetic = rec.ctx.session.synthetic;
  let bridgeDuringWord = null;
  rec.ctx.session.synthetic = async (o) => {
    await delay(300); // the bridge, if put out first, is gone by now
    if (/КОНЧЕН/.test(o.text)) bridgeDuringWord = alive(childPid);
    return synthetic(o);
  };
  try {
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.equal(bridgeDuringWord, true, "the child's bridge lives while the end's word is laid");
    await until(() => !alive(childPid), "the child's bridge to go after the word");
  } finally {
    await rec.stop();
  }
});

// OpenCode's own synthetic wakes the parent when the child goes quiet; a queued
// «КОНЧЕН» would lie down only after that turn (seen live: +4.8 s). The end goes
// steer — into the running turn at its next step — and wakes an idle parent.
test("a child's end goes into the parent steer, waking it", async () => {
  const { rec } = await leadChild("lead-steer");
  try {
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.equal(ends(rec)[0].delivery, "steer");
    assert.equal(ends(rec)[0].resume, true);
  } finally {
    await rec.stop();
  }
});

test("a one-shot child launched into a case is ended by leaving that case — and not by leaving another", async () => {
  const calls = join(SANDBOX, "lead-oneshot.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("lead-oneshot", {
    FB_CALLS: calls,
    FB_TOOLS: LEAD_TOOLS,
    FB_STAND_HELD: "host.repo.opus-5",
  });
  const rec = await plugin(b.env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  try {
    await until(() => rec.tools().has("iskron_case"), "the tools", 8000);
    await rec.call("iskron_stand", { realm: "@nks/nks-dev", karta: "#2816" }, "root");
    await until(() => /мост держит стояние/.test(rec.said()), "the root's held word");
    await rec.prompt("child", "start @nks/nks-dev #48 дело №77\nБриф: проверь.");
    const childPid = pidsOf(b.log)[1];
    await rec.call("iskron_case", { realm: "@nks/nks-dev", action: "join", room: "#80" }, "child");
    await rec.call("iskron_case", { realm: "@nks/nks-dev", action: "leave", room: "#80" }, "child");
    await delay(300);
    assert.ok(alive(childPid), "leaving another case is not the outcome");
    await rec.call("iskron_case", { realm: "@nks/nks-dev", action: "leave", room: "№77" }, "child");
    await until(() => !alive(childPid), "the child's bridge to go with leaving its case");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /вышел из дела №77 по исходу/);
  } finally {
    await rec.stop();
  }
});

// A leave without a room leaves every case — the whole outcome, like a leave of the place.
// #6550 rule 2 (variant A, the owner's choice): a subagent speaks only by its own
// satellite. The three cases of the scouting: a root holding no place — the child's
// stand is refused, not an ordinary place; a child that never stood — its write is
// refused whether the root holds a place (it would be signed by the parent's) or not;
// its reads go by the root's bridge.
async function childUnder(name, rootHolds) {
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const b = bridgeEnv(name, { FB_CALLS: calls, FB_TOOLS: LEAD_TOOLS });
  const rec = await plugin(b.env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  await until(() => rec.tools().has("iskron_case"), "the tools", 8000);
  if (rootHolds) {
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    appendFileSync(
      `${b.events}.${pidOf(b.log)}`,
      event("held", { key: "k-root", place: ROOT_PLACE }),
    );
    await until(() => /мост держит стояние k-root/.test(rec.said()), "the root's held word");
  } else await rec.call("iskron_look", { realm: "nks-dev", node_id: "1" }, "root");
  return { rec, calls, b };
}

test("rule 2: under a root holding no place, a child's stand is refused aloud — no ordinary place, no bridge of its own", async () => {
  const { rec, calls, b } = await childUnder("rule2-stand", false);
  try {
    const bridges = pidsOf(b.log).length;
    await assert.rejects(
      rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child"),
      /место родителя неизвестно/,
    );
    assert.equal(pidsOf(b.log).length, bridges, "no bridge raised for the child");
    assert.ok(!callsIn(calls).some((c) => c.name === "iskron_stand"), "no stand went out");
  } finally {
    await rec.stop();
  }
});

for (const rootHolds of [true, false])
  test(`rule 2: a child that never stood cannot write by the root's bridge (root ${rootHolds ? "holding a place" : "without a place"}); it reads by it`, async () => {
    const { rec, calls } = await childUnder(`rule2-write-${rootHolds}`, rootHolds);
    try {
      const before = callsIn(calls).length;
      await assert.rejects(
        rec.call("iskron_case", { realm: "nks-dev", action: "say", room: "#77" }, "child"),
        rootHolds ? /ушёл бы местом родителя host\.repo\.opus-5/ : /место родителя неизвестно/,
      );
      assert.equal(callsIn(calls).length, before, "the refused write reached no bridge");
      await rec.call("iskron_look", { realm: "nks-dev", node_id: "42" }, "child");
      assert.equal(callsIn(calls).at(-1).name, "iskron_look", "the read goes by the root's bridge");
    } finally {
      await rec.stop();
    }
  });

test("a child's case leave without a room ends it", async () => {
  const { rec, childPid } = await leadChild("lead-leave-all");
  try {
    await rec.call("iskron_case", { realm: "nks-dev", action: "join", room: "#77" }, "child");
    await rec.call("iskron_case", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => !alive(childPid), "the child's bridge to go with leaving all its cases");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /ушёл из дел по исходу/);
  } finally {
    await rec.stop();
  }
});

test("the launcher's revoke of its child's place ends the child for good: the plugin answers, the root's bridge revokes nothing, the parent gets the end, the child one word, and it cannot stand again", async () => {
  const { b, rec, rootPid, childPid, sent } = await leadChild("lead-release");
  try {
    rec.emit({ type: "session.text.ended", data: { sessionID: "child", text: "наполовину" } });
    await delay(50); // the child's text is taken before the launcher's later word
    const word = await rec.call(
      "iskron_channel",
      { realm: "nks-dev", action: "revoke", standing: `@me:${SUB}` },
      "root",
    );
    assert.match(word.content, /отпущен/);
    await until(() => !alive(childPid), "the child's bridge to go on the launcher's word");
    assert.ok(alive(rootPid), "the launcher's bridge stays");
    assert.ok(
      !sent().some((c) => c.pid === rootPid && c.arguments.action === "revoke"),
      "the root's bridge sent no revoke of the child's place",
    );
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /отпущен словом запустившего[\s\S]*наполовину/);
    await until(() => rec.synthetics.some((s) => s.sessionID === "child"), "the child's word");
    const toChild = rec.synthetics.filter((s) => s.sessionID === "child");
    assert.equal(toChild.length, 1, "one word to the child");
    assert.match(toChild[0].text, /отпустил тебя/);
    assert.equal(toChild[0].resume, false, "the word does not wake the child");
    const bridges = pidsOf(b.log).length;
    await assert.rejects(
      rec.call("iskron_stand", { realm: "nks-dev" }, "child"),
      /отпустил эту дочернюю сессию/,
    );
    await assert.rejects(rec.call("iskron_case", { action: "say" }, "child"), /отпустил/);
    assert.equal(pidsOf(b.log).length, bridges, "no bridge raised for the released child");
    await delay(300);
    assert.equal(ends(rec).length, 1, "it is not a lead again");
  } finally {
    await rec.stop();
  }
});

// The ceiling's word lies in the parent without waking it (synthetic resume=false:
// «schedule execution unless resume is false», OpenCode's description of the call);
// and only turns and frames count — other events of the child's session do not.
test("a lead child idle past the ceiling — no turn, no frame, whatever else its session emits — is ended, and the parent is told without being woken", async () => {
  const { rec, childPid } = await leadChild("lead-ceiling", { ISKRON_LEAD_IDLE_MS: 1500 });
  const noise = setInterval(() => {
    for (const type of ["session.usage.updated", "session.viewed", "session.inbox.delivered"])
      rec.emit({ type, data: { sessionID: "child", tokens: { input: 1 } } });
  }, 150);
  try {
    await until(() => !alive(childPid), "the forgotten child's bridge to go", 8000);
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /потолок простоя/);
    assert.equal(ends(rec)[0].resume, false, "the ceiling does not wake the parent");
    assert.equal(ends(rec)[0].delivery, "steer", "nor queues a turn after the parent's");
  } finally {
    clearInterval(noise);
    await rec.stop();
  }
});

test("a deleted lead child session: its bridge goes and the parent gets the end", async () => {
  const { rec, childPid } = await leadChild("lead-deleted");
  try {
    rec.emit({ type: "session.deleted", data: { sessionID: "child" } });
    await until(() => !alive(childPid), "the child's bridge to go with its session");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /сессия субагента удалена/);
  } finally {
    await rec.stop();
  }
});

// Two subagents of one launcher in one case (#6625): a word of A to B wakes only
// B's session; A's bridge gets the same record as a word not to it — a count, no
// prompt; the launcher gets nothing. A's leave ends A and leaves B standing.
test("two children of one parent in one case: A's word to B wakes only B, neither A nor the parent gets it; A's leave leaves B alone", async () => {
  const calls = join(SANDBOX, "lead-pair.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("lead-pair", { FB_CALLS: calls, FB_TOOLS: LEAD_TOOLS });
  const rec = await plugin(b.env, {
    sessions: [{ id: "root" }, { id: "A", parentID: "root" }, { id: "B", parentID: "root" }],
  });
  try {
    await until(() => rec.tools().has("iskron_case"), "the tools", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place: ROOT_PLACE }));
    await delay(400);
    const seat = {};
    for (const [s, n] of [
      ["A", 1],
      ["B", 2],
    ]) {
      await rec.call("iskron_stand", { realm: "nks-dev" }, s);
      const pid = pidsOf(b.log).at(-1);
      const place = { ...ROOT_PLACE, name: `${ROOT_PLACE.name}.sub-${n}` };
      appendFileSync(`${b.events}.${pid}`, event("held", { key: `k-${s}`, place }));
      await until(() => rec.said().includes(`мост держит стояние k-${s}`), `${s}'s held word`);
      await rec.call("iskron_case", { realm: "nks-dev", action: "join", room: "#77" }, s);
      seat[s] = { pid, addr: `@me:${place.name}` };
    }
    const word = (to) => ({
      ...addressed(301, seat.B.addr),
      to_standing: to,
      to_standing_id: to,
    });
    appendFileSync(
      `${b.events}.${seat.B.pid}`,
      event("frame", { frame: word(seat.B.addr), raw: "" }),
    );
    appendFileSync(
      `${b.events}.${seat.A.pid}`,
      event("frame", { frame: word(seat.A.addr), raw: "" }),
    );
    await until(() => rec.prompts.length === 1, "the word in B's session");
    await delay(BATCH_MS * 4);
    assert.deepEqual(
      rec.prompts.map((p) => p.sessionID),
      ["B"],
      "only B is woken; A and the parent get nothing",
    );
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "A");
    await until(() => !alive(seat.A.pid), "A's bridge to go with its leave");
    await until(() => ends(rec).length === 1, "A's end in the parent");
    assert.match(ends(rec)[0].text, /sub-1 КОНЧЕН/);
    await delay(300);
    assert.ok(alive(seat.B.pid), "B stands on");
    assert.deepEqual(
      rec.prompts.map((p) => p.sessionID),
      ["B"],
      "A's leave wakes nobody",
    );
  } finally {
    await rec.stop();
  }
});

// A plugin reload is not a child's end (#6625, #6550 p.3): the stopped instance
// pauses the child's bridge (iskron/suspend) — the place and its cases wait — and
// writes the child's key, the root's place and its errand's case into the marker;
// the next instance raises the child the same satellite bridge and takes the place
// back by key, without a word to the child: its session waits on. The tie to the
// parent is the session's parentID (OpenCode's Session), as at the first start.
async function reloadedChild(name, env = {}, gone = null, firstTurn = false) {
  const calls = join(SANDBOX, `${name}.calls`);
  const resume = join(SANDBOX, `${name}.resume`);
  writeFileSync(calls, "");
  const answer = { resumed: true, holding: true, key: "k-sub", word: "место возвращено" };
  writeFileSync(resume, JSON.stringify({ bySession: { child: answer } }));
  const b = bridgeEnv(name, { FB_CALLS: calls, FB_TOOLS: LEAD_TOOLS, FB_RESUME: resume, ...env });
  const sessions = [
    { id: "root", location: { directory: "/work/root" } },
    { id: "child", parentID: "root", location: { directory: "/work/child" } },
  ];
  const first = await plugin(b.env, { sessions });
  await until(() => first.tools().has("iskron_case"), "the tools", 8000);
  await first.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
  const rootPid = pidOf(b.log);
  appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place: ROOT_PLACE }));
  await delay(400);
  await first.call("iskron_stand", { realm: "nks-dev" }, "child");
  const childPid = pidsOf(b.log)[1];
  const sub = { ...ROOT_PLACE, name: SUB };
  appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
  await until(() => /мост держит стояние k-sub/.test(first.said()), "the child's held word");
  await first.call("iskron_case", { realm: "nks-dev", action: "join", room: "#77" }, "child");
  if (firstTurn) {
    turn(first, "жду соседа");
    await until(() => first.synthetics.some((s) => /сдал ход/.test(s.text)), "the first turn word");
  }
  await first.stop();
  const all = () =>
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  // gone — сессии, которые второй экземпляр не прочтёт (ctx.session.get бросает): возврата им нет.
  const second = await plugin(b.env, { keepMarker: true, sessions, ...(gone ? { gone } : {}) });
  if (gone) return { b, first, second, childPid, all };
  try {
    const back = () =>
      all().find((c) => c.name === "iskron/resume" && c.arguments.session === "child");
    await until(back, "the child's place asked back", 8000);
    return { b, first, second, childPid, newPid: back().pid, back: back(), all };
  } catch (e) {
    await second.stop();
    throw e;
  }
}

test("marker-child: a reload pauses the child's bridge and the next instance takes its place back by key, quietly — the child stays a lead, writes by its own bridge, ends by its leave", async () => {
  const { b, second, childPid, newPid, back, all } = await reloadedChild("reload-child");
  try {
    assert.deepEqual(
      all()
        .filter((c) => c.name === "iskron/suspend")
        .map((c) => c.pid),
      [childPid],
      "the stopped instance paused the child's bridge, and only it",
    );
    assert.deepEqual(back.arguments, { key: "k-sub", session: "child" });
    assert.notEqual(newPid, childPid);
    const start = readFileSync(b.log, "utf8")
      .trim()
      .split("\n")
      .find((l) => Number(l.split(/\s+/)[1]) === newPid);
    assert.match(start, /--satellite/, "the same satellite of the root's place");
    await delay(300);
    assert.ok(!second.prompts.some((p) => p.sessionID === "child"), "no word wakes the child");
    assert.deepEqual(second.synthetics, [], "the parent is told nothing: the child goes on");
    await second.call("iskron_case", { realm: "nks-dev", action: "say", room: "#77" }, "child");
    assert.equal(all().at(-1).pid, newPid, "the child's write goes by its own new bridge");
    await second.call("iskron_case", { realm: "nks-dev", action: "leave", room: "№77" }, "child");
    await until(() => !alive(newPid), "the child's bridge to go with leaving its errand's case");
    await until(() => ends(second).length === 1, "the end in the parent");
    assert.match(ends(second)[0].text, /вышел из дела №77 по исходу/);
    assert.equal(ends(second)[0].sessionID, "root");
  } finally {
    await second.stop();
  }
});

// A child whose session the next instance cannot read (deleted, or ctx.session.get
// failing for a while) is not taken back — and is ended: its write is refused,
// never served by the root's bridge (#6361).
test("marker-child: a child whose session cannot be read after a reload is ended — its write is refused, not sent by the root's bridge", async () => {
  const { second, all } = await reloadedChild("reload-unread", {}, new Set(["child"]));
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await delay(300);
    const before = all().length;
    await assert.rejects(
      second.call("iskron_case", { realm: "nks-dev", action: "say", room: "#77" }, "child"),
      /дочерняя сессия кончена/,
    );
    assert.equal(all().length, before, "the refused write reached no bridge");
    assert.ok(!all().some((c) => c.name === "iskron/resume" && c.arguments.session === "child"));
  } finally {
    await second.stop();
  }
});

test("marker-child: a child taken back after a reload is under the ceiling again", async () => {
  const { second, newPid } = await reloadedChild("reload-ceiling", { ISKRON_LEAD_IDLE_MS: 2500 });
  try {
    await until(() => !alive(newPid), "the forgotten child's bridge to go", 10000);
    await until(() => ends(second).length === 1, "the end in the parent");
    assert.match(ends(second)[0].text, /потолок простоя/);
  } finally {
    await second.stop();
  }
});

// The child's last text is its result at the end: it rides the marker through a
// reload (seen live: a revoke after a reload gave «(текста он не оставил)»).
test("marker-child: the child's last text survives a reload and is its result at the end", async () => {
  const { second } = await reloadedChild("reload-last", {}, null, true);
  try {
    const word = await second.call(
      "iskron_channel",
      { realm: "nks-dev", action: "revoke", standing: `@me:${SUB}` },
      "root",
    );
    assert.match(word.content, /отпущен/);
    await until(() => ends(second).length === 1, "the end in the parent");
    assert.match(ends(second)[0].text, /Итог — его последнее слово:\nжду соседа/);
  } finally {
    await second.stop();
  }
});

// The previous bridge leaves by its own bye, and its socket of the child's place may
// live on for seconds: the new child bridge waits for it to go — not a count of
// attempts — and says nothing to the child meanwhile: no «take it back» that the
// next attempt would make false, and no end of the child with its place whole.
test("marker-child: while the previous bridge still holds the child's socket, the return waits for it silently and then takes the place", async () => {
  const answers = join(SANDBOX, "reload-wait.answers");
  const elsewhere = {
    resumed: false,
    elsewhere: ["k-sub"],
    word: "возвращать нечего — k-sub: держит живой мост",
  };
  writeFileSync(answers, JSON.stringify({ bySession: { child: elsewhere } }));
  const { second, all, newPid } = await reloadedChild("reload-wait", {
    FB_RESUME: answers,
    ISKRON_CHILD_BACK_PAUSE_MS: 150,
  });
  try {
    await delay(1500); // more than every attempt by count
    const answer = { resumed: true, holding: true, key: "k-sub", word: "место возвращено" };
    writeFileSync(answers, JSON.stringify({ bySession: { child: answer } }));
    const resumes = () =>
      all().filter((c) => c.name === "iskron/resume" && c.arguments.session === "child");
    const n = resumes().length;
    await until(() => resumes().length > n, "the return after the socket went", 3000);
    await delay(300);
    const toChild = [...second.prompts, ...second.synthetics].filter(
      (p) => p.sessionID === "child",
    );
    assert.deepEqual(toChild, [], "not a word to the child while it waits");
    assert.deepEqual(second.synthetics, [], "the parent is told nothing: the child goes on");
    await second.call("iskron_case", { realm: "nks-dev", action: "say", room: "#77" }, "child");
    assert.equal(all().at(-1).pid, newPid, "the child writes by its own bridge again");
  } finally {
    await second.stop();
  }
});

// The children's places come back quietly by their own bridges: the root's loss
// word names the root's places only — a child's key there would call the root to
// take back a place that is not its own.
test("marker-child: the root's loss word after a reload names its own place, never its children's", async () => {
  const { second } = await reloadedChild("reload-word");
  try {
    const loss = () => second.prompts.find((p) => /слух был потерян/.test(p.text));
    await until(loss, "the loss word in the root");
    assert.equal(loss().sessionID, "root");
    assert.match(loss().text, /k-root/);
    assert.doesNotMatch(loss().text, /k-sub|sub-1/, "no child's place in the root's word");
  } finally {
    await second.stop();
  }
});

// The parent was told the child's first turn before the reload; the next instance
// knows it from the marker and does not tell it again on the child's next turn.
test("marker-child: a parent told of the child's first turn is not told again after a reload", async () => {
  const { second } = await reloadedChild("reload-noted", {}, null, true);
  try {
    turn(second, "ход после перезагрузки");
    await delay(400);
    assert.ok(
      !second.synthetics.some((s) => /сдал ход/.test(s.text)),
      "no second «turn, not the errand» word",
    );
  } finally {
    await second.stop();
  }
});

// OpenCode's own notice of a child's turn — `<subagent … state="completed">`, a
// synthetic into the parent (or the task tool's result) — reads as «done». The
// plugin cannot catch it, but the "context" hook (SessionContext of @opencode/plugin
// 2.0.x: system and messages are mutable) reaches every request the model reads:
// for a live lead named by such a notice, a system word says it is a turn.
test("OpenCode's «completed» notice of a live lead child's turn gets the plugin's word in the request's system; a plain subagent and an ended lead get none", async () => {
  const { rec } = await leadChild("lead-notice");
  const ask = async (...messages) => {
    const req = { sessionID: "root", system: [], messages };
    for (const cb of rec.hooks.context ?? []) await cb(req);
    return req.system.map((p) => p.text);
  };
  const notice = (id) => `<subagent sessionID="${id}" state="completed" description="x">\nжду\n`;
  try {
    assert.equal(rec.hooks.context?.length, 1, "the plugin hooks the request's context");
    assert.equal(rec.hooks.compaction?.length, 1, "and the compaction's");
    turn(rec, "жду соседа");
    const said = await ask(
      { role: "user", content: [{ type: "text", text: notice("child") }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "t",
            name: "task",
            result: { type: "text", value: notice("other") },
          },
        ],
      },
    );
    assert.equal(said.length, 1, "one word: the plain subagent «other» gets none");
    assert.match(said[0], /sessionID="child"[\s\S]*конец ХОДА субагента host\.repo\.opus-5\.sub-1/);
    const byTool = await ask({
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "t",
          name: "task",
          result: { type: "text", value: notice("child") },
        },
      ],
    });
    assert.equal(byTool.length, 1, "the task tool's result is read too");
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.deepEqual(
      await ask({ role: "user", content: [{ type: "text", text: notice("child") }] }),
      [],
      "an ended lead's notice is left as it is: its end has been said",
    );
  } finally {
    await rec.stop();
  }
});

// A word of the child's bridge — a backlog burst, a stale pile, a lost hearing —
// is the child's: with its session gone it is said aloud, never re-addressed to a root.
test("a backlog, a stale pile and a lost hearing of a child whose session is gone never reach the root", async () => {
  const gone = new Set();
  const b = bridgeEnv("lead-leak", { FB_TOOLS: LEAD_TOOLS });
  const rec = await plugin(b.env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
    gone,
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#2816" }, "root");
    await rootHolds(rec, b);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child");
    const [, childPid] = pidsOf(b.log);
    gone.add("child");
    for (const [kind, extra] of [
      ["backlog", { text: "пачка побудки ребёнка", frames: [{}] }],
      ["stale", { text: "лежалые ребёнка" }],
      ["lost", { text: "слух ребёнка потерян" }],
    ])
      appendFileSync(`${b.events}.${childPid}`, event(kind, extra));
    await until(
      () => (rec.said().match(/корню не переадресую/g) ?? []).length >= 3,
      "three loud lines",
    );
    await delay(200);
    assert.deepEqual(rec.prompts, [], "the root must not receive the child's words");
  } finally {
    await rec.stop();
  }
});

// Each session's spend goes to its own place (#6401): the child's to its
// satellite by its own bridge, the root's to the root's — never the child's
// numbers to the root. The child's end (#6625: its leave) hands the snapshot the
// debounce holds over at once, before the child's bridge goes with its place.
test("usage: a child's spend reaches its own bridge at its end, before the bridge goes; the root's stays the root's", async () => {
  const calls = join(SANDBOX, "usage-child.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("usage-child", {
    FB_CALLS: calls,
    ISKRON_USAGE_DEBOUNCE_MS: 600000,
    FB_TOOLS: LEAD_TOOLS,
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  const usageCalls = () =>
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron/usage");
  const tok = (input) => ({ input, output: 10, reasoning: 5, cache: { read: 100, write: 1 } });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    const place = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = pidsOf(b.log)[1];
    const sub = { ...place, name: "host.repo.opus-5.sub-1" };
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
    await delay(400);
    for (const [sessionID, input] of [
      ["root", 1000],
      ["child", 200],
    ]) {
      const model = { id: `m-${sessionID}`, providerID: "p" };
      rec.emit({ type: "session.step.started", data: { sessionID, model } });
      rec.emit({ type: "session.usage.updated", data: { sessionID, tokens: tok(input) } });
    }
    await delay(200);
    assert.equal(usageCalls().length, 0, "the debounce holds both snapshots");
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => !alive(childPid), "the child's bridge to end with its leave");
    const child = usageCalls().filter((c) => c.pid === childPid);
    assert.deepEqual(child.at(-1)?.arguments, {
      tokens: 216,
      input: 200,
      output: 15,
      cache_read: 100,
      cache_write: 1,
      model: "m-child",
    });
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "root" } });
    await until(() => usageCalls().some((c) => c.pid === rootPid), "the root's snapshot");
    const root = usageCalls().filter((c) => c.pid === rootPid);
    assert.deepEqual(
      root.map((c) => [c.arguments.input, c.arguments.model]),
      [[1000, "m-root"]],
      "the root's place gets the root's numbers only",
    );
  } finally {
    await rec.stop();
  }
});

// Review of #297, p.2: a snapshot already handed to the bridge is in flight when
// the child ends. The last one waits for its answer and goes after it — never
// overtaking it, never left behind when the child's bridge goes (faf654b did both).
test("usage: the child's end waits for the snapshot in flight, then sends the last one", async () => {
  const calls = join(SANDBOX, "usage-flight.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("usage-flight", {
    FB_CALLS: calls,
    FB_USAGE_DELAY_MS: 1500,
    ISKRON_USAGE_DEBOUNCE_MS: 50,
    FB_TOOLS: LEAD_TOOLS,
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  const usageLines = () =>
    readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((c) => c.name.startsWith("iskron/usage"));
  const tok = (input) => ({ input, output: 10, reasoning: 5, cache: { read: 100, write: 1 } });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    const place = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = pidsOf(b.log)[1];
    const sub = { ...place, name: "host.repo.opus-5.sub-1" };
    appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: sub }));
    await delay(400);
    rec.emit({ type: "session.usage.updated", data: { sessionID: "child", tokens: tok(200) } });
    await until(() => usageLines().length > 0, "the first snapshot in flight");
    rec.emit({ type: "session.usage.updated", data: { sessionID: "child", tokens: tok(300) } });
    await delay(20); // the event is taken before the leave, as a turn's events precede its tool call
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => !alive(childPid), "the child's bridge to end with its leave", 8000);
    assert.deepEqual(
      usageLines()
        .filter((c) => c.pid === childPid)
        .map((c) => [c.name, c.arguments.input]),
      [
        ["iskron/usage", 200],
        ["iskron/usage:answered", 200],
        ["iskron/usage", 300],
        ["iskron/usage:answered", 300],
      ],
    );
  } finally {
    await rec.stop();
  }
});

// A child resumed after its run ended (the field case, case №66 [7133], [7138]):
// its slot is gone, and a call without a mark went by the root's bridge — a
// join, line or say signed with the root's place, a leave took the root out of
// the case. A call that needs a place is refused aloud with the way back; a
// read goes by the root's bridge, it signs nothing; iskron_stand raises the
// child a bridge of its own again, and its writes go by it.
async function endedChild(name, more = []) {
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const b = bridgeEnv(name, {
    FB_CALLS: calls,
    FB_TOOLS: JSON.stringify(
      ["iskron_stand", "iskron_case", "iskron_look", "iskron_channel", ...more].map((n) => ({
        name: n,
        description: "Тул.",
        inputSchema: { type: "object" },
      })),
    ),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_case"), "the tools", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    const place = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place }));
    await delay(400); // the fake bridge relays event lines every 40 ms
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = pidsOf(b.log)[1];
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await until(() => !alive(childPid), "the child's bridge to end with its leave");
    return { b, rec, rootPid, sent: () => sentCalls(calls) };
  } catch (e) {
    await rec.stop(); // a failed setup must not keep the probe's process alive
    throw e;
  }
}

test("a child whose run ended is refused aloud on a call that needs a place — never by the root's bridge; a read goes by the root's", async () => {
  const { rec, rootPid, sent } = await endedChild("ended-write");
  try {
    const before = sent().length;
    await assert.rejects(
      rec.call("iskron_case", { realm: "nks-dev", action: "leave", room: "№1" }, "child"),
      /эта дочерняя сессия кончена[\s\S]*iskron_stand\(realm, karta, satellite_of="host\.repo\.opus-5"\)/,
    );
    assert.equal(sent().length, before, "the refused call reached no bridge");
    await rec.call("iskron_look", { realm: "nks-dev", node_id: "1" }, "child");
    const read = sent().at(-1);
    assert.equal(read?.name, "iskron_look");
    assert.equal(read?.pid, rootPid, "a read goes by the root's bridge");
  } finally {
    await rec.stop();
  }
});

// Reads of the account tools sign nothing and go by the root's bridge; their
// writing actions are refused like any call that needs a place (#6361).
test("a child whose run ended reads realms, orgs, itself and history by the root's bridge; their writing actions are refused", async () => {
  const { rec, rootPid, sent } = await endedChild("ended-reads", [
    "iskron_realm",
    "iskron_org",
    "iskron_me",
    "iskron_history",
  ]);
  try {
    const reads = [
      ["iskron_realm", "list"],
      ["iskron_org", "list"],
      ["iskron_org", "get"],
      ["iskron_org", "list_members"],
      ["iskron_me", "whoami"],
      ["iskron_history", "node"],
    ];
    for (const [tool, action] of reads) {
      await rec.call(tool, { action }, "child");
      assert.deepEqual([sent().at(-1)?.name, sent().at(-1)?.pid], [tool, rootPid], action);
    }
    const before = sent().length;
    for (const [tool, action] of [
      ["iskron_realm", "create"],
      ["iskron_org", "add_member"],
      ["iskron_me", "set_handle"],
      ["iskron_history", "restore_node"],
    ])
      await assert.rejects(rec.call(tool, { action }, "child"), /кончена[\s\S]*iskron_stand/);
    assert.equal(sent().length, before, "no refused call reached a bridge");
  } finally {
    await rec.stop();
  }
});

// A deleted session leaves no mark behind: the plugin forgets it whole.
test("a deleted child session takes its run-ended mark with it", async () => {
  const { rec, sent } = await endedChild("ended-deleted");
  try {
    rec.emit({ type: "session.deleted", data: { sessionID: "child" } });
    await delay(200);
    const before = sent().length;
    // Пометки конца нет — вызов судит правило 2: ребёнок без своего спутника не пишет.
    await assert.rejects(rec.call("iskron_case", { action: "say" }, "child"), (e) => {
      assert.doesNotMatch(e.message, /кончена/, "the run-ended mark is gone");
      assert.match(e.message, /только своим местом-спутником/);
      return true;
    });
    assert.equal(sent().length, before);
  } finally {
    await rec.stop();
  }
});

test("a child whose run ended stands again on a bridge of its own, and its writes go by it", async () => {
  const { b, rec, rootPid, sent } = await endedChild("ended-stand");
  try {
    await assert.rejects(rec.call("iskron_case", { action: "say" }, "child"), /кончена/);
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const fresh = pidsOf(b.log)[2];
    assert.ok(fresh && fresh !== rootPid && alive(fresh), "a new bridge of the child's own");
    assert.match(readFileSync(b.log, "utf8").trim().split("\n")[2], /--satellite/);
    await rec.call("iskron_case", { action: "say" }, "child");
    assert.equal(sent().at(-1)?.pid, fresh, "the write goes by the child's new bridge");
  } finally {
    await rec.stop();
  }
});

// interrupted is not an end of the run (#6361): its meaning is not observed, and
// a steer — the plugin's own way to put a frame into a turn — may be one.
test("an interrupted execution of a child session takes nothing down", async () => {
  const b = bridgeEnv("run-interrupted", {
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
    ]),
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const place = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
    appendFileSync(`${b.events}.${pidOf(b.log)}`, event("held", { key: "k-root", place }));
    await delay(400);
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = pidsOf(b.log)[1];
    rec.emit({ type: "session.execution.interrupted", data: { sessionID: "child" } });
    await delay(700);
    assert.ok(alive(childPid), "the child's bridge lives through an interruption");
  } finally {
    await rec.stop();
  }
});

// A subagent launched with a case (#6078, the owner's word): the child session
// whose FIRST prompt begins «start <graph> <role> <case №N>» stands as a satellite
// of the root's place in the named role and joins the case — inside the prompt
// hook, so before the model reads a word — and the model reads the plugin's word
// right under the launch line. The case goes to the wire as «#N».
const STAND_AND_CASE = JSON.stringify([
  { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
  { name: "iskron_case", description: "Дело.", inputSchema: { type: "object" } },
]);
const sentCalls = (file) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.name.startsWith("iskron_")); // tool calls, not the bridge's own iskron/resume

test("a child session whose first prompt is a launch line with a case stands as the root's satellite and joins the case before the model reads", async () => {
  const calls = join(SANDBOX, "launch.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("launch", {
    FB_CALLS: calls,
    FB_TOOLS: STAND_AND_CASE,
    FB_STAND_HELD: "host.repo.opus-5",
  });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "@nks/nks-dev", karta: "#2816" }, "root");
    // Форма OpenCode 2.0.16 (наблюдено живым прогоном): тул subagent ставит свою строку
    // перед промптом, и строка запуска приходит второй.
    const read = await rec.prompt(
      "child",
      "You are a subagent spawned by another session.\nstart @nks/nks-dev #48 дело №77\nБриф: почини мост.",
    );
    const after = sentCalls(calls).slice(1);
    assert.deepEqual(
      after.map((c) => [c.name, c.arguments]),
      [
        [
          "iskron_stand",
          {
            realm: "@nks/nks-dev",
            karta: "#48",
            satellite_of: "host.repo.opus-5",
            cwd: "/work/child",
          },
        ],
        ["iskron_case", { action: "join", realm: "@nks/nks-dev", room: "#77" }],
      ],
      "stand as the root's satellite in the named role, then join the case — before the hook returns",
    );
    assert.notEqual(
      after[0].pid,
      sentCalls(calls)[0].pid,
      "the child stands on a bridge of its own",
    );
    // Вызов агента — работа (числовой id); строка запуска — служебный ход плагина (#6510).
    assert.equal(typeof sentCalls(calls)[0].id, "number", "the agent's own call");
    assert.ok(
      after.every((c) => String(c.id).startsWith("iskron-service-")),
      `launch calls are marked as service moves: ${JSON.stringify(after.map((c) => c.id))}`,
    );
    assert.equal(
      read,
      "You are a subagent spawned by another session.\n" +
        "start @nks/nks-dev #48 дело №77\n" +
        "Искрон: встал host.repo.opus-5.sub-1, вошёл в дело №77 — первым словом перескажи бриф в деле.\n" +
        "Бриф: почини мост.",
    );
  } finally {
    await rec.stop();
  }
});

// The launch line goes the same rule 2 as the child's own iskron_stand: under a root
// holding no place it raises no bridge and takes no ordinary place — the refusal is
// said into the prompt, before the model reads.
test("a launch line under a root holding no place is refused aloud: no child bridge, no ordinary place", async () => {
  const calls = join(SANDBOX, "launch-noplace.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("launch-noplace", { FB_CALLS: calls, FB_TOOLS: STAND_AND_CASE });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_case", { realm: "@nks/nks-dev", action: "mine" }, "root");
    const bridges = pidsOf(b.log).length;
    const read = await rec.prompt("child", "start @nks/nks-dev #48 дело №77\nБриф: почини мост.");
    assert.match(read, /не встал: Отказано \(плагин\)[^\n]*место родителя неизвестно/);
    assert.equal(pidsOf(b.log).length, bridges, "no bridge raised for the child");
    assert.ok(!sentCalls(calls).some((c) => c.name === "iskron_stand"), "no stand went out");
  } finally {
    await rec.stop();
  }
});

test("without a launch line a child's prompt is left as it was: no stand, no join, no bridge of its own", async () => {
  const calls = join(SANDBOX, "no-launch.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("no-launch", { FB_CALLS: calls, FB_TOOLS: STAND_AND_CASE });
  const rec = await plugin(b.env, {
    sessions: [
      { id: "root" },
      { id: "plain", parentID: "root" },
      { id: "human", parentID: "root" },
      { id: "later", parentID: "root" },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    assert.equal(rec.hooks.prompt?.length, 1, "the plugin listens to prompts");
    const plain = "Сделай обзор дифа.";
    assert.equal(await rec.prompt("plain", plain), plain);
    // A launch line with a human's place, not a case, is the door skill's to run.
    const human = "start @nks/nks-dev #48 @dmitry:main";
    assert.equal(await rec.prompt("human", human), human);
    // Only the FIRST prompt launches.
    assert.equal(await rec.prompt("later", "привет"), "привет");
    assert.equal(await rec.prompt("later", "start r5 #48 #77"), "start r5 #48 #77");
    // A root is the door skill's to launch.
    assert.equal(await rec.prompt("root", "start r5 #48 #77"), "start r5 #48 #77");
    assert.deepEqual(sentCalls(calls), []);
    await until(() => existsSync(b.log), "the plugin's own bridge");
    assert.equal(pidsOf(b.log).length, 1, "only the plugin's own bridge was started");
  } finally {
    await rec.stop();
  }
});

test("on an English server (*.ai) the launch line reads «case №N» and the word about entering is English", async () => {
  const calls = join(SANDBOX, "launch-en.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("launch-en", {
    FB_CALLS: calls,
    FB_TOOLS: STAND_AND_CASE,
    FB_STAND_HELD: "host.repo.opus-5",
    ISKRON_BRIDGE_URL: "https://mcp.iskron.ai/",
  });
  const rec = await plugin(b.env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    // Ребёнок встаёт только спутником места корня (#6550 п.2): корень стоит первым.
    await rec.call("iskron_stand", { realm: "r5", karta: "#2816" }, "root");
    await until(() => /мост держит стояние/.test(rec.said()), "the root's held word");
    const read = await rec.prompt("child", "start r5 #48 case №77 from @me:lead");
    assert.equal(
      read,
      "start r5 #48 case №77 from @me:lead\n" +
        "Iskron: seated host.repo.opus-5.sub-1, entered case №77 — retell the brief as your first message in the case.",
    );
    assert.deepEqual(
      sentCalls(calls)
        .slice(1)
        .map((c) => c.arguments.room ?? c.name),
      ["iskron_stand", "#77"],
    );
  } finally {
    await rec.stop();
  }
});

test("a refused join comes back as words in the prompt, and the place stays", async () => {
  const calls = join(SANDBOX, "launch-refused.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("launch-refused", {
    FB_CALLS: calls,
    FB_TOOLS: STAND_AND_CASE,
    FB_STAND_HELD: "host.repo.opus-5",
  });
  writeFileSync(`${b.reply}.iskron_case`, "__ERROR__дело #77 не найдено в этом графе");
  const rec = await plugin(b.env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "r5", karta: "#2816" }, "root");
    await until(() => /мост держит стояние/.test(rec.said()), "the root's held word");
    // The tail «from <seat>» is pi's: here the parent is known, and the tail does no harm.
    const read = await rec.prompt("child", "start r5 #48 case #77 from @me:lead");
    assert.equal(
      read,
      "start r5 #48 case #77 from @me:lead\n" +
        "Искрон: встал host.repo.opus-5.sub-1; в дело №77 не вошёл — дело #77 не найдено в этом графе. Место остаётся.",
      "the child stands the root's satellite",
    );
    assert.deepEqual(
      sentCalls(calls)
        .slice(1)
        .map((c) => [c.name, c.arguments.action]),
      [
        ["iskron_stand", undefined],
        ["iskron_case", "join"],
      ],
      "nothing takes the place back after the refusal",
    );
    const child = pidsOf(b.log).at(-1);
    assert.ok(alive(child), "the child's bridge still holds its place");
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
    await rootHolds(rec, b);
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
    await rootHolds(rec, b);
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
    await rootHolds(rec, b);
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
  await rootHolds(first, b, { key: "root--2816--nks-dev" }); // ребёнок — только спутником (#6550 п.2)
  await first.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "child");
  const [, childPid] = pidsOf(b.log);
  appendFileSync(`${b.events}.${childPid}`, event("held", { key: "child--931--nks-dev" }));
  await until(
    () => /мост держит стояние child--931--nks-dev/.test(first.said()),
    "the child's held line",
  );
  await first.stop();
  const written = JSON.parse(readFileSync(lostMarkers()[0], "utf8"));
  assert.deepEqual(
    written.entries.sort((x, y) => x.session.localeCompare(y.session)),
    [
      {
        session: "child",
        dir: "/work/same",
        key: "child--931--nks-dev",
        child: true,
        of: ROOT_PLACE,
        room: null,
      },
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
      .map((l) => JSON.parse(l))
      .filter((c) => c.arguments?.session !== "child"); // the child takes its own place back (#6625)
    assert.equal(sent[0].name, "iskron/resume");
    assert.deepEqual(
      sent[0].arguments,
      { key: "root--2816--nks-dev", cwd: "/work/same", session: "root" },
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
    await rootHolds(rec, b);
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
      { key: "child--931--nks-dev", session: "child" },
      "a child resumes by key only, never by the shared directory",
    );
    assert.match(rec.said(), /сессия child — возврат места с диска/);
    assert.ok(alive(rootPid), "the root's bridge is untouched");
  } finally {
    await rec.stop();
  }
});

// ── room frames (api 0.71.0: envelope flattened ahead of provenance and body) ──

/** Строка счёта дела проб без адресованных месту (#6574). */
const countOf = (n, since, zachin = "Стенд") =>
  `№7 «${zachin}»: записей ${n}, тебе 0 — адресованных месту нет; ` +
  `целиком — iskron_case(realm="nks-dev", action="history", room=7, since=${since}).`;

test("a room frame to me reaches the agent short: case, entry, words, who, no answer call; a word to all queues as a count, a platform record with no author is the platform's", async () => {
  const b = bridgeEnv("room");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-room");
    const [pid] = pidsOf(b.log);
    const said = { ...saidFrame("interrupt", 41), addressee: ME };
    appendFileSync(`${b.events}.${pid}`, event("frame", { frame: said, raw: "" }));
    await until(() => rec.prompts.length === 1, "the room frame to be prompted");
    assert.equal(rec.prompts[0].delivery, "steer", "said to me with stack=interrupt steers");
    const text = rec.prompts[0].text;
    assert.match(
      text,
      /^№7 «Стенд» \[41\] слово от Алексей \(@aleksei:probe\) — роль #48\n/,
      "the case, the entry, the kind in words and a doer's role, by via+auth",
    );
    assert.doesNotMatch(text, /ответ:/, "delivery asks no answer (#6574)");

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
      /^№7 «Стенд» \[42\] дело закрыто: consensus — платформа$/,
      "a room record without an author is the platform speaking, and waits no answer",
    );

    appendFileSync(
      `${b.events}.${pid}`,
      event("frame", { frame: saidFrame("defer", 43), raw: "" }),
    );
    await delay(BATCH_MS * 4);
    assert.equal(rec.prompts.length, 2, "a word to all prompts nothing: counts wake no turn");
    assert.equal(
      await rec.prompt("s-room", "ход"),
      `ход\n\n${countOf(1, 42)}`,
      "a word to all is a count riding the next prompt, its text behind the history pointer",
    );
  } finally {
    await rec.stop();
  }
});

// English Iskron (#6080): a bridge aimed at a *.ai server speaks English in what
// it writes itself — the case frame's header, the kind words, the case batch —
// with the names of the norm (#6075): case, ledger line «[was] [did] = verdict».
// The frames below carry Latin data only, so any Cyrillic left is the plugin's own.
const ALEX = { kind: "standing", standing: "@alex:probe", name: "Alex", karta: { seq: 48 } };
const latin = (f) => ({ ...f, room: { ...f.room, zachin: "Bench" } });
const CYRILLIC = /[а-яё]/i;

for (const [server, en] of [
  ["https://mcp.iskron.ai/", true],
  ["https://mcp.iskron.ru/", false],
]) {
  test(`a plugin whose bridge looks at ${server} writes the case frame header and batch ${en ? "in English, without Cyrillic" : "in Russian, as before"}`, async () => {
    const b = bridgeEnv(`lang-${en ? "en" : "ru"}`);
    const rec = await plugin({ ...b.env, ISKRON_BRIDGE_URL: server });
    try {
      await until(() => rec.tools().has("iskron_channel"), "the channel tool", 8000);
      await rec.call("iskron_channel", { action: "connect" }, "s-lang");
      const [pid] = pidsOf(b.log);
      const send = async (frame, i) => {
        appendFileSync(`${b.events}.${pid}`, event("frame", { frame, raw: JSON.stringify(frame) }));
        await until(() => rec.prompts.length === i, `prompt ${i}`);
        return rec.prompts[i - 1].text;
      };
      const word = await send(
        latin({
          ...roomFrame("said", { author: ALEX, stack: "interrupt", body: "look at 41" }),
          addressee: ME,
        }),
        1,
      );
      const progressed = latin(
        roomFrame("progress", {
          author: ALEX,
          key: "tests",
          line: { done: "probes green", verdict: "partial", note: "no network" },
        }),
      );
      appendFileSync(
        `${b.events}.${pid}`,
        event("frame", { frame: progressed, raw: JSON.stringify(progressed) }),
      );
      await delay(BATCH_MS * 4);
      assert.equal(rec.prompts.length, 1, "a count wakes no turn");
      const line = (await rec.prompt("s-lang", "go")).replace(/^go\n\n/, "");
      // #6574: a ledger line not to the seat is a count riding the next prompt; its words stay in history.
      if (en) {
        assert.doesNotMatch(word, CYRILLIC, word);
        assert.doesNotMatch(line, CYRILLIC, line);
        assert.match(
          word,
          /^case №7 «Bench» \[\d+\] message from Alex \(@alex:probe\) — role #48\n/,
        );
        assert.doesNotMatch(word, /answer:/);
        assert.match(
          line,
          /^case №7 «Bench»: 1 records, yours 0 — none of them yours; in full — iskron_case\(/,
        );
      } else {
        assert.match(word, /^№7 «Bench» \[\d+\] слово от Alex \(@alex:probe\) — роль #48\n/);
        assert.doesNotMatch(word, /ответ:/);
        assert.match(line, /^№7 «Bench»: записей 1, тебе 0 — адресованных месту нет; целиком — /);
      }
      assert.doesNotMatch(line, /probes green/);
    } finally {
      await rec.stop();
    }
  });
}

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
    assert.match(p1.text, /^№7 «Стенд» \[50\] /, "the case and the entry lead");
    assert.match(
      p1.text,
      /\nсделано, см\. 41$/,
      "the body passes through once, closing waits no say",
    );

    // #6574: records not to the seat are a count, whatever their stack — and a
    // batch of counts alone prompts nothing: it rides the next prompt.
    const quiet = async (frame) => {
      const n = rec.prompts.length;
      appendFileSync(`${b.events}.${pid}`, event("frame", { frame, raw: JSON.stringify(frame) }));
      await delay(BATCH_MS * 4);
      assert.equal(rec.prompts.length, n, `${frame.event_kind} prompted on its own`);
    };
    await quiet(progress());
    await quiet(unknownKind()); // never interrupts, even with stack=interrupt
    await quiet(saidFrame("interrupt", 62)); // a word to all with stack=interrupt
    await quiet(saidFrame("defer", 63));

    // An invite to my ROLE (api 0.89.6): the key carries the role node id, the line's karta my seq.
    const r1 = await send(roleInvite(68), 2);
    assert.equal(r1.delivery, "steer", "an invite to my role interrupts");
    assert.match(
      r1.text,
      /^№7 «Стенд»: записей 4, тебе 0 — адресованных месту нет; [^\n]*since=43\)\.\n/,
      "the counts waiting ride in front of the next prompt",
    );
    assert.match(r1.text, /Алексей \(@aleksei:probe\) зовёт 🚚 Поставщик плитки в дело/);
    assert.doesNotMatch(r1.text, /пробы зелёные|род weather мосту неизвестен|стопкой/);
    await quiet(roleInvite(69, MY_KARTA + 1)); // an invite to another role
    const otherRealm = roleInvite(70);
    otherRealm.line.fields.karta.realm = "@alari/other";
    await quiet(otherRealm); // my role's seq in another graph is not my role
    const r4 = await send(withdraw(71), 3);
    assert.equal(r4.delivery, "queue", "a withdrawn invite batches, even when it was mine");
    assert.match(r4.text, /^№7 «Стенд»: записей 3, тебе 1 — адресованные строками ниже; /);
    assert.match(r4.text, /приглашение отозвано, отзывает Алексей \(@aleksei:probe\)/);

    const p6 = await send(roomFrame("invite", { entry_id: 64, key: `invite:${ME_ID}` }), 4);
    assert.equal(p6.delivery, "steer", "an invite to my own standing id interrupts");
    assert.match(p6.text, new RegExp(`Алексей \\(@aleksei:probe\\) зовёт ${ME_ID} в дело`));
    await quiet(
      roomFrame("invite", {
        entry_id: 65,
        key: "invite:5744a929-982c-4efe-88ff-480ab66f61b8",
        fields: { standing: { name: "Прораб", standing: "@other:x" } },
      }),
    );
    await quiet(roomFrame("opened", { entry_id: 66 }));
    const p9 = await send(roomFrame("invite", { entry_id: 67, key: "invite:@tester:proba" }), 5);
    assert.equal(p9.delivery, "steer", "an invite to my own standing address interrupts too");
    assert.match(p9.text, /^№7 «Стенд»: записей 2, тебе 0 — /, "the invite to another and opened");
    assert.doesNotMatch(p9.text, /Прораб/, "an invite to someone else is a count, no words");
    // may_object carries standing ids only: my address there is not me, another id is not me.
    const notMine = closing();
    notMine.line.fields.may_object = ["@tester:proba", "9b2e4d6f-1a3c-4e5b-9d7f-0c2e4a6b8d1f"];
    const p10 = await send(notMine, 6);
    assert.equal(p10.delivery, "steer", "closing interrupts even when I may not object");
    assert.match(p10.text, /возражать не тебе/);
    assert.doesNotMatch(p10.text, /ты можешь возразить/);
  } finally {
    await rec.stop();
  }
});

// auto — a platform record to the parent about its child case (#5893 §4.2, #4925),
// and link: not to the seat — a count each (#6574), never interrupting.
test("room kinds: auto records about a child case and link prompt nothing — one count rides the next prompt, without their words", async () => {
  const b = bridgeEnv("room-auto");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-auto");
    const [pid] = pidsOf(b.log);
    for (const frame of [
      auto("child_closed"),
      auto("child_late_objection", 82),
      auto("all_nodes_done", 83),
      link("parent"),
    ]) {
      appendFileSync(`${b.events}.${pid}`, event("frame", { frame, raw: JSON.stringify(frame) }));
      await delay(BATCH_MS * 4);
    }
    assert.equal(rec.prompts.length, 0, "a child's news is no call to act: no prompt of its own");
    const rode = await rec.prompt("s-auto", "ход");
    assert.equal(rode, `ход\n\n${countOf(4, 79)}`, "one count of the case rides the next prompt");
  } finally {
    await rec.stop();
  }
});

// A word in two phases (#5893 §4.5b): not to the seat — a count, no prompt of
// its own (#6574); the body of a word to me follows its stack, whole.
test("room kinds: a said in flight, bodies and aborts not to me prompt nothing and ride as a count; the body of a word to me steers", async () => {
  const b = bridgeEnv("room-body");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await until(() => rec.tools().has("iskron_channel"), "the channel tool");
    await rec.call("iskron_channel", { action: "connect" }, "s-body");
    const [pid] = pidsOf(b.log);
    const put = async (frame) => {
      appendFileSync(`${b.events}.${pid}`, event("frame", { frame, raw: JSON.stringify(frame) }));
      await delay(BATCH_MS * 4);
    };
    await put(saidInFlight(54));
    await put(bodyFrame(55, 54));
    assert.equal(rec.prompts.length, 0, "a word to all in two phases prompts nothing");
    await put({ ...bodyFrame(61, 60, "текст моего слова"), stack: "interrupt", addressee: ME });
    assert.equal(rec.prompts.length, 1);
    const loudP = rec.prompts[0];
    assert.equal(loudP.delivery, "steer", "body of a word to me with stack=interrupt steers");
    assert.match(loudP.text, /^№7 «Стенд»: записей 2, тебе 0 — [^\n]*since=53\)\.\n/);
    assert.match(loudP.text, /текст слова \[60\] от Алексей \(@aleksei:probe\)/);
    assert.match(loudP.text, /\nтекст моего слова$/, "the word's text passes through whole");
    assert.doesNotMatch(
      loudP.text,
      /текст второй фазы/,
      "the text of a word to all stays in history",
    );
    await put(bodyAborted(57, 56));
    await put(bodyLapsed(59, 58));
    await put(saidFrame("interrupt", 62));
    assert.equal(
      rec.prompts.length,
      1,
      "aborts and a word to all prompt nothing, whatever the stack",
    );
    assert.equal(await rec.prompt("s-body", "ход"), `ход\n\n${countOf(3, 56)}`);
  } finally {
    await rec.stop();
  }
});

// A case burst was one queue prompt per frame, and OpenCode hands the queue out one
// prompt per turn: on a live case the lag reached an hour and a half, and direct
// words stood in the same queue behind it.
const caseBurst = (from, n) => Array.from({ length: n }, (_, i) => progress(from + i));
const lines = (frames) =>
  frames.map((frame) => event("frame", { frame, raw: JSON.stringify(frame) })).join("");

test("ten case frames in a row not to the seat prompt nothing: one count of the case with the history pointer rides the next prompt, no line per frame", async () => {
  const b = bridgeEnv("case-burst");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-burst");
    const [pid] = pidsOf(b.log);
    appendFileSync(`${b.events}.${pid}`, lines(caseBurst(201, 10)));
    await delay(BATCH_MS * 6);
    assert.equal(rec.prompts.length, 0, "a burst of counts wakes no turn");
    // #6574: records not to the seat — one count per case, no text, no envelopes.
    assert.equal(await rec.prompt("s-burst", "ход"), `ход\n\n${countOf(10, 200)}`);
    assert.equal(await rec.prompt("s-burst", "ещё"), "ещё", "the count rides once");
  } finally {
    await rec.stop();
  }
});

// An addressed word not to me (#6081): no body, no steer; #6574: a count of the case.

/**
 * Кадры в мост сессии; ждать, пока промптов станет n, и ещё окна — лишнего не
 * пришло; rode — что прочтёт модель в следующем промпте «ход» (счёт попутно).
 */
async function asidePrompts(name, frames, n) {
  const b = bridgeEnv(name);
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, `s-${name}`);
    const [pid] = pidsOf(b.log);
    appendFileSync(`${b.events}.${pid}`, lines(frames));
    await until(() => rec.prompts.length >= n, `${n} prompt(s)`);
    await delay(BATCH_MS * 4);
    const prompts = [...rec.prompts];
    prompts.rode = await rec.prompt(`s-${name}`, "ход");
    return prompts;
  } finally {
    await rec.stop();
  }
}

test("(а) an addressed word not to me with stack interrupt prompts nothing: a count without its body rides the next prompt", async () => {
  const prompts = await asidePrompts("aside-one", [addressed(80)], 0);
  assert.equal(prompts.length, 0, "a word not to me never steers, nor queues on its own");
  assert.equal(prompts.rode, `ход\n\n${countOf(1, 79)}`);
});

test("(а2) an addressed word whose addressee has left the case (addressee_left) is a word to all: a count, no text", async () => {
  const prompts = await asidePrompts("aside-left", [addressedLeft(89)], 0);
  assert.equal(prompts.length, 0);
  assert.equal(prompts.rode, `ход\n\n${countOf(1, 88)}`);
});

test("(б) three addressed words of one pair in a row are one count «записей 3»", async () => {
  const prompts = await asidePrompts(
    "aside-run",
    [81, 82, 83].map((id) => addressed(id)),
    0,
  );
  assert.equal(prompts.length, 0);
  assert.equal(prompts.rode, `ход\n\n${countOf(3, 80)}`);
});

test("(в) an addressed word to me with stack interrupt steers at once and whole, no answer call; the count before it rides on", async () => {
  const prompts = await asidePrompts("aside-mine", [addressed(86), addressed(87, ME)], 1);
  assert.equal(prompts.length, 1, "only the word to me prompts");
  assert.equal(prompts[0].delivery, "steer");
  assert.match(prompts[0].text, /слово от Алексей \(@aleksei:probe\)[^\n]*\nтайное слово 87$/);
  assert.equal(prompts.rode, `ход\n\n${countOf(1, 85)}`);
});

test("(г) a word without an addressee between two asides is not to me either: one count of three", async () => {
  const frames = [
    addressed(90, BORIS, "defer"),
    saidFrame("defer", 91),
    addressed(92, BORIS, "defer"),
  ];
  const prompts = await asidePrompts("aside-plain", frames, 0);
  assert.equal(prompts.length, 0);
  assert.equal(prompts.rode, `ход\n\n${countOf(3, 89)}`);
});

test("(д) an addressed word not to me in flight and then its body with stack interrupt: one count, no body, no prompt", async () => {
  const prompts = await asidePrompts(
    "aside-body",
    [addressedInFlight(94), addressedBody(95, 94)],
    0,
  );
  assert.equal(prompts.length, 0, "the body does not steer apart");
  assert.equal(prompts.rode, `ход\n\n${countOf(2, 93)}`);
});

// A word in two phases addressed to the seat by a reply or as important: its
// said in flight promises the text, so the body brings it; the echo of my own
// word is not addressed to me.
test("(ж) the body of a reply to me and of an important word comes as text; the body of my own word is a count", async () => {
  const prompts = await asidePrompts(
    "two-phase-mine",
    [
      replyInFlight(54),
      bodyFrame(55, 54, "ответ мне второй фазой"),
      importantInFlight(56),
      importantBody(57, 56),
      ownBody(59, 58),
    ],
    1,
  );
  assert.equal(prompts.length, 1);
  const text = prompts[0].text;
  assert.match(text, /^№7 «Стенд»: записей 5, тебе 4 — адресованные строками ниже; /, text);
  assert.match(text, /\n№7 \[55\] текст слова \[54\] [^\n]*: ответ мне второй фазой\n/, text);
  assert.match(text, /\n№7 \[57\] текст слова \[56\] [^\n]*: важное тело 56$/, text);
  assert.doesNotMatch(text, /моё тело 58/, text);
});

test("(е) a word whose body the platform withheld (body_withheld) counts with the rest", async () => {
  const prompts = await asidePrompts("aside-withheld", [addressed(97), withheld(98)], 0);
  assert.equal(prompts.length, 0);
  assert.equal(prompts.rode, `ход\n\n${countOf(2, 96)}`);
});

// A short frame (#6081, the owner's word): 1–3 lines, no raw JSON, the text once;
// a burst to me carries a count head and a line per record to me (#6574).
test("a lone case frame to me is short: a said's text once, no JSON, «in reply to»; a burst is a count head, lines only for what is mine", async () => {
  const reply = { ...saidFrame("interrupt", 62), addressee: ME };
  reply.in_reply_to = 60;
  const mineDefer = { ...saidFrame("defer", 86), addressee: ME };
  const prompts = await asidePrompts(
    "short-frame",
    [reply, progress(44), joinedMember(85), mineDefer],
    2,
  );
  const word = prompts.find((p) => p.delivery === "steer").text;
  assert.equal(word.split("слово со стопкой interrupt").length - 1, 1, word);
  assert.match(
    word,
    /^№7 «Стенд» \[62\] слово от Алексей \(@aleksei:probe\)[^\n]*в ответ на \[60\]\n/,
  );
  assert.ok(!word.includes('{"'), word);
  const batch = prompts.find((p) => p.delivery === "queue").text.split("\n");
  assert.match(batch[0], /^№7 «Стенд»: записей 3, тебе 1 — адресованные строками ниже; /);
  assert.match(batch[1], /^№7 «Стенд» \[86\] слово от Алексей/);
  assert.equal(batch.length, 2, batch.join("\n"));
  assert.ok(!batch.join("\n").includes("пробы зелёные"), batch.join("\n"));
});

test("a direct word and a human word amid a case burst steer apart and whole; the burst stays one count", async () => {
  const b = bridgeEnv("case-direct");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-direct");
    const [pid] = pidsOf(b.log);
    // Both carry stack=defer: a stack is a case's word, not a reason to queue a direct word.
    const direct = { ...directWord("direct-9"), stack: "defer" };
    const human = saidFrame("defer", 230);
    human.provenance = { ...human.provenance, as_person: true };
    appendFileSync(
      `${b.events}.${pid}`,
      lines([...caseBurst(211, 5), direct, human, ...caseBurst(216, 5)]),
    );
    await until(() => rec.prompts.length >= 2, "two words");
    await delay(BATCH_MS * 4);
    assert.equal(rec.prompts.length, 2, "two words apart, the ten case frames prompt nothing");
    const steered = rec.prompts.filter((p) => p.delivery === "steer");
    assert.equal(steered.length, 2, "neither word waits in the case queue");
    assert.match(
      steered[0].text,
      /^роль #48 \(@alari:sosed\)\nпрямое слово соседа$/,
      "the direct word goes whole and short: who and the text, no answer call (#6574)",
    );
    assert.match(steered[1].text, /^№7 «Стенд» \[230\] [^\n]* — человек\n/);
    assert.match(steered[1].text, /\nслово со стопкой defer$/, "the human word goes whole");
    assert.equal(
      await rec.prompt("s-direct", "ход"),
      `ход\n\n${countOf(10, 210)}`,
      "the ten case frames are one count riding the next prompt, no word inside",
    );
  } finally {
    await rec.stop();
  }
});

test("a lone interrupting case frame still steers at once and whole", async () => {
  const b = bridgeEnv("case-lone");
  const rec = await plugin(b.env);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-lone");
    const [pid] = pidsOf(b.log);
    const c = closing();
    appendFileSync(`${b.events}.${pid}`, lines([c]));
    await until(() => rec.prompts.length === 1, "the closing prompt");
    await delay(BATCH_MS * 3);
    assert.equal(rec.prompts.length, 1);
    assert.equal(rec.prompts[0].delivery, "steer");
    assert.match(rec.prompts[0].text, /^№7 «Стенд» \[50\] ведущий /, "the case and the entry lead");
    assert.match(rec.prompts[0].text, /\nсделано, см\. 41$/);
  } finally {
    await rec.stop();
  }
});

test("while the burst prompt waits in the session's queue, new case frames wait here and go as one prompt when OpenCode takes it", async () => {
  const b = bridgeEnv("case-pending");
  const rec = await plugin(b.env, { inboxIds: true });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s-pend");
    const [pid] = pidsOf(b.log);
    // Words to me with stack=defer: a burst of counts alone would prompt nothing.
    const toMe = (from, n) =>
      Array.from({ length: n }, (_, i) => ({ ...saidFrame("defer", from + i), addressee: ME }));
    appendFileSync(`${b.events}.${pid}`, lines(toMe(241, 2)));
    await until(() => rec.prompts.length >= 1, "the first burst");
    for (const [i, frame] of toMe(243, 3).entries()) {
      appendFileSync(`${b.events}.${pid}`, lines([frame]));
      await delay(BATCH_MS * 2 + i);
    }
    assert.equal(rec.prompts.length, 1, "the first prompt is not taken yet: the rest wait here");
    rec.emit({
      type: "session.inbox.delivered",
      data: { sessionID: "s-pend", inboxID: "inbox-1" },
    });
    await until(() => rec.prompts.length === 2, "the held frames after the take");
    assert.equal(rec.prompts[1].delivery, "queue");
    const held = rec.prompts[1].text.split("\n");
    assert.match(held[0], /^№7 «Стенд»: записей 3, тебе 3 — [^\n]*since=242\)\.$/);
    assert.deepEqual(
      held.slice(1).map((l) => /\[(\d+)\]/.exec(l)?.[1]),
      ["243", "244", "245"],
      "every held frame enters the prompt that goes, none twice",
    );
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
    assert.match(rec.prompts[0].text, /^роль #48 \(@alari:sosed\)\n/);
    assert.doesNotMatch(rec.prompts[0].text, /^№/, "a direct word is not a room word");
    assert.doesNotMatch(
      rec.prompts[1].text,
      /^№|мосту неизвестен/,
      "a graph event is not a room frame",
    );
    assert.match(
      rec.prompts[2].text,
      /^№r-1 «Стенд» \[71\] род text, стопка interrupt — роль #48\n/,
    );
    assert.match(rec.prompts[5].text, /^№r-1 «Стенд» \[74\] род auto, стопка interrupt\n/);
    assert.match(
      rec.prompts[7].text,
      /^№r-1 «Стенд»: записей 1, тебе 1 — [^\n]*\n№r-1 «Стенд» \[76\] кадр room-old-76: /,
      "an old deferred room frame is a line of the case burst",
    );
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
