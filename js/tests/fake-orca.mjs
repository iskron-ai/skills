// A substitute Orca CLI for the orchestrator's probes (graph @nks/nks-dev, node #9966): answers
// --version and agent-context --json as 1.4.242 declared them, and records every other argv as a
// JSON line in FAKE_ORCA_LOG instead of launching anything. FAKE_ORCA_VERSION, FAKE_ORCA_EXIT,
// FAKE_ORCA_DELAY_MS change the version, the launch's exit code and how long it takes. The real `orca agent launch` is never run.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { initCheckout } from "./git-checkout.mjs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(`${process.env.FAKE_ORCA_VERSION ?? "1.4.242"}\n`);
  process.exit(Number(process.env.FAKE_ORCA_VERSION_EXIT ?? 0));
}
if (args[0] === "agent-context") {
  // FAKE_ORCA_CONTEXT_DELAY_MS: the schema answers this much later — a tact slow before a clone.
  const slow = Number(process.env.FAKE_ORCA_CONTEXT_DELAY_MS ?? 0);
  if (slow) await new Promise((r) => setTimeout(r, slow));
  const flags = process.env.FAKE_ORCA_LAUNCH_FLAGS?.split(",") ?? [
    "agent",
    "worktree",
    "prompt",
    "model",
    "effort",
    "surface",
    "focus",
    "json",
  ];
  // setup-clone's flags as 1.4.242 declares them; FAKE_ORCA_CLONE_FLAGS — another list.
  const clone = process.env.FAKE_ORCA_CLONE_FLAGS?.split(",") ?? [
    "help",
    "json",
    "pairing-code",
    "environment",
    "project",
    "host",
    "url",
    "destination",
    "display-name",
  ];
  const commands = [{ command: "agent launch", flags }];
  if (process.env.FAKE_ORCA_NO_CLONE !== "1")
    commands.push({ command: "project setup-clone", flags: clone });
  process.stdout.write(JSON.stringify({ commands }) + "\n");
  process.exit(0);
}
// project setup-clone in the forms 1.4.242 answered (case №4221): recorded; a missing --project,
// --host, --url or --destination — invalid_argument before any clone; --destination is the
// parent, the clone lands in <destination>/<repo of the url>, taken — refused; a --project other
// than the id Orca derives from the url (github.com lower case, else git:<host>/<path>) — refused
// after the clone, the folder left unregistered. FAKE_ORCA_CLONE_EXIT fails it with a secret on
// both outputs; else FAKE_ORCA_CLONE_COVER is the clone's AGENTS.md and — unless
// FAKE_ORCA_CLONE_UNREGISTERED=1 — a ready local setup at the path as given joins the laid
// projects. FAKE_ORCA_CLONE_DELAY_MS — it answers this much later; FAKE_ORCA_CLONE_HANG=1 — it
// never answers; FAKE_ORCA_CLONE_NOISE=1 — it prints more than any buffer would hold;
// FAKE_ORCA_CLONE_HEIR=<file> — a child of it holds its stdout a minute, its pid in <file>.
// FAKE_ORCA_CLONE_RUNTIME_TIMEOUT=<file> — the client's pairing wait runs out (case №4221): it
// answers runtime_timeout with exit 1 at once, and Orca's runtime — a detached copy of this
// fake — finishes the clone once the probe removes <file>; "never" — it never finishes it.
// A refusal as 1.4.242 prints it (#9966): indented JSON on stdout, stderr empty, exit 1.
// FAKE_ORCA_CLONE_BANNER=1 — a line that is no JSON comes before the answer on stdout.
const refuse = (code, message) => {
  const answer = { id: "local", ok: false, error: { code, message }, _meta: { runtimeId: null } };
  if (process.env.FAKE_ORCA_CLONE_BANNER === "1") process.stdout.write("warning: a newer Orca\n");
  process.stdout.write(JSON.stringify(answer, null, 2) + "\n");
  process.exit(1);
};
if (args[0] === "project" && args[1] === "setup-clone") {
  const inRuntime = process.env.FAKE_ORCA_IN_RUNTIME === "1";
  if (!inRuntime) appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(args) + "\n");
  const late = process.env.FAKE_ORCA_CLONE_RUNTIME_TIMEOUT;
  if (late && inRuntime) while (existsSync(late)) await new Promise((r) => setTimeout(r, 50));
  if (late && !inRuntime) {
    if (late !== "never")
      spawn(process.execPath, [process.argv[1], ...args], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, FAKE_ORCA_IN_RUNTIME: "1" },
      }).unref();
    refuse("runtime_timeout", "Timed out waiting for the Orca runtime.");
  }
  const flag = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : "");
  for (const f of ["project", "host", "url", "destination"])
    if (!flag(f)) refuse("invalid_argument", `Missing required --${f}`);
  const heir = process.env.FAKE_ORCA_CLONE_HEIR;
  if (heir) {
    // FAKE_ORCA_CLONE_HEIR_WRITES=1: three seconds on the heir writes to the held stdout a while,
    // then marks <file>.alive — a write the reader refused (EPIPE) kills it first.
    const writes =
      "setTimeout(() => { const t = setInterval(() => process.stdout.write('x\\n'), 50);" +
      " setTimeout(() => { clearInterval(t); require('fs').writeFileSync(process.argv[1] + '.alive', ''); }, 2000); }, 3000);";
    const script = `${process.env.FAKE_ORCA_CLONE_HEIR_WRITES === "1" ? writes : ""} setTimeout(() => {}, 60_000);`;
    const child = spawn(process.execPath, ["-e", script, heir], {
      detached: true,
      stdio: ["ignore", "inherit", "ignore"],
    });
    writeFileSync(heir, String(child.pid));
    child.unref();
  }
  if (process.env.FAKE_ORCA_CLONE_HANG === "1") await new Promise((r) => setTimeout(r, 120_000));
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
  const url = flag("url");
  const [host, ...path] = url
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\.git$/, "")
    .split("/");
  const bare = host.replace(/:\d+$/, "");
  const id =
    bare === "github.com"
      ? `github:${path.join("/")}`.toLowerCase()
      : `git:${bare}/${path.join("/")}`;
  const dest = join(flag("destination"), path.at(-1));
  if (existsSync(dest) && readdirSync(dest).length)
    refuse("runtime_error", `Clone failed: Destination already exists and is not empty: ${dest}.`);
  mkdirSync(dest, { recursive: true });
  if (process.env.FAKE_ORCA_CLONE_COVER)
    writeFileSync(join(dest, "AGENTS.md"), process.env.FAKE_ORCA_CLONE_COVER);
  if (process.env.FAKE_ORCA_CLONE_COVER) initCheckout(dest);
  if (flag("project") !== id)
    refuse(
      "runtime_error",
      `Imported folder resolves to project "${id}", not the selected project "${flag("project")}".`,
    );
  const lay = process.env.FAKE_ORCA_PROJECTS;
  if (lay && process.env.FAKE_ORCA_CLONE_UNREGISTERED !== "1") {
    const all = existsSync(lay) ? JSON.parse(readFileSync(lay, "utf8")) : {};
    (all.projects ??= []).push({ id, gitRemoteIdentity: { remoteUrl: url } });
    (all.setups ??= []).push({
      projectId: id,
      path: dest,
      setupState: "ready",
      hostId: "local",
      setupMethod: "cloned",
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
// A clone registered at a path git does not name (a symlink, another case) is no worktree to
// agent launch on 1.4.242 (case №4221): selector_not_found.
if (args[0] === "agent" && args.includes("--worktree")) {
  const at = args[args.indexOf("--worktree") + 1].replace(/^path:/, "");
  const lay = process.env.FAKE_ORCA_PROJECTS;
  const all = lay && existsSync(lay) ? JSON.parse(readFileSync(lay, "utf8")) : {};
  const cloned = (all.setups ?? []).some((s) => s.setupMethod === "cloned" && s.path === at);
  if (cloned && realpathSync.native(at) !== at) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: { code: "selector_not_found" } }) + "\n",
    );
    process.exit(1);
  }
}
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
if (args[0] === "terminal" && args[1] === "wait") {
  const hold = process.env.FAKE_ORCA_WAIT_HOLD;
  while (hold && existsSync(hold)) await new Promise((r) => setTimeout(r, 20));
}
const answer = {
  ok: true,
  result:
    args[0] === "agent"
      ? { outcome: handle ? { kind: "terminal", handle } : { kind: "chat" } }
      : args[1] === "show"
        ? {
            terminal: {
              handle: args[3],
              incarnationId:
                process.env.FAKE_ORCA_EXIT_INCARNATION &&
                readFileSync(process.env.FAKE_ORCA_LOG, "utf8").includes('"wait"')
                  ? process.env.FAKE_ORCA_EXIT_INCARNATION
                  : "inc_fake",
              connected: false,
              writable: false,
              executionHostId: "local",
              worktreePath: (() => {
                const log = readFileSync(process.env.FAKE_ORCA_LOG, "utf8")
                  .trim()
                  .split("\n")
                  .map(JSON.parse);
                const launch = log.findLast((a) => a[0] === "agent" && a.includes("--worktree"));
                return launch?.[launch.indexOf("--worktree") + 1]?.replace(/^path:/, "");
              })(),
            },
          }
        : args[1] === "close"
          ? { close: { handle: args[3], ptyKilled: true } }
          : args[1] === "wait"
            ? {
                wait: {
                  handle: args[3],
                  condition: "exit",
                  satisfied: process.env.FAKE_ORCA_WAIT_EXIT !== "0",
                  status: process.env.FAKE_ORCA_WAIT_EXIT === "0" ? "running" : "exited",
                },
              }
            : {},
  ...(runtime ? { _meta: { runtimeId: runtime } } : {}),
};
if (code === 0) process.stdout.write(JSON.stringify(answer) + "\n");
process.exit(code);
