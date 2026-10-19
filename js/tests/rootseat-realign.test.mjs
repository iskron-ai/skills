// Корень с дефектной обложкой AGENTS.md: одно слово выровнять скиллом iskronify (не «словом
// человека»), и посадка повторяется сама в той же сессии — после тула, сменившего файл
// обложки, или на следующем промпте; ровно одна. Явный stand за время выравнивания — второго
// места нет, только сличение; стоп владельца, удаление сессии и неоднозначная обложка — места нет.
//
// Стенд — rootseat-kit.mjs: настоящий плагин и мосты, подставной сервер ownseat-kit.
// ISKRON_OPENCODE_PLUGIN наводит пробу на другую копию плагина.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ONBOARD_START, ROOT_SEAT } from "../delivery/index.ts";
import { until } from "./ownseat-kit.mjs";
import { COVER, GRAPH_KEY, heardSeats, heldBy, writeAgents } from "./rootseat-kit.mjs";
import {
  ALIGN,
  aligning,
  connects,
  halts,
  HUMAN,
  look,
  OWN,
  resetStops,
  SEATED,
  sleep,
  stood,
  T,
} from "./rootseat-realign-kit.mjs";

test("(a) без фронтматтера — слово выравнивания, не «словом человека»; места нет", T, async (t) => {
  const { s, oc } = await aligning(t);
  const r = await oc.turn("root", "привет");
  assert.ok(r.prompt.includes(ALIGN) && r.prompt.includes("iskronify"), look(oc, r));
  assert.ok(!r.told.includes(HUMAN), look(oc, r));
  assert.ok(!stood(r.told), `не готовность: ложного «встал» нет\n${look(oc, r)}`);
  await sleep(500);
  assert.deepEqual(heardSeats(s.fake, null), []);
  assert.equal(connects(s), 0);
});

for (const [tool, input] of [
  ["write", { filePath: "AGENTS.md", content: "…" }],
  ["shell", { command: "cat > AGENTS.md" }],
])
  test(
    `(b) обложка записана, затем тул ${tool} — одна посадка и одно «встал» без промпта`,
    T,
    async (t) => {
      const { s, project, oc } = await aligning(t);
      await oc.turn("root", "выровняй");
      writeAgents(project);
      await oc.toolAfter("root", tool, input);
      await until(() => heldBy(s.dir, "root").length === 1, "корень встал после тула", 20_000);
      await until(() => oc.wordsTo("root").some(stood), "«встал» в идущий ход", 10_000);
      await oc.toolAfter("root", tool, input);
      await oc.toolAfter("root", "read", {});
      await sleep(1000);
      assert.equal(heldBy(s.dir, "root").length, 1, look(oc));
      assert.equal(connects(s), 1, `ровно одна посадка\n${look(oc)}`);
      assert.equal(oc.wordsTo("root").filter(stood).length, 1, look(oc));
      const next = await oc.turn("root", "дальше");
      assert.ok(!stood(next.prompt) && !next.prompt.includes(ALIGN), look(oc, next));
      assert.equal(connects(s), 1);
    },
  );

test("(c) обложка записана, следующее событие — промпт: посадка на нём", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  await oc.turn("root", "выровняй");
  writeAgents(project);
  const r = await oc.turn("root", "готово");
  assert.equal(r.atRequest.seats.length, 1, look(oc, r));
  assert.ok(r.prompt.includes(SEATED), look(oc, r));
  await oc.toolAfter("root", "write", {});
  await sleep(800);
  assert.equal(connects(s), 1, `ровно одна посадка\n${look(oc, r)}`);
  assert.equal(oc.wordsTo("root").filter(stood).length, 0, "второго «встал» нет");
});

test("(d) после правки граф неоднозначен — посадки нет, точное слово один раз", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  await oc.turn("root", "выровняй");
  writeAgents(project, { ...COVER, [GRAPH_KEY]: "@nks/nks-dev или @nks/drugoy" });
  await oc.toolAfter("root", "edit", {});
  const why = ROOT_SEAT.ru.manyGraphs("AGENTS.md", GRAPH_KEY, "@nks/nks-dev, @nks/drugoy");
  await until(() => oc.wordsTo("root").some((w) => w.includes(why)), "точное слово", 5_000);
  await oc.toolAfter("root", "edit", {});
  const r = await oc.turn("root", "ещё");
  assert.ok(!r.prompt.includes(why), `причина не повторяется\n${look(oc, r)}`);
  assert.equal(oc.wordsTo("root").filter((w) => w.includes(why)).length, 1, look(oc, r));
  await sleep(500);
  assert.equal(connects(s), 0);
  assert.deepEqual(heardSeats(s.fake, null), []);
});

test("(e) явный stand во время выравнивания — второго места нет, только сличение", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  const r = await oc.turn("root", "встань", () => [
    {
      tool: "iskron_stand",
      input: { realm: "@nks/nks-dev", karta: "931", name: "probe-explicit" },
    },
  ]);
  assert.ok(!r.calls[0]?.error, JSON.stringify(r.calls));
  const before = connects(s);
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  await until(
    () => oc.wordsTo("root").some((w) => w.includes(`${OWN}probe-explicit`)),
    "слово «стоит своим местом»",
    10_000,
  );
  await sleep(800);
  assert.deepEqual(heldBy(s.dir, "root"), ["probe-explicit"], look(oc));
  assert.equal(connects(s), before, `второй посадки нет\n${look(oc)}`);
});

test("(f) стоп → перезапуск плагина → правка обложки: посадки нет", T, async (t) => {
  const { s, project, oc, start } = await aligning(t);
  await oc.turn("root", "выровняй");
  halts(s).stop("root", "REALIGN_OWNER_STOP");
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  await sleep(800);
  assert.equal(connects(s), 0, "стоп этого экземпляра держит");
  await oc.stop();
  resetStops();
  const again = await start();
  again.create("root", { emit: false });
  writeAgents(project, { ...COVER, Nature: "library, правка" });
  await again.toolAfter("root", "write", {});
  const r = await again.turn("root", "после перезапуска");
  await again.toolAfter("root", "shell", {});
  await sleep(800);
  assert.equal(connects(s), 0, look(again, r));
  assert.ok(!stood(r.told), look(again, r));
  assert.ok(halts(s).halted("root"), "автоматическое выравнивание стоп не сняло");
});

test("(g) удаление сессии до посадки — места нет", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  await oc.turn("root", "выровняй");
  oc.remove("root");
  await sleep(100);
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  await sleep(800);
  assert.equal(connects(s), 0);
  assert.deepEqual(heardSeats(s.fake, null), []);
});

test("(g) удаление сессии во время посадки — места нет, слова нет", T, async (t) => {
  const { s, project, oc } = await aligning(t);
  await oc.turn("root", "выровняй");
  await s.fake.control({ connect_delay_ms: 1500 });
  writeAgents(project);
  // The hook waits for the seating it started: the session goes while it waits.
  const after = oc.toolAfter("root", "write", {});
  await until(() => s.fake.state.counts.connect_asked > 0, "посадка в полёте");
  oc.remove("root");
  await after;
  await sleep(3000);
  assert.deepEqual(heardSeats(s.fake, null), [], look(oc));
  assert.deepEqual(heldBy(s.dir, "root"), [], look(oc));
  assert.ok(!oc.wordsTo("root").some(stood), look(oc));
});

test("(h) нет фронтматтера и приглашение онбординга — одно слово", T, async (t) => {
  const { s, project, oc } = await aligning(t, { repo: "fresh" });
  const text = await oc.promptOnly("root", "hello");
  assert.equal(text, `hello\n${ONBOARD_START.ru.start()}`);
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  await until(() => heldBy(s.dir, "root").length === 1, "выровненный корень встал", 20_000);
});

test(
  "(i) свежий git-репо без AGENTS.md — приглашение, ожидание; обложка и тул — одна посадка",
  T,
  async (t) => {
    const { s, project, oc } = await aligning(t, { repo: "fresh", agents: false });
    const text = await oc.promptOnly("root", "hello");
    assert.equal(text, `hello\n${ONBOARD_START.ru.start()}`, "одно слово — приглашение");
    writeAgents(project);
    await oc.toolAfter("root", "write", { filePath: "AGENTS.md" });
    await until(() => heldBy(s.dir, "root").length === 1, "корень встал после тула", 20_000);
    await until(() => oc.wordsTo("root").some(stood), "«встал» в идущий ход", 10_000);
    await oc.toolAfter("root", "shell", {});
    await sleep(800);
    assert.equal(connects(s), 1, `ровно одна посадка\n${look(oc)}`);
    assert.equal(oc.wordsTo("root").filter(stood).length, 1, look(oc));
  },
);

test(
  "(i') репо с признаками выравнивания, но без AGENTS.md — слово выравнивания «нет AGENTS.md»",
  T,
  async (t) => {
    const { s, project, oc } = await aligning(t, { agents: false });
    const r = await oc.turn("root", "привет");
    assert.ok(
      r.prompt.includes(ROOT_SEAT.ru.realign(ROOT_SEAT.ru.noFile("AGENTS.md"), "AGENTS.md")),
      look(oc, r),
    );
    assert.ok(!r.prompt.includes(ONBOARD_START.ru.start()), look(oc, r));
    writeAgents(project);
    const next = await oc.turn("root", "готово");
    assert.ok(next.prompt.includes(SEATED), look(oc, next));
    assert.equal(connects(s), 1);
  },
);

// Вне репозитория обложки ждать не от чего: ни слова, ни ожидания; появившийся файл этой
// сессии не сажает — ни после тула, ни на следующем промпте (сядет новая сессия).
test("(j) каталог вне репо без AGENTS.md — ни слова, ни ожидания", T, async (t) => {
  const { s, project, oc } = await aligning(t, { repo: "none", agents: false });
  const r = await oc.turn("root", "привет");
  assert.equal(r.prompt, "привет", look(oc, r));
  writeAgents(project);
  await oc.toolAfter("root", "write", {});
  const next = await oc.turn("root", "ещё");
  await sleep(800);
  assert.equal(next.prompt, "ещё", look(oc, next));
  assert.equal(connects(s), 0);
  assert.deepEqual(oc.wordsTo("root"), []);
});
