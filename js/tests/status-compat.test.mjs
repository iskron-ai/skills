import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { seamSocketPath } from "../shared/seam-entrance.ts";
import { asyncStatus } from "./status-kit.mjs";

test("an older daemon is reported without inventing sessions or opening one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-old-"));
  mkdirSync(join(dir, "run"), { mode: 0o700 });
  const server = createServer((socket) =>
    socket.once("data", (data) => {
      assert.equal(JSON.parse(String(data)).probe, true);
      socket.end(
        JSON.stringify({
          t: "welcome",
          seam: 1,
          build: "old",
          pid: 123,
          path: "/old",
          session: null,
          resumed: false,
          sessions: 9,
        }) + "\n",
      );
    }),
  );
  await new Promise((r) => server.listen(seamSocketPath(dir), r));
  try {
    const r = await asyncStatus(dir, ["--json"]);
    assert.equal(r.code, 0);
    const s = JSON.parse(r.out);
    assert.deepEqual(s.daemon, { pid: 123, build: "old", path: "/old" });
    assert.equal(s.snapshot_available, false);
    assert.deepEqual(s.sessions, []);
    const human = await asyncStatus(dir, ["--lang", "en"]);
    assert.match(human.out, /snapshot unavailable/);
    assert.match(human.out, /Sessions: 9/);
    assert.doesNotMatch(human.out, /Sessions: 0/);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
