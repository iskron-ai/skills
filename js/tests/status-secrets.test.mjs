import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { seamSocketPath } from "../shared/seam-entrance.ts";
import { asyncStatus, status } from "./status-kit.mjs";

const secret = {
  grant: "SECRET_GRANT",
  env: { X: "SECRET_ENV" },
  url: "SECRET_URL",
  statusUrl: "SECRET_STATUS",
  argv: ["SECRET_ARGV"],
  socket: "SECRET_SOCKET",
};
test("status reports disk records and live fallback without secrets when no daemon answers", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-disk-"));
  try {
    mkdirSync(join(dir, "standings"));
    mkdirSync(join(dir, "fallback"));
    writeFileSync(
      join(dir, "standings", "old.hold"),
      JSON.stringify({ name: "disk-place", realm: "r5", karta: 931, ...secret }),
    );
    writeFileSync(
      join(dir, "fallback", `${process.pid}.json`),
      JSON.stringify({
        pid: process.pid,
        build: "test",
        cwd: "/probe",
        why: "SECRET_REASON",
        ...secret,
      }),
    );
    writeFileSync(join(dir, "standings", "broken.hold"), "{");
    for (const args of [["--json"], [], ["--lang", "en"]]) {
      const r = status(dir, args);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout + r.stderr, /SECRET_/);
      if (args.includes("--json")) {
        const s = JSON.parse(r.stdout);
        assert.equal(s.daemon, null);
        assert.equal(s.fallback.length, 1);
        assert.equal(s.disk_only.length, 1);
        assert.equal(s.disk_only[0].kind, "record");
      } else
        assert.match(
          r.stdout,
          args.includes("en") ? /record, liveness unknown/ : /запись, живость неизвестна/,
        );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("status allowlists a fake daemon snapshot before either output format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-secret-"));
  mkdirSync(join(dir, "run"), { mode: 0o700 });
  const server = createServer((sock) =>
    sock.once("data", (data) => {
      const hello = JSON.parse(String(data));
      assert.equal(hello.probe, true);
      assert.equal(hello.snapshot, true);
      assert.deepEqual(hello.env, {});
      sock.end(
        JSON.stringify({
          t: "welcome",
          seam: 1,
          build: "test",
          pid: 1,
          session: null,
          resumed: false,
          snapshot: {
            daemon: { pid: 1, build: "test", path: "/test", ...secret },
            sessions: [
              {
                local_id: "s1",
                thin_pid: 2,
                attached: true,
                harness: "test",
                harness_session: "h1",
                cwd: "/test",
                build: "test",
                skills: { name: "set", version: "1", stamp: "12345678", ...secret },
                ...secret,
                places: [
                  {
                    name: "place",
                    realm: "r5",
                    karta: 931,
                    primary: true,
                    listening: false,
                    usage: { tokens: 12, ...secret },
                    ...secret,
                  },
                ],
              },
            ],
          },
          ...secret,
        }) + "\n",
      );
    }),
  );
  await new Promise((r) => server.listen(seamSocketPath(dir), r));
  try {
    for (const args of [["--json"], ["--lang", "en"]]) {
      const r = await asyncStatus(dir, args);
      assert.equal(r.code, 0);
      assert.doesNotMatch(r.out, /SECRET_/);
      assert.match(r.out, /place/);
    }
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
