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
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GLOBAL_PREFIX, ROOT_SEAT } from "../delivery/index.ts";
import { createHalts } from "../opencode/halts.ts";
import { OPENCODE_CLIENT } from "../shared/clients.ts";
import {
  FILE as BRIDGE_UNDER_TEST,
  holdRecord,
  placeArgs,
  placeOf,
  setup,
  stand,
  textOf,
  until,
} from "./ownseat-kit.mjs";
import {
  COVER,
  GRAPH_KEY,
  heardSeats,
  heldBy,
  ROLE_KEY,
  rootPlugin,
  writeAgents,
} from "./rootseat-kit.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = { timeout: 90_000 };
const OPENCODE = { name: OPENCODE_CLIENT, version: "1" };
/** Посадка не мгновенна: запрос, отпущенный до неё, увидит пустую доску, а не успевшую. */
const SLOW_CONNECT = { connect_delay_ms: 700 };

/** Каталог и учётка пробы; obj — обложка AGENTS.md, null — файла нет. */
async function stage(t, cover = COVER) {
  resetStops(); // each fake account reuses ids; stops persist across reloads only within this stage
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  if (cover) writeAgents(project, cover);
  return { ...s, project };
}

/** Начало слова «встал» — его не должно быть там, где места нет. */
const SEATED = ROOT_SEAT.ru.seated("\0", "\0", "\0", "\0").split("\0")[0];
const board = (r, oc) =>
  `доска в миг запроса: ${JSON.stringify(r.atRequest)}\nсказано модели: ${r.told || "(ничего)"}\nstderr плагина:\n${oc.said()}`;
const resetStops = () => {
  for (const key of ["Halts", "LiftedAt", "StopIds", "StopWords"])
    delete globalThis[`${GLOBAL_PREFIX}${key}`];
};

test(
  "round3 P2-1: unload during disk return preserves explicit record, marker and next return",
  T,
  async (t) => {
    const s = await stage(t);
    await priorBridge(s, "root", "round3-returned", { kill: true });
    await s.fake.control({ registerToolDelayMs: 1800 });
    let oc = await rootPlugin(s, s.project);
    try {
      oc.create("root", { emit: false });
      const first = oc.turn("root", "return");
      await until(
        () => heardSeats(s.fake).includes("round3-returned"),
        "returned socket before register reply",
      );
      await oc.stop();
      await first;
      assert.deepEqual(heldBy(s.dir, "root"), ["round3-returned"]);
      const markers = readdirSync(s.dir).filter((f) => f.startsWith("opencode-lost."));
      assert.ok(
        markers.some((f) =>
          JSON.parse(readFileSync(join(s.dir, f), "utf8")).entries?.some(
            (e) => e.session === "root" && e.key?.startsWith("round3-returned--"),
          ),
        ),
        "pending explicit return is in the marker",
      );
      await until(
        () => !heardSeats(s.fake).includes("round3-returned"),
        "old bridge closed without revoke",
      );
      await s.fake.control({ registerToolDelayMs: 0 });
      oc = await rootPlugin(s, s.project);
      oc.create("root", { emit: false });
      const back = await oc.turn("root", "return again");
      assert.deepEqual(back.atRequest.seats, ["round3-returned"], board(back, oc));
      assert.equal(s.fake.state.closedPlaces.size, 0, "explicit place was never revoked");
    } finally {
      await oc.stop();
    }
  },
);

test("round3 P3b: reading the seating stop does not interrupt a turn", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("pure-gate", { emit: false });
    createHalts(
      () => undefined,
      () => s.dir,
      () => {},
      () => {},
    ).stop("pure-gate", "stop");
    assert.equal(await oc.promptOnly("pure-gate", "hello"), "hello");
    assert.equal(oc.interrupts.length, 0);
  } finally {
    await oc.stop();
    resetStops();
  }
});

test(
  "round3 P2-2: explicit stand during automatic connect passes, lifts stop, and survives cleanup",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control({ richTools: true, connect_delay_ms: 1800 });
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      const first = oc.turn("root", "hello");
      await until(() => s.fake.state.counts.connect_asked > 0, "automatic connect in flight");
      const halts = createHalts(
        () => undefined,
        () => s.dir,
        () => {},
        () => {},
      );
      halts.stop("root", "owner stopped");
      const explicit = await oc.turn("root", "stand explicitly", () => [
        {
          tool: "iskron_stand",
          input: { realm: "@nks/nks-dev", karta: "931", name: "round3-explicit", take: true },
        },
        {
          tool: "iskron_add_vimarsha",
          input: { realm: "@nks/nks-dev", name: "probe", given_as: "ding" },
        },
      ]);
      await first;
      assert.ok(!explicit.calls[0]?.error, JSON.stringify(explicit.calls));
      assert.ok(!halts.halted("root"), JSON.stringify(explicit.calls));
      assert.deepEqual(heldBy(s.dir, "root"), ["round3-explicit"]);
      assert.ok(heardSeats(s.fake).includes("round3-explicit"));
      assert.equal(s.fake.state.writes.at(-1)?.author, "round3-explicit");
    } finally {
      await oc.stop();
      resetStops();
    }
  },
);

test("P3c: неизвестный каталог сессии не заменяется домом экземпляра", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("root", { directory: null, emit: false });
    const r = await oc.turn("root", "привет");
    assert.deepEqual(placeArgs(s.fake, "connect"), [], board(r, oc));
    assert.deepEqual(heldBy(s.dir, "root"), []);
    assert.equal(r.prompt, "привет");
  } finally {
    await oc.stop();
  }
});

for (const language of ["ru", "en"])
  test(
    `P2 Opus: старый протокол без признака (${language}) не обещает замену без take`,
    T,
    async (t) => {
      const s = await stage(t);
      const proxy = join(s.project, "legacy-bridge.mjs");
      // The actual built bridge keeps a positive disk mark. Strip only its protocol proof,
      // modelling an older daemon: disk data alone must not authorize the promise.
      writeFileSync(
        proxy,
        `
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const p = spawn(process.execPath, [${JSON.stringify(BRIDGE_UNDER_TEST)}, ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'pipe'] });
process.stdin.pipe(p.stdin); p.stderr.pipe(process.stderr);
createInterface({ input: p.stdout }).on('line', line => {
  const m = JSON.parse(line);
  if (m.params?.data) delete m.params.data.provisional;
  if (m.result) { delete m.result.provisional; if (m.result.structuredContent) delete m.result.structuredContent.provisional; }
  process.stdout.write(JSON.stringify(m) + '\\n');
});
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => p.kill(s));
p.on('exit', c => process.exit(c ?? 0));
`,
      );
      const oc = await rootPlugin(s, s.project, {
        ISKRON_BRIDGE_PATH: proxy,
        ISKRON_BRIDGE_LANG: language,
      });
      try {
        oc.create("root");
        const r = await oc.turn("root", "hello");
        assert.equal(r.atRequest.seats.length, 1, board(r, oc));
        assert.ok(!/без take|without take/.test(r.told), board(r, oc));
        assert.match(r.told, language === "ru" ? /своим местом/ : /own seat/);
        const own = heldBy(s.dir, "root")[0];
        assert.equal(
          holdRecord(s.dir, `${own}--931--_nks_nks-dev`)?.provisional,
          true,
          "диск намеренно положителен — доказательство должно быть из ответа",
        );
      } finally {
        await oc.stop();
      }
    },
  );

test(
  "P2 Opus: мост отвечает признаком в stand, held и resume; явный stand снимает признак",
  T,
  async (t) => {
    const s = await stage(t);
    const b = await s.up(s.dir, { experimental: { "iskron/structured": {} } }, [], OPENCODE);
    await b.call("iskron/resume", { cwd: s.project, session: "root" });
    const r = await b.call(
      "tools/call",
      {
        name: "iskron_stand",
        arguments: { realm: "@nks/nks-dev", karta: "931", provisional: true, cwd: s.project },
      },
      true,
    );
    assert.equal(r.result?.structuredContent?.provisional, true, textOf(r));
    assert.ok(
      b.notifications.some(
        (n) => n.params?.data?.kind === "held" && typeof n.params.data.provisional === "boolean",
      ),
    );
    const back = await b.call("iskron/resume", { cwd: s.project, session: "root" });
    assert.equal(back.result?.provisional, true, JSON.stringify(back));
    const explicit = await stand(b, {
      realm: "@nks/nks-dev",
      karta: "931",
      name: "probe-flag-cleared",
      cwd: s.project,
    });
    assert.equal(explicit.result?.structuredContent?.provisional, false, textOf(explicit));
  },
);

test("P1-1: стоп владельца с диска после перезагрузки не снимается автопосадкой", T, async (t) => {
  const s = await stage(t);
  t.after(resetStops);
  let oc = await rootPlugin(s, s.project);
  try {
    oc.create("root");
    await oc.turn("root", "привет");
    await s.fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
    await until(
      () => readdirSync(s.dir).some((f) => f.startsWith("opencode-stopped.")),
      "стоп записан на диск",
    );
    await oc.stop();
    for (const key of ["Halts", "LiftedAt", "StopIds", "StopWords"])
      delete globalThis[`${GLOBAL_PREFIX}${key}`];
    const before = placeArgs(s.fake, "connect").length;
    oc = await rootPlugin(s, s.project);
    oc.create("root", { emit: false });
    const r = await oc.turn("root", "после перезагрузки");
    assert.equal(placeArgs(s.fake, "connect").length, before, board(r, oc));
    assert.ok(!r.told.includes(SEATED), board(r, oc));
    assert.match(r.system, /останов/);
    assert.ok(
      createHalts(
        () => undefined,
        () => s.dir,
        () => {},
        () => {},
      ).halted("root"),
    );
  } finally {
    await oc.stop();
  }
});

test("regression: явный stand по слову владельца всё ещё снимает стоп", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("root");
    await oc.turn("root", "привет");
    await s.fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
    await until(
      () => readdirSync(s.dir).some((f) => f.startsWith("opencode-stopped.")),
      "стоп записан",
    );
    const r = await oc.turn("root", "встань явно", () => [
      {
        tool: "iskron_stand",
        input: { realm: "@nks/nks-dev", karta: "931", name: "probe-owner-restarted" },
      },
    ]);
    assert.ok(!r.calls[0]?.error, JSON.stringify(r.calls));
    assert.deepEqual(heldBy(s.dir, "root"), ["probe-owner-restarted"]);
    assert.ok(
      !createHalts(
        () => undefined,
        () => s.dir,
        () => {},
        () => {},
      ).halted("root"),
    );
  } finally {
    await oc.stop();
  }
});

test("P1-1: поздний provisional-held не снимает стоп, пришедший во время connect", T, async (t) => {
  const s = await stage(t);
  t.after(resetStops);
  await s.fake.control({ connect_delay_ms: 1200 });
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("root");
    const turn = oc.turn("root", "привет");
    await until(() => s.fake.state.counts.connect_asked > 0, "connect ушёл");
    const halts = createHalts(
      () => undefined,
      () => s.dir,
      () => {},
      () => {},
    );
    halts.stop("root", "остановлен владельцем");
    const r = await turn;
    await sleep(1800);
    assert.ok(halts.halted("root"), board(r, oc));
    assert.ok(!r.told.includes(SEATED), board(r, oc));
    assert.deepEqual(heardSeats(s.fake), []);
  } finally {
    await oc.stop();
  }
});

for (const end of ["remove", "stop"])
  test(`P1-2: ${end} во время connect убирает позднее место, без слова посадки`, T, async (t) => {
    const s = await stage(t);
    await s.fake.control({ connect_delay_ms: 1400 });
    const oc = await rootPlugin(s, s.project);
    let stopped = false;
    try {
      oc.create("root");
      const turn = oc.turn("root", "привет");
      await until(() => s.fake.state.counts.connect_asked > 0, "connect ушёл");
      if (end === "remove") oc.remove("root");
      else {
        await oc.stop();
        stopped = true;
      }
      const r = await turn;
      await until(
        () =>
          s.fake.state.closedPlaces.size > 0 &&
          heardSeats(s.fake).length === 0 &&
          heldBy(s.dir, "root").length === 0,
        "позднее место снято на сервере, сокет и запись держания убраны",
      );
      assert.ok(!r.told.includes(SEATED), board(r, oc));
      assert.ok(!oc.wordsTo("root").some((w) => w.includes(SEATED)));
      assert.deepEqual(heardSeats(s.fake), []);
      assert.deepEqual(heldBy(s.dir, "root"), []);
      assert.ok(
        s.fake.state.closedPlaces.size > 0,
        "позднее место снято на сервере, не только закрыт сокет",
      );
      const before = placeArgs(s.fake, "connect").length;
      const retry = await oc.turn("root", "ещё раз", () => [
        {
          tool: "iskron_stand",
          input: { realm: "@nks/nks-dev", karta: "931", name: "probe-dead-root" },
        },
      ]);
      assert.ok(retry.calls[0]?.error, JSON.stringify(retry.calls));
      assert.equal(placeArgs(s.fake, "connect").length, before);
    } finally {
      if (!stopped) await oc.stop();
    }
  });

for (const language of ["ru", "en"])
  test(
    `P2: явное место после возврата (${language}) требует take для другого имени`,
    T,
    async (t) => {
      const s = await stage(t);
      await priorBridge(s, "root", "probe-explicit", { kill: true });
      const oc = await rootPlugin(s, s.project, { ISKRON_BRIDGE_LANG: language });
      try {
        oc.create("root");
        const r = await oc.turn("root", "привет");
        assert.deepEqual(r.atRequest.seats, ["probe-explicit"], board(r, oc));
        assert.ok(!/без take|without take|предварительн|provisional/i.test(r.told), board(r, oc));
        assert.match(r.told, /iskron_stand/);
        assert.match(r.told, /take/);
        assert.match(r.told, language === "ru" ? /сво[иём]|явн/ : /own|explicit/i);
      } finally {
        await oc.stop();
      }
    },
  );

test(
  "R1: предварительное место возвращается с диска и заменяется явным stand без take",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control({ richTools: true });
    let oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      await oc.turn("root", "привет");
      const old = heldBy(s.dir, "root")[0];
      assert.ok(old);
      await oc.stop();
      await until(() => heardSeats(s.fake).length === 0, "старый мост отпустил сокет");
      oc = await rootPlugin(s, s.project);
      oc.create("root", { emit: false });
      const back = await oc.turn("root", "вернулся");
      assert.deepEqual(back.atRequest.seats, [old], board(back, oc));
      const r = await oc.turn("root", "моё имя", () => [
        {
          tool: "iskron_stand",
          input: { realm: "@nks/nks-dev", karta: "931", name: "probe-after-return" },
        },
        {
          tool: "iskron_add_vimarsha",
          input: { realm: "@nks/nks-dev", name: "probe", given_as: "ding" },
        },
      ]);
      assert.deepEqual(heldBy(s.dir, "root"), ["probe-after-return"], JSON.stringify(r.calls));
      assert.equal(s.fake.state.writes.at(-1)?.author, "probe-after-return");
      assert.equal(holdRecord(s.dir, "probe-after-return--931--_nks_nks-dev")?.provisional, false);
      await oc.stop();
      await until(() => heardSeats(s.fake).length === 0, "явное место отпущено при перезапуске");
      oc = await rootPlugin(s, s.project);
      oc.create("root", { emit: false });
      await oc.turn("root", "ещё вернулся");
      const guarded = await oc.turn("root", "другое имя", () => [
        {
          tool: "iskron_stand",
          input: { realm: "@nks/nks-dev", karta: "931", name: "probe-forbidden" },
        },
      ]);
      assert.deepEqual(
        heldBy(s.dir, "root"),
        ["probe-after-return"],
        JSON.stringify(guarded.calls),
      );
    } finally {
      await oc.stop();
    }
  },
);

for (const language of ["ru", "en"])
  test(
    `R2: слово ${language} объясняет подпись и замену временного места для вахты`,
    T,
    async (t) => {
      const s = await stage(t);
      const oc = await rootPlugin(s, s.project, { ISKRON_BRIDGE_LANG: language });
      try {
        oc.create("root");
        const r = await oc.turn("root", "hello");
        assert.ok(!/не нужен|no iskron_stand needed/i.test(r.told), board(r, oc));
        assert.match(r.told, /iskron_stand/);
        assert.match(r.told, /take/);
        assert.match(r.told, language === "ru" ? /подписан/ : /sign/i);
        assert.match(r.told, language === "ru" ? /вахт|своего имени/ : /watch|own name/i);
      } finally {
        await oc.stop();
      }
    },
  );

test(
  "R3: свежий stand по r5 резолвит граф мостом и сообщает успех, не ложный отказ",
  T,
  async (t) => {
    const s = await stage(t, { ...COVER, [GRAPH_KEY]: "r5" });
    await s.fake.control({ structured: true });
    const oc = await rootPlugin(s, s.project);
    try {
      oc.create("root");
      const r = await oc.turn("root", "привет");
      assert.equal(r.atRequest.seats.length, 1, board(r, oc));
      assert.ok(r.told.includes(SEATED), board(r, oc));
      assert.ok(!r.told.includes("граф не сличён"), board(r, oc));
      // The bridge may retain r5 or resolve it to a slug; either successful fresh stand is seated.
      assert.ok(/r5|@nks\/nks-dev/.test(r.told), board(r, oc));
    } finally {
      await oc.stop();
    }
  },
);

test("R4a: session.created без промпта не занимает место; первый промпт занимает", T, async (t) => {
  const s = await stage(t);
  const oc = await rootPlugin(s, s.project);
  try {
    oc.create("root");
    await sleep(1200);
    assert.deepEqual(heardSeats(s.fake), []);
    assert.deepEqual(heldBy(s.dir, "root"), []);
    assert.deepEqual(placeArgs(s.fake, "connect"), [], "создание не является посадкой");
    const r = await oc.turn("root", "привет");
    assert.equal(r.atRequest.seats.length, 1, board(r, oc));
  } finally {
    await oc.stop();
  }
});

test(
  "R4b: ISKRON_ROOT_SEAT=0 отключает автопосадку и подпись чужой ролью в служебном run",
  T,
  async (t) => {
    const s = await stage(t);
    await s.fake.control({ richTools: true });
    const oc = await rootPlugin(s, s.project, { ISKRON_ROOT_SEAT: "0" });
    try {
      oc.create("root");
      const r = await oc.turn("root", "служебный прогон", () => [
        {
          tool: "iskron_add_vimarsha",
          input: { realm: "@nks/nks-dev", name: "probe", given_as: "ding" },
        },
      ]);
      assert.deepEqual(r.atRequest.seats, [], board(r, oc));
      assert.deepEqual(placeArgs(s.fake, "connect"), []);
      assert.equal(s.fake.state.writes.length, 1);
      assert.ok(!s.fake.state.writes[0].author, "нет подписи роли обложки");
      assert.ok(!r.told.includes(SEATED), board(r, oc));
    } finally {
      await oc.stop();
    }
  },
);

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
    await s.fake.control({ connect_delay_ms: 12000 });
    const oc = await rootPlugin(s, s.project, { ISKRON_ROOT_SEAT_MS: "800" });
    try {
      oc.create("hung");
      const firstTurn = oc.turn("hung", "привет");
      await until(() => s.fake.state.counts.connect_asked > 0, "первый connect ушёл и повис");
      const first = await firstTurn;
      assert.ok(!first.told.includes(SEATED), board(first, oc));
      await s.fake.control({ connect_delay_ms: 0 });
      // После потолка первой посадки следующая обязана идти, не ждать её ответа.
      await sleep(1800);
      oc.create("next");
      const nextTurn = oc.turn("next", "привет");
      await until(
        () =>
          heldBy(s.dir, "next").length === 1 &&
          heardSeats(s.fake).includes(heldBy(s.dir, "next")[0]),
        "следующий корень слушает до ответа первого connect",
      );
      const next = await nextTurn;
      assert.equal(heldBy(s.dir, "next").length, 1, board(next, oc));
      assert.deepEqual(heldBy(s.dir, "hung"), [], "первый connect всё ещё висит");
      // Under the full suite a process can take longer than 800 ms to start. That does not
      // mean its queue was stuck: its successful late word is valid too (F4).
      await until(
        () => next.told.includes(SEATED) || oc.wordsTo("next").some((w) => w.includes(SEATED)),
        "следующий корень услышал своё место",
      );
      await until(() => heldBy(s.dir, "hung").length === 1, "поздняя посадка завершилась", 20_000);
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
        20_000,
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

test(
  "R1b: возврат предварительного места у ещё живого прежнего моста сохраняет отметку",
  T,
  async (t) => {
    const s = await stage(t);
    const a = await rootPlugin(s, s.project);
    let b;
    try {
      a.create("root");
      await a.turn("root", "привет");
      const old = heldBy(s.dir, "root")[0];
      b = await rootPlugin(s, s.project);
      b.create("root", { emit: false });
      const back = await b.turn("root", "перезагрузка");
      assert.deepEqual(back.atRequest.seats, [old], board(back, b));
      const r = await b.turn("root", "моё имя", () => [
        {
          tool: "iskron_stand",
          input: { realm: "@nks/nks-dev", karta: "931", name: "probe-live-return" },
        },
      ]);
      assert.deepEqual(heldBy(s.dir, "root"), ["probe-live-return"], JSON.stringify(r.calls));
    } finally {
      await b?.stop();
      await a.stop();
    }
  },
);

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
    `T6: своё прежнее место ${label} держится, но не совпадает с обложкой — модель это слышит`,
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
