// Вне git-репозитория выравнивания нет: дефектный AGENTS.md — прежнее слово «не посажена» с
// причиной, без iskronify и без ожидания; верная обложка — прежняя первичная автопосадка.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ROOT_SEAT } from "../delivery/index.ts";
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
} from "./rootseat-realign-kit.mjs";

test("(m) вне git, дефектный AGENTS.md — «не посажена» с причиной, без ожидания", T, async (t) => {
  const { s, project, oc } = await aligning(t, { repo: "none" });
  const r = await oc.turn("root", "привет");
  const word = ROOT_SEAT.ru.notSeated(ROOT_SEAT.ru.noFrontmatter("AGENTS.md"));
  assert.ok(r.prompt.includes(word), look(oc, r));
  assert.ok(!r.prompt.includes(ALIGN) && !r.prompt.includes("iskronify"), look(oc, r));
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  const next = await oc.turn("root", "ещё");
  await sleep(800);
  assert.equal(connects(s), 0, `ожидания нет — посадки нет\n${look(oc, next)}`);
  assert.equal(next.prompt, "ещё", look(oc, next));
  assert.ok(!oc.wordsTo("root").some(stood), look(oc, next));
});

test("(n) вне git, верная обложка — первичная автопосадка, как на main", T, async (t) => {
  const { s, project, oc } = await aligning(t, { repo: "none", agents: false });
  writeAgents(project); // before the root's first prompt
  const r = await oc.turn("root", "привет");
  assert.ok(r.prompt.includes(SEATED), look(oc, r));
  assert.equal(heldBy(s.dir, "root").length, 1);
  assert.equal(connects(s), 1);
});
