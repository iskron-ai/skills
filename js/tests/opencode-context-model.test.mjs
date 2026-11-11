// #10121: same id/window is not the same observed model across providers.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { plugin, REAL_BRIDGE, SANDBOX, until } from "./opencode-kit.mjs";
import { setup } from "./ownseat-kit.mjs";

process.on("exit", () => rmSync(SANDBOX, { recursive: true, force: true }));

test("context gate: OpenCode compares provider and model id, never an unknown identity", async (t) => {
  const { fake, cwd } = await setup(t);
  fake.state.richTools = true;
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_stand",
      ISKRON_BRIDGE_DAEMON: "0",
      ISKRON_BRIDGE_NO_UPDATE: "1",
    },
    { location: { directory: cwd }, sessions: [{ id: "s", location: { directory: cwd } }] },
  );
  try {
    await until(() => rec.tools().has("iskron_stand"), "stand tool");
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "931", name: "model-probe" }, "s");
    rec.ctx.model.list = async () =>
      ["provider-a", "provider-b"].map((providerID) => ({
        providerID,
        id: "same-id",
        limit: { context: 200000 },
      }));
    const start = (model) =>
      rec.emit({
        type: "session.step.started",
        data: { sessionID: "s", model },
      });
    const end = async (input) => {
      let observed = false;
      rec.emit({
        type: "session.step.ended",
        data: {
          sessionID: "s",
          tokens: {
            get input() {
              observed = true;
              return input;
            },
            cache: { read: 0, write: 0 },
          },
        },
      });
      // The hook queue is asynchronous. Wait until usage consumed the event;
      // only then may a call promise to await its ordered fill queue.
      await until(() => observed, "usage consumed this step's token sample");
    };
    const write = () => rec.call("iskron_add_vimarsha", { realm: "nks-dev", name: "probe" }, "s");
    start({ providerID: "provider-a", id: "same-id" });
    await end(160000);
    await write(); // the ordered fill queue must reach the real bridge
    start({ providerID: "provider-b", id: "same-id" });
    await end(30000);
    await write(); // same id/window, different provider: no pending
    await end(10000);
    await assert.rejects(
      write(),
      /контекст сжат|context.*compact/i,
      "the same full model with a falling context does create pending",
    );
    await rec.call("iskron_stand", { realm: "nks-dev", context_restored: true }, "s");
    await end(160000);
    await write();
    start({ id: "same-id" }); // provider is unknown, not the last known provider
    await end(30000);
    await write();
    start(undefined); // missing model must not preserve the preceding identity
    await end(10000);
    await write();
  } finally {
    await rec.stop();
    await until(() => fake.state.sessions.size === 0, "isolated bridge closed its MCP session");
  }
});
