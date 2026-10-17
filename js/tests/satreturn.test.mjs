// Возврат места ребёнка-спутника после перезагрузки плагина, когда сессию обслуживали две
// эпохи (дело №954): stdio-сервер ушёл с ребёнком на .sub-1, его маркер пролежал; ребёнок
// встал заново в живом экземпляре на .sub-2; перезагрузка — и новый экземпляр читает оба
// маркера. Путь ребёнка целиком: adopt.take → children.back → resume по ключу настоящим
// мостом-спутником против подставного сервера. После возврата судят место, а не ключ: чей
// сокет открыт, кем подписана запись ребёнка, доходит ли до него слово.
//
// Стенд — rootseat-kit.mjs (настоящий плагин и мосты, подставной сервер ownseat-kit).
// ISKRON_OPENCODE_PLUGIN и ISKRON_BRIDGE_PATH наводят пробу на любые копии.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { setup, until } from "./ownseat-kit.mjs";
import { COVER, heardSeats, heldBy, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const T = { timeout: 180_000 };
const WATCH_MS = 1000;
const ENV = { ISKRON_BRIDGE_WATCH_MS: String(WATCH_MS) };
const lost = (dir) => readdirSync(dir).filter((f) => f.startsWith("opencode-lost."));
const tagOf = (project) => createHash("sha256").update(`${project}\0`).digest("hex").slice(0, 12);

/** Ребёнок c1 встаёт спутником корня; возвращает имя его места. */
async function childStands(oc, fake, before) {
  const r = await oc.turn("c1", "встань", () => [
    { tool: "iskron_stand", input: { realm: "@nks/nks-dev" } },
  ]);
  await until(
    () => heardSeats(fake).some((n) => /\.sub-\d+$/.test(n) && !before.includes(n)),
    `the child's satellite seat: ${JSON.stringify(r.calls)} ${heardSeats(fake)}\n${oc.said()}`,
    20_000,
  );
  // The hearing watchdog names the session to the child's bridge (resume.ts selectorFrom): its pause
  // record then carries the session, as the live records did after hours of watch.
  await new Promise((r) => setTimeout(r, 3 * WATCH_MS));
  return heardSeats(fake).find((n) => /\.sub-\d+$/.test(n) && !before.includes(n));
}

/**
 * Две эпохи одной сессии на диске: маркер ушедшей (c1 → old) и маркер последней (c1 → fresh),
 * у обоих мест — записи держания паузы. Маркеры возвращаются текстом, файлов в каталоге нет.
 */
async function twoEras(t) {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  writeAgents(project, COVER);
  await s.fake.control({ richTools: true });
  const known = [{ id: "root" }, { id: "c1", parentID: "root" }];
  let oc = await rootPlugin(s, project, ENV, known);
  let root;
  let old;
  let first;
  try {
    await oc.turn("root", "начни");
    await until(() => heardSeats(s.fake).length === 1, "the root seated", 20_000);
    root = heardSeats(s.fake)[0];
    old = await childStands(oc, s.fake, []);
  } finally {
    await oc.stop();
  }
  // The gone era's marker lies untaken: the next instance does not see it yet.
  first = lost(s.dir).map((f) => {
    const text = readFileSync(join(s.dir, f), "utf8");
    rmSync(join(s.dir, f));
    return text;
  });
  assert.equal(first.length, 1, "the first era left one marker");
  await until(() => !heardSeats(s.fake).includes(old), "the first era's child socket gone", 20_000);
  oc = await rootPlugin(s, project, ENV, known);
  let fresh;
  let second;
  try {
    await oc.turn("root", "дальше");
    await until(() => heardSeats(s.fake).includes(root), "the root back", 20_000);
    fresh = await childStands(oc, s.fake, [root, old]);
  } finally {
    await oc.stop();
  }
  second = lost(s.dir).map((f) => {
    const text = readFileSync(join(s.dir, f), "utf8");
    rmSync(join(s.dir, f));
    return text;
  });
  assert.equal(second.length, 1, "the second era left one marker");
  assert.notEqual(old, fresh, "two eras, two seats");
  const keyOf = (name, m) =>
    JSON.parse(m)
      .entries.find((e) => e.session === "c1")
      ?.key?.startsWith(`${name}--`);
  assert.ok(keyOf(old, first[0]) && keyOf(fresh, second[0]), "each marker names its era's seat");
  await until(() => heardSeats(s.fake).length === 0, "every socket gone before the reload", 20_000);
  return { s, project, known, root, old, fresh, first: first[0], second: second[0] };
}

/** The markers back into the grant directory under fixed names, in this order of names. */
function lay(dir, project, texts) {
  const tag = tagOf(project);
  texts.forEach((text, i) =>
    writeFileSync(join(dir, `opencode-lost.@${tag}.${process.pid}.${"ab"[i]}.json`), text),
  );
}

/** After the reload: the child's socket, the author of its write, the word it hears. */
async function judge(oc, s, want, notWant) {
  await until(
    () => heardSeats(s.fake).includes(want),
    `${want} heard after the reload: ${heardSeats(s.fake)}\n${oc.said()}`,
    30_000,
  );
  assert.ok(
    !heardSeats(s.fake).includes(notWant),
    `the former era's seat is not taken: ${heardSeats(s.fake)}`,
  );
  const r = await oc.turn("c1", "запиши", () => [
    { tool: "iskron_add_vimarsha", input: { realm: "nks-dev", name: "x" } },
  ]);
  assert.ok(!r.calls[0]?.error, JSON.stringify(r.calls));
  assert.equal(s.fake.state.writes.at(-1)?.author, want, "the child's write is signed by its seat");
  const body = `слово ребёнку ${Date.now()}`;
  await s.fake.control({
    ws_send: JSON.stringify({
      type: "message",
      id: `m-${Date.now()}`,
      received_at: new Date().toISOString(),
      stale: false,
      content_type: "text/plain",
      body_chars: body.length,
      to_standing: `@tester:${want}`,
      realm: "@nks/nks-dev",
      karta_seq: 931,
      body,
    }),
  });
  await until(
    () => oc.wordsTo("c1").some((w) => w.includes(body)),
    `the word delivered into the child\n${oc.said()}`,
    15_000,
  );
}

for (const order of ["old marker first", "fresh marker first"])
  test(
    `two eras' markers name the child: the seat of the latest era comes back — ${order}`,
    T,
    async (t) => {
      const e = await twoEras(t);
      lay(
        e.s.dir,
        e.project,
        order === "old marker first" ? [e.first, e.second] : [e.second, e.first],
      );
      const oc = await rootPlugin(e.s, e.project, ENV, e.known);
      try {
        await judge(oc, e.s, e.fresh, e.old);
        assert.deepEqual(lost(e.s.dir), [], "both markers taken");
      } finally {
        await oc.stop();
      }
    },
  );

// A gone twin's marker alone: the session is in no fresh marker, but has a fresher record of
// another seat — the twin's seat is not taken by the key; the fresher one comes back.
test(
  "a lone marker of a gone twin names the child's former seat: the former seat is not taken",
  T,
  async (t) => {
    const e = await twoEras(t);
    lay(e.s.dir, e.project, [e.first]);
    const oc = await rootPlugin(e.s, e.project, ENV, e.known);
    try {
      await judge(oc, e.s, e.fresh, e.old);
      assert.deepEqual(
        heldBy(e.s.dir, "c1").includes(e.fresh),
        true,
        "the fresh seat's record kept",
      );
    } finally {
      await oc.stop();
    }
  },
);

// The marker carries the seat's era from its hold record (the bridge's stoodAt): two markers
// are judged by when the session stood on the seat, not by when an instance stopped.
test("the loss marker carries each child's seat era from its hold record", T, async (t) => {
  const e = await twoEras(t);
  const era = (m) => JSON.parse(m).entries.find((x) => x.session === "c1")?.stoodAt;
  assert.equal(typeof era(e.first), "number", e.first);
  assert.equal(typeof era(e.second), "number", e.second);
  assert.ok(era(e.second) > era(e.first), "the second era stood later");
});

// A child's return is silent (#6628, #6550 item 3): the bridge refused the former era's seat and
// the later one did not come back (its address is dead) — not a word or steer into the child;
// the child is ended with a word to its parent naming why: the outdated seat was not taken.
test(
  "a lone twin marker, the later seat does not come back: nothing into the child, the parent hears the outdated seat was not taken",
  T,
  async (t) => {
    const e = await twoEras(t);
    const dir = join(e.s.dir, "standings");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (r.name === e.fresh)
        writeFileSync(
          join(dir, f),
          JSON.stringify({ ...r, url: "ws://127.0.0.1:9/api/channel/ws/dead" }),
        );
    }
    lay(e.s.dir, e.project, [e.first]);
    // The watch slow again: each failing return waits its hello 4 s, a 1 s watch would queue checks.
    const slow = { ISKRON_BRIDGE_WATCH_MS: "600000", ISKRON_CHILD_BACK_PAUSE_MS: "100" };
    const oc = await rootPlugin(e.s, e.project, slow, e.known);
    try {
      const why = /устаревшее место \S+ не взято|outdated seat \S+ was not taken/;
      await until(
        () => oc.wordsTo("root").some((w) => why.test(w) && w.includes(e.old)),
        `the parent hears why: ${JSON.stringify(oc.wordsTo("root"))}\n${oc.said()}`,
        60_000,
      );
      assert.deepEqual(oc.wordsTo("c1"), [], "not a word into the child");
      assert.ok(!heardSeats(e.s.fake).includes(e.old), "the outdated seat is not taken");
    } finally {
      await oc.stop();
    }
  },
);
