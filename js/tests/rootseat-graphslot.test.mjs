// Слот «Граф» обложки старого контракта (#8066): рабочий граф, за ним проза — указатель на
// методологию и «не используется». Настоящий плагин садит корень на рабочий граф и не пишет
// «называет несколько графов»; два равноправных графа — прежняя неоднозначность, места нет.
// Стенд — rootseat-kit.mjs; ISKRON_OPENCODE_PLUGIN наводит пробу на любую копию плагина.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { ROOT_SEAT } from "../delivery/index.ts";
import { placeArgs, setup } from "./ownseat-kit.mjs";
import { COVER, GRAPH_KEY, heardSeats, heldBy, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const T = { timeout: 90_000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEATED = ROOT_SEAT.ru.seated("\0", "\0", "\0", "\0").split("\0")[0];
const MANY = ROOT_SEAT.ru.manyGraphs("\0", "\0", "\0").split("\0")[2];
const OLD_GRAPH =
  "`@nks/nks-dev` (`r5`); методология — `@alari/methodology` (`r4`); общий `@nks/feedback` не используется";

async function rootTurn(t, graph) {
  // Before setup's own cleanup: the plugin stops first, so its bridges exit before it looks.
  let oc;
  t.after(() => oc?.stop());
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  writeAgents(project, { ...COVER, [GRAPH_KEY]: graph });
  oc = await rootPlugin(s, project);
  oc.create("root");
  const r = await oc.turn("root", "привет");
  const look = `сказано модели: ${r.told || "(ничего)"}\nstderr плагина:\n${oc.said()}`;
  return { s, r, look };
}

test(
  "#8066: методология и «не используется» за рабочим графом — одна посадка в @nks/nks-dev",
  T,
  async (t) => {
    const { s, r, look } = await rootTurn(t, OLD_GRAPH);
    assert.equal(r.atRequest.seats.length, 1, look);
    assert.deepEqual(heardSeats(s.fake), r.atRequest.seats, look);
    assert.deepEqual(heldBy(s.dir, "root"), r.atRequest.seats, look);
    assert.equal(placeArgs(s.fake, "connect").length, 1, look);
    assert.ok(r.told.includes(SEATED) && !r.told.includes(MANY), look);
  },
);

test("#8066: два равноправных графа — места нет, слово о неоднозначности", T, async (t) => {
  const { s, r, look } = await rootTurn(t, "`@nks/nks-dev` (`r5`); `@nks/drugoy` (`r7`)");
  await sleep(1500); // посадка в фоне, отпустившая запрос, успела бы
  assert.deepEqual(r.atRequest.seats, [], look);
  assert.deepEqual(placeArgs(s.fake, "connect"), [], look);
  assert.ok(r.told.includes(MANY), look);
});
