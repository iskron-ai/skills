// Автопосадка корневой сессии OpenCode по AGENTS.md (#931 в @nks/nks-dev): корень без
// parentID в каталоге, чья обложка называет граф и роль агента, к первому модельному
// запросу уже стоит — мост держит и слушает своё место этой роли в этом графе; первая
// запись модели подписана им без stand от модели. Нет обложки, нет полей, поля
// неоднозначны — места нет, и агент слышит, что не посажен; роль не угадывается.
// Два корня одной роли — два места; своё место прежнего моста этой сессии возвращается,
// чужое живое — не берётся.
//
// Стенд — rootseat-kit.mjs: настоящий плагин и настоящие мосты, подставной сервер
// ownseat-kit, ход сессии хуками OpenCode до сценарного провайдера.
// ISKRON_OPENCODE_PLUGIN и ISKRON_BRIDGE_PATH наводят пробу на любые копии.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { test as probe } from "node:test";

import { ROOT_SEAT } from "../delivery/index.ts";
import { OPENCODE_CLIENT } from "../shared/clients.ts";
import { placeArgs, placeOf, setup, stand, textOf, until } from "./ownseat-kit.mjs";
import {
  COVER,
  GRAPH_KEY,
  heardSeats,
  heldBy,
  ROLE_KEY,
  rootPlugin,
  writeAgents,
} from "./rootseat-kit.mjs";

// Автопосадка выключена защитным пакетом (rootSeatOn, #7972): пробы посадки ждут её включения;
// выключенное держит rootseat-off.test.mjs.
const test = (name, opts, fn) => probe(name, { ...opts, skip: "автопосадка выключена (#7972)" }, fn);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { timeout: 90_000 };
const OPENCODE = { name: OPENCODE_CLIENT, version: "1" };
/** Посадка не мгновенна: запрос, отпущенный до неё, увидит пустую доску, а не успевшую. */
const SLOW_CONNECT = { connect_delay_ms: 700 };

/** Каталог и учётка пробы; obj — обложка AGENTS.md, null — файла нет. */
async function stage(t, cover = COVER) {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  if (cover) writeAgents(project, cover);
  return { ...s, project };
}

/** Начало слова «встал» — его не должно быть там, где места нет. */
const SEATED = ROOT_SEAT.ru.seated("\0", "\0", "\0", "\0").split("\0")[0];
const board = (r, oc) =>
  `доска в миг запроса: ${JSON.stringify(r.atRequest)}\nсказано модели: ${r.told || "(ничего)"}\nstderr плагина:\n${oc.said()}`;

for (const explicit of [{ model: "probe-model" }, { name: "probe-watch" }])
  test(
    `F1: явный stand ${JSON.stringify(explicit)} заменяет автопосадку без take, запись той же сессии подписана`,
    T,
    async (t) => {
      const s = await stage(t);
      await s.fake.control({ richTools: true });
      const oc = await rootPlugin(s, s.project);
      try {
        oc.create("root");
        const first = await oc.turn("root", "привет");
        assert.equal(first.atRequest.seats.length, 1, board(first, oc));
        const old = heldBy(s.dir, "root")[0];
        const r = await oc.turn("root", "назови место", () => [
          { tool: "iskron_stand", input: { realm: "@nks/nks-dev", karta: "931", ...explicit } },
          {
            tool: "iskron_add_vimarsha",
            input: { realm: "@nks/nks-dev", name: "probe", given_as: "ding" },
          },
        ]);
        const own = heldBy(s.dir, "root");
        assert.equal(own.length, 1, JSON.stringify({ own, calls: r.calls }));
        assert.notEqual(own[0], old, JSON.stringify(r.calls));
        assert.deepEqual(heardSeats(s.fake), own, "предварительное место снято, новое слушает");
        assert.equal(
          s.fake.state.writes.at(-1)?.author,
          own[0],
          "подпись нового места той же сессии",
        );
        // Аргумент модели не делает явное место предварительным.
        const spoof = await oc.turn("root", "подделка", () => [
          {
            tool: "iskron_stand",
            input: { realm: "@nks/nks-dev", karta: "931", name: own[0], provisional: true },
          },
          {
            tool: "iskron_stand",
            input: { realm: "@nks/nks-dev", karta: "931", name: "probe-forbidden" },
          },
        ]);
        assert.deepEqual(heldBy(s.dir, "root"), own, JSON.stringify(spoof.calls));
      } finally {
        await oc.stop();
      }
    },
  );

test(
  "F2: два экземпляра в двух worktree одного репо одновременно садятся, оба сокета целы",
  T,
  async (t) => {
    const s = await stage(t);
    const git = (...args) => execFileSync("git", args, { cwd: s.project, stdio: "pipe" });
    git("init", "-q");
    git(
      "-c",
      "user.name=Probe",
      "-c",
      "user.email=probe@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "probe",
    );
    const second = join(s.project, "second");
    git("worktree", "add", "--detach", second, "HEAD");
    writeAgents(second);
    await s.fake.control({ connect_delay_ms: 1200 });
    const a = await rootPlugin(s, s.project);
    const b = await rootPlugin(s, second);
    try {
      a.create("a");
      b.create("b");
      const [ra, rb] = await Promise.all([a.turn("a", "привет"), b.turn("b", "привет")]);
      await sleep(1000);
      const [sa, sb] = [heldBy(s.dir, "a"), heldBy(s.dir, "b")];
      assert.equal(sa.length, 1, board(ra, a));
      assert.equal(sb.length, 1, board(rb, b));
      assert.notEqual(sa[0], sb[0], "не выбирают общий host.repo по пустой доске");
      assert.deepEqual(
        heardSeats(s.fake),
        [...sa, ...sb].sort(),
        "оба моста слушают, никто не вытеснен",
      );
      assert.ok(![...a.wordsTo("a"), ...b.wordsTo("b")].some((w) => /отняли|evicted/i.test(w)));
    } finally {
      await b.stop();
      await a.stop();
    }
  },
);

test(
  "F3/F4: повисший connect освобождает очередь; поздний успех сообщён модели вторым словом",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control({ connect_delay_ms: 6000 });
    const oc = await rootPlugin(s, s.project, { ISKRON_ROOT_SEAT_MS: "800" });
    try {
      oc.create("hung");
      await until(() => s.fake.state.counts.connect_asked > 0, "первый connect ушёл и повис");
      const first = await oc.turn("hung", "привет");
      assert.ok(!first.told.includes(SEATED), board(first, oc));
      await s.fake.control({ connect_delay_ms: 0 });
      // После потолка первой посадки следующая обязана идти, не ждать её ответа.
      await sleep(1800);
      oc.create("next");
      const next = await oc.turn("next", "привет");
      assert.equal(heldBy(s.dir, "next").length, 1, board(next, oc));
      assert.ok(next.told.includes(SEATED), board(next, oc));
      assert.deepEqual(heldBy(s.dir, "hung"), [], "первый connect всё ещё висит");
      await until(() => heldBy(s.dir, "hung").length === 1, "поздняя посадка завершилась");
      await until(
        () => oc.wordsTo("hung").some((w) => w.includes(SEATED)),
        "второе слово модели о позднем успехе",
      );
      const words = oc.wordsTo("hung").filter((w) => w.includes(SEATED));
      assert.equal(words.length, 1, JSON.stringify(words));
      assert.ok(words[0].includes(heldBy(s.dir, "hung")[0]));
      assert.deepEqual(
        heardSeats(s.fake),
        [...heldBy(s.dir, "hung"), ...heldBy(s.dir, "next")].sort(),
      );
    } finally {
      // The red baseline still has a queued stand: settle it before cleanup so that
      // it cannot spawn a bridge after its instance stopped.
      await until(
        () => heldBy(s.dir, "hung").length && heldBy(s.dir, "next").length,
        "посадки перед уборкой",
      ).catch(() => {});
      await oc.stop();
    }
  },
);

test(
  "F5: r7 в обложке против своего места в @nks/nks-dev — граф не сличён, ложного успеха нет",
  T,
  async (t) => {
    const s = await stage(t, { ...COVER, [GRAPH_KEY]: "r7" });
    await priorBridge(s, "root", "probe-uncompared", { kill: true });
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      const r = await oc.turn("root", "привет");
      assert.ok(!r.told.includes(SEATED), board(r, oc));
      assert.ok(r.told.includes("граф не сличён"), board(r, oc));
    } finally {
      await oc.stop();
    }
  },
);

test(
  "F4: connect завершился после отказа по сроку — второе слово модели называет позднее место",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control({ connect_delay_ms: 2200 });
    const oc = await rootPlugin(s, s.project, { ISKRON_ROOT_SEAT_MS: "600" });
    try {
      oc.create("root");
      const r = await oc.turn("root", "привет");
      assert.deepEqual(r.atRequest.seats, [], board(r, oc));
      assert.ok(!r.told.includes(SEATED), board(r, oc));
      await until(() => heldBy(s.dir, "root").length === 1, "поздний connect открыл место");
      // Не подменяем посадку явным stand и не просим второй ход: слово само входит в сессию.
      await until(
        () => oc.wordsTo("root").some((w) => w.includes(SEATED)),
        "модель услышала поздний успех",
      );
      const late = oc.wordsTo("root").filter((w) => w.includes(SEATED));
      assert.equal(late.length, 1);
      assert.ok(late[0].includes(heldBy(s.dir, "root")[0]));
    } finally {
      await oc.stop();
    }
  },
);

// ── T1, T2: место к первому запросу ──────────────────────────────────────────

for (const [label, emit] of [
  ["T1: session.created дошло до экземпляра", true],
  ["T2: холодная загрузка — session.created ушло до загрузки экземпляра", false],
])
  test(
    `${label}: корень в каталоге с обложкой графа и роли к первому модельному запросу держит и слушает своё место #931 в @nks/nks-dev`,
    T,
    async (t) => {
      const s = await stage(t);
      await s.fake.control(SLOW_CONNECT);
      const oc = await rootPlugin(s, s.project);
      try {
        oc.create("root", { emit });
        const r = await oc.turn("root", "привет");
        assert.equal(
          r.atRequest.seats.length,
          1,
          `первый запрос ушёл при одном слушающем месте #931 в @nks/nks-dev\n${board(r, oc)}`,
        );
        assert.deepEqual(
          heardSeats(s.fake, null),
          r.atRequest.seats,
          "роль — та, что названа ссылкой «#N «имя»», не #1506 и не #844 из той же строки",
        );
        assert.deepEqual(
          heldBy(s.dir, "root"),
          r.atRequest.seats,
          "место держит мост этой сессии — запись держания несёт её",
        );
      } finally {
        await oc.stop();
      }
    },
  );

// ── T3: первая запись подписана ──────────────────────────────────────────────

test(
  "T3: первая запись модели (сценарный tools/call) подписана местом корня — без stand и register от модели",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control({ richTools: true, ...SLOW_CONNECT });
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      const writes = s.fake.state.writes.length;
      // Сценарий модели — одна запись, ни iskron_stand, ни iskron_channel.
      const r = await oc.turn("root", "запиши вопрос", () => [
        {
          tool: "iskron_add_vimarsha",
          input: { realm: "@nks/nks-dev", name: "проба", given_as: "ding" },
        },
      ]);
      const call = r.calls[0];
      const w = s.fake.state.writes.slice(writes);
      assert.equal(
        w.length,
        1,
        `запись дошла до сервера: ${JSON.stringify(call)}\n${board(r, oc)}`,
      );
      assert.ok(
        w[0].author,
        `запись подписана местом, не безавторная: ${JSON.stringify(w[0])}\n${board(r, oc)}`,
      );
      assert.deepEqual(
        [w[0].author],
        r.atRequest.seats,
        "подписана тем местом, что слушало к первому запросу",
      );
    } finally {
      await oc.stop();
    }
  },
);

// ── T4: не посажен — и знает это ─────────────────────────────────────────────

const ROLE = COVER[ROLE_KEY];
const UNSEATED = [
  ["нет AGENTS.md", null],
  ["в обложке нет полей графа и роли", { Nature: "library", Стек: "markdown" }],
  ["в обложке нет роли агента", { Nature: "library", [GRAPH_KEY]: COVER[GRAPH_KEY] }],
  [
    "роль агента неоднозначна — две роли ссылками",
    { ...COVER, [ROLE_KEY]: "`#931 «👨‍💻 Разработчик»` или `#844 «🔍 Ревьюер»` — по делу" },
  ],
  ["роль агента без ссылки #N «…»", { ...COVER, [ROLE_KEY]: "разработчик, #931" }],
  [
    "граф неоднозначен — два графа",
    { ...COVER, [GRAPH_KEY]: "@nks/nks-dev (r5) или @nks/drugoy (r7)", [ROLE_KEY]: ROLE },
  ],
];

for (const [label, cover] of UNSEATED) {
  test(`T4 (место): ${label} — места нет, роль не угадана`, T, async (t) => {
    const s = await stage(t, cover);
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      const r = await oc.turn("root", "привет");
      await sleep(1500); // посадка в фоне, отпустившая запрос, успела бы
      assert.deepEqual(r.atRequest.seats, [], board(r, oc));
      assert.deepEqual(heardSeats(s.fake, null), [], `ни одно место не слушает\n${board(r, oc)}`);
      assert.deepEqual(placeArgs(s.fake, "connect"), [], "ни одного connect — роль не угадана");
      assert.deepEqual(placeArgs(s.fake, "register"), [], "ни одного register");
    } finally {
      await oc.stop();
    }
  });

  const silent = cover === null;
  test(
    `T4 (слово): ${label} — ${silent ? "тишина: проект не выровнен" : "агент к первому запросу слышит, что не посажен"}`,
    T,
    async (t) => {
      const s = await stage(t, cover);
      const oc = await rootPlugin(s, s.project);
      try {
        oc.create("root");
        const r = await oc.turn("root", "привет");
        if (silent)
          assert.equal(r.told, "", `модели не сказано ничего сверх слов человека\n${board(r, oc)}`);
        else {
          // Форма слова не фиксирована: в промпте, в системной части запроса или словом в сессию до него.
          assert.ok(r.told.length > 0, `модель прочла, что места нет\n${board(r, oc)}`);
          assert.ok(!r.told.includes(SEATED), `ложного «встал» нет\n${board(r, oc)}`);
        }
      } finally {
        await oc.stop();
      }
    },
  );
}

// ── N4: посадка сорвалась ────────────────────────────────────────────────────

/** Срок посадки под пробой — короче умолчания, чтобы проба не ждала его целиком. */
const SEAT_MS = 3000;
const FAILURES = [
  [
    "сервер рвёт каждый connect",
    async (s) => s.fake.control({ mcpDrop: 1000, mcpDropAction: "iskron_channel:connect" }),
    {},
  ],
  ["моста нет", async () => {}, { ISKRON_BRIDGE_PATH: "/nonexistent/bridge.mjs" }],
  [
    "connect не отвечает дольше срока посадки",
    async (s) => s.fake.control({ connect_delay_ms: 20_000 }),
    {},
  ],
];

for (const [label, fail, env] of FAILURES)
  test(
    `N4: обложка верна, ${label} — места нет, запрос ушёл в срок, модель слышит о неудаче, ложного «встал» нет`,
    T,
    async (t) => {
      const s = await stage(t);
      await fail(s);
      const oc = await rootPlugin(s, s.project, { ISKRON_ROOT_SEAT_MS: SEAT_MS, ...env });
      try {
        oc.create("root");
        const r = await oc.turn("root", "привет");
        assert.deepEqual(r.atRequest.seats, [], board(r, oc));
        assert.ok(
          r.atRequest.ms < SEAT_MS + 2000,
          `запрос не держится дольше срока посадки: ${r.atRequest.ms} мс\n${board(r, oc)}`,
        );
        assert.ok(r.told.length > 0, `модель прочла о неудаче посадки\n${board(r, oc)}`);
        assert.ok(!r.told.includes(SEATED), `ложного «встал» нет\n${board(r, oc)}`);
      } finally {
        await oc.stop();
      }
    },
  );

// ── T5: два корня одной роли ─────────────────────────────────────────────────

test(
  "T5: два одновременных корня одной роли в одном каталоге и учётке — два разных места, оба слушают, ни один не вытеснен",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control(SLOW_CONNECT);
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("a");
      oc.create("b");
      const [ra, rb] = await Promise.all([oc.turn("a", "привет"), oc.turn("b", "привет")]);
      assert.ok(ra.atRequest.seats.length >= 1, `у a к запросу есть место\n${board(ra, oc)}`);
      assert.ok(rb.atRequest.seats.length >= 1, `у b к запросу есть место\n${board(rb, oc)}`);
      await sleep(1500); // вытеснение, если оно есть, доходит
      const [a, b] = [heldBy(s.dir, "a"), heldBy(s.dir, "b")];
      assert.equal(a.length, 1, `a держит одно место: ${JSON.stringify({ a, b })}`);
      assert.equal(b.length, 1, `b держит одно место: ${JSON.stringify({ a, b })}`);
      assert.notEqual(a[0], b[0], "места разные");
      assert.deepEqual(heardSeats(s.fake), [a[0], b[0]].sort(), "оба слушают — никто не вытеснен");
    } finally {
      await oc.stop();
    }
  },
);

// ── T6: своё возвращается, чужое не берётся ──────────────────────────────────

/** Мост OpenCode прежнего экземпляра: стоял за сессию session в project и (kill) умер, не уйдя. */
async function priorBridge(s, session, name, { kill, realm = "@nks/nks-dev", karta = 931 }) {
  const b = await s.up(s.dir, undefined, [], OPENCODE);
  await b.call("iskron/resume", { cwd: s.project, session });
  const r = await stand(b, { realm, karta, name, cwd: s.project });
  assert.equal(placeOf(r), name, textOf(r));
  await until(() => heardSeats(s.fake, null).includes(name), `${name} слушает`);
  if (kill) {
    b.kill();
    await until(() => !heardSeats(s.fake, null).includes(name), `${name} без сокета`);
  }
  return b;
}

test(
  "T6: своё место прежнего моста этой сессии в этом каталоге возвращается к первому запросу — нового не заводится",
  T,
  async (t) => {
    const s = await stage(t);
    await priorBridge(s, "root", "proba-own", { kill: true });
    assert.deepEqual(heldBy(s.dir, "root"), ["proba-own"], "запись держания цела");
    const before = placeArgs(s.fake, "connect").length;
    await s.fake.control(SLOW_CONNECT);
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      const r = await oc.turn("root", "привет");
      assert.deepEqual(r.atRequest.seats, ["proba-own"], `своё место вернулось\n${board(r, oc)}`);
      // Возврат может открыть сокет прежним адресом записи — без connect вовсе.
      assert.deepEqual(
        placeArgs(s.fake, "connect")
          .slice(before)
          .filter((n) => n !== "proba-own"),
        [],
        "ни одного connect другого имени",
      );
    } finally {
      await oc.stop();
    }
  },
);

test(
  "T6: чужое место той же роли (другая сессия, слушает) не берётся — корень садится на своё",
  T,
  async (t) => {
    const s = await stage(t);
    await priorBridge(s, "theirs", "proba-theirs", { kill: false });
    const before = placeArgs(s.fake, "connect").length;
    await s.fake.control(SLOW_CONNECT);
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("mine");
      const r = await oc.turn("mine", "привет");
      const own = r.atRequest.seats.filter((n) => n !== "proba-theirs");
      assert.equal(own.length, 1, `к запросу у корня своё место рядом с чужим\n${board(r, oc)}`);
      assert.deepEqual(heldBy(s.dir, "mine"), own, "место держит мост этой сессии");
      assert.ok(
        !placeArgs(s.fake, "connect").slice(before).includes("proba-theirs"),
        "чужое место не переоткрыто",
      );
      await sleep(1000);
      assert.ok(heardSeats(s.fake).includes("proba-theirs"), "чужой сокет цел");
    } finally {
      await oc.stop();
    }
  },
);

for (const [label, prior] of [
  ["другой роли (#844)", { karta: 844 }],
  ["другого графа (@nks/drugoy)", { realm: "@nks/drugoy" }],
])
  test(
    `T6: своё прежнее место ${label}, чем в обложке, не принимается посадкой корня — не посажен, и модель это слышит`,
    T,
    async (t) => {
      const s = await stage(t);
      await priorBridge(s, "root", "proba-other", { kill: true, ...prior });
      const oc = await rootPlugin(s, s.project);
      try {
        oc.create("root");
        const r = await oc.turn("root", "привет");
        assert.deepEqual(r.atRequest.seats, [], `места #931 в @nks/nks-dev нет\n${board(r, oc)}`);
        assert.ok(!r.told.includes(SEATED), `ложного «встал» нет\n${board(r, oc)}`);
        assert.ok(
          r.told.includes("proba-other"),
          `модель слышит, какое своё место вернулось не то\n${board(r, oc)}`,
        );
      } finally {
        await oc.stop();
      }
    },
  );
