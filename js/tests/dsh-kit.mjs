// A leading daemon for the dsh probes (graph @nks/nks-dev, #10777): the built bridge against the
// fake NKS, the human's description of adapter bridge offering the harness dsh, a substitute dsh
// on the daemon's PATH and a substitute orca that only records — a dsh call never asks it.
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

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const HERE = dirname(fileURLToPath(import.meta.url));
export const REALM = "@nks/nks-dev";
export const ROOM = "725414c2-7078-4dfa-a5b9-140adb3b3422";
export const REPO = "github.com/probe/one";
export const MODEL = "local-probe/mock";

export function cli(dir, args) {
  const proc = spawn(NODE, [BRIDGE, "orchestra", ...args, "--auth-dir", dir, "--lang", "en"], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "",
    err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  return new Promise((resolve) => {
    proc.once("exit", (code) => resolve({ code, out, err }));
    setTimeout(() => proc.kill("SIGKILL"), 60_000).unref();
  });
}

export const invite = (entry, attrs = {}) => ({
  entry_id: entry,
  room_id: ROOM,
  karta_seq: 931,
  author: "@tester:lead",
  at: "2026-11-09T10:00:00Z",
  payload: { holon: { seq: 4057, repository: REPO } },
  attrs: { launcher: "probe-mac", harness: "dsh", model: MODEL, ...attrs },
});

// PATH without any orca: the probe's bin dir, then the inherited dirs that hold no orca.
const withoutOrca = (bin) =>
  [
    bin,
    ...(process.env.PATH ?? "").split(":").filter((d) => d && !existsSync(join(d, "orca"))),
  ].join(":");

const lines = (f) =>
  existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];

/** fenced — a server without raw: the description's body only between the card's fences;
 * adapter — the description's; harnesses(patch) — its offers instead of the one dsh offer;
 * beside — more bodies (patch) => description, checkouts filled in; orca: false — no orca at all
 * on the daemon's PATH; bridge — the daemon's bridge file instead of the built one (a
 * delivery copy with its own constants, e.g. DSH_PROFILE null); homes(checkout) — the
 * description's homes (#10096). */
export async function leadingDsh(
  t,
  {
    env = {},
    offer = {},
    limit = 2,
    adapter = "bridge",
    harnesses,
    beside = [],
    orca = true,
    fenced = false,
    bridge,
    caseRoom,
    homes,
  } = {},
) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-dsh-")));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout);
  writeFileSync(
    join(checkout, "AGENTS.md"),
    `---\niskron:\n  graph: ${REALM}\n  holon: 4057\n  agent_role: 931\n---\n# probe\n`,
  );
  initCheckout(checkout);
  const patch = join(dir, "dsh-profile.yml");
  writeFileSync(patch, "- id: tool-ask-user\n  disabled: true\n");
  const body = {
    launcher: "probe-mac",
    host: hostname(),
    adapter,
    limit,
    harnesses: harnesses?.(patch) ?? { dsh: { models: [MODEL], patch, ...offer } },
    checkouts: { [REPO]: checkout },
    ...(homes ? { homes: homes(checkout) } : {}),
  };
  const bodies = [body, ...beside.map((b) => ({ ...b(patch), checkouts: { [REPO]: checkout } }))];
  const fake = await startFakeNks({
    pat: "probe-pat",
    mind: { orchestra: bodies.map((b, i) => ({ seq: 77 + i, body: JSON.stringify(b) })), fenced },
  });
  // The call's case as the REST doors serve it (#10995): status plus the journal's entries.
  if (caseRoom) await fake.control({ caseRooms: { [ROOM]: caseRoom } });
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
  mkdirSync(join(dir, "run"), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "run", "orchestra.json"), JSON.stringify({ on: true, realms: [REALM] }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const [name, script] of [
    ["dsh", "fake-dsh.mjs"],
    ...(orca ? [["orca", "fake-orca.mjs"]] : []),
  ])
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${NODE}" "${join(HERE, script)}" "$@"\n`, {
      mode: 0o755,
    });
  const dshLog = join(dir, "dsh.log"),
    orcaLog = join(dir, "orca.log");
  const daemonEnv = {
    ...process.env,
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_DAEMON_IDLE_MS: "30000",
    ISKRON_ORCHESTRA_TACT_MS: "3600000",
    ISKRON_BRIDGE_LANG: "en",
    ISKRON_ORCHESTRA: "1",
    PATH: orca ? `${bin}:${process.env.PATH}` : withoutOrca(bin),
    FAKE_DSH_LOG: dshLog,
    FAKE_ORCA_LOG: orcaLog,
    ...env,
  };
  let daemon;
  const spawnDaemon = () => {
    daemon = spawn(NODE, [bridge ?? BRIDGE, "daemon", "--auth-dir", dir], {
      env: daemonEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    daemon.stderr.on("data", (c) => (derr += c));
    return daemon;
  };
  let derr = "";
  spawnDaemon();
  const stopDaemon = async () => {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const ended = new Promise((r) => daemon.once("exit", r));
      daemon.kill("SIGKILL");
      await ended;
    }
  };
  t.after(async () => {
    await stopDaemon();
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const ready = async () => {
    for (let i = 0; ; i++) {
      const r = await cli(dir, ["status"]);
      if (r.code === 0) return;
      if (i > 100) throw new Error(`daemon not ready: ${r.err}\n${derr.slice(-1500)}`);
      await new Promise((r2) => setTimeout(r2, 100));
    }
  };
  await ready();
  const registry = () => {
    const f = join(dir, "run", "orchestra-runs.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).runs : {};
  };
  return {
    dir,
    checkout,
    patch,
    step: () => cli(dir, ["step"]),
    status: () => cli(dir, ["status"]),
    dshCalls: () => lines(dshLog),
    orcaCalls: () => lines(orcaLog),
    run: (n) => registry()[`${REALM}|${ROOM}|${n}`],
    queue: (invites, signals = []) =>
      fake.control({ orchestra: { realms: { [REALM]: { invites, signals } } } }),
    room: (status, entries) => fake.control({ caseRooms: { [ROOM]: { status, entries } } }),
    /** A stop order on the account naming a seat — the foreign stop path (#10995). The realm
     * rides along: the demands snapshot refuses an order without one. */
    stopOrder: (standing) =>
      fake.control({
        stop_order: {
          id: "ord-probe",
          standing_id: standing,
          realm: REALM,
          karta_seq: 931,
          frame: false,
        },
      }),
    /** A new daemon over the same registry and the same fake — a slept row must survive it. */
    restart: async () => {
      await stopDaemon();
      spawnDaemon();
      await ready();
    },
    async until(n, ok, ms = 20_000) {
      for (const end = Date.now() + ms; Date.now() < end;) {
        const r = registry()[`${REALM}|${ROOM}|${n}`];
        if (r && ok(r)) return r;
        await new Promise((d) => setTimeout(d, 100));
      }
      throw new Error(`not observed: ${JSON.stringify(registry())}\n${derr.slice(-1500)}`);
    },
  };
}
