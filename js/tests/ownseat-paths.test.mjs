// Одно решение «моё, чужое, неизвестно» на все пути (граф nks-dev: решение
// #6706, вопрошание #6702): свой connect этого места — не отъём; место рядом
// без слуха проверяется так же, как основное; граф, записанный иначе, — то же
// место; свой локальный сокет — не чужой; сырой ход без роли не обходит проверки.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  channel,
  FILE,
  NODE,
  otherDir,
  placeArgs,
  placeOf,
  saidKind,
  setup,
  stand,
  textOf,
  until,
  write,
} from "./ownseat-kit.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ownTake = async (t, session) => {
  const { fake, dir, cwd, up } = await setup(t);
  const b = await up();
  if (session) await b.call("iskron/resume", { cwd, session });
  assert.equal(
    placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ connect_reply_delay_ms: 800 });
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba", cwd, take: true });
  await fake.control({ connect_reply_delay_ms: 0 });
  assert.equal(placeOf(r), "proba", textOf(r));
  await sleep(1000);
  assert.deepEqual(placeArgs(fake, "connect"), ["proba", "proba"], b.stderr);
  assert.ok(!saidKind(b, "evicted"), `no word of eviction:\n${b.stderr}`);
  assert.equal(fake.state.places.get("931:proba")?.listening, true, "still heard");
  const doors = readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".sock"));
  assert.equal(doors.length, 1, `the seat's local door is open:\n${b.stderr}`);
  const w = await write(b);
  assert.ok(!w.result?.isError, textOf(w));
};

test("Ф1: own take=true, 4000 ahead of the connect reply, named session — the new seat is kept with hearing", async (t) => {
  await ownTake(t, "ses-1");
});

test("Ф1: own take=true, 4000 ahead of the connect reply, no session — no false eviction, no seat beside", async (t) => {
  await ownTake(t, null);
});

const besideDeaf = async (t, deafen) => {
  const { fake, cwd, up } = await setup(t);
  const a = await up();
  await a.call("iskron/resume", { cwd, session: "ses-a" });
  assert.ok(
    !(await stand(a, { realm: "@nks/nks-dev", karta: 931, name: "proba" })).result?.isError,
  );
  assert.ok(
    !(await stand(a, { realm: "@nks/drugoy", karta: 48, name: "proba-b" })).result?.isError,
  );
  await until(() => fake.state.ws.size === 1, "a's socket");
  await deafen(fake, a);
  await until(() => fake.state.places.get("931:proba")?.listening === false, "a deaf");
  // Подставной сервер гасит слух только места сокета; место рядом на том же канале глохнет так же.
  await fake.control({ places: [{ karta: "48", name: "proba-b", listening: false }] });
  const b = await up(otherDir(t));
  assert.equal(
    placeOf(await stand(b, { realm: "@nks/drugoy", karta: 48, name: "proba-b" })),
    "proba-b",
  );
  await until(() => fake.state.places.get("48:proba-b")?.listening === true, "b hears proba-b");
  const before = fake.state.writes.length;
  const w = await write(a, "@nks/drugoy");
  assert.ok(w.result?.isError, textOf(w));
  assert.equal(fake.state.writes.length, before, JSON.stringify(fake.state.writes));
};

test("Ф2: left by word, the seat beside taken by another session — a write in its graph is refused", async (t) => {
  await besideDeaf(t, async (_f, a) => {
    assert.ok(!(await channel(a, { realm: "@nks/nks-dev", action: "leave" })).result?.isError);
  });
});

test("Ф2: a dead token, the seat beside taken by another session — a write in its graph is refused", async (t) => {
  await besideDeaf(t, async (f, a) => {
    await f.control({ ws_close: 4001 });
    await until(() => saidKind(a, "dead"), "the dead word");
  });
});

test("Ф3: a new bridge of the same session naming the graph by its slug takes back the seat held under @owner/slug — no seat beside", async (t) => {
  const { fake, cwd, up } = await setup(t);
  const b1 = await up();
  await b1.call("iskron/resume", { cwd, session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "@nks/nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  await b2.call("iskron/resume", { cwd, session: "ses-1" });
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.equal(placeOf(s2), "proba", textOf(s2));
  assert.deepEqual(placeArgs(fake, "connect"), ["proba", "proba"], textOf(s2));
});

test("Н1: no session, left by word, nobody took the seat — a write is not refused for the bridge's own local socket", async (t) => {
  const { fake, up } = await setup(t);
  const a = await up();
  assert.equal(placeOf(await stand(a, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "socket");
  assert.ok(!(await channel(a, { realm: "nks-dev", action: "leave" })).result?.isError);
  await until(() => fake.state.places.get("931:proba")?.listening === false, "deaf");
  const w = await write(a);
  assert.ok(!w.result?.isError, textOf(w));
});

test("a raw connect without a role on an empty bridge does not take the seat another session listens on", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up();
  assert.equal(placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  for (const action of ["connect", "mint", "register"]) {
    const r = await channel(b2, { realm: "nks-dev", action, name: "proba" });
    assert.ok(r.result?.isError, `${action}:\n${textOf(r)}`);
  }
  assert.deepEqual(placeArgs(fake, "connect"), ["proba"], "nothing taken");
  assert.deepEqual(placeArgs(fake, "register"), ["proba"], "nothing signed");
});

const leftThenTurned = async (t) => {
  const { fake, dir, cwd, up } = await setup(t);
  await fake.control({ turned_404: true });
  const b1 = await up();
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  assert.ok(!(await channel(b1, { realm: "nks-dev", action: "leave" })).result?.isError);
  await until(() => fake.state.places.get("931:proba")?.listening === false, "left");
  const b2 = await up(otherDir(t));
  assert.equal(
    placeOf(await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.places.get("931:proba")?.listening === true, "b2 hears proba");
  return { fake, dir, cwd, b1 };
};

test("left by word, another session turned the address (the platform answers 404): iskron_stand by name stands beside, not registering over its hearing", async (t) => {
  const { fake, cwd, b1 } = await leftThenTurned(t);
  const before = placeArgs(fake, "register").length;
  const s1 = await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  const regs = placeArgs(fake, "register").slice(before);
  assert.ok(!regs.includes("proba"), `b1 signed with proba: ${regs}\n${textOf(s1)}`);
  assert.equal(placeOf(s1), "proba.2", textOf(s1));
});

test("left by word, another session turned the address (404), then a watchdog attaches: a write is refused, not signed with its seat", async (t) => {
  const { fake, dir, b1 } = await leftThenTurned(t);
  const wd = spawn(NODE, [FILE, "watchdog", "proba--931--nks-dev", "--auth-dir", dir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => wd.kill("SIGKILL"));
  await until(() => /вернулся на место|back on the seat/.test(b1.stderr), "the return");
  await sleep(1500);
  const before = fake.state.writes.length;
  const w = await write(b1);
  assert.ok(w.result?.isError, textOf(w));
  assert.equal(fake.state.writes.length, before, JSON.stringify(fake.state.writes));
});

test("the socket dropped and another session turned the address meanwhile (404 on reopen): a write is refused and iskron_stand stands beside", async (t) => {
  const { fake, cwd, up } = await setup(t);
  await fake.control({ turned_404: true });
  const b1 = await up();
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  await fake.control({ ws_close: 1012 });
  await until(() => fake.state.places.get("931:proba")?.listening === false, "dropped");
  const b2 = await up(otherDir(t));
  assert.equal(
    placeOf(await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await until(() => fake.state.places.get("931:proba")?.listening === true, "b2 hears proba");
  await sleep(3000);
  const before = fake.state.writes.length;
  const w = await write(b1);
  assert.ok(w.result?.isError, textOf(w));
  assert.equal(fake.state.writes.length, before, JSON.stringify(fake.state.writes));
  const regs = placeArgs(fake, "register").length;
  const s1 = await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.ok(!placeArgs(fake, "register").slice(regs).includes("proba"), textOf(s1));
  assert.equal(placeOf(s1), "proba.2", textOf(s1));
});
