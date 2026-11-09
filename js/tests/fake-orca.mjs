// A substitute Orca CLI for the orchestrator's probes (graph @nks/nks-dev, node #9966): answers
// --version and agent-context --json as 1.4.242 declared them, and records every other argv as a
// JSON line in FAKE_ORCA_LOG instead of launching anything. FAKE_ORCA_VERSION, FAKE_ORCA_EXIT
// change the version and the launch's exit code. The real `orca agent launch` is never run.
import { appendFileSync } from "node:fs";

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
appendFileSync(process.env.FAKE_ORCA_LOG, JSON.stringify(args) + "\n");
const code = Number(process.env.FAKE_ORCA_EXIT ?? 0);
if (code === 0) process.stdout.write(JSON.stringify({ ok: true, agent: "fake" }) + "\n");
process.exit(code);
