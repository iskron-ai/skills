// The plugin's resume waits out the bridge's whole 429 rate_limited wait (graph @nks/nks-dev,
// node #10801): a return whose register waits a lawful Retry-After of 35 s answers after the
// old 30 s cap, and the plugin takes the answer instead of cutting the return off.
//
// The clock is the probe's: in this file's process every timer of 25 s and longer runs ten
// times faster (the answer caps — 30 s before, the bridge's wait + 15 s now), and the fake
// bridge answers the return after 35 s on the same clock. The whole probe stays under 10 s.
//
// ISKRON_OPENCODE_PLUGIN points the probe at any copy of the plugin (red before the fix).
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { plugin, SANDBOX, until } from "./opencode-kit.mjs";

const FAST = 10;
const LONG_MS = 25_000;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) =>
  realSetTimeout(fn, Number(ms) >= LONG_MS ? Number(ms) / FAST : ms, ...rest);

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const RETRY_AFTER_MS = 35_000;

test("a return answered after a 35 s Retry-After wait is taken, not cut off by the plugin's cap", async () => {
  const resume = join(SANDBOX, "resume-wait.answer");
  const log = join(SANDBOX, "resume-wait.log");
  writeFileSync(
    resume,
    JSON.stringify({
      resumed: true,
      key: "k--931--nks-dev",
      pending: 0,
      word: "возврат места с диска",
    }),
  );
  writeFileSync(log, "");
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
      FB_LOG: log,
      FB_RESUME: resume,
      FB_RESUME_DELAY_MS: RETRY_AFTER_MS / FAST,
    },
    { sessions: [{ id: "s-wait", location: { directory: "/work/of/the-wait" } }] },
  );
  try {
    await until(() => rec.tools().has("iskron_orient"), "the server's tools", 8000);
    const started = Date.now();
    await rec.call("iskron_orient", {}, "s-wait"); // the call waits for the return
    assert.doesNotMatch(rec.said(), /возврат места сессии s-wait не удался/, rec.said());
    assert.ok(Date.now() - started >= RETRY_AFTER_MS / FAST - 200, "the return answered late");
    assert.match(rec.said(), /сессия s-wait — возврат места с диска/, rec.said());
  } finally {
    await rec.stop();
  }
});
