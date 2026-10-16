// Автопосадка корня выключена защитным пакетом (rootSeatOn в js/opencode/rootseat.ts, #7972 в
// @nks/nks-dev): она обходила стоп владельца после перезагрузки и сажала удалённую сессию из
// своей очереди. Пробы гоняют СОБРАННЫЙ плагин (built.mjs, ISKRON_OPENCODE_PLUGIN — любая копия)
// с настоящими мостами против подставного сервера ownseat-kit: ни одного обращения к месту без
// явного stand, запрет стопа держится. Модели нет, сеть — loopback.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { setup } from "./ownseat-kit.mjs";
import { heardSeats, heldBy, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { timeout: 90_000 };

async function stage(t) {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  writeAgents(project);
  return { ...s, project };
}

/** Запись стопа так, как её кладёт halts.ts: рядом с грантом, по хэшу id сессии. */
const stopFile = (dir, session) =>
  join(
    dir,
    `opencode-stopped.${createHash("sha256").update(session).digest("hex").slice(0, 16)}.json`,
  );

/** Обращения к местам на подставном сервере: connect/register/mint — любое занятие. */
const placeCalls = (fake) => fake.state.placeArgs.map((a) => a.action);

test(
  "стоп владельца на диске → перезагрузка → первый промпт корня: места нет, запрет держится",
  T,
  async (t) => {
    const s = await stage(t);
    mkdirSync(s.dir, { recursive: true, mode: 0o700 });
    const file = stopFile(s.dir, "root");
    const word = "Искрон: место снято владельцем — проба";
    writeFileSync(
      file,
      JSON.stringify({ session: "root", at: new Date().toISOString(), id: "stop-probe", word }),
      { mode: 0o600 },
    );
    const oc = await rootPlugin(s, s.project); // новый экземпляр: реестр пуст, стоп только на диске
    try {
      oc.create("root", { emit: false }); // сессия пережила перезагрузку
      const r = await oc.turn("root", "привет");
      await sleep(2000);
      assert.deepEqual(placeCalls(s.fake), [], `ни одного занятия места:\n${oc.said()}`);
      assert.deepEqual(heldBy(s.dir, "root"), [], "записи держания нет");
      assert.deepEqual(heardSeats(s.fake, null), [], "никто не слушает");
      const rec = JSON.parse(readFileSync(file, "utf8"));
      assert.ok(!rec.lifted && rec.id === "stop-probe", `запрет не снят: ${JSON.stringify(rec)}`);
      assert.ok(r.system.includes(word), `ход остановленной сессии читает слово стопа:\n${r.system}`);
      assert.ok(!/стоит местом|is seated as/i.test(r.told), `слова посадки нет:\n${r.told}`);
    } finally {
      await oc.stop();
    }
  },
);

test("корень с обложкой, удалённый до промпта: места не получает", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("gone");
    oc.remove("gone");
    oc.create("quiet"); // создана и молчит: без промпта места тоже нет
    await sleep(3000);
    assert.deepEqual(placeCalls(s.fake), [], `ни одного занятия места:\n${oc.said()}`);
    assert.deepEqual([...heldBy(s.dir, "gone"), ...heldBy(s.dir, "quiet")], []);
    assert.deepEqual(heardSeats(s.fake, null), [], "никто не слушает");
  } finally {
    await oc.stop();
  }
});

test("первый промпт корня с обложкой: служебной посадки нет, модель о месте не слышит", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("root");
    const r = await oc.turn("root", "привет");
    await sleep(2000);
    assert.deepEqual(placeCalls(s.fake), [], `ни одного занятия места:\n${oc.said()}`);
    assert.deepEqual(heldBy(s.dir, "root"), []);
    assert.equal(r.prompt, "привет", "промпт не дополнен словом посадки");
  } finally {
    await oc.stop();
  }
});
