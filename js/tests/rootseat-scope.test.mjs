// Где выравнивание корня кончается: только каталог, совпадающий с корнем репозитория, ждёт своей
// обложки (подкаталог — прежняя первичная посадка, без ожидания); перенос сессии снимает её
// ожидание в старом экземпляре; тул сессии будит только её ждущий корень, не соседний.
//
// Стенд — rootseat-kit.mjs; ISKRON_OPENCODE_PLUGIN наводит пробу на другую копию плагина.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_SIGNS } from "../delivery/index.ts";
import { until } from "./ownseat-kit.mjs";
import { heldBy, writeAgents } from "./rootseat-kit.mjs";
import {
  ALIGN,
  aligning,
  connects,
  look,
  SEATED,
  sleep,
  stood,
  T,
  writeRaw,
} from "./rootseat-realign-kit.mjs";

const scratch = (t) => {
  const d = mkdtempSync(join(tmpdir(), "iskron-scope-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

/** Сессия в подкаталоге: первое слово — без выравнивания; позже записанная обложка — без посадки. */
async function subdirQuiet(t, { aligned }) {
  const { s, project, oc } = await aligning(t, {
    repo: aligned ? "partial" : "fresh",
    agents: false,
  });
  if (aligned) writeAgents(project);
  const sub = join(project, "pkg");
  mkdirSync(sub);
  oc.create("sub", { directory: sub });
  const r = await oc.turn("sub", "привет");
  // A fresh repository's onboarding invitation names iskronify too: only the cover's word is not said.
  assert.ok(!r.told.includes(ALIGN), look(oc, r));
  writeAgents(sub);
  await oc.toolAfter("sub", "write", {});
  const next = await oc.turn("sub", "ещё");
  await sleep(800);
  assert.equal(connects(s), 0, `ожидания нет — посадки нет\n${look(oc, next)}`);
  assert.ok(!stood(next.prompt) && !oc.wordsTo("sub").some(stood), look(oc, next));
}

test("(s1) подкаталог выровненного репо — ни слова выравнивания, ни ожидания", T, (t) =>
  subdirQuiet(t, { aligned: true }),
);

test("(s2) подкаталог репо без обложки — тоже без ожидания", T, (t) =>
  subdirQuiet(t, { aligned: false }),
);

test(
  "(s3) корень репо под другим написанием (симлинк) — выравнивается, как корень",
  T,
  async (t) => {
    const { project, oc } = await aligning(t);
    const link = join(scratch(t), "link");
    symlinkSync(project, link);
    oc.create("via", { directory: link });
    const r = await oc.turn("via", "привет");
    assert.ok(r.prompt.includes(ALIGN), look(oc, r));
  },
);

test("(s4) ждущий корень перенесён — правка старой обложки и тул не сажают", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  const r = await oc.turn("root", "выровняй");
  assert.ok(r.prompt.includes(ALIGN), look(oc, r));
  const other = scratch(t);
  writeAgents(other); // the new folder has a valid cover: a retry reading it would seat
  oc.move("root", other);
  await sleep(300);
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  await sleep(1000);
  assert.equal(connects(s), 0, `посадки нет\n${look(oc)}`);
  assert.equal(heldBy(s.dir, "root").length, 0, look(oc));
  assert.ok(!oc.wordsTo("root").some(stood), look(oc));
});

test("(s5) тул сессии B не сажает ждущую A; A садится своим промптом", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  const repoB = scratch(t);
  mkdirSync(join(repoB, ".git"));
  mkdirSync(join(repoB, REPO_SIGNS.rituals, ".."), { recursive: true });
  writeFileSync(join(repoB, REPO_SIGNS.rituals), "export default {};\n"); // no onboarding invitation
  writeRaw(repoB, "# B\n");
  oc.create("B", { directory: repoB });
  for (const id of ["root", "B"])
    assert.ok((await oc.turn(id, "выровняй")).prompt.includes(ALIGN), look(oc));
  writeAgents(project);
  const t0 = Date.now();
  await oc.toolAfter("B", "write", {});
  const held = Date.now() - t0;
  await sleep(1000);
  assert.equal(connects(s), 0, `тул B не сажает A\n${look(oc)}`);
  assert.ok(!oc.wordsTo("root").some(stood), look(oc));
  assert.ok(held < 1000, `ход B не держится: ${held} мс`);
  const a = await oc.turn("root", "готово");
  assert.ok(a.prompt.includes(SEATED), look(oc, a));
  await until(() => heldBy(s.dir, "root").length === 1, "A встала своим промптом", 10_000);
  assert.equal(connects(s), 1);
});

test("(s6) обложку выровнял субагент — тул ребёнка будит его корень", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  await oc.turn("root", "выровняй");
  oc.create("kid", { parentID: "root" });
  await sleep(200);
  writeAgents(project);
  await oc.toolAfter("kid", "write", {});
  await until(() => heldBy(s.dir, "root").length === 1, "корень встал после тула ребёнка", 20_000);
  assert.equal(connects(s), 1);
});
