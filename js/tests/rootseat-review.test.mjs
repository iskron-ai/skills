// The second review's falsifiers: proof comes from the serving bridge, never a sanitized key.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { COVER, frontmatter } from "./rootseat-kit.mjs";

const base = process.env.ISKRON_CORE_SOURCE_ROOT
  ? pathToFileURL(process.env.ISKRON_CORE_SOURCE_ROOT + "/")
  : new URL("../../", import.meta.url);
const at = (p) => new URL(p, base).href;
const { seatBy, sameSeat } = await import(at("js/opencode/rootseat-by.ts"));
const { createRootSeats } = await import(at("js/opencode/rootseat.ts"));
const { createSeatLife } = await import(at("js/opencode/rootseat-tools.ts"));
const { holdFilePathOf } = await import(at("js/shared/standings.ts"));
const { setLang } = await import(at("js/shared/lang.ts"));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "rootseat-review-"));
  writeFileSync(join(dir, "AGENTS.md"), frontmatter(COVER));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const slot = {
    holding: true,
    busy: 0,
    lastCall: 0,
    place: { name: "held-probe", karta: "931", realm: "@nks/nks-dev" },
    key: "held-probe--931--_nks_nks-dev",
    session: "root",
  };
  const doors = {
    slotFor: async () => slot,
    awaitReady: async () => {},
    modelOf: async () => null,
    callThrough: async () => assert.fail("already held"),
  };
  const word = async (result) =>
    createRootSeats({
      directoryOf: async () => dir,
      halted: () => false,
      seat: async () => result,
      cancel() {},
      release: async () => {},
      finished() {},
      tell() {},
    }).word("root");
  return { dir, slot, doors, word };
}

test("P2 Opus: no bridge flag means own-seat wording even with a positive disk mark", async (t) => {
  const f = fixture(t);
  const path = holdFilePathOf(f.dir, f.slot.key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ ...f.slot.place, key: f.slot.key, session: "root", provisional: true }),
  );
  f.slot.holding = false;
  const life = createSeatLife({
    ...f.doors,
    authDir: () => f.dir,
    slots: new Map([["root", f.slot]]),
    stopped: () => false,
    forgot() {},
    stood() {},
    failed: assert.fail,
    callThrough: async () => {
      f.slot.holding = true;
      return { content: "stood", place: f.slot.place };
    },
  });
  const r = await life.half.seatRoot("root", "@nks/nks-dev", "931", () => false);
  assert.equal(r.provisional, false, JSON.stringify(r));
  const text = await f.word(r);
  assert.ok(!/без take|without take/.test(text), text);
  assert.match(text, /take/);
});

for (const lang of ["ru", "en"])
  for (const kind of ["mismatch", "uncompared"])
    test(`P3a: ${lang} ${kind} names the held seat and requires take or revoke`, async (t) => {
      const f = fixture(t);
      setLang(lang);
      t.after(() => setLang("ru"));
      f.slot.place = {
        name: "held-probe",
        karta: kind === "mismatch" ? "844" : "931",
        realm: kind === "mismatch" ? "@nks/other" : "r5",
      };
      const r = await seatBy(f.doors, "root", "@nks/nks-dev", "931");
      const text = await f.word(r);
      assert.ok(!/не посажена|not seated/.test(text), text);
      for (const value of [
        "held-probe",
        f.slot.place.karta,
        f.slot.place.realm,
        "iskron_stand",
        "take",
        "revoke",
      ])
        assert.ok(text.includes(value), text);
      assert.match(text, lang === "ru" ? /держит|стоит/ : /holds/);
    });

test("P3b: the queue comment no longer claims old beside-name allocation", () => {
  const text = readFileSync(new URL("js/opencode/rootseat.ts", base), "utf8").replace(/\s+/g, " ");
  assert.ok(!text.includes("reads the board after"));
  assert.match(text.slice(0, 1600), /random|nonce/);
});

test("P3d: random suffix leaves at least 30 readable characters, names stay distinct", async () => {
  const { name } = await import(at("js/bridge/provisional.ts"));
  const prefix = "host.repository.model.with-a-long-readable-name";
  const names = Array.from({ length: 512 }, () => name(prefix));
  assert.equal(new Set(names).size, names.length);
  for (const n of names) {
    assert.ok(n.length <= 48, n);
    assert.ok(n.startsWith(prefix.slice(0, 30)), n);
    assert.match(n, /\.root-[a-f0-9]{8,12}$/);
  }
});

test("P3e: disk fallback uses the record's real realm, never its sanitized key", async (t) => {
  const f = fixture(t);
  const real = f.slot.place;
  f.slot.place = null;
  const r = await seatBy({ ...f.doors, recorded: () => real }, "root", "@nks/nks-dev", "931");
  assert.equal(r.realm, "@nks/nks-dev", JSON.stringify(r));
});

test("P3e: a key without a record does not print sanitized text as a graph", async (t) => {
  const f = fixture(t);
  f.slot.place = null;
  const r = await seatBy({ ...f.doors, recorded: () => null }, "root", "@nks/nks-dev", "931");
  const text = await f.word(r);
  assert.ok(!text.includes("_nks_nks-dev"), text);
  assert.match(text, /неизвест|unknown/);
  assert.ok(text.includes("held-probe"), text);
});

for (const [a, b] of [
  ["@a_b/c", "@a/b_c"],
  ["b_c", "@a_b/c"],
  ["c", "@a/b_c"],
  ["_a_b_c", "@a/b_c"],
  ["@other/b_c", "@a/b_c"],
])
  test(`P3f: ${a} is not ${b}`, () => {
    assert.equal(sameSeat({ name: "x", realm: a, karta: "931" }, b, "931"), false);
    assert.equal(sameSeat({ name: "x", realm: b, karta: "931" }, a, "931"), false);
  });

test("P3f: exact canonical names and whole slug components match", () => {
  for (const [a, b] of [
    [" @a/b_c ", "@a/b_c"],
    ["b_c", "@a/b_c"],
    ["@a/b_c", "b_c"],
    ["r5", "r5"],
  ])
    assert.equal(sameSeat({ name: "x", realm: a, karta: "#931" }, b, "931"), true);
});
