#!/usr/bin/env node
// The test runner of every `make test*` target (graph @nks/nks-dev, #4057): the
// suites spawn real bridges and daemons, and one that loses its sandbox must not
// reach the human of this machine.
//   (a) the browser: `open` and `xdg-open` stand first on PATH as blockers that
//       only record the call; a probe that wants a browser puts its own fake
//       before them, so any record left here is a leak and fails the run;
//   (b) leaked daemons: after the run, a dev daemon of this tree (dist/dev) whose
//       parent is gone and whose auth dir lies under the temp dir is stopped by
//       SIGTERM — never the home daemon, never another tree's.
//
//   node scripts/run-tests.mjs <node --test arguments…>
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEV = join(ROOT, "dist", "dev") + "/";
const TMP = [tmpdir(), realpathSync(tmpdir())];

const shim = mkdtempSync(join(tmpdir(), "iskron-no-browser-"));
const record = join(shim, "opened.txt");
for (const name of ["open", "xdg-open"]) {
  const file = join(shim, name);
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${record}"\n`);
  chmodSync(file, 0o755);
}

const run = spawnSync(process.execPath, ["--test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", PATH: `${shim}:${process.env.PATH}` },
});

function leakedDaemons() {
  if (process.platform === "win32") return [];
  const out = execFileSync("ps", ["-axww", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m) => m && m[2] === "1" && m[3].includes(DEV) && / daemon( |$)/.test(m[3]))
    .filter((m) => {
      const dir = m[3].match(/--auth-dir\s+(\S+)/)?.[1];
      return dir && TMP.some((t) => dir.startsWith(t));
    })
    .map((m) => Number(m[1]));
}

const reaped = leakedDaemons();
for (const pid of reaped) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
if (reaped.length)
  console.error(`run-tests: stopped ${reaped.length} leaked dev daemon(s): ${reaped.join(" ")}`);

let opened = "";
try {
  opened = readFileSync(record, "utf8").trim();
} catch {
  /* nothing tried to open a browser */
}
rmSync(shim, { recursive: true, force: true });
if (opened) {
  console.error(`run-tests: a bridge under test tried to open the real browser:\n${opened}`);
  process.exit(1);
}
process.exit(run.status ?? 1);
