// Stop is cancellation, not a pause of already prepared context (#9341, #9867).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";
import { said } from "./room-frames.mjs";

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const event = (kind, extra = {}) => JSON.stringify({ kind, ...extra }) + "\n";
const place = { realm: "r5", karta: "931", name: "stop-probe" };
const commandWord = /загрузи `stop-probe`/;
const cp = (keepID) => ({
  role: "user",
  id: `cp-${keepID}`,
  metadata: { keepID },
  content: [{ type: "text", text: "<conversation-checkpoint>\nprobe\n</conversation-checkpoint>" }],
});

async function setup(name) {
  const dir = join(SANDBOX, name);
  mkdirSync(dir);
  assert.equal(spawnSync("git", ["init", "-q", dir]).status, 0);
  const skills = ["establish-mcp", "stop-probe"].map((id) => {
    mkdirSync(join(dir, id));
    const path = join(dir, id, "SKILL.md");
    writeFileSync(path, `---\nname: ${id}\nslash: true\ndescription: Probe\n---\nProbe.\n`);
    return { id, name: id, path, description: "Probe", content: "" };
  });
  mkdirSync(join(dir, "establish-mcp/scripts"));
  writeFileSync(join(dir, "establish-mcp/scripts/iskron.mjs"), "");
  writeFileSync(
    join(dir, "AGENTS.md"),
    "---\niskron:\n  graph: r5\n  holon: 1506\n  agent_role: 931\n---\n",
  );
  const events = join(dir, "events"),
    log = join(dir, "log");
  writeFileSync(events, "");
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: new URL("./fake-bridge.mjs", import.meta.url).pathname,
      FB_LOG: log,
      FB_EVENTS: events,
    },
    {
      skills,
      sessions: [
        { id: "root", location: { directory: dir } },
        { id: "child", parentID: "root" },
        { id: "other" },
      ],
    },
  );
  await until(() => rec.tools().size === 3, "tools");
  await rec.call("iskron_channel", { action: "connect" }, "root");
  const pid = Number(readFileSync(log, "utf8").trim().split(/\s+/)[1]);
  const send = (kind, extra) => appendFileSync(`${events}.${pid}`, event(kind, extra));
  const resume = async (key) => {
    send("held", { automatic: false, key, place });
    await until(() => rec.said().includes(`мост держит место ${key}`), key);
  };
  await resume("initial");
  const command = async (session, id) => {
    await rec
      .commands()
      .get("stop-probe")
      .execute({
        sessionID: session,
        prompt: { text: "same input", files: [] },
        delivery: "queue",
      });
    const queued = rec.prompts.at(-1);
    return rec.promptRaw(session, queued.text, { metadata: queued.metadata, messageID: id });
  };
  const stop = async () => {
    send("stopped", { code: 4001, text: "OWNER_STOP" });
    await until(() => rec.interrupts.some((x) => x.sessionID === "root"), "stop interrupt");
  };
  return { rec, command, stop, resume, send };
}

test("stopped4001→explicit held without context cancels own and descendant words, not another session", async () => {
  const { rec, command, stop, resume } = await setup("stop-pending");
  try {
    for (const s of ["root", "child", "other"]) {
      await command(s, `old-${s}`);
      await rec.context(s, "compaction", []);
    }
    rec.emit({ type: "session.compaction.failed", data: { sessionID: "root" } });
    await delay(30); // Failure drops the generation, but direct words still need cancellation.
    await stop();
    await resume("resumed"); // No context/prepare/take while stopped.
    for (const s of ["root", "child"]) {
      assert.doesNotMatch(await rec.context(s, "context", [cp(`old-${s}`)]), commandWord);
      assert.doesNotMatch(
        await rec.context(s),
        commandWord,
        `${s}: old direct admission cancelled`,
      );
    }
    assert.match(await rec.context("other"), commandWord, "other session keeps its queue");
    await command("root", "fresh");
    assert.match(await rec.context("root"), commandWord, "new command after explicit resume works");
  } finally {
    await rec.stop();
  }
});

test(
  "parent stop→held cancels an existing child's admission while its parentID lookup is pending",
  { todo: "Принятый владельцем остаток: граф @nks/nks-dev #9890; №3482[100]" },
  async () => {
    const { rec, command, stop, resume } = await setup("stop-lineage");
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const get = rec.ctx.session.get;
    let waiting = false;
    rec.ctx.session.get = async (args) => {
      if (args.sessionID === "child" && !waiting) {
        waiting = true;
        await gate;
      }
      return get(args);
    };
    try {
      await command("other", "unrelated");
      const late = command("child", "old-child");
      await until(() => waiting, "existing child's parentID lookup paused");
      await stop();
      await resume("lineage-resumed");
      release();
      await late;
      assert.doesNotMatch(
        await rec.context("child"),
        commandWord,
        "unknown lineage cannot save old words",
      );
      assert.match(await rec.context("other"), commandWord, "unrelated queue survives");
      await command("child", "fresh-child");
      assert.match(
        await rec.context("child"),
        commandWord,
        "fresh child command after resume works",
      );
    } finally {
      release();
      await rec.stop();
    }
  },
);

test("stop→held invalidates a late async put and ride even after a new preparation", async () => {
  const { rec, command, stop, resume, send } = await setup("stop-async");
  rec.emit({ type: "session.created", data: { sessionID: "root" } });
  await delay(30); // Learn rootOf before pausing the first ritual's directory read.
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const get = rec.ctx.session.get;
  let waiting = false;
  rec.ctx.session.get = async (args) => {
    if (args.sessionID === "root" && !waiting) {
      waiting = true;
      await gate;
    }
    return get(args);
  };
  try {
    const late = command("root", "late");
    await until(() => waiting, "async preparation paused");
    await stop();
    await resume("async-resumed");
    await rec.promptRaw("root", "new ordinary", { messageID: "fresh" });
    release();
    await late;
    send("frame", { frame: said("defer", 43), raw: "" });
    await delay(200);
    // Counts are not consumed by a historical admission's late ride.
    const requests = [];
    for (const cb of rec.hooks.context ?? []) {
      const req = { sessionID: "root", system: [], messages: [{ role: "user", id: "late" }] };
      await cb(req);
      requests.push(...req.system);
    }
    assert.deepEqual(requests, [], "late word and stale command are cancelled");
    assert.match(
      await rec.context("root", "context", [{ role: "user", id: "fresh" }]),
      /№7/,
      "late ride did not steal the count from the new admission",
    );
    await command("root", "new-command");
    assert.match(await rec.context("root"), commandWord);
    await delay(10);
  } finally {
    release();
    await rec.stop();
  }
});
