// Real local Git fixture; no network or source outside the probe's own directory.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function initCheckout(path) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: path,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (!existsSync(join(path, ".git"))) git("init", "-b", "main");
  if (!existsSync(join(path, ".gitignore")))
    writeFileSync(join(path, ".gitignore"), ".worktrees/\n");
  git("add", "AGENTS.md", ".gitignore");
  git(
    "-c",
    "user.name=probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
}
