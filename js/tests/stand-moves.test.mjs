// Отказы iskron_stand называют рабочий ход (граф nks-dev: #5036 п. 8, контрпримеры
// #7552–#7556): правило api — словом поверхности, вызов — целиком.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { test } from "node:test";

import { channel, setup, stand, textOf, write } from "./ownseat-kit.mjs";

const METH = "@nks/methodology";

// #7556: 409 channel_already_stands_in_realm доходил голым английским, без хода.
test("register refused by channel_already_stands_in_realm reads in the session language with the move", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  await fake.control({ structured: true, registerStandsInRealmNext: 1 });
  const r = await stand(b, { realm: METH, karta: 12, name: "proba-b" });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.equal(fake.state.counts.register_stands_in_realm, 1, "the api refusal was met");
  assert.match(
    text,
    /^Отказано \(409\): канал этого моста уже стоит в графе @nks\/methodology/,
    text,
  );
  assert.match(text, /iskron_channel\(action="list", realm="@nks\/methodology"\)/, text);
  assert.match(text, /iskron_stand\(realm="@nks\/methodology", karta, name=/, text);
  assert.doesNotMatch(text, /channel_already_stands_in_realm|Conflict|already stands/, text);
});

// #7552: после перезапуска плагина iskron_stand ловил 429 socket_reissue_throttled от
// переоткрытия сокета того же места — и отдавал отказ агенту. Вызов пережидает порог сам.
test("connect refused 429 socket_reissue_throttled is waited out inside the call: the agent gets the seat, not the 429", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  await fake.control({ structured: true, connectThrottleNext: 1, connectThrottleRetryS: 1 });
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  const text = textOf(r);
  assert.ok(!r.result?.isError, text);
  assert.equal(fake.state.counts.connect_throttled, 1, "the api throttled the first connect");
  assert.match(text, /стояние \S*proba — роль #931/, text);
  assert.match(text, /вызов переждал порог платформы \(\d+ с\)/, text);
  assert.doesNotMatch(text, /429|socket_reissue_throttled|Too Many/, text);
});

// #7553: iskron_stand(take=true) на другое имя оставлял сессии два места — и каждый case
// просил from_standing. take — переход: прежнее место снимается.
test("take=true onto another seat of the graph revokes the seat the session stood on before", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const taken = await stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  const text = textOf(taken);
  assert.ok(!taken.result?.isError, text);
  assert.match(text, /стояние \S*drugoe — роль #931/, text);
  assert.match(text, /прежнее место этой сессии proba снято/, text);
  assert.ok(fake.state.closedPlaces.has("931:proba"), "the former seat is revoked at the platform");
  assert.ok(!fake.state.closedPlaces.has("931:drugoe"), "the taken seat lives");
  const w = await write(b);
  assert.ok(!w.result?.isError, `the session still writes from the taken seat:\n${textOf(w)}`);
});

// #7554: после перезапуска плагина iskron_stand(realm, status) отказывал «такого места нет» —
// без вызова, которым место вернуть.
test("a status-only call after the seat went from under the bridge names the full call with karta and the former name", async (t) => {
  const { dir, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  b.kill(); // плагин перезапущен: место не отпущено, запись держания цела
  const next = await up(dir);
  const r = await stand(next, { realm: "nks-dev", status: "занят" });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.match(text, /iskron_stand\(realm="[^"]*nks-dev", karta=931, name="proba"\)/, text);
  // Ушёл словом — тот же полный вызов, по месту, которое мост вёл.
  const again = await stand(next, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!again.result?.isError, textOf(again));
  const left = await channel(next, { realm: "nks-dev", action: "leave" });
  assert.ok(!left.result?.isError, textOf(left));
  const parked = await stand(next, { realm: "nks-dev", status: "занят" });
  assert.match(textOf(parked), /ушёл словом/, textOf(parked));
  assert.match(textOf(parked), /iskron_stand\(realm="[^"]*nks-dev", karta=931, name="proba"\)/);
});
