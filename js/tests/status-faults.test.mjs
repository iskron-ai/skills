import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { seamSocketPath } from "../shared/seam-entrance.ts";
import { asyncStatus, status } from "./status-kit.mjs";

const root = process.env.ISKRON_STATUS_SOURCE || resolve("js");
const { serveSeam } = await import(join(root, "shared/seam-host.ts"));
const { sessionSnapshot } = await import(join(root, "bridge/snapshot.ts"));
const { H } = await import(join(root, "bridge/holdstate.ts"));
const { state } = await import(join(root, "bridge/transport.ts"));

test("status creates neither a missing grant directory nor a seam directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-readonly-"));
  try {
    const missing = join(dir, "typo");
    const r = status(missing, ["--lang", "en"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(missing), false);
    assert.match(r.stdout, /directory does not exist/);
    status(dir);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status does not call an unheard held place listening", () => {
  const saved = { holder: H.holder, currentKey: H.currentKey, door: H.door, unheard: H.unheard };
  const standing = state.standing;
  try {
    H.holder = { alive: true };
    H.currentKey = "test";
    H.door = { key: "test", clients: new Set([{}]) };
    state.standing = { name: "test", realm: "r5", karta: 931 };
    const engine = { lastWork: () => 0 };
    H.unheard = false;
    assert.equal(sessionSnapshot("test", engine, 1, true, "test").places[0].listening, true);
    H.unheard = true;
    assert.equal(sessionSnapshot("test", engine, 1, true, "test").places[0].listening, false);
  } finally {
    Object.assign(H, saved);
    state.standing = standing;
  }
});

async function withServer(handler, check) {
  const dir = mkdtempSync(join(tmpdir(), "status-fault-"));
  mkdirSync(join(dir, "run"), { mode: 0o700 });
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    handler(socket);
  });
  await new Promise((r) => server.listen(seamSocketPath(dir), r));
  try {
    await check(dir);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a thrown daemon snapshot returns welcome with a safe reason, not no answer", async () => {
  await withServer(
    (socket) =>
      serveSeam(socket, {
        build: "test",
        path: "/test",
        count: () => 3,
        open: () => {
          throw new Error("must not open");
        },
        find: () => null,
        snapshot: () => {
          throw new Error("SECRET_SNAPSHOT_ERROR");
        },
      }),
    async (dir) => {
      const r = await asyncStatus(dir, ["--lang", "en"]);
      assert.equal(r.code, 0);
      assert.match(r.out, /snapshot failed/);
      assert.match(r.out, /Sessions: 3/);
      assert.doesNotMatch(r.out, /no answer|older daemon|SECRET_/);
      const json = await asyncStatus(dir, ["--json"]);
      assert.equal(json.code, 0);
      const snapshot = JSON.parse(json.out);
      assert.equal(snapshot.daemon.build, "test");
      assert.equal(snapshot.snapshot_available, false);
      assert.equal(snapshot.snapshot_error, "snapshot failed");
      assert.equal(snapshot.session_count, 3);
    },
  );
});

for (const [label, frame, expected] of [
  [
    "another protocol refusal",
    { t: "refuse", seam: 9, build: "test", reason: "SECRET_REASON" },
    /different protocol/,
  ],
  [
    "another protocol welcome",
    { t: "welcome", seam: 9, build: "test", pid: 1 },
    /different protocol/,
  ],
  ["refusal", { t: "refuse", seam: 1, build: "test", reason: "SECRET_REASON" }, /refused/],
])
  test(`status distinguishes ${label} without leaking the wire reason`, async () => {
    await withServer(
      (socket) => socket.once("data", () => socket.end(JSON.stringify(frame) + "\n")),
      async (dir) => {
        const r = await asyncStatus(dir, ["--lang", "en"]);
        assert.equal(r.code, 0);
        assert.match(r.out, expected);
        assert.doesNotMatch(r.out, /no answer|SECRET_/);
        const json = await asyncStatus(dir, ["--json"]);
        assert.equal(json.code, 0);
        assert.match(JSON.parse(json.out).daemon_error, expected);
      },
    );
  });

test("status still reports no answer for a silent daemon", async () => {
  await withServer(
    () => {},
    async (dir) => {
      const r = await asyncStatus(dir, ["--lang", "en"]);
      assert.equal(r.code, 0);
      assert.match(r.out, /no answer/);
      assert.doesNotMatch(r.out, /different protocol|refused/);
    },
  );
});
