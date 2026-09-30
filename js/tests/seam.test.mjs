// Пробы провода шва «тонкий мост ↔ демон машины» (shared/seam.ts,
// shared/seam-host.ts) — без движка: путь входа, рукопожатие и версии, проводка
// rpc, bye, окно переподхвата. Сессия здесь — эхо-заглушка; движок гоняет
// thin.test.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  connectSeam,
  helloFrame,
  SEAM_PROTOCOL,
  seamEnv,
  SeamError,
  seamSocketPath,
} from "../shared/seam.ts";
import { listenSeam, serveSeam } from "../shared/seam-host.ts";

const hello = (o = {}) => ({ ...helloFrame({ build: "vT+thin", path: "/x", argv: [] }), ...o });

function echoHost({ graceMs = 200 } = {}) {
  const sessions = new Map();
  const ended = [];
  let opened = 0;
  const host = {
    build: "vT+daemon",
    find: (id) => sessions.get(id) ?? null,
    open() {
      const id = `s${++opened}`;
      let sink = null;
      const s = {
        id,
        deliver: (msg) => sink?.({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } }),
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
  return { host, ended, opened: () => opened, graceMs };
}

async function withDaemon(fn, opts) {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seam-"));
  const path = seamSocketPath(dir);
  const h = echoHost(opts);
  const server = await listenSeam(path, (s) => serveSeam(s, h.host, h.graceMs));
  try {
    await fn({ dir, path, ...h });
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

test("the local entrance is keyed by the grant directory and stays within the socket path limit", () => {
  const a = mkdtempSync(join(tmpdir(), "iskron-seam-"));
  try {
    assert.equal(seamSocketPath(a), join(a, "daemon.sock"));
    assert.equal(seamSocketPath(a + "/"), seamSocketPath(a), "one grant, one daemon");
    const long = join(a, "x".repeat(120));
    const p = seamSocketPath(long);
    assert.ok(Buffer.byteLength(p) <= 100, p);
    assert.notEqual(p, seamSocketPath(join(a, "y".repeat(120))), "another grant, another daemon");
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

test("the handshake carries what the session needs from the harness, and nothing else", () => {
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
    "ISKRON_BRIDGE_TOKEN",
    "ISKRON_HARNESS_VERSION",
    "NODE_EXTRA_CA_CERTS",
  ]);
  const h = helloFrame({ build: "b", path: "/f", argv: ["--satellite"] });
  assert.equal(h.seam, SEAM_PROTOCOL);
  assert.equal(h.pid, process.pid);
  assert.equal(h.cwd, process.cwd());
  assert.deepEqual(h.argv, ["--satellite"]);
});

test("the entrance is 0600, a living daemon keeps it, a dead one's socket is cleared", async () => {
  await withDaemon(async ({ path }) => {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    await assert.rejects(
      listenSeam(path, () => {}),
      { code: "EADDRINUSE" },
    );
  });
  const dir = mkdtempSync(join(tmpdir(), "iskron-seam-"));
  const path = seamSocketPath(dir);
  writeFileSync(path, ""); // что осталось от упавшего демона
  const server = await listenSeam(path, () => {});
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

test("no daemon — absent; another seam version — refused with the reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seam-"));
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

test("rpc goes as is both ways; bye ends the session and is answered", async () => {
  await withDaemon(async ({ path, ended }) => {
    const l = await connectSeam(path, hello(), 1000);
    assert.equal(l.welcome.resumed, false);
    const got = frames(l);
    l.send({ t: "rpc", msg: { jsonrpc: "2.0", id: 7, method: "tools/list" } });
    await until("the echo", () => got.length === 1);
    assert.deepEqual(got[0], {
      t: "rpc",
      msg: { jsonrpc: "2.0", id: 7, result: { echo: "tools/list" } },
    });
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
      await until("the echo on the new seam", () => got.length === 1);
      await new Promise((r) => setTimeout(r, 400));
      assert.deepEqual(ended, [], "a resumed session does not end on the old seam's grace");
      b.close();
      await until("the end after the grace", () => ended.length === 1, 2000);
      assert.deepEqual(ended, [[id, "the thin bridge is gone (seam closed without bye)"]]);
    },
    { graceMs: 300 },
  );
});
