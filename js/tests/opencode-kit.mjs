// The OpenCode plugin under probe (opencode.test.mjs, opencode-siblings.test.mjs): the plugin
// loaded from a COPY in a temp dir, HOME pointed there, a stand-in OpenCode 2 context
// (fakeCtx) and its cleanup. Each test file is its own process, so each gets its own sandbox.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { FRAME_MARK } from "../delivery/protocol.ts";
import { BUILT_BRIDGE, BUILT_PLUGIN } from "./built.mjs";

const SOURCE = process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN;
/** The real bridge of this checkout — for the one probe that measures the plugin's stop against it. */
export const REAL_BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;

export const SANDBOX = mkdtempSync(join(tmpdir(), "iskron-opencode-"));
const COPY = join(SANDBOX, "iskron.js");
copyFileSync(SOURCE, COPY);
process.env.HOME = SANDBOX;
process.env.ISKRON_BRIDGE_AUTH_DIR = join(SANDBOX, "auth");
/** The window a case burst gathers in before its one prompt — short under the probes. */
export const BATCH_MS = 150;
process.env.ISKRON_OPENCODE_BATCH_MS = String(BATCH_MS);

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/** The markers keep.ts leaves next to the grant when a plugin stops with a holding bridge — one file per instance. */
export const lostMarkers = () => {
  const dir = process.env.ISKRON_BRIDGE_AUTH_DIR;
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("opencode-lost") && f.endsWith(".json"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
};
/** The owner's stops (halts.ts) and leads' ends (leadends.ts) the plugin lays next to the grant — read by every instance. */
export const stopMarks = () => {
  const dir = process.env.ISKRON_BRIDGE_AUTH_DIR;
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("opencode-stopped") || f.startsWith("opencode-ended"))
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
  faults = {}, // the session API's failures a probe asks for (keepalive)
} = {}) {
  const prompts = [];
  const synthetics = [];
  const interrupts = [];
  const updates = [];
  const moves = [];
  const archives = [];
  const hooks = {};
  const tools = registry();
  const commands = registry();
  const queue = [];
  let wake = null;
  const stderr = [];
  let calls = 0;
  const ctx = {
    app,
    ...(location ? { location } : {}),
    tool: {
      transform: tools.transform,
      reload: tools.reload,
      hook: async (name, cb) => {
        (hooks[`tool.${name}`] ??= []).push(cb);
        return { dispose: async () => {} };
      },
    },
    // Permission hooks: "evaluate" gets a mutable evaluation, as in OpenCode 2.0.24.
    permission: {
      hook: async (name, cb) => {
        (hooks[`permission.${name}`] ??= []).push(cb);
        return { dispose: async () => {} };
      },
    },
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
      // The channel's text carries the delivery's mark (#6815 item 3): kept as `marked`,
      // the probes read the text after it.
      // faults.promptWait(id) — the answer waits for the promise it returns.
      prompt: async (o) => {
        const marked = typeof o.text === "string" && o.text.startsWith(`${FRAME_MARK} `);
        prompts.push(marked ? { ...o, text: o.text.slice(FRAME_MARK.length + 1), marked } : o);
        const id = `inbox-${prompts.length}`;
        await faults.promptWait?.(id);
        return inboxIds ? { id, type: "user", delivery: o.delivery } : {};
      },
      // Create and remove — the plugin's keepalive child (keepalive.ts); both are logged in updates.
      // createNoId — the answer carries no id; removeFails — so many next removes throw.
      create: async (o) => {
        updates.push({ create: o });
        return faults.createNoId ? {} : { id: `ka-${updates.length}`, parentID: o?.parentID };
      },
      // noRemove — the context has no remove at all (a future OpenCode).
      ...(faults.noRemove
        ? {}
        : {
            remove: async (o) => {
              updates.push({ remove: o });
              if (faults.removeFails > 0 && faults.removeFails--) throw new Error("remove refused");
            },
          }),
      // An update — the stopped session's archive (#9256, OpenCode 2.2); updateFails — it throws.
      update: async (o) => {
        archives.push(o);
        if (faults.updateFails) throw new Error("update refused");
      },
      // A move — the twin's wake of an unloaded spelling (twins.ts); moveFails — it throws.
      move: async (o) => {
        moves.push(o);
        if (faults.moveFails) throw new Error("move refused");
      },
      // An interrupt of the session's running turn (session.interrupt, @opencode/plugin 2.0.4);
      // interruptFails — so many next interrupts throw.
      // interruptGate — a promise every interrupt waits for before it answers.
      interrupt: async (o) => {
        interrupts.push(o);
        await faults.interruptGate;
        if (faults.interruptFails > 0 && faults.interruptFails--)
          throw new Error("interrupt refused");
        return { interrupted: true };
      },
      // A synthetic message — how OpenCode's own subagent tool reports to the parent.
      synthetic: async (o) => {
        const marked = typeof o.text === "string" && o.text.startsWith(`${FRAME_MARK} `);
        synthetics.push(marked ? { ...o, text: o.text.slice(FRAME_MARK.length + 1), marked } : o);
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
    interrupts,
    updates,
    moves,
    archives,
    tools: () => tools.get(),
    commands: () => commands.get(),
    hooks,
    /**
     * A tool call that meets a permission check, the order OpenCode 2.0.24 runs them in:
     * tool "execute.before", then permission "evaluate" with the call's id; returns the effect.
     */
    ask: async (tool, input, action, resources, effect = "ask") => {
      const id = `call-${++calls}`;
      for (const cb of hooks["tool.execute.before"] ?? [])
        await cb({ tool, sessionID: "s", agent: "build", messageID: "m", id, input });
      const e = {
        sessionID: "s",
        action,
        resources,
        effect,
        source: { type: "tool", messageID: "m", id },
      };
      for (const cb of hooks["permission.evaluate"] ?? []) await cb(e);
      return e.effect;
    },
    /** A prompt into a session through its "prompt" hooks; returns what the model would read. */
    promptRaw: async (sessionID, text) => {
      const p = { sessionID, messageID: "m", prompt: { text }, delivery: "queue" };
      for (const cb of hooks.prompt ?? []) await cb(p);
      return p.prompt.text;
    },
    /** The same, the delivery's mark on riding counts (#6815 item 3) taken off. */
    async prompt(sessionID, text) {
      return (await this.promptRaw(sessionID, text)).replace(`\n\n${FRAME_MARK} `, "\n\n");
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
  "ISKRON_OPENCODE_CLIENT_PID",
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
  "FB_INIT_CAPS",
  "FB_NET_UP",
  "FB_DIE_ONCE",
  "FB_ENV",
  "FB_END_FAILED",
  "FB_END_REVOKED",
  "FB_END_DELAY_MS",
  "FB_END_PROBABLY",
  "FB_CALL_DELAY_MS",
  "FB_PULSE_REFUSE",
  "FB_PULSE_HOLD",
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
  "ISKRON_KEEPALIVE_MS",
  "ISKRON_PERMISSION_WAIT_MS",
  "ISKRON_WAKE_MS",
  "ISKRON_OPENCODE_PENDING_MS",
  "ISKRON_OPENCODE_WAKE_HOLD_MS",
  "ISKRON_OPENCODE_HALT_CAP_MS",
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
export async function plugin(env = {}, ctxOpts = {}) {
  // A plugin stopped with a holding bridge leaves a marker for the next instance
  // (keep.ts); the probes share one auth dir, so each starts clean unless it is
  // the marker itself that is under test.
  if (!ctxOpts.keepMarker) {
    for (const f of [...lostMarkers(), ...stopMarks()]) rmSync(f, { force: true });
    // The probes reuse session ids: the process's ended leads go too, and the stop registry
    // with them (№1236, #8240) — it is shared by the process's instances by design, and a
    // stale ban makes the next probe's sweep cut a same-id session before any event of its own.
    globalThis.__iskronEnded?.clear();
    globalThis.__iskronEndLiftedAt?.clear();
    globalThis.__iskronHalts?.clear();
    globalThis.__iskronLiftedAt?.clear();
    globalThis.__iskronStopIds?.clear();
    globalThis.__iskronStopWords?.clear();
    globalThis.__iskronStopAlone?.clear();
  }
  const def = await loadPlugin(env);
  assert.equal(def.id, "iskron", "the default export must be a definition with an id");
  const rec = fakeCtx(ctxOpts);
  const restore = captureStderr(rec.stderr);
  // channelDown — the channel half fails to come up: setupChannel throws (plugin.ts keeps the rest).
  const RealSet = globalThis.Set;
  if (ctxOpts.channelDown)
    globalThis.Set = class extends RealSet {
      constructor(...args) {
        if (/setupChannel/.test(new Error().stack)) throw new Error("channel half down");
        super(...args);
      }
    };
  try {
    rec.cleanup = await def.setup(rec.ctx);
  } finally {
    globalThis.Set = RealSet;
  }
  rec.said = () => rec.stderr.join("");
  // Captures nest: an instance stopped while a later one still listens keeps its capture
  // (cleanup), and gives it back after the later one's stop (restore).
  rec.restore = restore;
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
export async function until(check, what, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  assert.fail(`timed out waiting for ${what}`);
}
