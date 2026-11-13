import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeRuns } from "../bridge/orchestra-runs.ts";

export const command = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "own-tree-"))),
    source = join(root, "source"),
    auth = join(root, "auth");
  mkdirSync(source);
  mkdirSync(auth, { mode: 0o700 });
  command(source, "init", "-b", "main");
  writeFileSync(join(source, ".gitignore"), ".worktrees/\nignored\n");
  writeFileSync(join(source, "AGENTS.md"), "probe\n");
  command(source, "add", ".");
  command(
    source,
    "-c",
    "user.name=probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "-m",
    "base",
  );
  const base = command(source, "rev-parse", "HEAD");
  command(source, "update-ref", "refs/remotes/origin/main", base);
  const row = {
    realm: "@probe/own",
    room: "room",
    invite: 1,
    state: "preparing",
    at: "generation",
    worktree: source,
  };
  const runs = { own: row };
  writeRuns(auth, runs);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, source, auth, runs, row, base };
}
export function stopped(f) {
  f.row.state = "ended";
  f.row.stop_outcome = "stopped";
  f.row.closed = "client_exited";
  f.row.tree.exit = "observed-exit";
  writeRuns(f.auth, f.runs);
}
