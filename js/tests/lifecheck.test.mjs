// Побудка о живости (дело №1046): кадр платформы с provenance.wake="life_check" — не такт.
// Ни свёртка тактов, ни пачка побудки его не берут и не вытесняют; в OpenCode он идёт
// отдельным промптом в очередь корня, а место дочерней сессии ребёнка не будит — корню строка о нём.
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

test("OpenCode: a life check is one queued prompt, the platform's text, the warned seat and the way to answer, no counts riding", async () => {
  const { ch, prompts } = opencode();
  ch.onEvent("A", frameEv(life("life-1", { to_standing: "@alari:host.repo.opus-5" })));
  ch.onEvent("A", frameEv(life("life-2")));
  await pause(50);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].sessionID, "A");
  assert.equal(prompts[0].delivery, "queue");
  const head = `${FRAME_MARK} 8 ч нет твоего действия. Если не обновишь статус, будешь погашен.\n\n`;
  assert.equal(prompts[0].text, `${head}Предупреждено место: host.repo.opus-5.\n${REPLY_RU}`);
  assert.equal(
    prompts[1].text,
    `${head}Предупреждено место: место не названо платформой.\n${REPLY_RU}`,
  );
});

// Case №1046: the frame names its seat by id only — the bridge gives it the name of its seat with
// that id, so the prompt names the very seat warned, not a neighbour's (lifeseat.ts).
test("a life check addressed by id only gets its seat's name from the bridge; an unknown id stays unnamed", async () => {
  const { nameWarnedSeat } = await import("../bridge/lifeseat.ts");
  const primary = { standing: { name: "host.repo.opus-5.sub-3" }, door: { standingId: "id-3" } };
  const byId = life("l1", { to_standing_id: "id-3" });
  nameWarnedSeat(byId, primary);
  assert.equal(byId.to_standing, "host.repo.opus-5.sub-3");
  const other = life("l2", { to_standing_id: "id-5" });
  nameWarnedSeat(other, primary);
  assert.equal(other.to_standing, undefined, "a seat of no bridge here is not guessed");
  const named = life("l3", { to_standing: "@alari:x.sub-5", to_standing_id: "id-3" });
  nameWarnedSeat(named, primary);
  assert.equal(named.to_standing, "@alari:x.sub-5", "the platform's name stays");
});

const REPLY_RU =
  "Ответь действием: обнови занятость — iskron_stand(realm, status=<чем занят>) — или скажи в деле.";

// Решение ведущего №1046 («root»): место дочерней сессии ребёнка не будит — корню строка о
// нём с вызовом revoke; строки «обнови занятость» корню нет: его занятость ребёнка не спасает.
test("OpenCode: a child session's life check wakes not the child: its root gets a line about the seat, with revoke, without the status line", async () => {
  const { ch, prompts } = opencode(
    new Map([
      ["kid", "mid"],
      ["mid", "root"],
    ]),
  );
  ch.onEvent(
    "kid",
    { data: { kind: "held", key: "k", place: { realm: "@x/dev", karta: "931", name: "s.sub-1" } } },
    true,
  );
  ch.onEvent("kid", frameEv(life()), true);
  // Без «held» — место по адресу кадра; корень неизвестен — самый свежий.
  ch.onEvent(
    "orphan",
    frameEv(life("life-2", { to_standing: "@alari:o.sub-2", karta_seq: 48, realm: "@x/dev" })),
    true,
  );
  await pause(50);
  assert.deepEqual(
    prompts.map((p) => p.sessionID),
    ["root", "fresh"],
    "the child was woken",
  );
  assert.ok(prompts.every((p) => p.delivery === "queue"));
  assert.match(prompts[0].text, /место субагента s\.sub-1 предупреждено/);
  assert.ok(
    prompts[0].text.includes(
      'iskron_channel(realm="@x/dev", action="revoke", standing="s.sub-1", karta=931)',
    ),
    prompts[0].text,
  );
  assert.ok(
    prompts[1].text.includes(
      'iskron_channel(realm="@x/dev", action="revoke", standing="o.sub-2", karta=48)',
    ),
    prompts[1].text,
  );
  for (const p of prompts) {
    assert.ok(!p.text.includes("обнови занятость"), `the status line went to the root:\n${p.text}`);
    assert.ok(!p.text.includes("погашен"), "the child's warning text went to the root");
  }
});

// Общий текст кадра — у pi и сторожей (Monitor, exit, Codex): тело и строка хода ответа.
test("the shared frame text of a life check: the platform's text, then the way to answer — ru and en", async () => {
  const { frameToText } = await import("../shared/frame-text.ts");
  const ru = frameToText(life(), "");
  assert.match(ru, /\n8 ч нет твоего действия\. Если не обновишь статус, будешь погашен\.\n/);
  assert.ok(ru.endsWith(`\nПредупреждено место: место не названо платформой.\n${REPLY_RU}`), ru);
  const named = frameToText(life("life-3", { to_standing: "@alari:o.sub-2" }), "");
  assert.ok(named.endsWith(`\nПредупреждено место: o.sub-2.\n${REPLY_RU}`), named);
  const other = frameToText({ ...life(), provenance: { via: "platform" } }, "");
  assert.ok(!other.includes("Ответь действием"), "another platform frame names a way to answer");
  const { FRAME_TEXT } = await import("../delivery/index.ts");
  assert.equal(
    FRAME_TEXT.en.lifeCheckReply(),
    "Answer with an action: update your status — iskron_stand(realm, status=<what you are doing>) — or say a word in the case.",
  );
  assert.equal(FRAME_TEXT.en.lifeCheckSeat("o.sub-2"), "Seat warned: o.sub-2.");
  assert.equal(FRAME_TEXT.en.lifeCheckSeat(""), "Seat warned: the platform did not name the seat.");
  const { OPENCODE } = await import("../delivery/index.ts");
  assert.ok(
    OPENCODE.en
      .lifeCheckChild("s.sub-1", "931", "@x/dev")
      .includes('iskron_channel(realm="@x/dev", action="revoke", standing="s.sub-1", karta=931)'),
  );
  assert.match(OPENCODE.ru.lifeCheckChild("", "", ""), /standing="<имя места>", karta=<роль>/);
});
