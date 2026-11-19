// Common to the probes of the orchestrator's leading (orchestra-raise*.test.mjs): a real daemon
// against the fake NKS, the human's launcher description in the fake mind and a substitute
// `orca` on the daemon's PATH that records argv instead of launching.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import { initCheckout } from "./git-checkout.mjs";

export const NODE = process.env.ISKRON_NODE || process.execPath;
export const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const FAKE_ORCA = join(dirname(fileURLToPath(import.meta.url)), "fake-orca.mjs");
export const REALM = "@nks/nks-dev";
export const ROOM = "725414c2-7078-4dfa-a5b9-140adb3b3422";
export const REPO = "github.com/probe/one";

export function cli(dir, args, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "orchestra", ...args, "--auth-dir", dir, "--lang", "en"], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  return new Promise((resolve) => {
    proc.once("exit", (code) => resolve({ code, out, err }));
    setTimeout(() => proc.kill("SIGKILL"), 30_000).unref();
  });
}

/** A caller that gives up after 5 s — a manual step otherwise waits for the tact's outcome. */
export const GIVE_UP = { ISKRON_ORCHESTRA_STEP_WAIT_MS: "5000" };

export const describe = (over = {}) => ({
  seq: over.seq ?? 77,
  body: JSON.stringify({
    launcher: "probe-mac",
    host: hostname(),
    adapter: "orca",
    limit: 2,
    harnesses: { opencode: { models: ["anthropic/claude-opus-5-5"] } },
    ...over.body,
  }),
});

/** Orca's own projects as 1.4.242 prints them: the probe repository has one ready local setup. */
export const orcaProjects = (checkout) => ({
  projects: [
    {
      id: "p-one",
      name: "one",
      gitRemoteIdentity: { canonicalKey: REPO, remoteUrl: `git@github.com:probe/one.git` },
    },
    {
      id: "p-two",
      name: "one", // the same name, another repository: names never decide
      gitRemoteIdentity: {
        canonicalKey: "github.com/other/one",
        remoteUrl: "https://github.com/other/one.git",
      },
    },
  ],
  setups: [
    { projectId: "p-one", path: checkout, setupState: "ready", hostId: "local" },
    { projectId: "p-one", path: "/remote/one", setupState: "ready", hostId: "ssh-box" },
    { projectId: "p-two", path: "/elsewhere/one", setupState: "ready", hostId: "local" },
  ],
});

/** author — the caller's seat address, a string, as the invites door carries it (#4951; LOCAL
 * 0.169.0 answered "author":"@skills-probe:lead", 09.11.2026); the fake's account is @tester, so
 * the default call is the machine's own. */
export const invite = (entry, attrs, repository = REPO, author = "@tester:lead") => ({
  entry_id: entry,
  room_id: ROOM,
  karta_seq: 931,
  author,
  at: "2026-11-09T10:00:00Z",
  payload: { holon: { seq: 4057, repository } },
  attrs,
});
export const GOOD = {
  launcher: "probe-mac",
  harness: "opencode",
  model: "anthropic/claude-opus-5-5",
};

export const signal = (i, entry, rooms, seat = "seat-raised") => ({
  id: `s${i}`,
  standing: { id: seat, standing: `@tester:${seat}` },
  n: i,
  spawned_for: { invite: entry, room: ROOM },
  cause: rooms.length ? "joined" : "left",
  room: { id: ROOM },
  rooms: rooms.map((id) => ({ id })),
  at: `2026-11-09T10:00:0${i}Z`,
  cursor: `c${i}`,
});
/** The platform's idleness of a seat on the same tape (#6010): idle_warned or idle_due. */
export const idleSignal = (i, entry, cause, seat = "seat-raised") => ({
  ...signal(i, entry, [], seat),
  cause,
});

export const orcaCalls = (log) =>
  existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];

export async function waitEnded(o, invite = 9) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const r = o.runs()[`${REALM}|${ROOM}|${invite}`];
    if (r?.state === "ended" && r.tree?.state === "removed") return r;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail(`exit/stop/cleanup not observed: ${JSON.stringify(o.runs())}`);
}

/** The checkout's cover: the raised agent's root seats itself by it (opencode/rootseat.ts). */
export const coverOf = (graph = REALM, role = 931) =>
  `---\niskron:\n  graph: ${graph}\n  holon: 4057\n  agent_role: ${role}\n---\n# probe\n`;
export const cover = (dir, text = coverOf()) => {
  writeFileSync(join(dir, "AGENTS.md"), text);
  initCheckout(dir);
};

/** A leading daemon: flag on, the fake's api beside a hold record, a substitute orca on PATH. */
export async function leading(
  t,
  { descriptions, projects, env = {}, admitted = true, whoami, covered = coverOf(), holons } = {},
) {
  // Short: the daemon's sockets live under it, and a Unix socket path is capped near 104 bytes.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-or-")));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout);
  if (covered) cover(checkout, covered);
  const fake = await startFakeNks({
    pat: "probe-pat",
    mind: { orchestra: descriptions?.(checkout) ?? [describe()], holons },
    whoami,
  });
  writeFileSync(join(dir, "server"), `${fake.base}/mcp\n`);
  writeFileSync(join(dir, "token"), "probe-pat");
  mkdirSync(join(dir, "standings"), { recursive: true });
  writeFileSync(
    join(dir, "standings", "probe-1.hold"),
    JSON.stringify({
      realm: REALM,
      karta: 931,
      name: "probe-1",
      url: `${fake.base}/channel/ws/probe-1`,
      at: Date.now(),
    }) + "\n",
  );
  mkdirSync(join(dir, "run"), { recursive: true, mode: 0o700 }); // the seam refuses a shared dir
  writeFileSync(join(dir, "run", "orchestra.json"), JSON.stringify({ on: true, realms: [REALM] }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "orca"), `#!/bin/sh\nexec "${NODE}" "${FAKE_ORCA}" "$@"\n`, {
    mode: 0o755,
  });
  writeFileSync(
    join(bin, "ssh"),
    `#!${NODE}\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\nprocess.stdout.write(process.env.FAKE_SSH_OUT || 'hostname github.com\\nidentityfile SECRET\\n');\nprocess.exit(Number(process.env.FAKE_SSH_EXIT || 0));\n`,
    { mode: 0o755 },
  );
  const log = join(dir, "orca.log");
  const laid = join(dir, "orca-projects.json");
  writeFileSync(laid, JSON.stringify((projects ?? orcaProjects)(checkout)));
  const denv = {
    ...process.env,
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_DAEMON_IDLE_MS: "15000",
    ISKRON_ORCHESTRA_TACT_MS: "3600000",
    ISKRON_BRIDGE_LANG: "en", // the tact's words are the daemon's
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_ORCA_LOG: log,
    FAKE_SSH_LOG: join(dir, "ssh.log"),
    FAKE_ORCA_PROJECTS: laid,
    FAKE_ORCA_RUNTIME_FILE: join(dir, "orca-runtime"),
    ...(admitted ? { ISKRON_ORCHESTRA: "1" } : {}),
    ...env,
  };
  if (!admitted) delete denv.ISKRON_ORCHESTRA;
  const daemon = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: denv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let derr = "";
  daemon.stderr.on("data", (c) => (derr += c));
  /** What must end while the daemon still lives — the probe's own clients of it. */
  const beforeCleanup = [];
  t.after(async () => {
    for (const end of beforeCleanup.splice(0)) await end();
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const ended = new Promise((r) => daemon.once("exit", r));
      daemon.kill("SIGKILL");
      await ended;
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; ; i++) {
    const r = await cli(dir, ["status"]);
    if (r.code === 0) break;
    if (i > 100) throw new Error(`daemon not ready: ${r.err}\n${derr.slice(-1500)}`);
    await new Promise((r2) => setTimeout(r2, 100));
  }
  return {
    dir,
    fake,
    checkout,
    beforeCleanup,
    step: () => cli(dir, ["step"]),
    launches: () => orcaCalls(log).filter((a) => a[0] === "agent"),
    closes: () => orcaCalls(log).filter((a) => a[0] === "terminal" && a[1] === "close"),
    terminals: () => orcaCalls(log).filter((a) => a[0] === "terminal"),
    /** A restarted Orca: its answers carry this runtime id from now on. */
    restartOrca: (runtime) => writeFileSync(join(dir, "orca-runtime"), runtime),
    runs: () => {
      const f = join(dir, "run", "orchestra-runs.json");
      return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).runs : {};
    },
    /** The registry's clone rows by repository. */
    cloneRows: () => {
      const f = join(dir, "run", "orchestra-runs.json");
      return (existsSync(f) && JSON.parse(readFileSync(f, "utf8")).clones) || {};
    },
    queue: (invites, signals = []) =>
      fake.control({ orchestra: { realms: { [REALM]: { invites, signals } } } }),
  };
}

/** The CLI as a human types it at a terminal: under a pseudo-terminal of `script`, its words
 * and its refusals on the one output. */
export function atTerminal(dir, args) {
  const argv = [NODE, BRIDGE, "orchestra", ...args, "--auth-dir", dir, "--lang", "en"];
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const [cmd, cargs] =
    process.platform === "darwin"
      ? ["script", ["-q", "/dev/null", ...argv]]
      : ["script", ["-qec", argv.map(q).join(" "), "/dev/null"]];
  const proc = spawn(cmd, cargs, {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
    // A socket for stdin makes script refuse (tcgetattr on a socket): /dev/null it is.
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (out += c));
  return new Promise((resolve) => {
    proc.once("exit", (code) => resolve({ code, out }));
    setTimeout(() => proc.kill("SIGKILL"), 30_000).unref();
  });
}

export const adds = (o) => o.fake.state.calls.filter((c) => c.name === "iskron_add_phenomenon");

/** Polls the run until `ok` holds; the exec observer acts on its own 5 s timer. */
export async function runUntil(o, ok, what) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (ok(o.runs()[`${REALM}|${ROOM}|9`])) return o.runs()[`${REALM}|${ROOM}|9`];
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail(`${what} not observed: ${JSON.stringify(o.runs())}`);
}
