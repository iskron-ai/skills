// Re-run the original archived observer and assertions against the repaired kit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const root = join(out, "../../..");
const scratch = mkdtempSync(join(tmpdir(), "ru29-kit-"));
const records = [];
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const head = git("rev-parse", "HEAD");
try {
  const unpack = spawnSync("tar", ["-xzf", "fixtures/reviews/mind-1236/ru29-lifecycle-traces.tar.gz", "-C", scratch, "mind-sibling-trace.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(unpack.status, 0, unpack.stderr);
  const loader = join(scratch, "mind-sibling-trace.mjs");
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const carriers = {
    loader: digest(loader),
    bridge: digest(join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs")),
    plugin: digest(join(root, "dist/dev/skills/establish-mcp/scripts/opencode-plugin.js")),
  };
  for (const [name, flags] of [["original", {}], ["delay600", { MIND_INTERRUPT_DELAY: "600" }]]) {
    const args = ["--test", "--test-reporter=tap", "--test-name-pattern=put out by close 4001 revoked:silent", "js/tests/opencode-siblings.test.mjs"];
    const env = { ...process.env, TMPDIR: scratch, ISKRON_BRIDGE_NO_UPDATE: "1", NODE_OPTIONS: `--import=${loader}`, ...flags };
    delete env.MIND_UNIQUE_SESSIONS;
    delete env.MIND_REUSE_PLACE;
    delete env.MIND_TAKE_PLACE;
    const run = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 120000 });
    writeFileSync(join(out, `${name}.stdout`), run.stdout || "");
    writeFileSync(join(out, `${name}.stderr`), run.stderr || "");
    const record = { name, head, node: process.version, args, flags, carriers, exit: run.status };
    records.push(record);
    assert.equal(run.status, 0, `${name}: original test assertions`);
    // Node's TAP reporter doubles backslashes in diagnostic stdout lines.
    const events = [...run.stdout.matchAll(/SIBLING_TRACE (\{[^\n]+\})/g)]
      .map(m => JSON.parse(m[1].replaceAll("\\\\", "\\")));
    const contexts = new Map();
    let current;
    for (const event of events) {
      if (event.event === "context-created") {
        current = { instance: event.traceInstance, interrupts: [], stop: null, cleanup: null };
        contexts.set(event.traceInstance, current);
      }
      if (event.event === "put-start") current.stop = event.at;
      if (event.event === "cleanup-end") current.cleanup = event.at;
      if (event.event === "interrupt-call") contexts.get(event.traceInstance).interrupts.push(event.at);
    }
    assert.equal(contexts.size, 2, "both original variants ran in the same process");
    for (const context of contexts.values()) {
      assert.equal(context.interrupts.length, 1, "exactly one interrupt per original variant");
      assert.ok(context.stop !== null && context.cleanup !== null);
      assert.ok(context.interrupts[0] >= context.stop, "no interrupt before this variant's stop");
      assert.ok(context.interrupts[0] <= context.cleanup, "no observed call after recorder cleanup");
    }
    record.observed = [...contexts.values()];
  }
  console.log("PASS: original and delay600 pairs; original session IDs, one interrupt each, none before own stop or observed after cleanup.");
} finally {
  writeFileSync(join(out, "commands.json"), JSON.stringify(records, null, 2) + "\n");
  rmSync(scratch, { recursive: true, force: true });
}
