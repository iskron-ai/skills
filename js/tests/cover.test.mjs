// Разбор обложки для автопосадки корня (shared/cover.ts): граф — первый токен
// @owner/slug или rN, роль — ровно одна ссылка #N в кавычках ПОСТАВКИ в начале значения.
// Кавычки и ключи — параметр: форма соседней EN-поставки (Graph, Agent role, "…" с
// одинаковой открывающей и закрывающей) читается тем же правилом.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { COVER } from "../delivery/index.ts";
import { sameSeat } from "../opencode/rootseat-by.ts";
import { frontMatter, seatOfPairs } from "../shared/cover.ts";

/** Форма соседней поставки: ключи и кавычки ссылки роли свои. */
const EN = { file: "AGENTS.md", graph: "Graph", role: "Agent role", roleQuotes: ['"', '"'] };
const seat = (yaml, keys) => seatOfPairs(frontMatter(`---\n${yaml}\n---\n# x\n`), keys);
const ru = (role, graph = "'@nks/nks-dev (r5)'") =>
  seat(`'Граф': ${graph}\n'Роль агента': ${role}`, undefined);
const en = (role, graph = "'@nks/nks-dev (r5)'") =>
  seat(`'Graph': ${graph}\n'Agent role': ${role}`, EN);
const NKS_931 = { realm: "@nks/nks-dev", karta: "931" };

test("RU: живая строка роли — #931, не #1506 и не #844 из той же строки", () => {
  assert.deepEqual(
    ru(
      '\'`#931 «👨‍💻 Разработчик скилл-репозиториев агента»` — adhikarin, стюард #1506 (и соседнего скилл-репо #844); инбокс `iskron_orient(realm="@nks/nks-dev", focus="931")`\'',
    ),
    NKS_931,
  );
});

test("RU: кавычки поставки — «…»; ссылка в чужих кавычках — не ссылка", () => {
  assert.ok("why" in ru(`'#931 "Разработчик" — стюард'`));
  assert.ok("why" in ru(`'#931 «a» или #844 «b»'`), "две ссылки — неоднозначно");
});

// Дословно строки 'Graph' и 'Agent role' фронтматтера ~/code/verstak-ai/skills/AGENTS.md
// (2026-10-16): внешняя обёртка YAML одинарная, кавычки имени роли внутри — двойные.
const VERSTAK_GRAPH = "'@nks/nks-dev (r5)'";
const VERSTAK_ROLE =
  '\'#931 "👨‍💻 Agent skill-repository developer" — adhikarin, steward of the holon (also of the sibling delivery holon #1506); inbox verstak_orient(focus="931")\'';

test("EN: живая обложка verstak-ai/skills — граф @nks/nks-dev, роль #931, не #1506", () => {
  assert.deepEqual(en(VERSTAK_ROLE, VERSTAK_GRAPH), NKS_931);
});

test("EN: одинаковые кавычки — имя до первой закрывающей, дальше проза", () => {
  assert.deepEqual(en(`'#931 "dev" — see "notes" and #1506'`), NKS_931);
  assert.deepEqual(en(`'#931 "dev" — see "notes" #1506'`), NKS_931);
});

test("EN: внешняя обёртка YAML двойная, внутренние кавычки экранированы — тот же разбор", () => {
  assert.deepEqual(en(`"#931 \\"dev\\" — steward of #1506"`), NKS_931);
});

test("EN: две ссылки, ссылка без кавычек, кавычки RU-поставки — места нет", () => {
  assert.ok("why" in en(`'#931 "a" or #844 "b"'`), "две роли");
  assert.ok("why" in en(`'developer #931'`), "нет ссылки в начале");
  assert.ok("why" in en(`'#931 «dev»'`), "кавычки не этой формы");
});

test("ключи по умолчанию — COVER поставки, с её кавычками", () => {
  assert.deepEqual(COVER.roleQuotes, ["«", "»"]);
  assert.ok("why" in seat(`'Graph': ${VERSTAK_GRAPH}\n'Agent role': ${VERSTAK_ROLE}`));
});

test("F5: короткий граф против слага не считается соответствием по одной роли", () => {
  assert.equal(sameSeat({ name: "x", realm: "@nks/nks-dev", karta: "931" }, "r7", "931"), false);
  assert.equal(sameSeat({ name: "x", realm: "r5", karta: "931" }, "@nks/drugoy", "931"), false);
  assert.equal(sameSeat({ name: "x", realm: "r5", karta: "931" }, "r7", "931"), false);
  assert.equal(sameSeat({ name: "x", realm: "r5", karta: "931" }, "r5", "931"), true);
  assert.equal(
    sameSeat({ name: "x", realm: "_nks_nks-dev", karta: "931" }, "@nks/nks-dev", "931"),
    false,
  );
});

test("F6: REALITY называет носитель автопосадки, фальсификаторы и предел наблюдения", () => {
  const reality = readFileSync(
    process.env.ISKRON_REALITY_PATH || new URL("../../REALITY.md", import.meta.url),
    "utf8",
  );
  const row = reality
    .split("\n")
    .find((line) => line.startsWith("| Корень выровненного проекта садится до первого запроса |"));
  assert.ok(row, "класс заявки записан");
  for (const text of [
    "opencode serve",
    "rootseat-run-opencode.mjs",
    "Фальсификаторы:",
    "Наблюдено",
    "Предел:",
  ])
    assert.ok(row.includes(text), text);
});

test("R5: ссылки предварительного места ведут к узлам, не к делу №777", () => {
  const root = process.env.ISKRON_CORE_SOURCE_ROOT;
  for (const path of [
    "js/bridge/provisional.ts",
    "js/bridge/stand.ts",
    "js/delivery/words/standmoves.ts",
  ]) {
    const text = readFileSync(
      root ? `${root}/${path}` : new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    assert.ok(!text.includes("#777"), path);
    assert.ok(text.includes("#7972"), path);
    assert.ok(text.includes("#5164"), path);
  }
});

test("R3: свежий stand с ответом нормализующего моста доказывает соответствие r5 и слага", async () => {
  const { seatBy } = await import(
    process.env.ISKRON_ROOTSEAT_BY_PATH ||
      new URL("../opencode/rootseat-by.ts", import.meta.url).href
  );
  const place = { name: "probe", karta: "931", realm: "@nks/nks-dev" };
  const slot = { holding: false, busy: 0, lastCall: 0, place: null, key: null };
  const doors = {
    slotFor: async () => slot,
    modelOf: async () => null,
    awaitReady: async () => {},
    callThrough: async (_slot, name, args, session, service) => {
      assert.equal(name, "iskron_stand");
      assert.equal(session, "root");
      assert.equal(service, true);
      assert.equal(args.realm, "r5");
      slot.place = place;
      slot.holding = true;
      return { content: "stood", place };
    },
  };
  const r = await seatBy(doors, "root", "r5", "931");
  assert.equal(r.place, "probe", JSON.stringify(r));
  assert.equal(r.realm, "@nks/nks-dev");
  // The very same seat returned from disk is not evidence of what r5 means.
  const disk = await seatBy(
    { ...doors, callThrough: async () => assert.fail("не делать stand при возврате") },
    "root",
    "r5",
    "931",
  );
  assert.equal(disk.uncompared, "r5", JSON.stringify(disk));
  assert.deepEqual(disk.other, place);
});
