// Отказы iskron_stand называют рабочий ход (граф nks-dev: #5036 п. 8, контрпримеры
// #7552–#7556): правило api — словом поверхности, вызов — целиком.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

// #7556, форма api 0.124: отказ называет место канала в графе (data.your_standings) — ход им.
test("register refused by channel_already_stands_in_realm with your_standings names that seat in the move", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  // The channel stands in the graph by another hand (an earlier run of the session) and as
  // another role (#5418): the bridge leads no seat there, the api knows it and names no role.
  const [ch] = [...fake.state.channels.values()];
  ch.places.set("@nks/methodology", { karta: "7", name: "m-a", standing_id: "s-m-a" });
  await fake.control({ structured: true, oneSeatPerRealm: true });
  const r = await stand(b, { realm: METH, karta: 12, name: "m-b" });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.equal(fake.state.counts.register_stands_in_realm, 1, `the api refusal was met:\n${text}`);
  assert.match(
    text,
    /^Отказано \(409\): канал этого моста уже стоит в графе @nks\/methodology/,
    text,
  );
  // The refused call's role is not the seat's: the move leaves karta open and points at the board.
  assert.ok(text.includes(`iskron_stand(realm="${METH}", karta, name="m-a")`), text);
  assert.doesNotMatch(text, /karta=12/, text);
  assert.ok(text.includes(`iskron_channel(action="list", realm="${METH}")`), text);
  assert.match(text, /standing=<m-a>/, text);
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

// #7552, своё переоткрытие: сокет места упал, мост переоткрывает его сам, а connect вызова
// ловит 429 — вызов дожидается своего сокета и отвечает «возвращено», второго connect нет.
// Без take вызов при своём переоткрытии идёт register; connect — только take=true.
test("429 met while the bridge itself reopens the seat's socket: the call waits for its own socket, no second connect", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const connects = fake.state.counts.connect;
  await fake.control({ structured: true, connectThrottleNext: 1, connectThrottleRetryS: 8 });
  await fake.control({ ws_close: 1011 }); // мост переоткроет сокет сам через ~2 с
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba", take: true });
  const text = textOf(r);
  assert.ok(!r.result?.isError, text);
  assert.equal(fake.state.counts.connect_throttled, 1, "the call's connect met the 429");
  assert.equal(
    fake.state.counts.connect,
    connects,
    "no second connect: the socket is the bridge's own",
  );
  assert.match(text, /твоё — возвращено/, text);
  assert.doesNotMatch(text, /429|socket_reissue_throttled|Too Many/, text);
});

// #7439 в ожидании 429: владелец снял место, пока вызов пережидал порог, — после стопа место
// не занимает ничто, кроме нового слова человека: второго connect нет, ответ — слово стопа.
// Сокет места падает, мост переоткрывает его сам (~2 с), и переоткрытие встречает 4001
// владельца — тем временем вызов take=true пережидает 429.
test("the owner takes the seat off while the call waits out a 429: no connect after the wait, the answer is the stop", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const connects = fake.state.counts.connect;
  await fake.control({ structured: true, connectThrottleNext: 1, connectThrottleRetryS: 8 });
  await fake.control({ ws_refuse: 4001 });
  await fake.control({ ws_close: 1011 });
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba", take: true });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.equal(fake.state.counts.connect, connects, "no connect after the owner's stop");
  assert.match(text, /ты остановлен/, text);
  assert.doesNotMatch(text, /429|socket_reissue_throttled|возвращено/, text);
});

// #7439 при переходе: take=true с места proba на drugoe пережидает 429, а владелец снимает
// прежнее место proba — сессия остановлена, хотя новое место никто не снимал: повторного
// connect нет, ответ — слово стопа.
test("the owner takes the former seat off while take=true onto another seat waits out a 429: no connect after the wait, the answer is the stop", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const connects = fake.state.counts.connect;
  await fake.control({ structured: true, connectThrottleNext: 1, connectThrottleRetryS: 8 });
  const pending = stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  while (!fake.state.counts.connect_throttled) await new Promise((r) => setTimeout(r, 50));
  await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const r = await pending;
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.equal(fake.state.counts.connect, connects, "no connect after the owner's stop");
  assert.match(text, /ты остановлен/, text);
  assert.doesNotMatch(text, /429|socket_reissue_throttled|стояние \S*drugoe/, text);
});

// #7439 в повторном connect: владелец снимает прежнее место, пока повторный connect после 429
// ещё в пути, — поздний ответ не держится: новое место снято, сокета у него нет, ответ — слово стопа.
test("the owner takes the former seat off while take=true's repeated connect after a 429 is in flight: the new seat is taken off again, not held", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const asked = fake.state.counts.connect_asked;
  const upgrades = fake.state.counts.ws_upgrades;
  await fake.control({ structured: true, connectThrottleNext: 1, connectThrottleRetryS: 1 });
  await fake.control({ connect_delay_ms: 1500 });
  const pending = stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  while (fake.state.counts.connect_asked < asked + 2) await new Promise((r) => setTimeout(r, 50));
  await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const r = await pending;
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.match(text, /ты остановлен/, text);
  assert.doesNotMatch(text, /стояние \S*drugoe/, text);
  assert.ok(fake.state.closedPlaces.has("931:drugoe"), "the seat the late connect took is revoked");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.state.counts.ws_upgrades, upgrades, "no socket held for the new seat");
});

// #7439, страж на выходе вызова: register нового места ответил успехом уже после стопа —
// ответ всё равно слово стопа, привязки нет: следующая запись идёт не от нового места.
test("a register that answers after the owner's stop leaves no binding: the answer is the stop, the next write is not from the new seat", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  await fake.control({ structured: true });
  fake.state.standingRegisterDelayMs = 1500;
  const pending = stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  const heard = () => [...fake.state.ws].some((s) => fake.state.wsNames.get(s) === "drugoe");
  while (!heard()) await new Promise((r) => setTimeout(r, 50));
  await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const r = await pending;
  fake.state.standingRegisterDelayMs = 0;
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.match(text, /ты остановлен/, text);
  assert.doesNotMatch(text, /стояние \S*drugoe/, text);
  await write(b);
  const last = fake.state.writes.at(-1);
  assert.notEqual(last?.author, "drugoe", "the next write is not from the new seat");
  assert.ok(fake.state.closedPlaces.has("931:drugoe"), "the seat the call bound is revoked");
});

// #7439 рядом: стоп пришёл, пока вызов ждал ответа revoke прежнего места рядом, — register
// нового места рядом не оставляет привязки, запись в тот граф не идёт от него.
test("the owner's stop during the revoke of the former seat beside: the register after it leaves no binding to the new seat", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const near = await stand(b, { realm: METH, karta: 12, name: "m-a" });
  assert.ok(!near.result?.isError, textOf(near));
  await fake.control({ structured: true, revokeReplyDelayMs: 1500 });
  const pending = stand(b, { realm: METH, karta: 12, name: "m-b", take: true });
  while (!fake.state.closedPlaces.has("12:m-a")) await new Promise((r) => setTimeout(r, 50));
  await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const r = await pending;
  await fake.control({ revokeReplyDelayMs: 0 });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.match(text, /ты остановлен/, text);
  assert.doesNotMatch(text, /стояние \S*m-b/, text);
  await write(b, METH);
  const last = fake.state.writes.at(-1);
  assert.notEqual(last?.author, "m-b", "the next write is not from the new seat beside");
});

// #7439 при откате: стоп пришёл, пока вызов ждал отказа register нового места, — прежнее место
// не держится снова и held не звучит: held снимает запрет побудок (OpenCode), стоп его не вернёт.
test("the owner's stop while register of the new seat is refused: the former seat is not held again, no held, the answer is the stop", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  await fake.control({ structured: true, standingRefuseNext: 1 });
  fake.state.standingRefuseDelayMs = 1500;
  const said = b.notifications.length;
  const pending = stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  const heard = () => [...fake.state.ws].some((s) => fake.state.wsNames.get(s) === "drugoe");
  while (!heard()) await new Promise((r) => setTimeout(r, 50));
  await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const r = await pending;
  fake.state.standingRefuseDelayMs = 0;
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.match(text, /ты остановлен/, text);
  assert.doesNotMatch(text, /осталась на прежнем месте/, text);
  await new Promise((r) => setTimeout(r, 300));
  const kinds = b.notifications.slice(said).map((n) => n.params?.data?.kind);
  const after = kinds.slice(kinds.indexOf("stopped"));
  assert.ok(kinds.includes("stopped"), `the stop is said: ${kinds.join(", ")}`);
  assert.ok(!after.includes("held"), `no held after the stop: ${kinds.join(", ")}`);
  const names = [...fake.state.ws].map((s) => fake.state.wsNames.get(s));
  assert.ok(!names.includes("proba"), `the former seat is not held again: ${names.join(", ")}`);
});

// #7553 при отказе register: connect нового места прошёл, register отказан — переход не удался:
// новое место снято, сессия осталась на прежнем, оно у неё единственное.
test("register refused after take=true's connect onto another seat undoes the move: the new seat is revoked, the former one stays the only one", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  await fake.control({ structured: true, standingRefuseNext: 1 });
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.match(text, /503/, text);
  assert.match(text, /осталась на прежнем месте proba/, text);
  assert.ok(fake.state.closedPlaces.has("931:drugoe"), "the seat just taken is revoked");
  assert.ok(!fake.state.closedPlaces.has("931:proba"), "the former seat lives");
  await new Promise((r) => setTimeout(r, 300));
  const names = [...fake.state.ws].map((s) => fake.state.wsNames.get(s));
  assert.ok(names.includes("proba"), `the former seat is held again: ${names.join(", ")}`);
  const w = await write(b);
  assert.ok(!w.result?.isError, `the session writes from the former seat:\n${textOf(w)}`);
});

// #7556 после connect: отказ register за свежим connect шёл мимо слова правила — голым английским.
test("register refused by channel_already_stands_in_realm after a fresh connect reads in the session language with the move", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  await fake.control({ structured: true, registerStandsInRealmNext: 1 });
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.equal(fake.state.counts.register_stands_in_realm, 1, "the api refusal was met");
  assert.match(text, /^Отказано \(409\): канал этого моста уже стоит в графе \S*nks-dev/, text);
  assert.match(text, /iskron_channel\(action="list", realm="\S*nks-dev"\)/, text);
  assert.doesNotMatch(text, /channel_already_stands_in_realm|Conflict|already stands/, text);
});

// #7553 рядом: смена места take=true во втором графе кончалась 409 — прежнее место искали
// только в основном графе. Канал стоит в графе один раз: прежнее место рядом снимается до register.
test("take=true onto another seat of a graph beside revokes the former seat there first: no 409", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const near = await stand(b, { realm: METH, karta: 12, name: "m-a" });
  assert.ok(!near.result?.isError, textOf(near));
  await fake.control({ structured: true, oneSeatPerRealm: true });
  const taken = await stand(b, { realm: METH, karta: 12, name: "m-b", take: true });
  const text = textOf(taken);
  assert.ok(!taken.result?.isError, text);
  assert.equal(fake.state.counts.register_stands_in_realm ?? 0, 0, "no 409 from the api");
  assert.match(text, /прежнее место этой сессии m-a снято/, text);
  assert.ok(fake.state.closedPlaces.has("12:m-a"), "the former seat beside is revoked");
  assert.ok(!fake.state.closedPlaces.has("931:proba"), "the main seat lives");
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

// #7553 с местами рядом: take на другое основное имя открывал новый канал — двери мест рядом
// терялись, а revoke прежнего основного получал 409 (#6499) при успешном ответе вызова. Отказ до connect.
test("take=true onto another main seat while seats beside stand is refused before connect: the seats beside and their doors live", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const near = await stand(b, { realm: METH, karta: 12, name: "m-a" });
  assert.ok(!near.result?.isError, textOf(near));
  const connects = fake.state.counts.connect;
  const taken = await stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  const text = textOf(taken);
  assert.equal(taken.result?.isError, true, text);
  assert.equal(fake.state.counts.connect, connects, "no connect: the channel is not reopened");
  assert.match(text, /m-a \(@nks\/methodology\)/, text);
  assert.match(
    text,
    /iskron_channel\(action="revoke", realm="@nks\/methodology", karta="12", standing="m-a"\)/,
    text,
  );
  assert.match(text, /iskron_stand\(realm="\S*nks-dev", karta=931, name="proba"\)/, text);
  assert.equal(fake.state.closedPlaces.size, 0, "nothing revoked");
  const w = await write(b, METH);
  assert.ok(!w.result?.isError, `the seat beside still writes:\n${textOf(w)}`);
});

// Отказ revoke прежнего места после перехода не глотается: вызов сообщает его ошибкой.
test("take=true onto another seat whose former seat's revoke is refused reports it as an error", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  await fake.control({ revokeRefuseNext: [{ text: "revoke boom" }] });
  const taken = await stand(b, { realm: "nks-dev", karta: 931, name: "drugoe", take: true });
  const text = textOf(taken);
  assert.equal(taken.result?.isError, true, text);
  assert.match(text, /стояние \S*drugoe — роль #931/, text);
  assert.match(text, /прежнее место этой сессии proba не снято \(revoke boom\)/, text);
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

// #7554, чужое место: подсказка брала новейшую запись каталога по одному слагу — и могла
// назвать место чужого владельца графа или другого харнеса.
test("the full call after a restart names this session's seat, not a newer record of another owner's graph or harness", async (t) => {
  const { dir, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  b.kill();
  const holds = join(dir, "standings");
  const rec = readdirSync(holds)
    .filter((f) => f.endsWith(".hold"))
    .map((f) => JSON.parse(readFileSync(join(holds, f), "utf8")))
    .find((x) => x.name === "proba");
  assert.ok(rec, "the seat's hold record");
  const later = Date.now() + 60_000;
  const plant = (file, patch) =>
    writeFileSync(join(holds, file), JSON.stringify({ ...rec, ...patch, at: later }) + "\n");
  plant("alien.hold", { realm: "@alien/nks-dev", name: "chuzhoe", key: "alien" });
  plant("other.hold", { name: "drugoi-harness", client: "another-harness", key: "other" });
  const next = await up(dir);
  const r = await stand(next, { realm: "nks-dev", status: "занят" });
  const text = textOf(r);
  assert.match(text, /iskron_stand\(realm="[^"]*nks-dev", karta=931, name="proba"\)/, text);
  assert.doesNotMatch(text, /chuzhoe|drugoi-harness|@alien/, text);
});
