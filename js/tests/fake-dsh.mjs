#!/usr/bin/env node
// A substitute `dsh` for the orchestrator's dsh probes (graph @nks/nks-dev, #10777): records its
// argv, cwd, the spawned-for environment and the model patch, then answers as dsh 0.2.2-rc.1
// headless --json does — a `session` event, later `final` — or refuses before any session.
// FAKE_DSH_LOG — the record file; FAKE_DSH_MODE — ok | fail | hang; FAKE_DSH_HOLD_MS — the
// time between session and final.
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const patches = argv.flatMap((a, i) => (argv[i - 1] === "--patch" ? [a] : []));
appendFileSync(
  process.env.FAKE_DSH_LOG,
  JSON.stringify({
    argv,
    cwd: process.cwd(),
    spawned_for: process.env.ISKRON_SPAWNED_FOR ?? null,
    orchestra: process.env.ISKRON_ORCHESTRA ?? null,
    model: patches[1] ? readFileSync(patches[1], "utf8") : null,
  }) + "\n",
);
const mode = process.env.FAKE_DSH_MODE || "ok";
if (mode === "fail") {
  process.stdout.write(JSON.stringify({ type: "error", message: "probe refusal" }) + "\n");
  process.exit(3);
}
const id = "session-0b6f1c2e-probe";
process.stdout.write(JSON.stringify({ type: "session", sessionId: id, cwd: process.cwd() }) + "\n");
if (mode === "hang") setInterval(() => {}, 1000);
else
  setTimeout(
    () => {
      process.stdout.write(
        JSON.stringify({
          type: "final",
          sessionId: id,
          reason: { kind: "completed" },
          text: "ok",
        }) + "\n",
      );
      process.exit(0);
    },
    Number(process.env.FAKE_DSH_HOLD_MS || 200),
  );
