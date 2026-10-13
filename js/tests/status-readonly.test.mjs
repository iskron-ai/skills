import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs, setConfig } from "../bridge/config.ts";
import { Door } from "../bridge/door.ts";
import { socketPathOf } from "../shared/standings.ts";
import { asyncStatus } from "./status-kit.mjs";

test("status never attaches to a recorded door or changes its idleAt and .seen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-no-attach-"));
  mkdirSync(join(dir, "standings"));
  const key = "status-door";
  const seen = join(dir, "standings", `${key}.seen`);
  writeFileSync(seen, "before");
  writeFileSync(
    join(dir, "standings", `${key}.hold`),
    JSON.stringify({
      key,
      name: "place",
      realm: "r5",
      karta: 931,
    }),
  );
  let idleAt = 123;
  let attaches = 0;
  const server = createServer((socket) => {
    attaches++;
    idleAt = 0;
    writeFileSync(seen, "attached");
    socket.on("close", () => {
      idleAt = Date.now();
    });
    socket.end();
  });
  await new Promise((r) => server.listen(socketPathOf(dir, key), r));
  try {
    const got = await asyncStatus(dir, ["--json"]);
    assert.equal(got.code, 0);
    assert.equal(attaches, 0);
    assert.equal(idleAt, 123);
    assert.equal(readFileSync(seen, "utf8"), "before");
    assert.equal(JSON.parse(got.out).disk_only[0].kind, "record");
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status leaves a real Door's idle clock and delivery memory untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-real-door-"));
  setConfig(parseArgs(["http://status.test", "--auth-dir", dir]));
  let attaches = 0;
  const door = new Door("status-real-door", {
    onAttach: () => {
      attaches++;
    },
    lateEvent: () => null,
    onError: (text) => {
      throw new Error(text);
    },
  });
  try {
    door.open();
    for (let i = 0; i < 100 && !door.ownsSocket; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(door.ownsSocket, true);
    writeFileSync(
      join(dir, "standings", "real.hold"),
      JSON.stringify({
        key: door.key,
        name: "real",
        realm: "r5",
        karta: 931,
      }),
    );
    const frame = (id, at) => ({
      type: "message",
      id,
      provenance: { wake: "look_up" },
      received_at: at,
    });
    door.push("old", frame("old", "2026-10-13T10:00:00Z"));
    door.push("new", frame("new", "2026-10-13T11:00:00Z"));
    const idleAt = door.idleAt;
    const memory = () => (existsSync(door.seenPath) ? readFileSync(door.seenPath, "utf8") : null);
    const seen = memory();
    for (let i = 0; i < 2; i++) assert.equal((await asyncStatus(dir, ["--json"])).code, 0);
    assert.equal(attaches, 0);
    assert.equal(door.idleAt, idleAt);
    assert.equal(memory(), seen);
  } finally {
    door.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
