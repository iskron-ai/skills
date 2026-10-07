// Знание о месте одно на все пути (граф nks-dev: решение #6706, вопрошание
// #6702): доска разобрана не целиком — мост не знает, кто слушает; сентинел роли
// не обходит проверки; основа места рядом переживает мёртвый токен; отъём
// закрывает запись на весь канал; прежний мост этой сессии уступает по исходу
// connect нового, не по времени.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  boardLine,
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

const unreadBoard = `Каналы (2):\n${boardLine("other")}\n  ??? строка иной формы`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("К1: an unread board line — a raw connect or register of a seat not among the read is refused, not passed as free", async (t) => {
  const { fake, up } = await setup(t);
  await fake.control({ boardText: unreadBoard });
  const b = await up();
  for (const action of ["connect", "register"]) {
    const r = await channel(b, { realm: "nks-dev", action, karta: 931, name: "proba" });
    assert.ok(r.result?.isError, `${action} refused:\n${textOf(r)}`);
    assert.match(textOf(r), /не знает/, textOf(r));
  }
  assert.deepEqual(placeArgs(fake, "connect"), [], "nothing connected blind");
});

test("К1: an unread board line — «one seat per bridge» gives no take=true advice for the asked seat", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.equal(placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "mine" })), "mine");
  await fake.control({ boardText: unreadBoard });
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "drugoe" });
  assert.ok(r.result?.isError, textOf(r));
  assert.doesNotMatch(textOf(r), /— iskron_stand с take=true|повтори[^.]*take=true/, textOf(r));
});

test("К2: a raw register as karta=agent does not sign with the seat another session listens on", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up();
  assert.equal(placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  const r = await channel(b2, {
    realm: "nks-dev",
    action: "register",
    karta: "agent",
    name: "proba",
  });
  assert.ok(r.result?.isError, textOf(r));
  assert.deepEqual(placeArgs(fake, "register"), ["proba"], "nothing signed");
});

test("К2: iskron_stand as karta=agent does not connect over the seat another session listens on", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up();
  assert.equal(placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  const r = await stand(b2, { realm: "nks-dev", karta: "agent", name: "proba" });
  assert.ok(!placeArgs(fake, "connect").slice(1).includes("proba"), `no take:\n${textOf(r)}`);
});

test("К3: after a dead token erased the record, iskron_stand by the seat beside's own name on a new bridge arms no role-inbox hook", async (t) => {
  const { fake, cwd, up } = await setup(t);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: true }] });
  const b1 = await up();
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba.2",
  );
  await until(() => fake.state.ws.size === 1, "socket");
  const hooks = fake.state.counts.webhooks_added;
  await fake.control({ ws_close: 4001 });
  await until(() => saidKind(b1, "dead"), "the dead word");
  await b1.stop();
  const b = await up();
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba.2", cwd });
  assert.equal(placeOf(r), "proba.2", textOf(r));
  assert.equal(fake.state.counts.webhooks_added, hooks, `no role-inbox hook:\n${textOf(r)}`);
});

test("К4: an eviction the network kept from standing beside — a write in the other graph of the channel is refused too", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.ok(
    !(await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "proba" })).result?.isError,
  );
  assert.ok(
    !(await stand(b, { realm: "@nks/drugoy", karta: 48, name: "proba-b" })).result?.isError,
  );
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ mcpDrop: 50, mcpDropAction: "iskron_channel:list" });
  await fake.control({ ws_close: 4000 });
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  await until(
    () => b.notifications.some((n) => /встать рядом мост не смог/.test(n.params?.data?.text ?? "")),
    "the failure word",
  );
  const before = fake.state.writes.length;
  const w = await write(b, "@nks/drugoy");
  assert.ok(w.result?.isError, textOf(w));
  assert.equal(fake.state.writes.length, before, JSON.stringify(fake.state.writes));
});

test("К4: iskron_stand in another graph with take=true on a name another session holds does not register it", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up(mkdtempSync(join(tmpdir(), "iskron-ownseat-m2-")));
  assert.ok(
    !(await stand(b1, { realm: "@nks/drugoy", karta: 48, name: "proba-b" })).result?.isError,
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  assert.ok(
    !(await stand(b2, { realm: "@nks/nks-dev", karta: 931, name: "proba" })).result?.isError,
  );
  const r = await stand(b2, { realm: "@nks/drugoy", karta: 48, name: "proba-b", take: true });
  assert.deepEqual(
    placeArgs(fake, "register").filter((n) => n === "proba-b"),
    ["proba-b"],
    `no second register of proba-b:\n${textOf(r)}`,
  );
});

test("the former bridge of this session yields on the outcome of the new bridge's connect, not on time: a 3 s connect gives no second seat", async (t) => {
  const { fake, cwd, up } = await setup(t);
  const b1 = await up();
  await b1.call("iskron/resume", { cwd, session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  await b2.call("iskron/resume", { cwd, session: "ses-1" });
  await fake.control({ connect_reply_delay_ms: 3000 });
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  await fake.control({ connect_reply_delay_ms: 0 });
  assert.equal(placeOf(s2), "proba", textOf(s2));
  await sleep(1500);
  assert.deepEqual(placeArgs(fake, "connect"), ["proba", "proba"], `one seat:\n${b1.stderr}`);
  assert.ok(!saidKind(b1, "resumed"), "the former bridge did not stand beside");
});
