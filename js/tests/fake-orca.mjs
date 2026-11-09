// A substitute Orca CLI for the orchestrator's probes (graph @nks/nks-dev, node #9966): answers
// --version and agent-context --json as 1.4.242 declared them, and records every other argv as a
// JSON line in FAKE_ORCA_LOG instead of launching anything. FAKE_ORCA_VERSION, FAKE_ORCA_EXIT,
// FAKE_ORCA_DELAY_MS change the version, the launch's exit code and how long it takes. The real `orca agent launch` is never run.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write(`${process.env.FAKE_ORCA_VERSION ?? "1.4.242"}\n`);
  process.exit(0);
}
if (args[0] === "agent-context") {
  const flags = ["agent", "worktree", "prompt", "model", "effort", "surface", "focus", "json"];
  process.stdout.write(JSON.stringify({ commands: [{ command: "agent launch", flags }] }) + "\n");
  process.exit(0);
}
// project list / setups — the form observed on 1.4.242 (case №4050 [8]); FAKE_ORCA_PROJECTS —
// a JSON file {projects: [...], setups: [...]} laid by the probe; none — empty lists.
if (args[0] === "project" && (args[1] === "list" || args[1] === "setups")) {
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
