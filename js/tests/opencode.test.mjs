// Behavioural probe for the OpenCode plugin shipped in
// skills/establish-mcp/scripts/opencode-plugin.js — the door that gives an
// OpenCode session both halves of Iskron: the iskron_* tools under their own
// names (raised over a child iskron-bridge) and the live channel, delivered as
// a prompt into the session that holds the standing.
//
// The plugin is an ordinary module: the probe calls its factory with a stand-in
// `client` and reads the hooks it returns. Three seams keep that honest:
//
//   • the bridge is a REAL child process — tests/fake-bridge.mjs, aimed at by
//     ISKRON_BRIDGE_PATH; the spawn/NDJSON/pagination path is not imitated.
//   • the standing socket is held by the bridge, not the plugin: the channel
//     half only reads the bridge's notifications, and the fake bridge emits
//     those from a file (FB_EVENTS) the probe appends to.
//   • the module is loaded from a COPY in a temp dir, HOME points there too,
//     so the home-copy candidate for the bridge is the probe's to decide.
//
// `@opencode-ai/plugin` is the one import the shipped file keeps external; in
// OpenCode it resolves next to the plugins directory, here a loader hook points
// it at js/node_modules — the real package, the real zod.
//
// ISKRON_OPENCODE_PLUGIN points the probe at any copy (a past revision, a
// broken one) so it can be shown red before a fix. Run with `make test-opencode`.
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./opencode-loader.mjs", import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE =
  process.env.ISKRON_OPENCODE_PLUGIN ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "opencode-plugin.js");
const FAKE_BRIDGE = join(HERE, "fake-bridge.mjs");

const SANDBOX = mkdtempSync(join(tmpdir(), "iskron-opencode-"));
const COPY = join(SANDBOX, "iskron.js");
copyFileSync(SOURCE, COPY);
process.env.HOME = SANDBOX;
process.env.ISKRON_BRIDGE_AUTH_DIR = join(SANDBOX, "auth");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the client the plugin is handed ──────────────────────────────────────────

function fakeClient({ sessions = [] } = {}) {
  const prompts = [];
  const toasts = [];
  const client = {
    session: {
      promptAsync: async (o) => {
        prompts.push(o);
        return { data: {} };
      },
      list: async () => ({ data: sessions }),
    },
    tui: {
      showToast: async (o) => {
        toasts.push(o.body);
        return { data: true };
      },
    },
  };
  return { client, prompts, toasts, said: () => toasts.map((t) => t.message).join("\n") };
}

const ENV_KEYS = [
  "ISKRON_BRIDGE_PATH",
  "ISKRON_MCP_READY_WAIT_MS",
  "ISKRON_MCP_HANDSHAKE_MS",
  "FB_LOG",
  "FB_MODE",
  "FB_TOOLS",
  "FB_PAGINATE",
  "FB_REPLY",
  "FB_EVENTS",
];

let seq = 0;
async function loadPlugin(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
  return (await import(`${pathToFileURL(COPY).href}?n=${++seq}`)).default;
}

/** A loaded plugin: hooks in hand, dispose at hand. */
async function plugin(env = {}, clientOpts = {}) {
  const factory = await loadPlugin(env);
  const rec = fakeClient(clientOpts);
  rec.hooks = await factory({ client: rec.client, directory: SANDBOX, worktree: SANDBOX });
  rec.stop = () => rec.hooks.dispose?.();
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
      ISKRON_MCP_READY_WAIT_MS: 15000,
      ...extra,
    },
  };
}

const ctx = (sessionID) => ({ sessionID, abort: new AbortController().signal });
const pidOf = (log) => Number(readFileSync(log, "utf8").trim().split(/\s+/)[1]);
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

// ── tools ────────────────────────────────────────────────────────────────────

test("every bridge tool stands under its own name, with zod args cut from the server's schema", async () => {
  const b = bridgeEnv("own-names", { FB_PAGINATE: "1" });
  const rec = await plugin(b.env);
  try {
    const names = Object.keys(rec.hooks.tool);
    assert.deepEqual(names.sort(), ["iskron_channel", "iskron_orient"]);
    const channel = rec.hooks.tool.iskron_channel;
    assert.equal(channel.description.split("\n")[0], "Живой канал делателя.");
    // The enum survives the cut, and so does required-ness.
    const action = channel.args.action;
    assert.ok(action, "the `action` argument must be cut from the schema");
    assert.equal(action.safeParse("connect").success, true);
    assert.equal(action.safeParse("dance").success, false, "the enum must be enforced");
    assert.equal(action.safeParse(undefined).success, false, "a required arg is not optional");
    assert.match(rec.said(), /тулов в сессии: 2 \(с сервера\)/);
  } finally {
    await rec.stop();
  }
});

test("a call is proxied to the bridge and its text comes back as the tool's output", async () => {
  const b = bridgeEnv("proxy");
  const rec = await plugin(b.env);
  try {
    writeFileSync(b.reply, "Живой ответ графа");
    const out = await rec.hooks.tool.iskron_orient.execute({}, ctx("s-1"));
    assert.equal(out.output, "Живой ответ графа");
    assert.equal(out.title, "iskron_orient");
    writeFileSync(b.reply, "__ERROR__ключ не тот");
    await assert.rejects(
      () => rec.hooks.tool.iskron_channel.execute({ action: "connect" }, ctx("s-1")),
      /ключ не тот/,
      "a refused tool must surface as a thrown error, not as text",
    );
  } finally {
    await rec.stop();
  }
});

test("dispose kills the bridge the plugin spawned", async () => {
  const b = bridgeEnv("dispose");
  const rec = await plugin(b.env);
  const pid = pidOf(b.log);
  assert.ok(alive(pid), "the bridge must be running while the plugin lives");
  await rec.stop();
  await until(() => !alive(pid), "the bridge to die after dispose");
});

test("no bridge on the machine: no tools, and the plugin says where it looked", async () => {
  const rec = await plugin({ ISKRON_BRIDGE_PATH: join(SANDBOX, "no-such-bridge.mjs") });
  try {
    assert.deepEqual(rec.hooks.tool, {});
    assert.match(rec.said(), /мост не найден/);
    assert.match(rec.said(), /no-such-bridge\.mjs/);
    assert.match(rec.said(), /iskron-bridge\.mjs/, "the home copy must be among the candidates");
  } finally {
    await rec.stop();
  }
});

test("a bridge stuck in someone's browser: tools come from the last list, calls wait for it", async () => {
  // First a good run to leave a tools list behind.
  const ok = bridgeEnv("cache-fill");
  await (await plugin(ok.env)).stop();
  const b = bridgeEnv("cache-use", { FB_MODE: "mute", ISKRON_MCP_READY_WAIT_MS: 300 });
  const rec = await plugin(b.env);
  try {
    assert.deepEqual(Object.keys(rec.hooks.tool).sort(), ["iskron_channel", "iskron_orient"]);
    assert.match(rec.said(), /из прошлого списка/);
    // The call must not answer before the bridge does — here, never.
    const call = rec.hooks.tool.iskron_orient.execute({}, ctx("s-2"));
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

// ── channel ──────────────────────────────────────────────────────────────────

test("a frame goes as a prompt into the session that called iskron_channel; hello only toasts", async () => {
  const b = bridgeEnv("frame");
  const rec = await plugin(b.env);
  try {
    await rec.hooks.tool.iskron_orient.execute({}, ctx("s-other"));
    await rec.hooks.tool.iskron_channel.execute({ action: "connect" }, ctx("s-holder"));
    appendFileSync(
      b.events,
      JSON.stringify({ kind: "frame", frame: { type: "hello", pending: 0 }, raw: "{}" }) + "\n",
    );
    await until(() => /канал слушает/.test(rec.said()), "the hello toast");
    assert.equal(rec.prompts.length, 0, "hello must not wake the agent");
    const frame = {
      type: "message",
      body: "Привет с той стороны",
      provenance: { from_standing: "@alari:telegram-bot" },
    };
    appendFileSync(
      b.events,
      JSON.stringify({ kind: "frame", frame, raw: JSON.stringify(frame) }) + "\n",
    );
    await until(() => rec.prompts.length === 1, "the frame to be prompted");
    const p = rec.prompts[0];
    assert.equal(
      p.path.id,
      "s-holder",
      "the holder of the standing gets the frame, not the last caller",
    );
    assert.match(p.body.parts[0].text, /от @alari:telegram-bot/);
    assert.match(p.body.parts[0].text, /Привет с той стороны/);
  } finally {
    await rec.stop();
  }
});

test("with no caller on record the freshest root session gets the frame", async () => {
  const b = bridgeEnv("root");
  const rec = await plugin(b.env, {
    sessions: [
      { id: "old", time: { updated: 1 } },
      { id: "child", parentID: "old", time: { updated: 9 } },
      { id: "fresh", time: { updated: 5 } },
    ],
  });
  try {
    appendFileSync(
      b.events,
      JSON.stringify({ kind: "frame", frame: { type: "message", body: "x" }, raw: "" }) + "\n",
    );
    await until(() => rec.prompts.length === 1, "the frame to be prompted");
    assert.equal(rec.prompts[0].path.id, "fresh", "a subagent session is never the addressee");
  } finally {
    await rec.stop();
  }
});

test("a dead token is loud: an error toast and a prompt that names the move", async () => {
  const b = bridgeEnv("dead");
  const rec = await plugin(b.env);
  try {
    await rec.hooks.tool.iskron_channel.execute({ action: "connect" }, ctx("s-holder"));
    appendFileSync(b.events, JSON.stringify({ kind: "dead", code: 4001 }) + "\n");
    await until(() => rec.prompts.length === 1, "the dead-token prompt");
    assert.match(rec.prompts[0].body.parts[0].text, /токен мёртв/);
    assert.match(rec.prompts[0].body.parts[0].text, /mint/);
    assert.ok(
      rec.toasts.some((t) => t.variant === "error" && /токен мёртв/.test(t.message)),
      "the human must see it too",
    );
  } finally {
    await rec.stop();
  }
});

test("a deleted session is forgotten as the addressee", async () => {
  const b = bridgeEnv("forget");
  const rec = await plugin(b.env, { sessions: [{ id: "root", time: { updated: 1 } }] });
  try {
    await rec.hooks.tool.iskron_channel.execute({ action: "connect" }, ctx("gone"));
    await rec.hooks.event({
      event: { type: "session.deleted", properties: { info: { id: "gone" } } },
    });
    appendFileSync(
      b.events,
      JSON.stringify({ kind: "frame", frame: { type: "message", body: "x" }, raw: "" }) + "\n",
    );
    await until(() => rec.prompts.length === 1, "the frame to be prompted");
    assert.equal(rec.prompts[0].path.id, "root");
  } finally {
    await rec.stop();
  }
});

// Keep the sandbox's auth dir existing for the cache tests that run first.
mkdirSync(process.env.ISKRON_BRIDGE_AUTH_DIR, { recursive: true });
