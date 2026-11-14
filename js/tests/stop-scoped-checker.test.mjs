// Offline checker fixtures only: no native client, model, Orca or destructive signal.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO } from "./built.mjs";

for (const outcome of ["stopped", "failed", "unknown", "missing"]) {
  test(`scoped checker correlates exact target order: ${outcome}`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "stop-checker-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const acks = [
      { id: "foreign", state: "accepted" },
      { id: "foreign", state: "stopped" },
      ...(outcome === "missing"
        ? []
        : [
            { id: "target", state: "accepted" },
            { id: "target", state: outcome },
          ]),
    ];
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/status"
            ? {
                clients: [{ label: "axis3-stop", id: "session-own", exit: { code: 143 } }],
                serveAlive: true,
                holds: [],
                acks,
              }
            : {
                state: { time: { archived: 123 } },
                history: [{ type: "user", text: "LOCAL4532 axis3-stop reply OK" }],
              },
        ),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value));
    save("control.json", { url: `http://127.0.0.1:${server.address().port}` });
    save("freeze.json", {});
    save("axis3-stop-argv.json", ["opencode", "--session", "session-own"]);
    writeFileSync(join(dir, "axis3-stop.stderr.raw"), "OWN_TUI_PID=2147483647");
    writeFileSync(join(dir, "neighbour.stderr.raw"), `OWN_TUI_PID=${process.pid}`);
    const child = spawn(
      process.execPath,
      [join(REPO, "scripts/check-stop-scoped.mjs"), dir, "target"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (c) => (stderr += c));
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, outcome === "stopped" ? 0 : 1, stderr);
    const result = JSON.parse(readFileSync(join(dir, "scoped3-evidence.json"), "utf8"));
    const ack = result.checks.find((c) => c.name === "successful terminal ack follows accepted");
    assert.equal(ack.ok, outcome === "stopped");
    assert.ok(
      result.checks.filter((c) => c !== ack).every((c) => c.ok),
      "other criteria stay intact",
    );
  });
}
