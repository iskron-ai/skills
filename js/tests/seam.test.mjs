// Пробы шва «тонкий мост ↔ демон машины» без движка: вход (shared/seam-entrance.ts
// — путь, личный каталог, замки), провод (shared/seam.ts — рукопожатие, версии,
// ack) и сторона демона (shared/seam-host.ts — проводка rpc, bye, окно
// переподхвата). Сессия здесь — эхо-заглушка; движок гоняет thin.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  connectSeam,
  helloFrame,
  patShaOf,
  SEAM_PROTOCOL,
  seamEnv,
  SeamError,
} from "../shared/seam.ts";
import {
  carryAwayStale,
  seamDaemonLockPath,
  seamEntranceProblem,
  seamRunDir,
  seamSocketPath,
  takeFileLock,
} from "../shared/seam-entrance.ts";
import { listenSeam, serveSeam } from "../shared/seam-host.ts";
import { shortSocketDir } from "../shared/standings.ts";

const hello = (o = {}) => ({ ...helloFrame({ build: "vT+thin", path: "/x", argv: [] }), ...o });
const root = process.getuid?.() === 0;
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;
const fresh = () => mkdtempSync(join(tmpdir(), "iskron-seam-"));

function echoHost({ graceMs = 200 } = {}) {
  const sessions = new Map();
  const ended = [];
  const delivered = [];
  let opened = 0;
  const host = {
    build: "vT+daemon",
    find: (id) => sessions.get(id) ?? null,
    open() {
      const id = `s${++opened}`;
      let sink = null;
      const s = {
        id,
        deliver: (msg) => {
          delivered.push(msg);
          if (msg.id != null) sink?.({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } });
        },
        attach: (fn) => (sink = fn),
        end: async (why) => {
          ended.push([id, why]);
          sessions.delete(id);
        },
      };
      sessions.set(id, s);
      return s;
    },
  };
  return { host, ended, delivered, opened: () => opened, graceMs };
}

async function withDaemon(fn, opts) {
  const dir = fresh();
  const h = echoHost(opts);
  const server = await listenSeam(dir, (s) => serveSeam(s, h.host, h.graceMs));
  try {
    await fn({ dir, path: seamSocketPath(dir), ...h });
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

const frames = (link) => {
  const got = [];
  link.onFrame((f) => got.push(f));
  return got;
};
const until = async (what, fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("the entrance is keyed by the grant directory, private, and within the socket path limit", () => {
  const a = fresh();
  try {
    assert.equal(seamSocketPath(a), join(a, "run", "daemon.sock"));
    assert.equal(seamSocketPath(a + "/"), seamSocketPath(a), "one grant, one daemon");
    const long = join(a, "x".repeat(120));
    const p = seamSocketPath(long);
    assert.ok(Buffer.byteLength(p) <= 103, p);
    assert.ok(p.startsWith(shortSocketDir() + "/"), `a long path goes to the personal dir: ${p}`);
    assert.notEqual(p, seamSocketPath(join(a, "y".repeat(120))), "another grant, another daemon");
    assert.equal(seamEntranceProblem(a), null);
    assert.equal(statSync(seamRunDir(a)).mode & 0o777, 0o700, "the run dir is made 0700");
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

test("an entrance open to others or not a directory is refused, not taken", async () => {
  const a = fresh();
  try {
    mkdirSync(seamRunDir(a), { mode: 0o755 });
    chmodSync(seamRunDir(a), 0o755);
    assert.match(seamEntranceProblem(a) ?? "", /открыт группе или прочим/);
    await assert.rejects(
      listenSeam(a, () => {}),
      { code: "EUNSAFE" },
    );
    assert.equal(existsSync(seamSocketPath(a)), false, "no socket in an open dir");
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
  const b = fresh();
  const elsewhere = fresh();
  try {
    symlinkSync(elsewhere, seamRunDir(b));
    assert.match(seamEntranceProblem(b) ?? "", /не каталог/, "a symlink is not the private dir");
  } finally {
    rmSync(b, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
  // Каталог чужого владельца пробой не создать без root — проверка владельца
  // (privateDirProblem) та же, что у коротких сокетов дверей мест.
});

test("the handshake carries what the session needs — not the personal token", () => {
  const env = seamEnv({
    ISKRON_BRIDGE_TOKEN: "t",
    ISKRON_HARNESS_VERSION: "1",
    CLAUDE_PLUGIN_ROOT: "/p",
    HTTPS_PROXY: "http://proxy",
    NODE_EXTRA_CA_CERTS: "/ca",
    SECRET_OF_SOMEONE_ELSE: "no",
  });
  assert.deepEqual(Object.keys(env).sort(), [
    "CLAUDE_PLUGIN_ROOT",
    "HTTPS_PROXY",
    "ISKRON_HARNESS_VERSION",
    "NODE_EXTRA_CA_CERTS",
  ]);
  const h = helloFrame({ build: "b", path: "/f", argv: ["--satellite"], patSha: patShaOf("t") });
  assert.equal(h.seam, SEAM_PROTOCOL);
  assert.equal(h.pid, process.pid);
  assert.equal(h.cwd, process.cwd());
  assert.deepEqual(h.argv, ["--satellite"]);
  assert.equal(h.patSha, patShaOf("t"));
  assert.doesNotMatch(
    JSON.stringify(h),
    /"t"\}|ISKRON_BRIDGE_TOKEN/,
    "the token itself stays home",
  );
});

test("the socket is 0600; two daemons at once — one listens, the other is refused and unlinks nothing", async () => {
  const dir = fresh();
  const h = echoHost();
  const tries = await Promise.allSettled([
    listenSeam(dir, (s) => serveSeam(s, h.host)),
    listenSeam(dir, (s) => serveSeam(s, h.host)),
  ]);
  try {
    const up = tries.filter((t) => t.status === "fulfilled");
    const refused = tries.filter((t) => t.status === "rejected");
    assert.equal(up.length, 1, "exactly one daemon per grant");
    assert.equal(refused[0].reason.code, "EADDRINUSE");
    assert.equal(statSync(seamSocketPath(dir)).mode & 0o777, 0o600);
    const l = await connectSeam(seamSocketPath(dir), hello({ probe: true }), 1000);
    assert.equal(l.welcome.build, "vT+daemon", "the living daemon still answers");
    l.close();
    await assert.rejects(
      listenSeam(dir, () => {}),
      { code: "EADDRINUSE" },
    );
    const again = await connectSeam(seamSocketPath(dir), hello({ probe: true }), 1000);
    again.close();
  } finally {
    for (const t of tries) if (t.status === "fulfilled") await new Promise((r) => t.value.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a dead daemon's socket and lock are cleared by the next one", async () => {
  const dir = fresh();
  try {
    assert.equal(seamEntranceProblem(dir), null);
    writeFileSync(seamSocketPath(dir), ""); // что осталось от упавшего демона
    writeFileSync(
      seamDaemonLockPath(dir),
      JSON.stringify({ pid: deadPid(), token: "dead", started_at: Date.now() }),
    );
    const server = await listenSeam(dir, () => {});
    assert.equal(JSON.parse(readFileSync(seamDaemonLockPath(dir), "utf8")).pid, process.pid);
    await new Promise((r) => server.close(r));
    assert.equal(existsSync(seamDaemonLockPath(dir)), false, "the lock goes with the daemon");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the file lock: a live holder keeps it, a dead one's is stolen once, a refusing disk is a fault at once", () => {
  const dir = fresh();
  const path = join(dir, "l");
  try {
    const mine = takeFileLock(path, 60_000);
    assert.equal(mine.held, true);
    const busy = takeFileLock(path, 60_000);
    assert.equal(busy.held, false, "live — wait");
    assert.equal(busy.fault, null);
    assert.equal(busy.holder?.pid, process.pid, "the holder is named");
    mine.release();
    writeFileSync(path, JSON.stringify({ pid: deadPid(), token: "x", started_at: Date.now() }));
    const stolen = takeFileLock(path, 60_000);
    assert.equal(stolen.held, true, "a dead holder's lock is taken over");
    stolen.release();
    if (!root) {
      const ro = join(dir, "ro");
      mkdirSync(ro, { mode: 0o500 });
      const r = takeFileLock(join(ro, "l"), 60_000);
      assert.equal(r.held, false);
      assert.match(r.fault ?? "", /EACCES|permission/i, "the reason, not a wait");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ревью sub-24: B прочёл брошенный замок, A успел его унести и взять свежий, B
// уносит уже живой замок A. Унесённый по ошибке живой замок возвращается на место.
test("a live lock carried away by mistake is put back, not left aside", () => {
  const dir = fresh();
  const path = join(dir, "r.lock");
  try {
    writeFileSync(path, JSON.stringify({ pid: deadPid(), token: "stale", started_at: 0 }));
    const a = takeFileLock(path, 15_000); // A унёс брошенный и держит свой
    assert.equal(a.held, true);
    const liveToken = JSON.parse(readFileSync(path, "utf8")).token;
    const b = carryAwayStale(path, "stale"); // B — со своим прочтением брошенного
    assert.equal(b?.putBack, true, `B puts it back: ${JSON.stringify(b)}`);
    assert.match(b.word, /put back/, "B says what happened");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).token, liveToken, "A's lock is in place");
    assert.deepEqual(readdirSync(dir), ["r.lock"], "nothing is left aside");
    assert.equal(takeFileLock(path, 15_000).held, false, "C does not take it while A holds");
    a.release();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a daemon lock does not hold the entrance on a pid alone: a foreign pid with a dead socket is stale", async () => {
  const dir = fresh();
  try {
    assert.equal(seamEntranceProblem(dir), null);
    // pid 1 — чужой (EPERM), замок свежий, сокета нет: живого демона здесь нет.
    writeFileSync(
      seamDaemonLockPath(dir),
      JSON.stringify({ pid: 1, token: "old", started_at: Date.now() }),
    );
    const server = await listenSeam(dir, () => {});
    await new Promise((r) => server.close(r));
    // Свой живой pid, замок старше потолка давности, сокет мёртв — тоже брошен.
    writeFileSync(
      seamDaemonLockPath(dir),
      JSON.stringify({ pid: process.pid, token: "hung", started_at: Date.now() - 86_400_000 }),
    );
    const again = await listenSeam(dir, () => {});
    await new Promise((r) => again.close(r));
    // Свой живой и свежий (демон только встаёт) — держит, и отказ называет замок.
    writeFileSync(
      seamDaemonLockPath(dir),
      JSON.stringify({ pid: process.pid, token: "starting", started_at: Date.now() }),
    );
    await assert.rejects(
      listenSeam(dir, () => {}),
      (e) => {
        assert.equal(e.code, "EADDRINUSE");
        assert.ok(e.message.includes(seamDaemonLockPath(dir)), e.message);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no daemon — absent; another seam version — refused with the reason", async () => {
  const dir = fresh();
  await assert.rejects(connectSeam(seamSocketPath(dir), hello(), 1000), (e) => {
    assert.ok(e instanceof SeamError);
    assert.equal(e.kind, "absent");
    return true;
  });
  rmSync(dir, { recursive: true, force: true });
  await withDaemon(async ({ path, opened }) => {
    await assert.rejects(connectSeam(path, hello({ seam: 99 }), 1000), (e) => {
      assert.equal(e.kind, "refused");
      assert.match(e.message, /seam protocol 99 is not spoken here/);
      return true;
    });
    assert.equal(opened(), 0, "no session for a stranger");
  });
});

test("a probe learns the daemon's build without opening a session", async () => {
  await withDaemon(async ({ path, opened }) => {
    const l = await connectSeam(path, hello({ probe: true }), 1000);
    assert.equal(l.welcome.build, "vT+daemon");
    assert.equal(l.welcome.session, null);
    assert.equal(l.welcome.pid, process.pid);
    assert.equal(opened(), 0);
    l.close();
  });
});

test("a request is acked before the session sees it; a notification is not; order holds", async () => {
  await withDaemon(async ({ path, delivered }) => {
    const l = await connectSeam(path, hello(), 1000);
    assert.equal(l.welcome.ack, true, "the daemon says it speaks ack");
    const got = frames(l);
    l.send({ t: "rpc", msg: { jsonrpc: "2.0", id: 1, method: "initialize" } });
    l.send({ t: "rpc", msg: { jsonrpc: "2.0", method: "notifications/initialized" } });
    l.send({ t: "rpc", msg: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    await until("both echoes", () => got.filter((f) => f.t === "rpc").length === 2);
    assert.deepEqual(
      got.map((f) => (f.t === "ack" ? `ack ${f.id}` : `rpc ${f.msg.id}`)),
      ["ack 1", "rpc 1", "ack 2", "rpc 2"],
      "each ack precedes its request's handling",
    );
    assert.deepEqual(
      delivered.map((m) => m.method),
      ["initialize", "notifications/initialized", "tools/list"],
      "the order of arrival is the order of delivery",
    );
    l.close();
  });
});

test("rpc goes as is both ways; bye ends the session and is answered", async () => {
  await withDaemon(async ({ path, ended }) => {
    const l = await connectSeam(path, hello(), 1000);
    assert.equal(l.welcome.resumed, false);
    const got = frames(l);
    l.send({ t: "rpc", msg: { jsonrpc: "2.0", id: 7, method: "tools/list" } });
    await until("the echo", () => got.some((f) => f.t === "rpc"));
    assert.deepEqual(
      got.find((f) => f.t === "rpc"),
      { t: "rpc", msg: { jsonrpc: "2.0", id: 7, result: { echo: "tools/list" } } },
    );
    let closed = false;
    l.onClose(() => (closed = true));
    l.send({ t: "bye", why: "stdin closed" });
    await until("bye-ok", () => got.some((f) => f.t === "bye-ok"));
    await until("the close", () => closed);
    assert.deepEqual(ended, [[l.welcome.session, "stdin closed"]]);
  });
});

test("a seam closed without bye ends the session after the grace; a reattach within it resumes", async () => {
  await withDaemon(
    async ({ path, ended }) => {
      const a = await connectSeam(path, hello(), 1000);
      const id = a.welcome.session;
      a.close();
      await new Promise((r) => setTimeout(r, 100));
      const b = await connectSeam(path, hello({ session: id }), 1000);
      assert.equal(b.welcome.session, id);
      assert.equal(b.welcome.resumed, true, "the same session came back");
      const got = frames(b);
      b.send({ t: "rpc", msg: { jsonrpc: "2.0", id: 1, method: "ping" } });
      await until("the echo on the new seam", () => got.some((f) => f.t === "rpc"));
      await new Promise((r) => setTimeout(r, 400));
      assert.deepEqual(ended, [], "a resumed session does not end on the old seam's grace");
      b.close();
      await until("the end after the grace", () => ended.length === 1, 2000);
      assert.deepEqual(ended, [[id, "the thin bridge is gone (seam closed without bye)"]]);
    },
    { graceMs: 300 },
  );
});
