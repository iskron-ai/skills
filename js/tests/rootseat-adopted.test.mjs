// Работа снимает предварительность места (#931 в @nks/nks-dev): место автопосадки, на
// котором сессия уже вошла в дело или записала в граф, — её; явный stand с другим именем
// без take отказывает по правилу одного места на мост, называя место и take, и не снимает
// его. Без работы явный stand сменяет предварительное место, как прежде.
// ISKRON_OPENCODE_PLUGIN и ISKRON_BRIDGE_PATH наводят пробу на любые копии.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { holdRecord, setup } from "./ownseat-kit.mjs";
import { COVER, heardSeats, heldBy, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const T = { timeout: 90_000 };
const R = "@nks/nks-dev";
const ROOM = "70efab85-1f3b-46a2-a279-c9e806a9b371";

const WORK = {
  "вход в дело": [{ tool: "iskron_case", input: { realm: R, action: "join", room: ROOM } }],
  "запись в граф": [
    { tool: "iskron_add_vimarsha", input: { realm: R, name: "probe", given_as: "ding" } },
  ],
  "строка дела": [
    { tool: "iskron_case", input: { realm: R, action: "line", room: ROOM, text: "ход" } },
  ],
};

async function stage(t) {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  writeAgents(project, COVER);
  s.fake.state.tools = ["iskron_orient", "iskron_add_vimarsha", "iskron_channel"]
    .map((name) => ({ name, description: name, inputSchema: { type: "object" } }))
    .concat({
      name: "iskron_case",
      description: "Дела.",
      inputSchema: { type: "object", properties: { action: { type: "string" } } },
    });
  return { ...s, project };
}

const revokes = (s) =>
  s.fake.state.calls.filter((c) => c.name === "iskron_channel" && c.arguments.action === "revoke");
const told = (r) => JSON.stringify(r.calls);

for (const [label, work] of Object.entries(WORK))
  test(
    `работа (${label}) снимает предварительность: stand с model без take отказывает`,
    T,
    async (t) => {
      const s = await stage(t);
      const oc = await rootPlugin(s, s.project);
      try {
        oc.create("root");
        await oc.turn("root", "привет");
        const old = heldBy(s.dir, "root")[0];
        assert.ok(old);
        assert.equal(holdRecord(s.dir, `${old}--931--_nks_nks-dev`)?.provisional, true);
        await oc.turn("root", "работа", () => work);
        const r = await oc.turn("root", "моё имя", () => [
          { tool: "iskron_stand", input: { realm: R, karta: "931", model: "probe-model" } },
        ]);
        assert.deepEqual(heldBy(s.dir, "root"), [old], told(r));
        assert.deepEqual(heardSeats(s.fake), [old], "место слушает, второго нет");
        assert.deepEqual(revokes(s), [], "место не снято — участие в деле на нём");
        assert.match(told(r), new RegExp(old.replace(/[.]/g, "\\.")), "отказ называет место");
        assert.match(told(r), /take/, "отказ называет ход смены");
      } finally {
        await oc.stop();
      }
    },
  );

test("без работы stand с model по-прежнему сменяет предварительное место", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("root");
    await oc.turn("root", "привет");
    const old = heldBy(s.dir, "root")[0];
    await oc.turn("root", "чтение", () => [
      { tool: "iskron_case", input: { realm: R, action: "mine" } },
    ]);
    const r = await oc.turn("root", "моё имя", () => [
      { tool: "iskron_stand", input: { realm: R, karta: "931", model: "probe-model" } },
    ]);
    const own = heldBy(s.dir, "root");
    assert.equal(own.length, 1, told(r));
    assert.notEqual(own[0], old, told(r));
  } finally {
    await oc.stop();
  }
});
