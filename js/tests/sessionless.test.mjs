// Запись держания без сессии не делает своё место чужим (граф nks-dev: #6702, #5038):
// мост, вернувший место с диска, сессию записи не теряет; запись без сессии того же
// харнесса и каталога, которую не держит живая другая сессия, — своя для названной
// сессии: мост возвращает основное место сам, а держатель без сессии уступает тихо.
// Харнесс без имени сессии (обе стороны без сессии) — по-прежнему чужой живой мост.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  channel,
  holdRecord,
  placeArgs,
  placeOf,
  setup,
  stand,
  textOf,
  until,
} from "./ownseat-kit.mjs";

const KEY = "proba--931--nks-dev";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Место proba держит живой мост без сессии из каталога cwd — сирота возврата с диска. */
const orphanHolds = async (t) => {
  const kit = await setup(t);
  const b1 = await kit.up();
  const s1 = await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd: kit.cwd });
  assert.equal(placeOf(s1), "proba", textOf(s1));
  await until(() => kit.fake.state.ws.size === 1, "b1 socket");
  assert.equal(holdRecord(kit.dir, KEY)?.session, undefined, "the record carries no session");
  return { ...kit, b1 };
};

test("a record without a session, held by a bridge that named none: the same client's named session in the same folder takes the main seat back, not .2", async (t) => {
  const { fake, cwd, up, b1 } = await orphanHolds(t);
  const b2 = await up();
  await b2.call("iskron/resume", { session: "ses-1" }); // плагин называет сессию; места так не возвращает
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.equal(placeOf(s2), "proba", textOf(s2));
  await until(() => fake.state.places.get("931:proba")?.listening === true, "b2 hears proba");
  await sleep(1500);
  assert.ok(
    !placeArgs(fake, "connect").includes("proba.2"),
    `nobody stood beside: ${placeArgs(fake, "connect")}\n${b1.stderr}`,
  );
});

test("a record without a session whose holder then names its session: another session in the same folder still stands beside", async (t) => {
  const { fake, dir, cwd, up, b1 } = await orphanHolds(t);
  await b1.call("iskron/resume", { session: "ses-1" });
  await until(() => holdRecord(dir, KEY)?.session === "ses-1", "the record signed by ses-1");
  const b2 = await up();
  await b2.call("iskron/resume", { session: "ses-2" });
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.equal(placeOf(s2), "proba.2", textOf(s2));
  assert.deepEqual(placeArgs(fake, "connect"), ["proba", "proba.2"], textOf(s2));
});

test("no session on either side (a harness without session names): the live former bridge of the same folder stays another's", async (t) => {
  const { fake, cwd, up } = await orphanHolds(t);
  const b2 = await up();
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.equal(placeOf(s2), "proba.2", textOf(s2));
  assert.deepEqual(placeArgs(fake, "connect"), ["proba", "proba.2"], textOf(s2));
});

test("a raw connect of a named session on an unsigned seat of its own folder is judged as iskron_stand judges it — not another session's", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up();
  assert.equal(placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up(); // тот же каталог сессии, что у b1: каталог процесса пробы
  await b2.call("iskron/resume", { session: "ses-1" });
  const r = await channel(b2, { realm: "nks-dev", karta: 931, action: "connect", name: "proba" });
  assert.doesNotMatch(textOf(r), /другая сессия|another session/, textOf(r));
  assert.deepEqual(placeArgs(fake, "connect"), ["proba", "proba"], textOf(r));
});

test("resume from disk by key on a bridge whose session is not named keeps the session in the hold record", async (t) => {
  const { fake, dir, cwd, up } = await setup(t);
  const b1 = await up();
  await b1.call("iskron/resume", { session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  assert.equal(holdRecord(dir, KEY)?.session, "ses-1");
  b1.kill();
  await until(() => fake.state.ws.size === 0, "b1's socket gone");
  const b2 = await up();
  const r = await b2.call("iskron/resume", { key: KEY }); // так возвращает место тонкий мост в новом демоне
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.equal(holdRecord(dir, KEY)?.session, "ses-1", "the session survives the resume");
});
