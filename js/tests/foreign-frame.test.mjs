// Case №1551: one seat on the socket, and a message addressed by to_standing_id to another seat
// (@alari:telegram-bot) reached the agent as its own. A message to an id of no seat of the
// session goes to the journal — id and address, no body — never to the agent; one to the own
// id or without to_standing_id is delivered; the own id not known yet — delivered with the line.
//
// ISKRON_BRIDGE_PATH aims the probe at any copy of the bridge.
import assert from "node:assert/strict";
import { test } from "node:test";

import { setup, stand, textOf, until } from "./ownseat-kit.mjs";
import { pause, seatId, standing } from "./stoporder-kit.mjs";

const NKS = "@nks/nks-dev";
const message = (id, body, to = {}) =>
  JSON.stringify({ type: "message", id, realm: NKS, karta_seq: 931, body, ...to });
const FOREIGN = { to_standing: "@alari:telegram-bot", to_standing_id: "7f0dc20d-foreign" };
const delivered = (b, id) =>
  b.notifications.some((n) => n.params?.data?.kind === "frame" && n.params.data.frame?.id === id);

test("one seat: a message to another seat's id is not given to the agent — a journal line without the body; own id and no id are delivered", async (t) => {
  const env = await setup(t);
  const b = await env.up(undefined, undefined, ["--debug"]);
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(env.fake, NKS, "proba"), "the seat id");
  const own = seatId(env.fake, NKS, "proba");
  await pause(300); // hello names the seat's id to the bridge
  const send = (f) => env.fake.control({ ws_send: f });
  await send(message("f-foreign", "SECRET-OF-ANOTHER", FOREIGN));
  await send(message("f-own", "to me", { to_standing: "@tester:proba", to_standing_id: own }));
  await send(message("f-none", "no address id"));
  await until(() => delivered(b, "f-own") && delivered(b, "f-none"), "own and unaddressed");
  await pause(300);
  assert.ok(!delivered(b, "f-foreign"), `another seat's message reached the agent:\n${b.stderr}`);
  const line = b.stderr.split("\n").find((l) => l.includes("not given to the agent"));
  assert.ok(line, `no journal line:\n${b.stderr}`);
  for (const f of ["id f-foreign", "to_standing_id 7f0dc20d-foreign", "@alari:telegram-bot", NKS])
    assert.ok(line.includes(f), `${f} not in: ${line}`);
  assert.ok(line.includes("karta_seq 931"), line);
  assert.ok(
    !b.stderr.includes("SECRET-OF-ANOTHER"),
    `the body leaked to the journal:\n${b.stderr}`,
  );
  // --debug: every message's id and address fields, still no body.
  for (const id of ["f-foreign", "f-own", "f-none"])
    assert.match(b.stderr, new RegExp(`debug: message id ${id}, to_standing_id`), b.stderr);
});

test("one seat whose id the bridge never learnt: a message to another id is delivered as before, with the journal line «own id unknown»", async (t) => {
  const env = await setup(t);
  await env.fake.control({ registerNoId: true, helloNoIds: true });
  const b = await env.up();
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => env.fake.state.ws.size === 1, "the socket");
  await pause(300);
  await env.fake.control({ ws_send: message("f-unknown", "maybe mine", FOREIGN) });
  await until(() => delivered(b, "f-unknown"), "the frame delivered");
  await until(() => /own id unknown.*id f-unknown/.test(b.stderr), `the line:\n${b.stderr}`);
});

test("a frame not of type message is not looked at, even addressed to another seat", async (t) => {
  const { fake, b } = await standing(t);
  await pause(300);
  await fake.control({ ws_send: JSON.stringify({ type: "ping-x", id: "c-1", ...FOREIGN }) });
  await pause(300);
  assert.ok(!/another seat.*c-1/.test(b.stderr), b.stderr);
});
