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
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "FB_REPLY",
  "FB_EVENTS",
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
    assert.match(
      await rec.call("iskron_bridge", {}, "s-0").then((r) => r.content),
      /тулов iskron_\*: 2/,
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
    assert.equal(rec.prompts[0].delivery, "queue", "a frame joins the turn, it does not cut it");
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
    ],
  });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "root");
    await rec.call("iskron_orient", {}, "child");
    assert.equal(pidsOf(b.log).length, 1, "the child must not raise a bridge of its own");
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
  } finally {
    await rec.stop();
  }
});

test("an eviction is loud in OpenCode: a prompt into the holder's session naming take=true", async () => {
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
    assert.match(rec.prompts[0].text, /iskron_stand с take=true/);
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
