// The human's rules from mind in an OpenCode session (graph @nks/nks-dev: kriya #9817, outcome
// #9816, risk #9818): a child launched with a case reads them in its launch word — taken from its
// own stand answer, not from the launcher's brief; a seated session after a compaction reads them
// in the first request's system, read by its own bridge as a service move; a root seated by its
// cover reads them beside its seating word. Fake bridge (opencode-kit.mjs) and the real bridge
// over the fake server (rootseat-kit.mjs); ISKRON_OPENCODE_PLUGIN aims it at any copy.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MIND_SLICE } from "../delivery/index.ts";
import { plugin, SANDBOX, until } from "./opencode-kit.mjs";
import { setup } from "./ownseat-kit.mjs";
import { rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const PLACE = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
const W = MIND_SLICE.ru;
const MARK = W.mark();
const BLOCK = [
  W.head(1),
  "  📌 Итог — одной строкой (#31) — Фрагмент правила",
  W.foot(false, 100),
].join("\n");
const READINESS =
  "признаки (1):\n  personal_mind «Личная память» — present · scope: person · ready: да";
const SEARCH =
  "Найдено 1 узлов:\n  📌 Итог — одной строкой (#31, phenomenon, Pt/Va/Ad, v1) — Фрагмент правила\n\n" +
  '↳ Выбери один узел и иди по стрелкам: iskron_look(realm="mind", node_id="#31")';

function lay(name, extra = {}) {
  const files = Object.fromEntries(
    ["log", "reply", "events", "calls"].map((k) => [k, join(SANDBOX, `mind-${name}.${k}`)]),
  );
  for (const f of Object.values(files)) writeFileSync(f, "");
  const env = {
    ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
    FB_LOG: files.log,
    FB_REPLY: files.reply,
    FB_EVENTS: files.events,
    FB_CALLS: files.calls,
    ...extra,
  };
  return { files, env };
}

const sent = (file) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.name?.startsWith("iskron_"));

test("a launched child reads the human's rules from its own stand answer, under its launch word", async () => {
  const { files, env } = lay("launch", {
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
      { name: "iskron_case", description: "Дело.", inputSchema: { type: "object" } },
    ]),
    FB_STAND_HELD: "host.repo.opus-5",
  });
  writeFileSync(`${files.reply}.iskron_stand`, `Искрон: стояние host.repo.opus-5.sub-1\n${BLOCK}`);
  const rec = await plugin(env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "@nks/nks-dev", karta: "#2816" }, "root");
    const read = await rec.prompt("child", "start @nks/nks-dev #48 дело №77\nБриф: почини мост.");
    assert.ok(
      read.endsWith(
        "Искрон: встал host.repo.opus-5.sub-1, вошёл в дело №77 — первым словом перескажи бриф в деле.\n" +
          BLOCK,
      ),
      read,
    );
    assert.match(
      read,
      /Личное: в дело правило приводи, только когда оно описывает это дело/,
      "the rules carry the personal mark",
    );
  } finally {
    await rec.stop();
  }
});

test("a seated session after a compaction reads the human's rules in the first request's system, by service calls of its bridge", async () => {
  const { files, env } = lay("compact");
  writeFileSync(`${files.reply}.iskron_me`, READINESS);
  writeFileSync(`${files.reply}.iskron_search`, SEARCH);
  const rec = await plugin(env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 8000);
    await rec.call("iskron_channel", { action: "connect" }, "s-m");
    const pid = Number(readFileSync(files.log, "utf8").trim().split(/\s+/)[1]);
    appendFileSync(
      `${files.events}.${pid}`,
      JSON.stringify({ kind: "held", automatic: false, key: "k-m", place: PLACE }) + "\n",
    );
    await until(() => rec.said().includes("мост держит стояние k-m"), "held");
    const system = async (hook) => {
      const req = { sessionID: "s-m", system: [], messages: [], tools: {}, options: {} };
      for (const cb of rec.hooks[hook] ?? []) await cb(req);
      return req.system.map((p) => p.text).join("\n");
    };
    assert.ok(!(await system("context")).includes(MARK), "no compaction — no rules");
    const order = await system("compaction");
    assert.ok(!order.includes(MARK), "the compaction request itself gets no rules");
    const first = await system("context");
    assert.ok(first.includes(BLOCK), first);
    assert.ok(!(await system("context")).includes(MARK), "the next request — none");
    const mind = sent(files.calls).filter((c) => c.name !== "iskron_channel");
    assert.deepEqual(
      mind.map((c) => c.name),
      ["iskron_me", "iskron_search"],
    );
    assert.equal(mind[1].arguments.realm, "mind");
    assert.equal(mind[1].arguments.attrs_filter, "slice:agents,ways");
    assert.ok(
      mind.every((c) => String(c.id).startsWith("iskron-service-")),
      "a service move, not the agent's work",
    );
  } finally {
    await rec.stop();
  }
});

test(
  "a root seated by its cover reads the human's rules beside its seating word",
  { timeout: 90_000 },
  async (t) => {
    const s = await setup(t);
    const project = realpathSync(s.cwd);
    writeAgents(project);
    await s.fake.control({
      mind: { rules: [{ seq: 31, name: "Итог — одной строкой", text: "Фрагмент правила" }] },
    });
    const oc = await rootPlugin(s, project);
    try {
      oc.create("root");
      const r = await oc.turn("root", "go");
      assert.ok(r.system.includes(BLOCK), `${r.told}\n${oc.said()}`);
    } finally {
      await oc.stop();
    }
  },
);
