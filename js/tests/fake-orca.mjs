// A substitute Orca CLI for the orchestrator's probes (graph @nks/nks-dev, node #9966): answers
// --version and agent-context --json as 1.4.242 declared them, and records every other argv as a
// JSON line in FAKE_ORCA_LOG instead of launching anything. FAKE_ORCA_VERSION, FAKE_ORCA_EXIT,
// FAKE_ORCA_DELAY_MS change the version, the launch's exit code and how long it takes. The real `orca agent launch` is never run.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(`${process.env.FAKE_ORCA_VERSION ?? "1.4.242"}\n`);
  process.exit(0);
}
if (args[0] === "agent-context") {
  // FAKE_ORCA_CONTEXT_DELAY_MS: the schema answers this much later — a tact slow before a clone.
  const slow = Number(process.env.FAKE_ORCA_CONTEXT_DELAY_MS ?? 0);
  if (slow) await new Promise((r) => setTimeout(r, slow));
  const flags = ["agent", "worktree", "prompt", "model", "effort", "surface", "focus", "json"];
  const clone = ["url", "destination", "project", "host", "display-name"];
  const commands = [{ command: "agent launch", flags }];
  if (process.env.FAKE_ORCA_NO_CLONE !== "1")
    commands.push({ command: "project setup-clone", flags: clone });
  process.stdout.write(JSON.stringify({ commands }) + "\n");
  process.exit(0);
}
// project setup-clone (declared by agent-context 1.4.242, #9966; its answer unobserved): recorded,
// then FAKE_ORCA_CLONE_EXIT fails it with a secret on both outputs; else the destination is made,
// FAKE_ORCA_CLONE_COVER is its AGENTS.md, and — unless FAKE_ORCA_CLONE_UNREGISTERED=1 — a ready
// local setup of the url joins the laid projects. Its git environment lies in FAKE_ORCA_LOG.env;
// FAKE_ORCA_CLONE_DELAY_MS — it answers this much later; FAKE_ORCA_CLONE_HANG=1 — it starts a
// child of its own (its pid in FAKE_ORCA_LOG.child) and never answers, as a git stuck on the
// network; FAKE_ORCA_CLONE_NOISE=1 — it prints more than any buffer would hold, then succeeds.
if (args[0] === "project" && args[1] === "setup-clone") {
  appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(args) + "\n");
  const { GIT_TERMINAL_PROMPT, GCM_INTERACTIVE } = process.env;
  writeFileSync(
    `${process.env.FAKE_ORCA_LOG}.env`,
    JSON.stringify({ GIT_TERMINAL_PROMPT, GCM_INTERACTIVE }),
  );
  if (process.env.FAKE_ORCA_CLONE_HANG === "1") {
    const git = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], {
      stdio: "ignore",
    });
    writeFileSync(`${process.env.FAKE_ORCA_LOG}.child`, String(git.pid));
    await new Promise((r) => setTimeout(r, 120_000));
  }
  const wait = Number(process.env.FAKE_ORCA_CLONE_DELAY_MS ?? 0);
  if (wait) await new Promise((r) => setTimeout(r, wait));
  if (process.env.FAKE_ORCA_CLONE_NOISE === "1")
    for (let i = 0; i < 6; i++) process.stdout.write("x".repeat(1024 * 1024));
  const fail = Number(process.env.FAKE_ORCA_CLONE_EXIT ?? 0);
  if (fail) {
    process.stdout.write("fatal: https://user:SECRET-TOKEN@host failed\n");
    process.stderr.write("fatal: SECRET-TOKEN\n");
    process.exit(fail);
  }
  const url = args[args.indexOf("--url") + 1];
  const dest = args[args.indexOf("--destination") + 1];
  mkdirSync(dest, { recursive: true });
  if (process.env.FAKE_ORCA_CLONE_COVER)
    writeFileSync(join(dest, "AGENTS.md"), process.env.FAKE_ORCA_CLONE_COVER);
  const lay = process.env.FAKE_ORCA_PROJECTS;
  if (lay && process.env.FAKE_ORCA_CLONE_UNREGISTERED !== "1") {
    const all = existsSync(lay) ? JSON.parse(readFileSync(lay, "utf8")) : {};
    (all.projects ??= []).push({ id: "p-clone", gitRemoteIdentity: { remoteUrl: url } });
    (all.setups ??= []).push({
      projectId: "p-clone",
      path: dest,
      setupState: "ready",
      hostId: "local",
    });
    writeFileSync(lay, JSON.stringify(all));
  }
  writeFileSync(`${process.env.FAKE_ORCA_LOG}.cloned`, "");
  process.stdout.write(JSON.stringify({ ok: true, result: {} }) + "\n");
  process.exit(0);
}
// project list / setups — the form observed on 1.4.242 (case №4050 [8]); FAKE_ORCA_PROJECTS —
// a JSON file {projects: [...], setups: [...]} laid by the probe; none — empty lists.
// FAKE_ORCA_FAIL_AFTER_CLONE=N — the N-th read (list and setups) after a clone fails once (exit 5).
if (args[0] === "project" && (args[1] === "list" || args[1] === "setups")) {
  const cloned = `${process.env.FAKE_ORCA_LOG}.cloned`;
  const nth = Number(process.env.FAKE_ORCA_FAIL_AFTER_CLONE ?? 0);
  if (nth && existsSync(cloned)) {
    const seen = Number(readFileSync(cloned, "utf8") || 0);
    if (args[1] === "setups")
      if (seen + 1 === nth) unlinkSync(cloned);
      else writeFileSync(cloned, String(seen + 1));
    if (seen + 1 === nth) process.exit(5);
  }
  const lay = process.env.FAKE_ORCA_PROJECTS;
  const all = lay && existsSync(lay) ? JSON.parse(readFileSync(lay, "utf8")) : {};
  const result =
    args[1] === "list" ? { projects: all.projects ?? [] } : { setups: all.setups ?? [] };
  process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
  process.exit(0);
}
appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(args) + "\n");
// FAKE_ORCA_DELAY_MS: the launch is recorded at once and answers this much later.
const delay = Number(process.env.FAKE_ORCA_DELAY_MS ?? 0);
if (delay) await new Promise((r) => setTimeout(r, delay));
// FAKE_ORCA_HOLD: a file — the launch answers only once the probe removes it.
const hold = process.env.FAKE_ORCA_HOLD;
while (hold && existsSync(hold)) await new Promise((r) => setTimeout(r, 20));
const code = Number(process.env.FAKE_ORCA_EXIT ?? 0);
// The launch answer's form by agent-context 1.4.242 (outcome.kind, outcome.handle), not an
// observed launch; FAKE_ORCA_HANDLE="" — an answer without a handle. terminal show and close
// answer ok. Every answer carries _meta.runtimeId as 1.4.242 did (№4050 [74]): the content of
// FAKE_ORCA_RUNTIME_FILE (a restarted Orca), else rt_fake; "" in the file — no _meta.
const handle = process.env.FAKE_ORCA_HANDLE ?? "term_fake";
const rtFile = process.env.FAKE_ORCA_RUNTIME_FILE;
const runtime = rtFile && existsSync(rtFile) ? readFileSync(rtFile, "utf8").trim() : "rt_fake";
const answer = {
  ok: true,
  result:
    args[0] === "agent"
      ? { outcome: handle ? { kind: "terminal", handle } : { kind: "chat" } }
      : args[1] === "show"
        ? { terminal: { handle: args[3] } }
        : {},
  ...(runtime ? { _meta: { runtimeId: runtime } } : {}),
};
if (code === 0) process.stdout.write(JSON.stringify(answer) + "\n");
process.exit(code);
