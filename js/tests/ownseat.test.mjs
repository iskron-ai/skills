// Своё место и место рядом по всем путям входа (граф nks-dev: решение #6706,
// вопрошание #6702, канон #5036 пп. 3, 5): основа места рядом — с диска, когда
// процесс её не помнит; место другой сессии не возвращается с диска её записью;
// сырые connect, mint и register не берут места, которое слушает другой; отъём
// не оставляет подписи отнятым местом и не роняет мест других графов молча;
// своё переоткрытие сокета — не «другой держатель».
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boardLine,
  channel,
  holdRecord,
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

test("the seat beside called by its own name on a restarted bridge: its base comes from the record — no role-inbox hook", async (t) => {
  const { fake, dir, cwd, up } = await setup(t);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: true }] });
  const b1 = await up();
  const s1 = await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.equal(placeOf(s1), "proba.2", textOf(s1));
  await b1.stop();
  await until(() => fake.state.places.get("931:proba.2")?.listening === false, "proba.2 deaf");
  const hooks = fake.state.counts.webhooks_added;
  const b2 = await up();
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba.2", cwd });
  assert.equal(placeOf(s2), "proba.2", textOf(s2));
  assert.equal(fake.state.counts.webhooks_added, hooks, `no role-inbox hook:\n${textOf(s2)}`);
  assert.equal(holdRecord(dir, "proba.2--931--nks-dev")?.base, "proba");
});

test("the seat beside called by its own name by a new bridge of the same session, the former alive: no hook, the base kept, the next eviction stands on proba.3", async (t) => {
  const { fake, dir, cwd, up } = await setup(t);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: true }] });
  const b1 = await up();
  await b1.call("iskron/resume", { cwd, session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba.2",
  );
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const hooks = fake.state.counts.webhooks_added;
  const b2 = await up();
  await b2.call("iskron/resume", { cwd, session: "ses-1" });
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba.2", cwd });
  assert.equal(placeOf(s2), "proba.2", textOf(s2));
  assert.equal(fake.state.counts.webhooks_added, hooks, `no role-inbox hook:\n${textOf(s2)}`);
  assert.equal(holdRecord(dir, "proba.2--931--nks-dev")?.base, "proba", "the base is kept");
  await fake.control({ ws_close_old: { name: "proba.2", code: 4000 } });
  await until(() => fake.state.ws.size === 1, "b1 yields");
  await fake.control({ ws_close: 4000 });
  await until(() => fake.state.places.get("931:proba.2")?.listening === false, "closed");
  await fake.control({
    places: [
      { karta: "931", name: "proba", listening: true },
      { karta: "931", name: "proba.2", listening: true },
    ],
  });
  await until(() => saidKind(b2, "resumed"), `the word beside:\n${b2.stderr}`);
  assert.equal(placeArgs(fake, "connect").at(-1), "proba.3", "beside the remembered base");
});

test("iskron_stand by name does not take back from disk the seat another named session stood on — it stands beside", async (t) => {
  const { fake, dir, cwd, up } = await setup(t);
  const b1 = await up();
  await b1.call("iskron/resume", { cwd, session: "ses-sosed" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  await b1.stop();
  await until(() => fake.state.places.get("931:proba")?.listening === false, "closed");
  const b2 = await up();
  await b2.call("iskron/resume", { session: "ses-moya" });
  const s2 = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.doesNotMatch(textOf(s2), /возврат места с диска/, textOf(s2));
  assert.equal(placeOf(s2), "proba.2", textOf(s2));
  assert.equal(holdRecord(dir, "proba--931--nks-dev")?.session, "ses-sosed");
});

test("raw register, connect and mint of a seat another session listens on are refused when the bridge leads nothing", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up();
  assert.equal(placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const b2 = await up();
  for (const action of ["register", "connect", "mint"]) {
    const r = await channel(b2, { realm: "nks-dev", action, karta: 931, name: "proba" });
    assert.ok(r.result?.isError, `${action} refused:\n${textOf(r)}`);
    assert.match(textOf(r), /слушает другая сессия/, textOf(r));
    assert.doesNotMatch(textOf(r), /повтори[^.]*take=true/, textOf(r));
  }
  assert.deepEqual(placeArgs(fake, "connect"), ["proba"], "nothing rotated");
  assert.deepEqual(placeArgs(fake, "register"), ["proba"], "nothing signed");
  const free = await channel(b2, {
    realm: "nks-dev",
    action: "connect",
    karta: 931,
    name: "svoboda",
  });
  assert.ok(!free.result?.isError, `a free seat still connects:\n${textOf(free)}`);
});

test("an unread board line, the asked seat held by a live local bridge of another session: no take=true advice", async (t) => {
  const { fake, up } = await setup(t);
  const b1 = await up();
  assert.equal(placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "b1 socket");
  const line = (name) =>
    `  #931 👨‍💻 Роль 能 · @tester:${name} — живой · простой 6h · слушает · сокет был сейчас · открыл @tester\n     📥 http://x/api/channel/in/${name}`;
  await fake.control({ boardText: `Каналы (2):\n${line("other")}\n  ??? строка иной формы` });
  const b2 = await up();
  const r = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(r.result?.isError, textOf(r));
  assert.doesNotMatch(textOf(r), /повтори[^.]*take=true/, textOf(r));
});

test("after an eviction the network kept from standing beside, a session turnover does not re-register the taken seat", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.equal(placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ mcpDrop: 8, mcpDropAction: "iskron_channel:list" });
  await fake.control({ ws_close: 4000 });
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  await until(
    () => b.notifications.some((n) => /встать рядом мост не смог/.test(n.params?.data?.text ?? "")),
    "the failure word",
  );
  await fake.control({ mcpDrop: 0, mcpDropAction: null });
  const before = placeArgs(fake, "register").length;
  await fake.control({ kill_session: true });
  await channel(b, { realm: "nks-dev", action: "history" });
  const regs = placeArgs(fake, "register").slice(before);
  assert.ok(!regs.includes("proba"), `no register of the taken seat: ${regs}`);
  assert.ok(regs.includes("proba.2"), `the bridge stood beside before the call: ${regs}`);
});

test("a repeated iskron_stand while the bridge reopens its own socket (close 1011) is not «another holder»", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const args = { realm: "nks-dev", karta: 931, name: "proba", model: "opus-5" };
  assert.equal(placeOf(await stand(b, args)), "proba");
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ ws_close: 1011 });
  await until(() => fake.state.places.get("931:proba")?.listening === false, "closed");
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  const r = await stand(b, args);
  assert.ok(!r.result?.isError, textOf(r));
  assert.equal(placeOf(r), "proba", textOf(r));
  assert.deepEqual(placeArgs(fake, "connect"), ["proba"], "no second connect of the own seat");
});

test("an eviction of a channel that carries a seat in another graph: that seat stands again on the new channel and the word names it", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.ok(
    !(await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "proba" })).result?.isError,
  );
  const other = await stand(b, { realm: "@nks/drugoy", karta: 48, name: "proba-b" });
  assert.ok(!other.result?.isError, textOf(other));
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ ws_close: 4000 });
  await until(() => fake.state.places.get("931:proba")?.listening === false, "closed");
  await fake.control({
    places: [
      { karta: 931, name: "proba", listening: true },
      { karta: 48, name: "proba-b", listening: false },
    ],
  });
  await until(() => saidKind(b, "resumed"), `the word beside:\n${b.stderr}`);
  const word = saidKind(b, "resumed").params.data.text;
  assert.match(word, /proba-b/, word);
  // Слушает ли место того графа отнявший (канал мог уйти к нему целиком) — решает доска: само имя или рядом.
  const regs = placeArgs(fake, "register");
  const at = regs.indexOf("proba.2");
  assert.ok(
    at >= 0 && regs.slice(at + 1).some((n) => /^proba-b(\.\d+)?$/.test(n)),
    `proba-b stands again after the seat beside: ${regs}\n${word}`,
  );
  assert.match(word, /встало снова на новом/, word);
});

test("an unread board line, the asked name another listens on: the seat beside is not chosen blind either", async (t) => {
  const { fake, up } = await setup(t);
  await fake.control({
    boardText: `Каналы (3):\n${boardLine("proba")}\n${boardLine("other")}\n  ??? строка иной формы`,
  });
  const b = await up();
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(r.result?.isError, textOf(r));
  assert.deepEqual(placeArgs(fake, "connect"), [], "no blind connect");
});

test("right after an eviction, the move beside still in flight: a write waits for it and is signed by the seat beside", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.equal(placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ listDelayMs: 2000 });
  await fake.control({ ws_close: 4000 });
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  await until(() => saidKind(b, "evicted"), "the eviction word");
  const w = await write(b);
  assert.notEqual(fake.state.writes.at(-1)?.author, "proba", textOf(w));
});

test("an eviction the network kept from standing beside: a write is refused aloud, not signed with the taken seat", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.equal(placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ mcpDrop: 50, mcpDropAction: "iskron_channel:list" });
  await fake.control({ ws_close: 4000 });
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  await until(
    () => b.notifications.some((n) => /встать рядом мост не смог/.test(n.params?.data?.text ?? "")),
    "the failure word",
  );
  const w = await write(b);
  assert.ok(w.result?.isError, textOf(w));
  assert.match(textOf(w), /вызов не отправлен/, textOf(w));
  assert.ok(
    !fake.state.writes.some((x) => x.author === "proba"),
    JSON.stringify(fake.state.writes),
  );
});

test("left by word, then another machine's session stood there: iskron_stand by name stands beside, not registering over its hearing", async (t) => {
  const { fake, cwd, up } = await setup(t);
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
  await fake.control({ ws_refuse: 4001 }); // connect b2 повернул адрес
  const before = placeArgs(fake, "register").length;
  const s1 = await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  const regs = placeArgs(fake, "register").slice(before);
  assert.ok(!regs.includes("proba"), `b1 signed with proba: ${regs}\n${textOf(s1)}`);
  assert.equal(placeOf(s1), "proba.2", textOf(s1));
});

test("an eviction, then the network drops the seat beside's register once: the bridge registers proba.2 and says the outcome", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  assert.equal(placeOf(await stand(b, { realm: "nks-dev", karta: 931, name: "proba" })), "proba");
  await until(() => fake.state.ws.size === 1, "socket");
  await fake.control({ mcpDrop: 1, mcpDropAction: "iskron_channel:register" });
  await fake.control({ ws_close: 4000 });
  await fake.control({ places: [{ karta: 931, name: "proba", listening: true }] });
  await until(() => saidKind(b, "resumed"), `the outcome word:\n${b.stderr}`);
  assert.ok(placeArgs(fake, "register").includes("proba.2"), `${placeArgs(fake, "register")}`);
  assert.match(saidKind(b, "resumed").params.data.text, /встал рядом/);
});
