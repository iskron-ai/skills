// Two location instances cutting the same session and stop generation (#9256).
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";

after(() => rmSync(SANDBOX, { recursive: true, force: true }));
const barrier = () => {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
};

for (const mode of ["refused", "unconfirmed"])
  test(`same-generation replacement waits for current archive ${mode}`, async () => {
    const sid = `cut-race-${mode}`;
    const calls = join(SANDBOX, `${sid}.calls`);
    const log = join(SANDBOX, `${sid}.log`);
    const events = join(SANDBOX, `${sid}.events`);
    for (const path of [calls, log, events]) writeFileSync(path, "");
    const env = {
      ISKRON_BRIDGE_PATH: new URL("./fake-bridge.mjs", import.meta.url).pathname,
      FB_CALLS: calls,
      FB_LOG: log,
      FB_EVENTS: events,
    };
    const app = { name: "opencode", version: "2.2.7" };
    const readback = barrier();
    const replacement = barrier();
    const A = await plugin(env, { app, sessions: [{ id: sid, time: {} }] });
    let B;
    let reading = false;
    const get = A.ctx.session.get;
    A.ctx.session.get = async (args) => {
      const info = await get(args);
      if (args.sessionID === sid && A.archives.length) {
        assert.ok(info.time?.archived, "first host really saved its archive");
        reading = true;
        await readback.promise;
      }
      return info;
    };
    const halted = () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s))
        .filter((c) => c.name === "iskron/halted");
    try {
      await until(() => A.tools().has("iskron_channel"), "first instance tools");
      await A.call("iskron_channel", { action: "list" }, sid);
      const pid = Number(readFileSync(log, "utf8").trim().split(/\s+/)[1]);
      appendFileSync(
        `${events}.${pid}`,
        JSON.stringify({ kind: "stopped", key: "k", text: "stop", order: sid }) + "\n",
      );
      await until(() => reading, "first archive held at readback");
      const gen = globalThis.__iskronStopIds.get(sid);
      assert.equal(typeof gen, "string", "the stopped session has a concrete generation");
      B = await plugin(env, {
        app,
        keepMarker: true,
        // A second location learns a lineage for the same id: its normal sweep then cuts the
        // already stopped session, without manufacturing a new stop/order generation.
        sessions: [{ id: sid, parentID: "parent", time: {} }],
        faults: {
          updateGate: replacement.promise,
          updateFails: mode === "refused",
          archiveNoop: mode === "unconfirmed",
        },
      });
      B.emit({ type: "session.created", data: { sessionID: sid, parentID: "parent" } });
      await until(() => B.archives.length === 1, "replacement archive held", 8000);
      assert.equal(globalThis.__iskronStopIds.get(sid), gen, "same stop, not a second order");
      assert.equal(B.interrupts.length, 1, "replacement interrupted the same session");
      assert.equal(B.interrupts[0].sessionID, sid);
      assert.deepEqual(B.archives[0], { sessionID: sid, archived: true });
      readback.open(); // The old host now sees !current(); this must not certify success.
      await delay(250); // Let the real fake-bridge transport carry any premature receipt.
      assert.deepEqual(halted(), [], "old host cannot answer while current archive is pending");
      replacement.open();
      await until(() => halted().length === 1, "current refusal reaches original waiter");
      assert.deepEqual(halted()[0].arguments, {
        order: sid,
        ok: false,
        code: `interrupt_confirmed_archive_${mode}`,
      });
      assert.equal(B.archives.length, 1, "superseded worker does not reclaim the same cut");
    } finally {
      readback.open();
      replacement.open();
      await B?.stop();
      await A.stop();
    }
  });
