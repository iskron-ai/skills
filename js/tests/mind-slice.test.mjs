// The human's rules from mind in the answer of iskron_stand (graph @nks/nks-dev: kriya #9817,
// outcome #9816, risks #9818 leak and #9819 volume): readiness first, then one read of the slice
// agents,ways; name and one line per rule, the body by number; every word marked personal;
// mind missing, unknown or refused — one line, the seat stands all the same.
//
// ISKRON_BRIDGE_PATH aims the probe at any copy of the bridge.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MIND_SLICE } from "../delivery/index.ts";
import { sliceIn } from "../shared/mindslice.ts";
import { setup, stand, textOf } from "./ownseat-kit.mjs";

const W = MIND_SLICE.ru;
const rules = (n) =>
  Array.from({ length: n }, (_, i) => ({
    seq: 30 + i,
    name: `Правило ${i + 1}: короткое имя правила человека о работе`,
    text: `${"Фрагмент описания правила, обрезанный сервером на восьмидесяти знаках ".slice(0, 80)}…`,
  }));
const mindCalls = (fake) =>
  fake.state.calls.filter(
    (c) => c.name === "iskron_me" || (c.name === "iskron_search" && c.arguments?.realm === "mind"),
  );

async function stood(t, mind) {
  const { fake, up } = await setup(t);
  await fake.control({ mind });
  const b = await up();
  const r = await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${b.stderr}`);
  return { fake, text: textOf(r) };
}

test("iskron_stand: the answer closes with the human's rules — personal mark, a line each, the body by number", async (t) => {
  const { fake, text } = await stood(t, { rules: rules(3) });
  const block = sliceIn(text);
  assert.ok(block, `no rules block in the stand answer:\n${text}`);
  assert.ok(text.endsWith(block), "the block closes the answer");
  const lines = block.split("\n");
  assert.equal(lines[0], W.head(3));
  assert.match(
    lines[0],
    /Личное: ни текст, ни факт записи в дела, брифы, коммиты и граф проекта не переписывай/,
  );
  assert.equal(lines.length, 5, block);
  assert.match(lines[1], /^ {2}📌 Правило 1: [^\n(]+ \(#30\) — Фрагмент описания/);
  assert.equal(lines.at(-1), W.foot(false, 100));
  assert.ok(!block.includes("↳"), "the server's tail is not a rule");
  const sent = mindCalls(fake).map((c) => [c.name, c.arguments]);
  assert.deepEqual(sent, [
    ["iskron_me", { action: "readiness" }],
    [
      "iskron_search",
      {
        realm: "mind",
        q: "",
        attrs_filter: "slice:agents,ways",
        limit: 100,
        include_description: true,
      },
    ],
  ]);
});

// A full page holds rows the rule parser skips (a released node's form): the page is still full,
// the foot still names the next page — the cut is the server's page, not the parsed rules.
test("iskron_stand: a full page with an unparsed row — the foot names the next page", async (t) => {
  const page = rules(100);
  page[99] = { row: `  📌 Отпущенное правило (#129, phenomenon, Pt/At/Vs, v2) · отпущено` };
  const { text } = await stood(t, { rules: page });
  assert.equal(sliceIn(text).split("\n").at(-1), W.foot(true, 100));
});

test("iskron_stand: no own mind — one line, mind is not read", async (t) => {
  const { fake, text } = await stood(t, { missing: true });
  assert.equal(sliceIn(text), W.absent());
  assert.deepEqual(
    mindCalls(fake).map((c) => c.name),
    ["iskron_me"],
    "the short name mind is not asked without an own graph",
  );
});

test("iskron_stand: readiness without the sign — one line «not read», mind is not read", async (t) => {
  const { fake, text } = await stood(t, null);
  assert.equal(sliceIn(text), W.unknown());
  assert.deepEqual(
    mindCalls(fake).map((c) => c.name),
    ["iskron_me"],
  );
});

test("iskron_stand: an empty slice — one line", async (t) => {
  const { text } = await stood(t, { rules: [] });
  assert.equal(sliceIn(text), W.empty());
});

test("iskron_stand: a refused slice read — one line with the refusal, the seat stands", async (t) => {
  const { fake, up } = await setup(t);
  await fake.control({ mind: { refuse: "Ошибка: поиск недоступен" } });
  const b = await up();
  const r = await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, textOf(r));
  assert.equal(sliceIn(textOf(r)), W.unread("Ошибка: поиск недоступен"));
});

test("iskron_stand: 15 rules — the block's bytes, a line per rule", async (t) => {
  const { text } = await stood(t, { rules: rules(15) });
  const block = sliceIn(text);
  assert.equal(block.split("\n").length, 17);
  const bytes = Buffer.byteLength(block);
  t.diagnostic(`rules block of 15: ${bytes} bytes`);
  // A line per rule: name, number and the server's fragment of ~80 characters — no badges, no body.
  assert.ok(bytes < 5000, `${bytes} bytes for 15 rules`);
});
