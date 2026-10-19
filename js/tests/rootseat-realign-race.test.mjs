// Повторная посадка после выравнивания успевает в ход: хук тула ждёт её в пределах срока
// посадки, промпт, пришедший во время неё, ждёт её же — посадка одна, слово «встал» одно и
// лежит в ходе к концу хука или промпта. Дольше срока — одно слово «не уложилась», посадка одна.
import assert from "node:assert/strict";
import { test } from "node:test";

import { until } from "./ownseat-kit.mjs";
import { heldBy, writeAgents } from "./rootseat-kit.mjs";
import { aligning, connects, LATE, look, sleep, stood, T } from "./rootseat-realign-kit.mjs";

test("(k) задержанный connect и конкурентный промпт — одна посадка, слово в ходе", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  await oc.turn("root", "выровняй");
  await s.fake.control({ connect_delay_ms: 1500 });
  writeAgents(project);
  const after = oc.toolAfter("root", "write", {});
  await until(() => s.fake.state.counts.connect_asked > 0, "повторная посадка в полёте");
  const text = await oc.promptOnly("root", "ещё");
  await after;
  const said = () => [text, ...oc.wordsTo("root")].filter(stood);
  assert.equal(said().length, 1, `«встал» в ходе к концу хука и промпта\n${text}\n${look(oc)}`);
  await sleep(1000);
  assert.equal(connects(s), 1, `ровно одна посадка\n${look(oc)}`);
  assert.equal(heldBy(s.dir, "root").length, 1);
  assert.equal(said().length, 1, `второго «встал» нет\n${look(oc)}`);
});

test("(l) посадка дольше срока — одно «не уложилась» в ход, посадка одна", T, async (t) => {
  const { s, project, oc } = await aligning(t, { env: { ISKRON_ROOT_SEAT_MS: "1000" } });
  await oc.turn("root", "выровняй");
  await s.fake.control({ connect_delay_ms: 3000 });
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  assert.equal(
    oc.wordsTo("root").filter((w) => w.includes(LATE)).length,
    1,
    `«не уложилась» в ходе к концу хука\n${look(oc)}`,
  );
  await oc.toolAfter("root", "shell", {});
  await until(() => heldBy(s.dir, "root").length === 1, "место встало позже", 15_000);
  await sleep(1000);
  assert.equal(connects(s), 1, `ровно одна посадка\n${look(oc)}`);
  assert.equal(oc.wordsTo("root").filter((w) => w.includes(LATE)).length, 1, look(oc));
});
