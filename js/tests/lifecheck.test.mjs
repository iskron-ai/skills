// Побудка о живости (дело №1046): кадр платформы с provenance.wake="life_check" — не такт.
// Ни свёртка тактов, ни пачка побудки его не берут и не вытесняют; в OpenCode он идёт
// отдельным промптом в очередь корня — и место дочерней сессии будит её корень, не её саму.
// Исходники импортируются напрямую (Node снимает типы), как в eventcopy.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Backlog } from "../bridge/backlog.ts";
import { FRAME_MARK } from "../delivery/protocol.ts";
import { foldedTacts, isLifeCheck, isTact, onlyTacts, splitBatch } from "../shared/seen.ts";

process.env.ISKRON_BRIDGE_LANG = "ru";
const { setupChannel } = await import("../opencode/channel.ts");

const life = (id = "life-1", extra = {}) => ({
  type: "message",
  id,
  origin: "platform",
  provenance: { via: "platform", auth: "none", wake: "life_check", force: true },
  content_type: "text/plain",
  body: "8 ч нет твоего действия. Если не обновишь статус, будешь погашен.",
  ...extra,
});
const tact = (n, at) => ({
  type: "message",
  id: `tact-${n}`,
  origin: "platform",
  provenance: { via: "platform", wake: "look_up" },
  received_at: at,
  body: `Час на «вахта ${n}»`,
});
const none = () => false;

test("a life check is told by provenance.wake and is not a tact", () => {
  assert.equal(isLifeCheck(life()), true);
  assert.equal(isTact(life()), false);
  assert.equal(isLifeCheck(tact(1)), false);
  assert.equal(isLifeCheck({ type: "message", provenance: { via: "platform" } }), false);
  assert.equal(onlyTacts([life()]), false);
});

test("a tact after a life check folds neither it nor into it: the life check stays in the batch", () => {
  const all = [life(), tact(1, "2026-10-18T09:00:00Z"), tact(2, "2026-10-18T10:00:00Z")];
  const folded = foldedTacts(all);
  assert.ok(!folded.has(all[0]), "the life check was folded by a tact");
  assert.deepEqual(
    [...folded].map((f) => f.id),
    ["tact-1"],
  );
  const { kept } = splitBatch(all, Infinity, none);
  assert.deepEqual(
    kept.map((f) => f.id),
    ["life-1", "tact-2"],
  );
});

test("a wake window does not take a life check: it goes its own way", () => {
  const b = new Backlog(none);
  let ev = null;
  b.open(0, (e) => (ev = e));
  assert.equal(b.note(life()), false, "the life check joined the wake window");
  assert.equal(b.note(tact(1, "2026-10-18T09:00:00Z")), true);
  b.flushNow();
  assert.deepEqual(
    ev.frames.map((f) => f.id),
    ["tact-1"],
  );
  assert.doesNotMatch(ev.text, /погашен/);
});

const opencode = (parents = new Map()) => {
  const prompts = [];
  const ch = setupChannel(
    {
      session: {
        get: async () => ({}),
        prompt: async (o) => (prompts.push(o), { id: `in-${prompts.length}` }),
      },
    },
    () => {},
    () => "fresh",
    parents,
  );
  return { ch, prompts };
};
const frameEv = (f) => ({ data: { kind: "frame", frame: f, raw: JSON.stringify(f) } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("OpenCode: a life check is one queued prompt, the platform's text and the way to answer, no counts riding", async () => {
  const { ch, prompts } = opencode();
  ch.onEvent("A", frameEv(life()));
  await pause(50);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].sessionID, "A");
  assert.equal(prompts[0].delivery, "queue");
  assert.equal(
    prompts[0].text,
    `${FRAME_MARK} 8 ч нет твоего действия. Если не обновишь статус, будешь погашен.\n\n` +
      "Ответь действием: обнови занятость — iskron_stand(realm, status=<чем занят>) — или скажи в деле.",
  );
});

test("OpenCode: a child session's life check wakes its root, not the child", async () => {
  const { ch, prompts } = opencode(
    new Map([
      ["kid", "mid"],
      ["mid", "root"],
    ]),
  );
  ch.onEvent("kid", frameEv(life()), true);
  ch.onEvent("orphan", frameEv(life("life-2")), true);
  await pause(50);
  assert.deepEqual(
    prompts.map((p) => p.sessionID),
    ["root", "fresh"],
    "a child with no known parent goes to the freshest root",
  );
  assert.ok(prompts.every((p) => p.delivery === "queue"));
});
