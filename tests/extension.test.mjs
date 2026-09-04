// Behavioural probe for the pi extension shipped in extensions/iskron.ts — the
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
//   • globalThis.WebSocket is replaced, the way tests/watchdog-drop-order.mjs
//     does it, so close codes and frames arrive on demand. The shipped file
//     carries no test seam for this: it looks the global up when it opens.
//   • the module is loaded from a COPY in a temp dir, and HOME points there too.
//     That is not tidiness. findBridge() has three candidates, and the last one
//     is `<extension dir>/../skills/establish-mcp/scripts/iskron-bridge.mjs` —
//     from the repo that resolves to the REAL bridge, which would take the probe
//     to the network and a browser. Away from extensions/, and with HOME moved,
//     every candidate is the probe's to choose.
//
// TypeScript is loaded by Node itself (v22.18+ strips types with no flag; this
// repo runs it on v26). Strip-only is all Node has left — --experimental-
// transform-types is gone — which is why the shipped Bridge class declares its
// fields instead of using constructor parameter properties.
//
// ISKRON_EXTENSION points the same probe at any copy (a past revision, a
// deliberately broken one) so it can be shown red before a fix.
//
// Node 22+ (the global WebSocket, same floor as the watchdogs). Run it with
// `make test-extension`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = process.env.ISKRON_EXTENSION || join(HERE, "..", "extensions", "iskron.ts");
const FAKE_BRIDGE = join(HERE, "fake-bridge.mjs");
const MISSING_BRIDGE = join(HERE, "no-such-bridge.mjs");

const SANDBOX = mkdtempSync(join(tmpdir(), "iskron-ext-"));
const COPY = join(SANDBOX, "iskron.ts");
copyFileSync(SOURCE, COPY);
// homedir() is the second bridge candidate. Moving HOME both frees the probe to
// decide that candidate and guarantees a real ~/.iskron-bridge is never touched.
process.env.HOME = SANDBOX;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the runtime the extension reaches for ─────────────────────────────────────

const sockets = [];
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = null;
    this._l = new Map();
    sockets.push(this);
  }
  addEventListener(type, fn) {
    if (!this._l.has(type)) this._l.set(type, []);
    this._l.get(type).push(fn);
  }
  emit(type, ev) { for (const fn of [...(this._l.get(type) ?? [])]) fn(ev); }
  deliver(data) { this.readyState = 1; this.emit("message", { data }); }
  drop(code) { this.readyState = 3; this.emit("close", { code }); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
}
globalThis.WebSocket = FakeWebSocket;

// Every fetch is recorded and, unless a test says otherwise, refused: a probe
// that quietly reached the network would be worth nothing.
const fetches = [];
let fetchImpl = async () => { throw new Error("сеть в пробе закрыта"); };
globalThis.fetch = (url, init) => {
  fetches.push({ url: String(url), init });
  return fetchImpl(url, init);
};

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
    pi, ctx, tools, messages, notices, statuses, handlers,
    async fire(name, event = {}) {
      for (const fn of handlers.get(name) ?? []) await fn(event, ctx);
    },
    said: () => notices.map((n) => n.text).join("\n"),
  };
}

const ENV_KEYS = [
  "ISKRON_BRIDGE_PATH", "ISKRON_CHANNEL_SOCKET", "ISKRON_CHANNEL_SOCKET_FILE",
  "ISKRON_CHANNEL_SAY", "ISKRON_CHANNEL_STATUS", "ISKRON_MCP_READY_WAIT_MS",
  "ISKRON_MCP_HANDSHAKE_MS", "FB_LOG", "FB_MODE", "FB_TOOLS", "FB_PAGINATE", "FB_REPLY",
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
  sockets.length = 0;
  fetches.length = 0;
  fetchImpl = async () => { throw new Error("сеть в пробе закрыта"); };
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
    log, reply,
    env: {
      ISKRON_BRIDGE_PATH: FAKE_BRIDGE, FB_LOG: log, FB_REPLY: reply,
      ISKRON_MCP_READY_WAIT_MS: 15000, ...extra,
    },
  };
}

const pidOf = (log) => Number(readFileSync(log, "utf8").trim().split(/\s+/)[1]);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ═══════════════════════════════════════════════════════════════════════════

// The file's own opening claim: pi calls the factory on paths where no session
// follows, so the factory must be inert. A socket, a child process or a timer
// created here would outlive a call that was never a session.
test("factory alone raises nothing live", async () => {
  const { log, env } = bridgeEnv("inert", { ISKRON_CHANNEL_SOCKET: "ws://127.0.0.1:9/channel/ws/t" });
  const factory = await loadFactory(env);
  const rec = fakePi();

  const timersBefore = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  factory(rec.pi);
  const timersAfter = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  try {
    assert.equal(sockets.length, 0, "сокет открыт до session_start");
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
test("socket harvest: a connect answer with an address starts the listening, one without does not", async () => {
  const { reply, env } = bridgeEnv("harvest");
  const rec = await session(env);
  const call = async (name, text) => {
    writeFileSync(reply, text);
    return rec.tools.get(name).execute("id", { action: "connect" }, undefined, () => {}, {});
  };
  try {
    const out = await call("iskron_channel", "Стояние занято. Сокет: wss://iskron.example/channel/ws/tok-1");
    assert.match(out.content[0].text, /Стояние занято/);
    assert.equal(sockets.length, 1, "адрес из ответа не поднял слушание");
    assert.equal(sockets[0].url, "wss://iskron.example/channel/ws/tok-1");

    await call("iskron_channel", "Зарегистрирован как adhikarin. Адреса здесь нет.");
    assert.equal(sockets.length, 1, "ответ без адреса тронул слушание");

    // Only iskron_channel is watched: an address seen anywhere else is text.
    await call("iskron_orient", "в графе есть wss://iskron.example/channel/ws/tok-2");
    assert.equal(sockets.length, 1, "адрес подобран у чужого тула");

    // Plain ws off loopback is a secret going over the wire in the open.
    await call("iskron_channel", "Сокет: ws://iskron.example/channel/ws/tok-3");
    assert.equal(sockets.length, 1, "принят ws:// не на петле");

    // A new address supersedes: the old socket is closed on purpose (1000), so
    // its close is not read as a drop and does not chase an address that is gone.
    await call("iskron_channel", "Новое место. Сокет: wss://iskron.example/channel/ws/tok-4");
    assert.equal(sockets.length, 2);
    assert.equal(sockets[1].url, "wss://iskron.example/channel/ws/tok-4");
    assert.deepEqual(sockets[0].closed, { code: 1000, reason: "новый сокет" });

    // A tool refusal is a throw, and the refusal text is what the doer reads.
    await assert.rejects(() => call("iskron_channel", "__ERROR__место занято другим"), /место занято другим/);
  } finally {
    await rec.stop();
  }
});

// What the channel half is for: a frame from a neighbour enters the running turn
// and lifts an idle agent. Service frames must not — hello only proves the socket
// is held, and an agent woken by every heartbeat is worse than no channel.
test("service frames raise no turn, a work frame does", async () => {
  const rec = await session({ ISKRON_CHANNEL_SOCKET: "wss://iskron.example/channel/ws/tok" });
  try {
    const ws = sockets[0];
    assert.ok(ws, "адрес из окружения не поднял слушание");

    ws.deliver(JSON.stringify({ type: "hello" }));
    assert.equal(rec.messages.length, 0, "hello поднял ход");
    assert.deepEqual(rec.statuses.at(-1), { key: "iskron", text: "Искрон: канал слушает" });

    ws.deliver(JSON.stringify({ type: "status", text: "сосед занят" }));
    assert.equal(rec.messages.length, 0, "status поднял ход");

    ws.deliver(JSON.stringify({ body: "посмотри ветку", provenance: { from_standing: "svatantra" } }));
    assert.equal(rec.messages.length, 1, "рабочий кадр не поднял ход");
    const { msg, opts } = rec.messages[0];
    assert.equal(opts.triggerTurn, true);
    assert.equal(opts.deliverAs, "steer");
    assert.equal(msg.customType, "iskron-channel");
    // Who speaks is read off provenance, never off the body.
    assert.match(msg.content, /^Кадр канала Искрона от svatantra:\n\nпосмотри ветку$/);

    ws.deliver("не JSON вовсе");
    assert.equal(rec.messages.length, 2, "неразобранный кадр потерян");
    assert.match(rec.messages[1].msg.content, /не JSON вовсе/);
  } finally {
    await rec.stop();
  }
});

// A dead token cannot be reconnected through — retrying is an infinite loop
// against a door that will not open. The extension has nowhere to exit to, so
// "loud" means the doer sees it in the turn, and the retry stops.
test("dead-token codes complain loudly and stop, other drops reconnect", async () => {
  const live = [];
  for (const code of [4000, 4001, 4002]) {
    const rec = await session({ ISKRON_CHANNEL_SOCKET: `wss://iskron.example/channel/ws/t${code}` });
    const before = sockets.length;
    sockets[0].drop(code);
    assert.equal(rec.messages.length, 1, `код ${code} прошёл молча`);
    assert.equal(rec.messages[0].msg.details.fatal, true);
    assert.equal(rec.messages[0].opts.triggerTurn, true);
    assert.equal(rec.notices.at(-1).level, "error");
    assert.match(rec.notices.at(-1).text, new RegExp(`закрыт кодом ${code} — токен мёртв`));
    // 4001 is the one where minting a new token is the answer, and only there.
    assert.equal(/action="mint"/.test(rec.notices.at(-1).text), code === 4001);
    live.push({ rec, before });
  }
  // One wait covers all three: the reconnect this must NOT do is 2000 ms away.
  await delay(2300);
  for (const { rec, before } of live) {
    assert.equal(sockets.length, before, "мёртвый токен увёл в переподключение");
    await rec.stop();
  }

  // The contrast — an ordinary drop is retried, or the channel dies on a hiccup.
  const rec = await session({ ISKRON_CHANNEL_SOCKET: "wss://iskron.example/channel/ws/ok" });
  try {
    sockets[0].drop(1006);
    assert.equal(rec.messages.length, 0, "обычный обрыв разбудил делателя");
    await delay(2300);
    assert.equal(sockets.length, 2, "обычный обрыв не переподключился");
    assert.equal(sockets[1].url, "wss://iskron.example/channel/ws/ok");
  } finally {
    await rec.stop();
  }
});

// Drops that keep coming split in two, and only one of them is the doer's
// business. If the service is down, retrying is right and silent. If the service
// answers while the socket will not stay up, retrying is a loop around a question
// only a person can settle — so the doer is asked. This is also the one place
// the channel half reaches the network at all.
test("repeated fast drops against a live service become a question, not a loop", async () => {
  const rec = await session({ ISKRON_CHANNEL_SOCKET: "wss://iskron.example/channel/ws/tok" });
  fetchImpl = async () => ({ ok: true, json: async () => ({ version: "9.9.9" }) });
  try {
    sockets[0].drop(1006);
    await delay(2200);
    sockets[1].drop(1006);
    await delay(2200);
    assert.equal(rec.messages.length, 0, "делателя спросили раньше третьего обрыва");
    sockets[2].drop(1006);
    await delay(50);

    // The version is asked for over http on the socket's own origin — the probe
    // never had to be told a service URL.
    assert.equal(fetches.at(-1).url, "https://iskron.example/api/version");
    assert.equal(rec.messages.length, 1, "служба отвечает, а делателя не спросили");
    assert.match(rec.messages[0].msg.content, /служба отвечает \(9\.9\.9\) — спроси о токене/);
    assert.equal(rec.messages[0].msg.details.fatal, true);
    await delay(2300);
    assert.equal(sockets.length, 3, "вопрос задан, а цикл продолжился");
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
  assert.equal(sockets.length, 1);

  await rec.stop();
  try {
    assert.deepEqual(sockets[0].closed, { code: 1000, reason: "session shutdown" });
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
    if (alive(pid)) try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
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
  const rec = await session({ ISKRON_BRIDGE_PATH: MISSING_BRIDGE, ISKRON_MCP_READY_WAIT_MS: 15000 });
  try {
    assert.equal(rec.tools.size, 0);
    const complaint = rec.notices.find((n) => n.level === "error");
    assert.ok(complaint, "мост не нашёлся молча");
    assert.match(complaint.text, /мост не найден/);
    assert.ok(complaint.text.includes(MISSING_BRIDGE), "не назван путь, который просили");
    // Every candidate is named — and this is also the probe's own proof that it
    // looked in its sandbox home, never in the real ~/.iskron-bridge.
    assert.ok(complaint.text.includes(join(SANDBOX, ".iskron-bridge")), "не назван кандидат из HOME");
    assert.match(complaint.text, /establish-mcp/);
    // The other half stood: it says the place is not taken yet, which is not a failure.
    assert.match(rec.said(), /места ещё нет/);
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

// The doer's word outward. The line is published by the extension because the
// listening secret is here; the doer only writes text. Publishing a change and
// not a tick is the whole discipline — a status board rewritten every second
// says nothing.
test("busy line is published on a change, not on a tick", async () => {
  const say = join(SANDBOX, "say.txt");
  writeFileSync(say, "читаю дифф");
  const posts = [];
  const rec = await session({
    ISKRON_CHANNEL_SOCKET: "wss://iskron.example/channel/ws/tok",
    ISKRON_CHANNEL_SAY: say,
  });
  fetchImpl = async (_url, init) => { posts.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
  try {
    await delay(1400);
    assert.deepEqual(posts, [{ text: "читаю дифф" }]);
    // The status URL is derived from the socket, not asked for.
    assert.equal(fetches.at(-1).url, "https://iskron.example/channel/status/tok");

    await delay(1100);
    assert.equal(posts.length, 1, "та же строка опубликована повторно");

    writeFileSync(say, "");  // an empty line is a WORD: it takes the busy line down
    await delay(1100);
    assert.deepEqual(posts, [{ text: "читаю дифф" }, { text: "" }]);
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

// Обновление поставки НЕ обновляло мост: расширение предпочитает домашнюю копию,
// потому что рядом с ней грант, — и делатель работал старым, считая, что
// обновился. Наблюдено на штатной установке после релиза: код 6.0.0 поднял мост
// 5.0.0. Проба держит три вещи разом, потому что дефект в любой из них
// возвращает ту же тишину: обновляем только СТРОГО новее, говорим вслух в обе
// стороны, и не трогаем ничего, когда путь задан человеком руками.
test("a newer packaged bridge refreshes the home copy, aloud, and never downgrades it", async () => {
  const { mkdirSync } = await import("node:fs");
  const bridgeText = (v) => `#!/usr/bin/env node\nconst VERSION = "${v}"; // x-release-please-version\n`;

  // Своя песочница-пакет: import.meta.url расширения должен смотреть на ../skills/…
  const pkg = mkdtempSync(join(tmpdir(), "iskron-pkg-"));
  const extDir = join(pkg, "extensions");
  const pkgBridgeDir = join(pkg, "skills", "establish-mcp", "scripts");
  const home = join(pkg, "home");
  const homeBridgeDir = join(home, ".iskron-bridge");
  for (const d of [extDir, pkgBridgeDir, homeBridgeDir]) mkdirSync(d, { recursive: true });
  const extCopy = join(extDir, "iskron.ts");
  copyFileSync(SOURCE, extCopy);
  const packaged = join(pkgBridgeDir, "iskron-bridge.mjs");
  const homeBridge = join(homeBridgeDir, "iskron-bridge.mjs");

  const runStart = async (env) => {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
    process.env.HOME = home;
    sockets.length = 0;
    const factory = (await import(`${pathToFileURL(extCopy).href}?n=${++seq}`)).default;
    const rec = fakePi();
    factory(rec.pi);
    await rec.fire("session_start");
    await rec.fire("session_shutdown");
    return rec;
  };

  // (а) поставка новее — копия обновлена, и об этом сказано
  writeFileSync(packaged, bridgeText("6.0.0"));
  writeFileSync(homeBridge, bridgeText("5.0.0"));
  let rec = await runStart({ ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(readFileSync(homeBridge, "utf8"), /VERSION = "6\.0\.0"/, "домашний мост не обновлён");
  assert.ok(
    /5\.0\.0[\s\S]*6\.0\.0/.test(rec.said()),
    "обновление прошло молча — а тихая починка есть то же расхождение, только в нашу пользу",
  );

  // (б) домашний новее — не тронут, и об этом тоже сказано
  writeFileSync(packaged, bridgeText("6.0.0"));
  writeFileSync(homeBridge, bridgeText("7.1.0"));
  rec = await runStart({ ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(readFileSync(homeBridge, "utf8"), /VERSION = "7\.1\.0"/, "домашний мост откачен назад");
  assert.ok(
    /домашний новее/.test(rec.said()),
    "молчание оставляет человека в неведении о том, что поставка отстала",
  );

  // (в) путь задан руками — выбор человека старше нашей заботы
  writeFileSync(homeBridge, bridgeText("5.0.0"));
  await runStart({ ISKRON_BRIDGE_PATH: MISSING_BRIDGE, ISKRON_MCP_READY_WAIT_MS: 1 });
  assert.match(readFileSync(homeBridge, "utf8"), /VERSION = "5\.0\.0"/, "тронули домашний мост, хотя путь задан руками");
});
