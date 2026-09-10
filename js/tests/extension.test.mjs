// Behavioural probe for the pi extension shipped in extensions/iskron.js — the
// door that gives a pi session both halves of Iskron: the iskron_* tools (raised
// over a child iskron-bridge) and the live channel socket. Until this file it
// had no automated cover at all: it stood on one lucky run that would not repeat
// itself.
//
// The extension is an ordinary module, so the probe calls its factory with a
// stand-in `pi` and drives the lifecycle by hand. Three seams make that honest:
//
//   • the bridge is a REAL child process — tests/fake-bridge.mjs, aimed at by
//     ISKRON_BRIDGE_PATH. Nothing about the spawn/NDJSON/pagination path is
//     imitated, only the server behind it.
//   • the standing socket is held by the bridge, not by the extension: the
//     channel half only reads the bridge's notifications, and the fake bridge
//     emits those from a file (FB_EVENTS) the probe appends to.
//   • the module is loaded from a COPY in a temp dir, and HOME points there too.
//     That is not tidiness. findBridge() has three candidates, and the last one
//     is `<extension dir>/../skills/establish-mcp/scripts/iskron.mjs` —
//     from the repo that resolves to the REAL bridge, which would take the probe
//     to the network and a browser. Away from extensions/, and with HOME moved,
//     every candidate is the probe's to choose.
//
// The shipped file is the esbuild output of js/extension/iskron.ts — plain ESM,
// loaded by Node as is; the TypeScript source is checked against the real pi
// types by `npm run typecheck`, not here.
//
// ISKRON_EXTENSION points the same probe at any copy (a past revision, a
// deliberately broken one) so it can be shown red before a fix.
//
// Node 22+ (the global WebSocket, same floor as the watchdogs). Run it with
// `make test-extension`.
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.ISKRON_EXTENSION || join(HERE, "..", "..", "extensions", "iskron.js");
const FAKE_BRIDGE = join(HERE, "fake-bridge.mjs");
const MISSING_BRIDGE = join(HERE, "no-such-bridge.mjs");

const SANDBOX = mkdtempSync(join(tmpdir(), "iskron-ext-"));
const COPY = join(SANDBOX, "iskron.mjs");
copyFileSync(SOURCE, COPY);
// homedir() is the second bridge candidate. Moving HOME both frees the probe to
// decide that candidate and guarantees a real ~/.iskron-bridge is never touched.
process.env.HOME = SANDBOX;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the pi the extension is handed ───────────────────────────────────────────

function fakePi({ hasUI = true } = {}) {
  const handlers = new Map();
  const tools = new Map();
  const messages = [];
  const notices = [];
  const statuses = [];
  const ctx = {
    hasUI,
    ui: {
      notify: (text, level) => notices.push({ text, level }),
      setStatus: (key, text) => statuses.push({ key, text }),
    },
  };
  const pi = {
    on: (name, fn) => {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    },
    registerTool: (t) => tools.set(t.name, t),
    sendMessage: (msg, opts) => messages.push({ msg, opts }),
  };
  return {
    pi,
    ctx,
    tools,
    messages,
    notices,
    statuses,
    handlers,
    async fire(name, event = {}) {
      for (const fn of handlers.get(name) ?? []) await fn(event, ctx);
    },
    said: () => notices.map((n) => n.text).join("\n"),
  };
}

const ENV_KEYS = [
  "ISKRON_BRIDGE_PATH",
  "ISKRON_CHANNEL_SOCKET",
  "ISKRON_CHANNEL_SOCKET_FILE",
  "ISKRON_CHANNEL_SAY",
  "ISKRON_CHANNEL_STATUS",
  "ISKRON_MCP_READY_WAIT_MS",
  "ISKRON_MCP_HANDSHAKE_MS",
  "FB_LOG",
  "FB_MODE",
  "FB_TOOLS",
  "FB_PAGINATE",
  "FB_REPLY",
];

let seq = 0;
/**
 * A fresh factory with a fresh module instance — READY_WAIT_MS and friends are
 * read at module load, so the query string is what lets one test be slow and
 * the next one quick.
 */
async function loadFactory(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
  return (await import(`${pathToFileURL(COPY).href}?n=${++seq}`)).default;
}

/** A live session: factory called, session_start fired, shutdown at hand. */
async function session(env = {}, opts = {}) {
  const factory = await loadFactory(env);
  const rec = fakePi(opts);
  factory(rec.pi);
  await rec.fire("session_start");
  rec.stop = () => rec.fire("session_shutdown");
  return rec;
}

/** A bridge session with its own spawn log and reply file. */
function bridgeEnv(name, extra = {}) {
  const log = join(SANDBOX, `${name}.log`);
  const reply = join(SANDBOX, `${name}.reply`);
  writeFileSync(reply, "");
  return {
    log,
    reply,
    env: {
      ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
      FB_LOG: log,
      FB_REPLY: reply,
      ISKRON_MCP_READY_WAIT_MS: 15000,
      ...extra,
    },
  };
}

const pidOf = (log) => Number(readFileSync(log, "utf8").trim().split(/\s+/)[1]);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A bridge script text distinguishable by version and, optionally, a trailing comment. */
const bridgeText = (v, note = "") =>
  `#!/usr/bin/env node\nconst VERSION = "${v}"; // x-release-please-version${note}\n`;

/**
 * A package sandbox for `refreshHomeBridge()`, own to one test: `extensions/iskron.mjs`
 * (a fresh copy, so its own `import.meta.url` resolves upward into THIS sandbox's
 * `skills/…`, never the real repo) with its own `skills/establish-mcp/scripts/
 * iskron.mjs` ("packaged") and its own `HOME` holding `~/.iskron-bridge/
 * iskron-bridge.mjs` ("home"). Neither bridge file is written here — a test writes
 * only the ones its scenario needs, so "no packaged bridge" / "no home copy" are
 * themselves expressible.
 */
function packageSandbox() {
  const pkg = mkdtempSync(join(tmpdir(), "iskron-pkg-"));
  const extDir = join(pkg, "extensions");
  const pkgBridgeDir = join(pkg, "skills", "establish-mcp", "scripts");
  const home = join(pkg, "home");
  const homeBridgeDir = join(home, ".iskron-bridge");
  for (const d of [extDir, pkgBridgeDir, homeBridgeDir]) mkdirSync(d, { recursive: true });
  const extCopy = join(extDir, "iskron.mjs");
  copyFileSync(SOURCE, extCopy);
  return {
    extCopy,
    packaged: join(pkgBridgeDir, "iskron.mjs"),
    home,
    homeBridgeDir,
    homeBridge: join(homeBridgeDir, "iskron-bridge.mjs"),
  };
}

/**
 * One session_start + session_shutdown against a package sandbox's own extension
 * copy — refreshHomeBridge() runs as the first line of raise(), on session_start.
 * HOME is pointed at the sandbox for the call and put back after, win or throw:
 * a test that left HOME on a scratch dir would make every test after it, not just
 * the next one, silently pass or fail against the wrong home.
 */
async function runRefresh(box, env = {}, opts = {}) {
  const savedHome = process.env.HOME;
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
  process.env.HOME = box.home;
  try {
    const factory = (await import(`${pathToFileURL(box.extCopy).href}?n=${++seq}`)).default;
    const rec = fakePi(opts);
    factory(rec.pi);
    await rec.fire("session_start");
    await rec.fire("session_shutdown");
    return rec;
  } finally {
    process.env.HOME = savedHome;
  }
}

// ═══════════════════════════════════════════════════════════════════════════

// The file's own opening claim: pi calls the factory on paths where no session
// follows, so the factory must be inert. A socket, a child process or a timer
// created here would outlive a call that was never a session.
test("factory alone raises nothing live", async () => {
  const { log, env } = bridgeEnv("inert", {
    ISKRON_CHANNEL_SOCKET: "ws://127.0.0.1:9/channel/ws/t",
  });
  const factory = await loadFactory(env);
  const rec = fakePi();

  const timersBefore = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  factory(rec.pi);
  const timersAfter = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  try {
    assert.equal(rec.tools.size, 0);
    assert.equal(rec.messages.length, 0);
    assert.equal(rec.notices.length, 0);
    assert.equal(timersAfter, timersBefore, "таймер заведён до session_start");
    // What it DID do: hang its handlers. Both halves plus the factory's own report.
    assert.equal(rec.handlers.get("session_start").length, 3);
    assert.equal(rec.handlers.get("session_shutdown").length, 2);
    // The child is the one thing that cannot be read synchronously: spawn returns
    // at once, the log line is written by the other process. Read it after a beat,
    // or an eagerly raised bridge slips past while it is still starting.
    await delay(200);
    assert.equal(existsSync(log), false, "мост спавнится до session_start");
  } finally {
    // A build that DID raise something leaves a child behind; shutdown reaps it,
    // so a red run stays a red run instead of a hang.
    await rec.fire("session_shutdown");
  }
});

// The tools half's whole point: server names go through unchanged, because the
// skills corpus says "позови iskron_orient" and a proxy tool would make every
// such line false. Pagination is on: a client that reads one page and stops
// registers half the surface and nothing complains.
test("bridge raised: every server tool stands in the session under its own name", async () => {
  const { log, env } = bridgeEnv("raise", { FB_PAGINATE: "1" });
  const rec = await session(env);
  try {
    assert.deepEqual([...rec.tools.keys()].sort(), ["iskron_channel", "iskron_orient"]);
    assert.match(rec.said(), /мост поднят \(fake-nks 0\), тулов в сессии: 2/);
    assert.ok(existsSync(log), "мост не спавнился");

    const channel = rec.tools.get("iskron_channel");
    // Schema travels without conversion; only the dialect passport is dropped.
    assert.equal(channel.parameters.$schema, undefined);
    assert.deepEqual(channel.parameters.properties.action.enum, ["connect", "mint", "register"]);
    assert.deepEqual(channel.parameters.required, ["action"]);
    // The prompt line is one sentence of the description, not the whole of it.
    assert.equal(channel.promptSnippet, "Живой канал делателя.");
  } finally {
    await rec.stop();
  }
});

// The hair that ties the two halves. `connect` binds the CALLING session, so the
// socket address must never leave it — the tools half reads it out of the answer
// it is already proxying and hands it to the channel half. Everything about that
// pickup is here: what counts as an address, what does not, and which tool is
// watched at all.
/** A bridge session whose fake bridge also emits standing events from a file. */
function eventsEnv(name, extra = {}) {
  const base = bridgeEnv(name, extra);
  const events = join(SANDBOX, `${name}.events`);
  writeFileSync(events, "");
  return { ...base, events, env: { ...base.env, FB_EVENTS: events } };
}
const push = (file, ev) => appendFileSync(file, JSON.stringify(ev) + "\n");
const frame = (obj) => ({ kind: "frame", raw: JSON.stringify(obj), frame: obj });

// What the channel half is for: a frame from a neighbour enters the running turn
// and lifts an idle agent. Service frames must not — hello only proves the socket
// is held, and an agent woken by every heartbeat is worse than no channel. The
// socket itself is the bridge's; here only its notifications arrive.
test("service frames raise no turn, a work frame does", async () => {
  const { events, env } = eventsEnv("frames");
  const rec = await session(env);
  try {
    push(events, frame({ type: "hello", pending: 0 }));
    await delay(250);
    assert.equal(rec.messages.length, 0, "hello поднял ход");
    assert.deepEqual(rec.statuses.at(-1), { key: "iskron", text: "Искрон: канал слушает" });

    push(events, frame({ type: "status", text: "сосед занят" }));
    await delay(250);
    assert.equal(rec.messages.length, 0, "status поднял ход");

    push(events, frame({ body: "посмотри ветку", provenance: { from_standing: "svatantra" } }));
    await delay(250);
    assert.equal(rec.messages.length, 1, "рабочий кадр не поднял ход");
    const { msg, opts } = rec.messages[0];
    assert.equal(opts.triggerTurn, true);
    assert.equal(opts.deliverAs, "steer");
    assert.equal(msg.customType, "iskron-channel");
    // Who speaks is read off provenance, never off the body.
    assert.match(
      msg.content,
      /^Кадр канала Искрона от делателя роли неизвестной — стояние svatantra\nprovenance: \{"from_standing":"svatantra"\}\n\nпосмотри ветку$/,
    );

    push(events, { kind: "frame", raw: "не JSON вовсе", frame: null });
    await delay(250);
    assert.equal(rec.messages.length, 2, "неразобранный кадр потерян");
    assert.match(rec.messages[1].msg.content, /не JSON вовсе/);
  } finally {
    await rec.stop();
  }
});

// A dead token cannot be reconnected through, and the bridge has already
// stopped trying; the extension has nowhere to exit to, so "loud" means the
// doer sees it in the turn.
test("a dead-token event complains loudly; 4001 alone offers mint", async () => {
  for (const code of [4000, 4001, 4002]) {
    const { events, env } = eventsEnv(`dead${code}`);
    const rec = await session(env);
    try {
      push(events, { kind: "dead", code, text: `ДЕЛАТЕЛЬ: закрытие ${code} — токен мёртв` });
      await delay(250);
      assert.equal(rec.messages.length, 1, `код ${code} прошёл молча`);
      assert.equal(rec.messages[0].msg.details.fatal, true);
      assert.equal(rec.messages[0].opts.triggerTurn, true);
      assert.equal(rec.notices.at(-1).level, "error");
      assert.match(rec.notices.at(-1).text, new RegExp(`закрыт кодом ${code} — токен мёртв`));
      // 4001 is the one where minting a new token is the answer, and only there.
      assert.equal(/action="mint"/.test(rec.notices.at(-1).text), code === 4001);
    } finally {
      await rec.stop();
    }
  }
});

// Drops that keep coming while the service answers: the bridge keeps the place
// and reopens slower, and the doer must see it in the turn — as a word, not as
// the end of the holding.
test("flapping against a live service becomes a word in the turn, not the end of the holding", async () => {
  const { events, env } = eventsEnv("alive");
  const rec = await session(env);
  try {
    push(events, { kind: "alive", version: "9.9.9", text: "обрывы" });
    await delay(250);
    assert.equal(rec.messages.length, 1, "служба отвечает, а делателю не сказали");
    assert.match(rec.messages[0].msg.content, /служба отвечает \(9\.9\.9\) — мост держит место/);
    assert.match(rec.messages[0].msg.content, /спроси о токене/);
    assert.equal(rec.messages[0].msg.details.fatal, false, "the holding goes on — not fatal");
  } finally {
    await rec.stop();
  }
});

// pi calls session_shutdown on paths where nothing was ever raised, and may call
// it more than once. Both halves must go quiet, and the child must not outlive
// the session it was spawned for.
test("session_shutdown is idempotent and quiets both halves", async () => {
  const { log, reply, env } = bridgeEnv("shutdown");
  const rec = await session(env);
  writeFileSync(reply, "Сокет: wss://iskron.example/channel/ws/tok");
  await rec.tools.get("iskron_channel").execute("id", {}, undefined, () => {}, {});
  const pid = pidOf(log);
  assert.ok(alive(pid), "мост не живёт");

  await rec.stop();
  try {
    for (let i = 0; i < 50 && alive(pid); i++) await delay(40);
    assert.equal(alive(pid), false, "мост пережил сессию");
    // A tool left standing in the session must refuse rather than hang.
    await assert.rejects(
      () => rec.tools.get("iskron_orient").execute("id", {}, undefined, () => {}, {}),
      /мост не поднят в этой сессии/,
    );
  } finally {
    // A build that fails this test leaves a live child holding the event loop
    // open; reaped here so the run ends in a verdict rather than in a hang.
    if (alive(pid))
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
  }

  await rec.stop(); // second time: nothing to close, and no throw
  // ...and on a factory that never saw a session_start at all.
  const cold = fakePi();
  (await loadFactory({}))(cold.pi);
  await cold.fire("session_shutdown");
});

// One half failing must not take the other, and must not take the session. A
// missing bridge is the ordinary case of that: no tools, a named complaint, and
// the channel half standing as if nothing happened.
test("a missing bridge does not bring down the session", async () => {
  const rec = await session({
    ISKRON_BRIDGE_PATH: MISSING_BRIDGE,
    ISKRON_MCP_READY_WAIT_MS: 15000,
  });
  try {
    assert.equal(rec.tools.size, 0);
    const complaint = rec.notices.find((n) => n.level === "error");
    assert.ok(complaint, "мост не нашёлся молча");
    assert.match(complaint.text, /мост не найден/);
    assert.ok(complaint.text.includes(MISSING_BRIDGE), "не назван путь, который просили");
    // Every candidate is named — and this is also the probe's own proof that it
    // looked in its sandbox home, never in the real ~/.iskron-bridge.
    assert.ok(
      complaint.text.includes(join(SANDBOX, ".iskron-bridge")),
      "не назван кандидат из HOME",
    );
    assert.match(complaint.text, /establish-mcp/);
  } finally {
    await rec.stop();
  }

  // A bridge that is there but dies on the spot: same contract, different text.
  const dead = await session(bridgeEnv("dead", { FB_MODE: "die" }).env);
  try {
    assert.equal(dead.tools.size, 0);
    assert.match(dead.said(), /мост не поднялся — мост вышел \(code=3/);
  } finally {
    await dead.stop();
  }
});

// A first OAuth run takes the human to a browser, and the bridge stays silent
// until they come back. That must not hold the session hostage: the start
// returns, says so, and the tools arrive later.
test("a silent bridge does not hold the session start hostage", async () => {
  const { env } = bridgeEnv("mute", { FB_MODE: "mute", ISKRON_MCP_READY_WAIT_MS: 400 });
  const started = Date.now();
  const rec = await session(env);
  try {
    const waited = Date.now() - started;
    assert.ok(waited < 5000, `старт держали ${waited} мс`);
    assert.equal(rec.tools.size, 0);
    assert.match(rec.said(), /мост ещё поднимается/);
  } finally {
    await rec.stop();
  }
});

// hasUI is false in rpc mode, where stdout belongs to the protocol. Nothing may
// be printed and nothing may throw for want of a UI.
test("a session without UI neither prints nor throws", async () => {
  const rec = await session(bridgeEnv("noui").env, { hasUI: false });
  try {
    assert.equal(rec.notices.length, 0);
    assert.equal(rec.statuses.length, 0);
    assert.equal(rec.tools.size, 2, "без UI половина тулов не встала");
  } finally {
    await rec.stop();
  }
});

// ── refreshHomeBridge(): каждая ветка правила — отдельным тестом ──────────────
//
// Прежде здесь стоял один тест на три ограды разом: падение первой прятало две
// другие целиком. Обновление поставки НЕ обновляло мост (наблюдено на штатной
// установке: код 6.0.0 поднял мост 5.0.0) — вот что чинит это правило; каждый
// тест ниже топит один его пункт и не смотрит на остальные.
//
// runRefresh() гонит полную session_start (refreshHomeBridge — её первая
// строка), поэтому вниз по потоку findBridge() и raise() тоже отработают и
// могут добавить СВОИ notice — молчащий домашний мост как файл не значит
// молчащую сессию целиком. Поэтому тесты на «молчание» проверяют не пустоту
// rec.said(), а отсутствие СЛОВ refreshHomeBridge в нём, и байты домашней
// копии — то, что функция реально решает.

const REFRESH_WORDS = [
  /версия не читается — домашнюю копию не трогаю/,
  /домашний новее, не трогаю/,
  /заменён на привезённый поставкой/,
  /мост дома обновлён/,
];
const saidNoneOf = (rec) => REFRESH_WORDS.every((re) => !re.test(rec.said()));

// Rule 1: путь задан руками — выбор человека старше нашей заботы, и его не
// проверяют версией: тронуть домашнюю копию здесь значило бы переписать то,
// что человек мог положить сам.
// The bridge that came with the package is the one this extension speaks the
// notification protocol with; the home copy serves other harnesses' configs and
// lags whenever a voiceless session may not refresh it. Seen live: home first,
// headless pi raised the previous bridge in silence — tools up, standing dead.
test("the packaged bridge is preferred over a stale home copy, also without UI", async () => {
  const box = packageSandbox();
  copyFileSync(FAKE_BRIDGE, box.packaged);
  writeFileSync(box.homeBridge, "#!/usr/bin/env node\nprocess.exit(3);\n");
  const log = join(SANDBOX, "prefer.log");
  const reply = join(SANDBOX, "prefer.reply");
  writeFileSync(reply, "");
  const rec = await runRefresh(
    box,
    { FB_LOG: log, FB_REPLY: reply, ISKRON_MCP_READY_WAIT_MS: 15000 },
    { hasUI: false },
  );
  assert.equal(rec.tools.size, 2, "расширение подняло домашнюю копию, а не привезённый мост");
});

test("refreshHomeBridge: ISKRON_BRIDGE_PATH set leaves the home copy untouched", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0"));
  writeFileSync(box.homeBridge, bridgeText("5.0.0"));
  const rec = await runRefresh(box, {
    ISKRON_BRIDGE_PATH: MISSING_BRIDGE,
    ISKRON_MCP_READY_WAIT_MS: 1,
  });
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "5\.0\.0"/,
    "тронули домашний мост при заданном пути",
  );
  assert.ok(saidNoneOf(rec), "заговорили о домашнем мосте, хотя путь задан руками");
});

// Rule 2: нет UI — нет голоса, а голосом стоит сама ограда: подмена без права
// сказать о ней запрещена, не только не озвучена.
test("refreshHomeBridge: a session without UI leaves the home copy untouched", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0"));
  writeFileSync(box.homeBridge, bridgeText("5.0.0"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 }, { hasUI: false });
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "5\.0\.0"/,
    "домашняя копия заменена без UI",
  );
  assert.equal(rec.notices.length, 0, "notify сказал что-то без UI");
});

// Rule 3: поставка не несёт моста вовсе — это дело establish-mcp, не расширения.
test("refreshHomeBridge: no packaged bridge leaves silently", async () => {
  const box = packageSandbox();
  writeFileSync(box.homeBridge, bridgeText("5.0.0"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "5\.0\.0"/,
    "домашняя копия тронута без пакета",
  );
  assert.ok(saidNoneOf(rec), "заговорили о домашнем мосте без пакета");
});

// Rule 4: файл на месте, а версию прочесть нечем — сама починка мертва, и об
// этом обязаны сказать, а не молча оставить старое.
test("refreshHomeBridge: an unreadable packaged version warns and leaves the home copy untouched", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, "#!/usr/bin/env node\n// версии тут нет\n");
  writeFileSync(box.homeBridge, bridgeText("5.0.0"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "5\.0\.0"/,
    "домашняя копия тронута при нечитаемой версии",
  );
  assert.match(
    rec.said(),
    /в поставке мост есть, но его версия не читается — домашнюю копию не трогаю/,
  );
});

// Rule 5: домашней копии ещё нет — её заводит establish-mcp, не это правило;
// молчание здесь не отказ, а «нечего сравнивать».
test("refreshHomeBridge: no home copy yet leaves silently and creates nothing", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.deepEqual(readdirSync(box.homeBridgeDir), [], "домашняя копия заведена, хотя её не было");
  assert.ok(saidNoneOf(rec), "заговорили о домашнем мосте при его отсутствии");
});

// Rule 6: байт в байт — говорить не о чем, и трогать нечего.
test("refreshHomeBridge: identical bytes leave the home copy untouched and silent", async () => {
  const box = packageSandbox();
  const bytes = bridgeText("6.0.0");
  writeFileSync(box.packaged, bytes);
  writeFileSync(box.homeBridge, bytes);
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.equal(readFileSync(box.homeBridge, "utf8"), bytes, "байт-в-байт копия переписана");
  assert.ok(saidNoneOf(rec), "заговорили о домашнем мосте при совпавших байтах");
});

// Rule 7: версия дома строго новее — не трогаем (мог быть свежий мост, положенный
// человеком руками), но об этом отказе говорим, а не молчим.
test("refreshHomeBridge: a strictly newer home copy is kept, aloud", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0"));
  writeFileSync(box.homeBridge, bridgeText("7.1.0"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "7\.1\.0"/,
    "домашний мост откачен назад",
  );
  assert.match(rec.said(), /дома мост 7\.1\.0, в поставке 6\.0\.0 — домашний новее, не трогаю/);
});

// Rule 8, главный случай: версии равны, а байты нет — ровно то, что даёт
// установка из git-источника (ветка едет, релизная константа стоит на месте).
// Сверка по версии эту замену пропустила бы всегда; сверка по байтам — ловит.
test("refreshHomeBridge: equal versions but different bytes replace the home copy", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0", " — из ветки А"));
  writeFileSync(box.homeBridge, bridgeText("6.0.0", " — из ветки Б"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.equal(
    readFileSync(box.homeBridge, "utf8"),
    readFileSync(box.packaged, "utf8"),
    "домашняя копия не стала зеркалом поставки при разных байтах той же версии",
  );
  assert.match(
    rec.said(),
    /мост дома заменён на привезённый поставкой — версия та же \(6\.0\.0\), байты другие\. Грант не тронут\./,
  );
  assert.doesNotMatch(
    rec.said(),
    /мост дома обновлён/,
    "сказано слово случая версии-скачка, а не совпавшей версии",
  );
});

// Rule 8, случай подъёма версии: текст РАЗНЫЙ — не «версия та же», а стрелка
// старое→новое.
test("refreshHomeBridge: a version bump replaces the home copy with its own wording", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0"));
  writeFileSync(box.homeBridge, bridgeText("5.0.0"));
  const rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "6\.0\.0"/,
    "домашний мост не обновлён",
  );
  assert.match(
    rec.said(),
    /мост дома обновлён 5\.0\.0 → 6\.0\.0\. Грант не тронут, он лежит рядом отдельными файлами\./,
  );
  assert.doesNotMatch(
    rec.said(),
    /версия та же/,
    "сказано слово случая совпавшей версии, а не версии-скачка",
  );
});

// Rule 8, побочное условие обеих замен: временный файл — `.tmp-<pid>` — существует
// ровно между записью и rename; после успеха в каталоге не должно остаться ничего,
// кроме итогового iskron-bridge.mjs.
test("refreshHomeBridge: a successful replacement leaves no temp file behind", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0", " — новые байты"));
  writeFileSync(box.homeBridge, bridgeText("6.0.0", " — старые байты"));
  await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  const left = readdirSync(box.homeBridgeDir);
  assert.deepEqual(left, ["iskron-bridge.mjs"], `каталог держит лишнее: ${left.join(", ")}`);
  // Одного листинга каталога мало: он зелен и там, где подмены нет вовсе —
  // замерено на origin/main, эта проба прошла среди 17 прошедших. Байты и есть
  // то, ради чего проба названа, поэтому их и требуем.
  assert.equal(
    readFileSync(box.homeBridge, "utf8"),
    readFileSync(box.packaged, "utf8"),
    "домашняя копия не стала привезённой — подмены не было",
  );
});

// Rule 9: запись не удалась — временный файл убирается, и об отказе говорят
// вслух, работая тем, что было. Ограда воспроизведена правами каталога: без
// root-байпаса writeFileSync внутрь read-only каталога бросает.
test("refreshHomeBridge: a failed write cleans up the temp file and warns", async () => {
  const box = packageSandbox();
  writeFileSync(box.packaged, bridgeText("6.0.0"));
  writeFileSync(box.homeBridge, bridgeText("5.0.0"));
  const { chmodSync } = await import("node:fs");
  chmodSync(box.homeBridgeDir, 0o555); // read+exec, no write
  let rec;
  try {
    rec = await runRefresh(box, { ISKRON_MCP_READY_WAIT_MS: 1 });
  } finally {
    chmodSync(box.homeBridgeDir, 0o755); // иначе временную директорию потом не убрать
  }
  assert.match(
    readFileSync(box.homeBridge, "utf8"),
    /VERSION = "5\.0\.0"/,
    "домашний мост изменился при отказавшей записи",
  );
  assert.match(rec.said(), /заменить не вышло/);
  assert.deepEqual(
    readdirSync(box.homeBridgeDir),
    ["iskron-bridge.mjs"],
    "временный файл остался после отказа",
  );
});
