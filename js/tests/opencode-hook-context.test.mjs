// The built plugin must not persist its own words as the human's prompt
// (graph @nks/nks-dev, #9341; OpenCode 2.2.5 surface #9867).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHalts } from "../opencode/halts.ts";
import { createEnds } from "../opencode/leadends.ts";
import { delay, plugin, SANDBOX } from "./opencode-kit.mjs";

const env = {
  ISKRON_BRIDGE_PATH: fileURLToPath(new URL("./fake-bridge.mjs", import.meta.url)),
  FB_TOOLS: JSON.stringify([{ name: "iskron_stand", inputSchema: { type: "object" } }]),
};

const checkpoint = (keepID, id = "checkpoint-new") => ({
  role: "user",
  id,
  metadata: { keepID, recent: "[User]: start r5 931 дело №77" },
  content: [
    {
      type: "text",
      text: "<conversation-checkpoint>\n<summary>probe</summary>\n</conversation-checkpoint>",
    },
  ],
});
const queuedLaunch = async (rec, id = "admitted-command", session = "child") => {
  const input = "start r5 931 дело №77";
  assert.equal(await rec.promptRaw(session, input, { messageID: id }), input);
};
const launchWord = /не встал|not seated/;

test("real compaction checkpoint aliases a pending id once, without consuming it at compaction", async () => {
  const rec = await plugin(env, { sessions: [{ id: "root" }, { id: "child", parentID: "root" }] });
  try {
    await queuedLaunch(rec);
    const cp = checkpoint("admitted-command");
    const before = JSON.stringify(cp);
    assert.equal(await rec.context("child", "context", [cp]), "", "early checkpoint has no grant");
    assert.equal(
      await rec.context("child", "compaction", []),
      "",
      "compaction leaves the queue untouched",
    );
    assert.match(await rec.context("child", "context", [cp]), launchWord);
    assert.equal(await rec.context("child", "context", [cp]), "", "one shot");
    assert.equal(JSON.stringify(cp), before, "checkpoint remains untouched");
    assert.deepEqual(rec.prompts, []);
  } finally {
    await rec.stop();
  }
});

for (const invalid of [
  "ordinary",
  "prepared-checkpoint",
  "foreign",
  "unmarked",
  "failed",
  "moved",
  "deleted",
  "unload",
  "stopped",
  "ended",
]) {
  test(`checkpoint alias rejects ${invalid} without stealing another admission`, async () => {
    const rec = await plugin(env, {
      sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
    });
    try {
      await queuedLaunch(rec);
      const cp = checkpoint("admitted-command");
      if (invalid === "prepared-checkpoint")
        await rec.promptRaw("child", cp.content[0].text, {
          messageID: cp.id,
          metadata: cp.metadata,
        });
      if (invalid !== "unmarked") await rec.context("child", "compaction", []);
      if (invalid === "ordinary") cp.content[0].text = "ordinary input";
      if (invalid === "unmarked") {
        await rec.context("child", "compaction", []);
        await queuedLaunch(rec, "later");
        cp.metadata.keepID = "later";
      }
      if (["failed", "moved", "deleted"].includes(invalid)) {
        rec.emit({
          type: invalid === "failed" ? "session.compaction.failed" : `session.${invalid}`,
          data: { sessionID: "child" },
        });
        await delay(30);
      }
      if (invalid === "unload") await rec.stop();
      if (invalid === "ended")
        createEnds(
          () => `${SANDBOX}/.iskron-bridge`,
          () => {},
          () => {},
        ).end("child");
      if (invalid === "stopped")
        createHalts(
          () => undefined,
          () => `${SANDBOX}/.iskron-bridge`,
          () => {},
          () => {},
        ).stop("child", "ALIAS_STOP");
      const result = await rec.context(invalid === "foreign" ? "root" : "child", "context", [cp]);
      assert.ok(!launchWord.test(result), result);
      if (["ordinary", "prepared-checkpoint", "foreign", "unmarked", "failed"].includes(invalid)) {
        assert.match(
          await rec.context("child", "context", rec.messages("child")),
          launchWord,
          "invalid alias did not consume pending direct delivery",
        );
      }
    } finally {
      if (invalid !== "unload") await rec.stop();
    }
  });
}

test("old checkpoint grant cannot deliver a later prompt or replay after a move", async () => {
  const dir = mkdtempSync(join(SANDBOX, "alias-command-"));
  const skills = ["establish-mcp", "alias-probe"].map((id) => {
    mkdirSync(join(dir, id));
    const path = join(dir, id, "SKILL.md");
    writeFileSync(path, `---\nname: ${id}\nslash: true\ndescription: Local probe\n---\nProbe.\n`);
    return { id, name: id, path, description: "Local probe", content: "" };
  });
  mkdirSync(join(dir, "establish-mcp/scripts"));
  writeFileSync(join(dir, "establish-mcp/scripts/iskron.mjs"), "");
  const rec = await plugin(env, {
    skills,
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  const enqueue = async (id) => {
    await rec
      .commands()
      .get("alias-probe")
      .execute({
        sessionID: "child",
        prompt: { text: "same input", files: [] },
        delivery: "queue",
      });
    const queued = rec.prompts.at(-1);
    await rec.promptRaw("child", queued.text, { metadata: queued.metadata, messageID: id });
  };
  const commandWord = /alias-probe/;
  try {
    await enqueue("admitted-command");
    await rec.context("child", "compaction", []);
    assert.match(
      await rec.context("child", "context", [checkpoint("admitted-command")]),
      commandWord,
    );
    await enqueue("later");
    assert.equal(
      await rec.context("child", "context", [checkpoint("later", "other-checkpoint")]),
      "",
    );
    assert.match(await rec.context("child", "context", rec.messages("child")), commandWord);
    rec.emit({ type: "session.moved", data: { sessionID: "child" } });
    await delay(30);
    await enqueue("after-move");
    assert.equal(await rec.context("child", "context", [checkpoint("after-move")]), "");
    assert.match(await rec.context("child", "context", rec.messages("child")), commandWord);
  } finally {
    await rec.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("launch word is in the first primary system, never in the persisted prompt", async () => {
  const rec = await plugin(env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  try {
    const input =
      "You are a subagent spawned by another session.\nstart r5 931 дело №77\n  brief\r\n";
    assert.equal(await rec.promptRaw("child", input), input);
    const request = (sessionID) => ({ sessionID, system: [], messages: rec.messages(sessionID) });
    const compact = request("child");
    for (const cb of rec.hooks.compaction ?? []) await cb(compact);
    assert.equal(compact.system.length, 0, "compaction must not eat the pending launch word");
    const foreign = request("root");
    for (const cb of rec.hooks.context ?? []) await cb(foreign);
    assert.equal(foreign.system.length, 0, "a child's word cannot reach its root");
    const first = request("child");
    for (const cb of rec.hooks.context ?? []) await cb(first);
    assert.match(first.system.map((p) => p.text).join("\n"), /не встал|not seated/);
    const repeat = request("child");
    for (const cb of rec.hooks.context ?? []) await cb(repeat);
    assert.equal(repeat.system.length, 0, "one shot, not every model step");
    assert.deepEqual(rec.prompts, [], "no extra inbox or model step");
  } finally {
    await rec.stop();
  }
});

for (const end of ["moved", "deleted", "failed", "unload"]) {
  test(`async preparation cannot restore a checkpoint grant after ${end}`, async () => {
    const rec = await plugin(env, {
      sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const get = rec.ctx.session.get;
    let waiting = false;
    rec.ctx.session.get = async (args) => {
      if (args.sessionID === "child") {
        waiting = true;
        await gate;
      }
      return get(args);
    };
    try {
      const prepared = rec.promptRaw("child", "start r5 931 дело №77", {
        messageID: "late-prepare",
      });
      for (let i = 0; i < 30 && !waiting; i++) await delay(5);
      assert.ok(waiting, "prompt preparation is paused across its lifecycle change");
      if (end === "unload") await rec.stop();
      else {
        rec.emit({
          type: end === "failed" ? "session.compaction.failed" : `session.${end}`,
          data: { sessionID: "child" },
        });
        await delay(30);
      }
      release();
      await prepared;
      await rec.context("child", "compaction", []);
      assert.equal(await rec.context("child", "context", [checkpoint("late-prepare")]), "");
      assert.equal(
        await rec.context("child"),
        "",
        "old async preparation cannot reinsert its words",
      );
    } finally {
      release();
      if (end !== "unload") await rec.stop();
    }
  });
}

for (const end of ["deleted", "unload", "stopped", "ended"]) {
  test(`pending launch is suppressed after ${end}`, async () => {
    const rec = await plugin(env, {
      sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
    });
    try {
      const text = "start r5 931 дело №77";
      assert.equal(await rec.promptRaw("child", text), text);
      if (end === "deleted") {
        rec.emit({ type: "session.deleted", data: { sessionID: "child" } });
        await delay(30);
      } else if (end === "unload") await rec.stop();
      else if (end === "ended")
        createEnds(
          () => `${SANDBOX}/.iskron-bridge`,
          () => {},
          () => {},
        ).end("child");
      else
        createHalts(
          () => undefined,
          () => `${SANDBOX}/.iskron-bridge`,
          () => {},
          () => {},
        ).stop("child", "CONTEXT_OWNER_STOP");
      const system = await rec.context("child");
      if (end === "stopped") {
        assert.match(system, /CONTEXT_OWNER_STOP/);
        assert.ok(!system.includes("место родителя неизвестно"), system);
      } else assert.equal(system, "", "closed sessions get no pending word");
      assert.deepEqual(rec.prompts, [], "no extra model turn");
    } finally {
      if (end !== "unload") await rec.stop();
    }
  });
}
