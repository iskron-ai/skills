// A stand-in OpenCode 2 server for the rituals plugin sample of iskronify
// (references/harness-surfaces.md, the ```js block with "iskron-rituals"), as
// observed (graph @nks/nks-dev, node #5048): one event stream for the whole
// server, an instance of the plugin per location — one per spelling of a
// directory — each with ctx.location of its own; tool hooks belong to an
// instance and are called on it.
//
// The sample is placed as iskronify places it, <own>/.opencode/plugins/
// iskron-rituals.js, and imported once: every instance is a setup() of the same
// module. `alias` is a symlink to `own` — another spelling of the same folder,
// as /tmp and /private/tmp come live.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// Every stand's folder goes when the process does: the module of the plugin is
// loaded from it, so it stays while the probes of this file run.
const roots = [];
process.on("exit", () => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

// The sample may keep a word-once set per process on globalThis (one live
// server runs every instance in one process). Within a stand it is shared, as
// live; between stands — each probe — whatever the plugin put there is dropped,
// and session and call ids are fresh, so no probe hears another's.
const baseline = new Set(Reflect.ownKeys(globalThis));
const dropPluginGlobals = () => {
  for (const k of Reflect.ownKeys(globalThis)) if (!baseline.has(k)) delete globalThis[k];
};
let stands = 0;
let calls = 0;

/** The rituals plugin block of a markdown file, exactly as written. */
export function ritualSample(mdPath) {
  const md = readFileSync(mdPath, "utf8");
  const block = [...md.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((b) => b.includes("iskron-rituals"));
  assert.ok(block, `rituals plugin block present in ${mdPath}`);
  return block;
}

export const memoryPath = join(homedir(), ".claude", "projects", "-stand", "memory", "MEMORY.md");

export async function standServer(source) {
  dropPluginGlobals();
  const tag = `${process.pid}-${++stands}`;
  const sid = (name) => `${name}@${tag}`;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "opencode-stand-")));
  roots.push(root);
  const own = join(root, "own");
  const foreign = join(root, "foreign");
  const alias = join(root, "own-alias");
  const plugins = join(own, ".opencode", "plugins");
  mkdirSync(plugins, { recursive: true });
  mkdirSync(foreign);
  symlinkSync(own, alias, "dir");
  const file = join(plugins, "iskron-rituals.js");
  writeFileSync(file, source);
  const mod = await import(`${pathToFileURL(file).href}?stand=${Date.now()}-${Math.random()}`);

  // Probes name sessions ("mine", "theirs"); the server sees them as <name>@<stand>.
  const known = new Map(); // id → { dir, parentID }
  const sessions = { set: (name, s) => void known.set(sid(name), s) };
  const prompts = []; // { sessionID, text }
  const failing = { add: (name) => void gone.add(sid(name)) };
  const gone = new Set();
  const streams = new Set(); // one queue per subscriber
  const cleanups = [];

  const write = async (arg = {}) => {
    if (gone.has(arg.sessionID)) throw new Error(`session ${arg.sessionID} is gone`);
    prompts.push({ sessionID: arg.sessionID, text: String(arg.text ?? "") });
  };

  function subscribe({ signal } = {}) {
    const queue = [];
    let wake = null;
    const stream = { push: (ev) => (queue.push(ev), wake?.()) };
    streams.add(stream);
    signal?.addEventListener("abort", () => wake?.());
    return (async function* () {
      try {
        while (!signal?.aborted) {
          if (queue.length) yield queue.shift();
          else await new Promise((r) => (wake = r));
        }
      } finally {
        streams.delete(stream);
      }
    })();
  }

  /** Starts an instance of the plugin at `location`; returns its tool hooks. */
  async function instance(location) {
    const hooks = {};
    const ctx = {
      location: { directory: location },
      tool: { hook: async (name, fn) => void (hooks[name] ??= []).push(fn) },
      // @opencode/client promise/client.d.ts: subscribe(options) → AsyncIterable, not a Promise.
      event: { subscribe: (o) => subscribe(o) },
      session: {
        prompt: write,
        synthetic: write,
        get: async ({ sessionID } = {}) => {
          const s = known.get(sessionID);
          return s ? { id: sessionID, parentID: s.parentID, location: { directory: s.dir } } : null;
        },
      },
    };
    const cleanup = await mod.default.setup(ctx);
    if (typeof cleanup === "function") cleanups.push(cleanup);
    await settle(); // the subscription is taken
    return {
      /** Calls the instance's hooks; the session is named as by the probe, the call id is fresh unless given. */
      async call(name, input) {
        if (!String(input.sessionID).endsWith(`@${tag}`)) input.sessionID = sid(input.sessionID);
        input.id ??= `call-${++calls}`;
        for (const fn of hooks[name] ?? []) await fn(input);
        return input;
      },
    };
  }

  /** A session is created in `dir`: the event goes down the one stream. */
  async function create(name, dir, parentName) {
    const sessionID = sid(name);
    const parentID = parentName ? sid(parentName) : undefined;
    known.set(sessionID, { dir, parentID });
    const location = { directory: dir };
    const data = { sessionID, projectID: "prj", location };
    if (parentID) data.parentID = parentID;
    for (const s of streams) s.push({ type: "session.created", location, data });
    await settle();
  }

  const greeted = (name) => prompts.filter((p) => p.sessionID === sid(name)).length;
  const stop = async () => {
    for (const c of cleanups) await c();
  };
  return { own, foreign, alias, sessions, failing, instance, create, greeted, stop };
}

/** A tool call as the hooks of 2.0.24 get it: sessionID, no directory; the stand gives it a fresh id. */
export const toolCall = (tool, sessionID, input, result) => ({
  tool,
  sessionID,
  agent: "build",
  messageID: "msg",
  input,
  ...(result ? { status: "completed", result } : {}),
});
