// Обвязка проб общего соединения каналов (граф @nks/nks-dev, #8620, #8622, #8623): фейк
// платформы с диспетчером, настоящий демон машины, сессии — по шву напрямую (как
// pulse-status.test.mjs) или тонким мостом, когда пробе нужна смена демона.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { attachMux } from "./fake-mux.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE } from "./status-kit.mjs";

export const PAT = "status-pat";
/** Интервал такта под пробой: договор его не называет — шов пульса (pulse.ts). */
export const TICK_MS = 300;
const ENV = { ...env, ISKRON_PULSE_GAP_MS: String(TICK_MS), ISKRON_BRIDGE_DAEMON_TRACE: "1" };
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "pi-iskron", version: "2.1" },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(what, fn, ms = 6000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
export const textOf = (r) => (r?.result?.content ?? []).map((c) => c.text ?? "").join("\n");

const journalOf = (dir) => {
  try {
    return readFileSync(join(dir, "run", "daemon.log"), "utf8");
  } catch {
    return "";
  }
};
export const daemonPids = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);
export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Одна MCP-сессия демона по шву: кадры копятся, ответы — по id. */
async function seamSession(dir, fake) {
  const hello = helloFrame({
    build: "v7.9.0+test",
    path: BRIDGE,
    argv: [fake.mcpUrl, "--auth-dir", dir],
    patSha: patShaOf(PAT),
  });
  const link = await connectSeam(seamSocketPath(dir), hello, 3000);
  const frames = [];
  const waiters = new Map();
  link.onFrame((f) => {
    frames.push(f);
    const w = f.t === "rpc" && f.msg.id !== undefined && waiters.get(f.msg.id);
    if (w) (waiters.delete(f.msg.id), w(f.msg));
  });
  let seq = 0;
  const s = {
    frames,
    rpc(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        waiters.set(id, resolve);
        setTimeout(() => reject(new Error(`no reply: ${method}`)), 20_000).unref();
        link.send({ t: "rpc", msg: { jsonrpc: "2.0", id, method, params } });
      });
    },
    stand: (args) => s.rpc("tools/call", { name: "iskron_stand", arguments: args }),
    /** Сколько кадров сессии несут этот текст. */
    heard: (text) => frames.filter((f) => JSON.stringify(f).includes(text)).length,
    bye: () => (link.send({ t: "bye", why: "probe" }), link.close()),
    close: () => link.close(),
  };
  await s.rpc("initialize", INIT);
  link.send({ t: "rpc", msg: { jsonrpc: "2.0", method: "notifications/initialized" } });
  return s;
}

/** Тонкий мост: поднимает демон сам и поднимает преемника после SIGTERM. */
function thinBridge(dir, fake) {
  const proc = spawn(NODE, [BRIDGE, fake.mcpUrl, "--no-browser", "--auth-dir", dir], {
    env: { ...ENV, ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_BRIDGE_DAEMON: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const all = [];
  const waiters = new Map();
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    for (let nl; (nl = out.indexOf("\n")) >= 0;) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      all.push(msg);
      const w = waiters.get(msg.id);
      if (w) (waiters.delete(msg.id), w(msg));
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let seq = 0;
  const b = {
    all,
    get stderr() {
      return stderr;
    },
    rpc(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        waiters.set(id, resolve);
        setTimeout(() => reject(new Error(`no reply: ${method}`)), 30_000).unref();
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    stand: (args) => b.rpc("tools/call", { name: "iskron_stand", arguments: args }),
    stop: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => (proc.once("exit", r), proc.kill("SIGKILL"))),
  };
  return b;
}

/**
 * Фейк с диспетчером, каталог гранта, демон и сессии; уборка — всегда.
 * own: false — демон поднимают тонкие мосты пробы (смена демона).
 */
export async function withMux(fn, { mode = "mux", own = true } = {}) {
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true });
  const mux = attachMux(fake, { mode });
  const dir = mkdtempSync(join(tmpdir(), "iskron-mux-"));
  const closers = [];
  let daemon = null;
  try {
    if (own) {
      daemon = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], { env: ENV, stdio: "ignore" });
      (await entrance(dir)).close();
    }
    const session = async () => {
      const s = await seamSession(dir, fake);
      closers.push(() => s.close());
      return s;
    };
    const thin = async () => {
      const b = thinBridge(dir, fake);
      closers.push(() => b.stop());
      await b.rpc("initialize", INIT);
      return b;
    };
    await fn({ fake, mux, dir, session, thin, journal: () => journalOf(dir) });
  } finally {
    await Promise.all(closers.map((c) => c()));
    if (daemon) {
      const exited = new Promise((r) => daemon.once("exit", r));
      daemon.kill("SIGKILL");
      await exited;
    }
    for (const pid of daemonPids(dir).filter(alive)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    mux.stop();
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Соединение диспетчера, несущее эти каналы. Красная причина на мосте без диспетчера —
 * словами: ни одного апгрейда по адресу диспетчера, места слушают сокетами на место.
 */
export async function muxCarrying(fake, mux, channels, ms = 6000) {
  const carried = () => mux.live().find((c) => channels.every((ch) => c.subs.has(ch))) ?? null;
  try {
    return await waitFor(`one dispatcher connection carrying ${channels.join(", ")}`, carried, ms);
  } catch (e) {
    throw new Error(
      `${e.message}: the bridge asked /channel/mux ${mux.attempts.length} time(s); ` +
        `socket-per-seat upgrades: ${fake.state.counts.ws_upgrades} — no dispatcher in the bridge`,
      { cause: e },
    );
  }
}

/** Канал места по имени в графе фейка. */
export const channelOf = (fake, name) =>
  [...fake.state.channels].find(([, c]) =>
    [...c.places.values()].some((p) => p.name === name),
  )?.[0];
/** standing_id места по имени. */
export const seatIdOf = (fake, name) =>
  [...fake.state.channels.values()]
    .flatMap((c) => [...c.places.values()])
    .find((p) => p.name === name)?.standing_id;
