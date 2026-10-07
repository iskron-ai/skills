// Место без слуха — ушёл словом или токен мёртв (граф nks-dev: решение #6706):
// если его теперь слушает другая сессия (или мост этого не знает), запись,
// сырой register и повторная привязка после смены сессии им не подписываются.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  channel,
  placeArgs,
  placeOf,
  saidKind,
  setup,
  stand,
  textOf,
  until,
  write,
} from "./ownseat-kit.mjs";

const deafThenTaken = async (t, deafen) => {
  const { fake, up } = await setup(t);
  const a = await up();
  assert.equal(placeOf(await stand(a, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "a's socket");
  await deafen(fake, a);
  await until(() => fake.state.places.get("931:proba")?.listening === false, "a deaf");
  const b = await up(mkdtempSync(join(tmpdir(), "iskron-ownseat-m2-")));
  assert.equal(placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.places.get("931:proba")?.listening === true, "b hears proba");
  return { fake, a };
};

const neverSigned = async (fake, a) => {
  const writes = fake.state.writes.length;
  const w = await write(a);
  assert.ok(w.result?.isError, `the write is refused:\n${textOf(w)}`);
  assert.equal(fake.state.writes.length, writes, JSON.stringify(fake.state.writes));
  const regs = placeArgs(fake, "register").length;
  const r = await channel(a, { realm: "nks-dev", action: "register", karta: 931, name: "proba" });
  assert.ok(r.result?.isError, `the raw register is refused:\n${textOf(r)}`);
  await fake.control({ kill_session: true });
  await channel(a, { realm: "nks-dev", action: "history" });
  assert.equal(
    placeArgs(fake, "register").length,
    regs,
    `no replay: ${placeArgs(fake, "register")}`,
  );
};

test("left by word, then another session took the seat: no write, raw register or replay signs with it", async (t) => {
  const { fake, a } = await deafThenTaken(t, async (_f, a) => {
    assert.ok(!(await channel(a, { realm: "nks-dev", action: "leave" })).result?.isError);
  });
  await neverSigned(fake, a);
});

test("a dead token, then another session took the seat: no write, raw register or replay signs with it", async (t) => {
  const { fake, a } = await deafThenTaken(t, async (f, a) => {
    await f.control({ ws_close: 4001 });
    await until(() => saidKind(a, "dead"), "the dead word");
  });
  await neverSigned(fake, a);
});
