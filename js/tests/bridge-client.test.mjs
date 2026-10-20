// The stdio client of pi and OpenCode (shared/bridge-client.ts): a write into a bridge that
// has already shut its stdin is refused through the call, not thrown as EPIPE past it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Bridge } from "../shared/bridge-client.ts";

test("a bridge that closed its stdin: requests are refused, no EPIPE escapes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-client-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "quit.mjs");
  writeFileSync(bin, "process.stdin.destroy(); setTimeout(() => process.exit(0), 300);\n");
  const escaped = [];
  const onUncaught = (e) => escaped.push(e);
  process.on("uncaughtException", onUncaught);
  t.after(() => process.off("uncaughtException", onUncaught));
  const b = new Bridge(bin, () => {});
  b.start();
  t.after(() => b.stop());
  const calls = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5));
    calls.push(
      b.request("x", { pad: "y".repeat(70_000) }, { timeoutMs: 1000 }).then(
        () => "answered",
        () => "refused",
      ),
    );
  }
  assert.deepEqual(new Set(await Promise.all(calls)), new Set(["refused"]));
  assert.deepEqual(
    escaped.map((e) => e.code),
    [],
  );
});
