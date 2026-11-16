// Whose dsh process a run names (graph @nks/nks-dev, #10777): after a restart the pid alone proves
// nothing — only the command line carrying this run's model overlay does. Another's process
// living on a reused pid gets no signal and is not taken for ours.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { dshExit, dshTerminate, exits } from "../bridge/orchestra-dsh-proc.ts";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function started(t, args) {
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  const exited = new Promise((done) => child.once("exit", (code, signal) => done(signal ?? code)));
  t.after(() => {
    if (alive(child.pid)) process.kill(child.pid, "SIGKILL");
  });
  return new Promise((done) => child.once("spawn", () => done({ pid: child.pid, exited })));
}

test("dsh proc: after a restart a live process on the run's pid with another command line is not ours — no signal", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-dsh-proc-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const model = join(dir, "op.model.yml");
  const other = await started(t, ["-e", "setInterval(() => {}, 1000)"]);
  exits.clear(); // a restarted daemon: no child of its own
  const run = { dsh: { pid: other.pid, events: join(dir, "op.events.ndjson"), model } };
  await dshTerminate(run, "no_seat");
  await new Promise((d) => setTimeout(d, 300));
  assert.equal(alive(other.pid), true, "another's process gets no signal");
  assert.equal(run.dsh.terminated, undefined);
  assert.equal(await dshExit(run), "unknown", "an unproven process is not ours");
});

test("dsh proc: after a restart the process whose command line carries the run's model overlay is ours — it gets the signal", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-dsh-proc-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const model = join(dir, "op.model.yml");
  const own = await started(t, ["-e", "setInterval(() => {}, 1000)", "--", "--patch", model]);
  exits.clear();
  const run = { dsh: { pid: own.pid, events: join(dir, "op.events.ndjson"), model } };
  assert.equal(await dshExit(run), undefined, "ours and alive");
  await dshTerminate(run, "no_seat");
  assert.equal(await own.exited, "SIGTERM");
  assert.equal(run.dsh.terminated, "no_seat");
});
