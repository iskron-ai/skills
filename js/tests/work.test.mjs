// Проба точки «последняя работа агента» (bridge/work.ts, хартбит места #6510):
// её двигает только вызов тула агентом — не служебные ходы плагина и
// расширения (iskron/check, iskron/usage, строка запуска с id iskron-service-*)
// и не ходы самого моста (переигранное рукопожатие, возврат места). Сессия
// движка — в процессе пробы, из исходника (как tests/fake-daemon.mjs).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { parseArgs, setConfig } from "../bridge/config.ts";
import { openSession } from "../bridge/session.ts";
import { startFakeNks } from "./fake-nks.mjs";

const PAT = "nks_pat_work";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("last agent work moves on the agent's tool calls only — not on service moves of the plugin, the extension or the bridge", async () => {
  process.env.ISKRON_BRIDGE_TOKEN = PAT;
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-work-"));
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  try {
    setConfig(parseArgs([fake.mcpUrl, "--no-browser", "--auth-dir", dir]));
    const s = openSession({ input, output });
    const init = {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "opencode-iskron", version: "0" },
    };
    const orient = { name: "iskron_orient", arguments: {} };
    const steps = [
      [false, "initialize", { id: 1, method: "initialize", params: init }],
      [false, "tools/list", { id: 2, method: "tools/list", params: {} }],
      [
        false,
        "iskron/check",
        { id: 3, method: "iskron/check", params: { key: "x--931--nks-dev" } },
      ],
      [false, "iskron/usage", { id: 4, method: "iskron/usage", params: { tokens: 1 } }],
      [
        false,
        "initialize replayed by the thin bridge",
        { id: "iskron-thin-replay-1", method: "initialize", params: init },
      ],
      [
        false,
        "launch-line tool call",
        { id: "iskron-service-5", method: "tools/call", params: orient },
      ],
      [true, "the agent's tool call", { id: 6, method: "tools/call", params: orient }],
    ];
    let prev = s.lastWork();
    assert.equal(prev, 0, "no work before any call");
    for (const [moves, label, msg] of steps) {
      await sleep(5);
      input.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
      await sleep(250);
      const now = s.lastWork();
      assert.equal(now !== prev, moves, `${label}: ${moves ? "must" : "must not"} move last work`);
      prev = now;
    }
    input.end();
    await Promise.race([s.ended, sleep(3000)]);
  } finally {
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
