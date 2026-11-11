// The local confirmation must not be enriched or treated as taking a seat (#10121).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { plugin, REAL_BRIDGE, SANDBOX, until } from "./opencode-kit.mjs";
import { setup } from "./ownseat-kit.mjs";

process.on("exit", () => rmSync(SANDBOX, { recursive: true, force: true }));

test("context confirmation: true is local to its held seat; false and absent keep ordinary enrichment", async (t) => {
  const { fake, dir, cwd } = await setup(t);
  fake.state.richTools = true;
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_AUTH_DIR: dir,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_stand",
      ISKRON_BRIDGE_DAEMON: "0",
      ISKRON_BRIDGE_NO_UPDATE: "1",
    },
    {
      location: { directory: cwd },
      sessions: [
        { id: "root", location: { directory: cwd } },
        {
          id: "child",
          parentID: "root",
          location: { directory: cwd },
          model: { id: "child-model" },
        },
        { id: "unseated", parentID: "root", location: { directory: cwd } },
      ],
    },
  );
  const stand = (input, s) => rec.call("iskron_stand", { realm: "nks-dev", ...input }, s);
  const write = (s) => rec.call("iskron_add_vimarsha", { realm: "nks-dev", name: "probe" }, s);
  const moves = () =>
    fake.state.placeArgs.filter((p) => ["connect", "register"].includes(p.action));
  try {
    await until(() => rec.tools().has("iskron_stand"), "stand tool");
    const empty = moves().length;
    await assert.rejects(stand({ context_restored: true }, "root"));
    assert.equal(moves().length, empty, "true without a held seat makes no connect/register");
    await stand({ karta: "931", name: "ordinary-root" }, "root");
    const held = () =>
      readdirSync(join(dir, "standings"))
        .filter((f) => f.endsWith(".hold"))
        .map((f) => JSON.parse(readFileSync(join(dir, "standings", f), "utf8")))
        .find((r) => r.name === "ordinary-root");
    assert.equal(held().cwd, cwd, "absent confirmation keeps cwd enrichment");
    await stand({ karta: "931", context_restored: false }, "child");
    let registered = moves()
      .filter((p) => p.action === "register")
      .at(-1);
    assert.equal(registered.model, "child-model", "false keeps harness model enrichment");
    assert.match(
      registered.attrs.satellite_of,
      /ordinary-root/,
      "false keeps satellite enrichment",
    );
    await stand({ karta: "931" }, "child");
    registered = moves()
      .filter((p) => p.action === "register")
      .at(-1);
    assert.equal(registered.model, "child-model", "absent confirmation keeps model enrichment");
    await stand({ karta: "931", name: "ordinary-root", context_restored: false }, "root");
    assert.equal(held().cwd, cwd, "false keeps cwd enrichment");
    const before = fake.state.counts.look ?? 0;
    for (const sessionID of ["root", "child"]) {
      rec.emit({
        type: "session.step.started",
        data: { sessionID, model: { id: "m1", providerID: "p" } },
      });
      for (const input of [100000, 10000])
        rec.emit({
          type: "session.step.ended",
          data: {
            sessionID,
            tokens: { input, cache: { read: 0, write: 0 } },
          },
        });
    }
    await until(() => fake.state.counts.look >= before + 2, "both seats gated");
    await assert.rejects(write("root"), /контекст сжат|context.*compact/i);
    await assert.rejects(write("child"), /контекст сжат|context.*compact/i);
    const writesBefore = moves().length;
    await assert.rejects(stand({ context_restored: true }, "unseated"));
    assert.equal(
      moves().length,
      writesBefore,
      "an unseated child takes no satellite just to confirm",
    );
    await stand({ context_restored: true }, "child");
    assert.equal(moves().length, writesBefore, "held satellite confirmation is local");
    await write("child");
    await assert.rejects(
      write("root"),
      /контекст сжат|context.*compact/i,
      "another seat stays gated",
    );
    await assert.rejects(
      stand({ context_restored: false }, "root"),
      /контекст сжат|context.*compact/i,
    );
    await stand({ context_restored: true }, "root");
    await write("root");
  } finally {
    await rec.stop();
    await until(() => fake.state.sessions.size === 0, "isolated bridges closed their MCP sessions");
  }
});
