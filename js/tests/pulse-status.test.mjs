// status печатает последний pulse, отправленный сокетом места (граф nks-dev: #7529, #7495):
// в --json — полем pulse у места, в тексте — строкой pulse=… рядом с usage.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc, status } from "./status-kit.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("status prints the seat's last sent pulse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-pulse-"));
  const fake = await startFakeNks({ pat: "status-pat" });
  const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: { ...env, ISKRON_PULSE_GAP_MS: "300" },
    stdio: "ignore",
  });
  let link;
  try {
    (await entrance(dir)).close();
    const hello = helloFrame({
      build: "v7.9.0+test",
      path: BRIDGE,
      argv: [fake.mcpUrl, "--auth-dir", dir],
      patSha: patShaOf("status-pat"),
    });
    link = await connectSeam(seamSocketPath(dir), hello, 3000);
    const init = {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pi-iskron", version: "2.1" },
    };
    await rpc(link, "initialize", init, 1);
    const stand = { realm: "nks-dev", karta: 931, name: "pulse-place" };
    await rpc(link, "tools/call", { name: "iskron_stand", arguments: stand }, 2);
    await rpc(link, "iskron/pulse", { state: "busy" }, 3);
    for (let i = 0; i < 100 && fake.state.pulses.at(-1)?.frame.state !== "busy"; i++)
      await sleep(25);
    const sent = fake.state.pulses.at(-1)?.frame;
    assert.equal(sent?.state, "busy", JSON.stringify(fake.state.pulses));
    const place = JSON.parse(status(dir, ["--json"]).stdout).sessions[0].places[0];
    const { sent_at, ...pulse } = place.pulse ?? {};
    assert.deepEqual(pulse, (({ type: _t, ...rest }) => rest)(sent));
    assert.ok(!Number.isNaN(Date.parse(sent_at)), `sent_at: ${sent_at}`);
    assert.match(status(dir).stdout, /pulse=\{"state":"busy","pending":0/);
  } finally {
    link?.close();
    const exited = new Promise((r) => d.once("exit", r));
    d.kill("SIGKILL");
    await exited;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
