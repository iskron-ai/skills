// Проба тула моста iskron_stand (граф nks-dev: #4508, #4511 под #4504): один
// вызов — доска, выведенное имя, connect и register, хук инбокса роли, стук в
// комнату по полному адресу; повторный вызов не ротирует живое место и не
// шлёт второго join; повтор стука — только осознанный и не раньше двух минут.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: против моста без тула
// tools/list его не несёт и вызов уходит на сервер как чужое имя — та
// краснота, ради которой проба написана.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const HERE = dirname(fileURLToPath(import.meta.url));
const FILE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "stand-probe", version: "0" },
};
const PAT = "nks_pat_stand";

function startBridge(serverUrl, authDir) {
  const notifications = [];
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_STAND_KNOCK_REPEAT_MS: "300", // шов проб: окно повтора 300 мс вместо 2 минут
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined && msg.method) {
        notifications.push(msg);
        continue;
      }
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let id = 0;
  return {
    proc,
    notifications,
    get stderr() {
      return stderr;
    },
    call(method, params = {}) {
      const myId = ++id;
      const p = new Promise((res, rej) => {
        waiters.set(myId, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${myId})`)), 20_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return p;
    },
    stop: () =>
      proc.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.stdin.end();
            setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
          }),
  };
}

const textOf = (reply) => (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");

async function ready(t) {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-stand-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const init = await bridge.call("initialize", INIT);
  assert.ok(init.result, `initialize: ${JSON.stringify(init)}`);
  return { fake, dir, bridge };
}

test("tools/list carries iskron_stand — the bridge's own tool, in the server's list", async (t) => {
  const { bridge } = await ready(t);
  const list = await bridge.call("tools/list");
  const stand = (list.result?.tools ?? []).find((x) => x.name === "iskron_stand");
  assert.ok(stand, `no iskron_stand in ${JSON.stringify(list.result?.tools?.map((x) => x.name))}`);
  assert.deepEqual(stand.inputSchema.required, ["realm", "karta"]);
  assert.ok(
    stand.description.startsWith("[мост]"),
    "the tool must name the bridge as its executor",
  );
});

test("iskron_stand: one call takes the place, arms the inbox hook and knocks; a second call neither rotates nor knocks again", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({
    rooms: [
      { karta: "3505", address: "@tester:thread-k2" },
      { karta: "3505", address: "@tester:thread-k3" },
    ],
  });
  const args = {
    realm: "nks-dev",
    karta: 931,
    name: "proba",
    room: "@tester:thread-k2",
    status: "на вахте",
  };
  const first = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const text = textOf(first);
  assert.ok(!first.result?.isError, `stand refused:\n${text}\n${bridge.stderr}`);
  assert.match(text, /стояние proba — роль #931, граф nks-dev: connect и register/, text);
  assert.match(
    text,
    /Слушать: node ".*" watchdog \S+/,
    "the answer must carry the watchdog command",
  );
  assert.match(text, /hello получен: ожидало кадров — 0/, text);
  assert.match(text, /Хук инбокса роли: взведён/, text);
  assert.match(text, /Комната @tester:thread-k2: стук отправлен/, text);
  assert.match(text, /Занятость: на вахте/, text);
  let counts = (await fake.control({})).counts;
  assert.equal(counts.connect, 1);
  assert.equal(counts.webhooks_added, 1);
  assert.equal(counts.status_posts, 1);
  assert.deepEqual(
    fake.state.sends.map((s) => [s.karta, s.standing, s.text]),
    [["3505", "@tester:thread-k2", "join"]],
    "the knock is one send of `join` to the room's own standing, under the human's karta",
  );

  const second = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const again = textOf(second);
  assert.match(again, /сокет уже держит этот мост — register/, again);
  assert.match(again, /Хук инбокса роли: стоит и будит это стояние/, again);
  assert.match(again, /стук уже отправлен .* — жди приглашения/, again);
  counts = (await fake.control({})).counts;
  assert.equal(counts.connect, 1, "a live place held by this bridge is not rotated");
  assert.equal(counts.webhooks_added, 1, "no second hook");
  assert.equal(fake.state.sends.length, 1, "no second join without a deliberate repeat");

  const early = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, repeat_knock: true },
  });
  assert.match(textOf(early), /повтор рано/, textOf(early));
  assert.equal(fake.state.sends.length, 1, "a deliberate repeat before two minutes is refused");

  const other = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, room: "@tester:thread-k3" },
  });
  assert.match(textOf(other), /Комната @tester:thread-k3: стук отправлен/, textOf(other));
  assert.equal(
    fake.state.sends.length,
    2,
    "a different room in the same session gets its own knock",
  );

  const unknown = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, room: "@tester:thread-none" },
  });
  assert.match(
    textOf(unknown),
    /этого стояния нет, а send требует роль его держателя/,
    textOf(unknown),
  );
  assert.equal(fake.state.sends.length, 2, "an address absent from the board is never guessed at");
  const byKarta = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, room: "@tester:thread-none", room_karta: "#77" },
  });
  assert.match(textOf(byKarta), /Комната @tester:thread-none: стук отправлен/, textOf(byKarta));
  assert.equal(
    fake.state.sends.at(-1).karta,
    "77",
    "room_karta names the room's holder when the board does not",
  );
});

test("iskron_stand derives the name from machine, repository and branch when none is given", async (t) => {
  const { fake, bridge } = await ready(t);
  const reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: "#931" },
  });
  const text = textOf(reply);
  assert.ok(!reply.result?.isError, text);
  const host = hostname().split(".")[0].toLowerCase();
  const name = /стояние (\S+) — роль #931/.exec(text)?.[1];
  assert.ok(
    name && name.startsWith(`${host}.`),
    `the derived name must start with the machine: ${text}`,
  );
  assert.ok(
    [...fake.state.places.keys()].includes(`931:${name}`),
    "the place is taken under the derived name",
  );
});

test("iskron_stand refuses without realm and karta, naming what it needs", async (t) => {
  const { bridge } = await ready(t);
  const reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev" },
  });
  assert.equal(reply.result?.isError, true);
  assert.match(textOf(reply), /требует realm и karta/);
});

test("iskron_stand: a deliberate repeat after the window, one only; a new entry cycle resets the count", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({ rooms: [{ karta: "3505", address: "@tester:thread-k2" }] });
  const args = { realm: "nks-dev", karta: 931, name: "proba", room: "@tester:thread-k2" };
  await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(fake.state.sends.length, 1);
  await new Promise((r) => setTimeout(r, 350));
  const repeat = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, repeat_knock: true },
  });
  assert.match(textOf(repeat), /повторный стук отправлен/, textOf(repeat));
  assert.equal(fake.state.sends.length, 2, "the deliberate repeat after the window goes out");
  await new Promise((r) => setTimeout(r, 350));
  const third = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, repeat_knock: true },
  });
  assert.match(textOf(third), /стучал дважды, приглашения нет — больше не стучу/, textOf(third));
  assert.equal(fake.state.sends.length, 2, "the limit holds within one entry cycle");
  const taken = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, take: true },
  });
  assert.match(
    textOf(taken),
    /стук отправлен/,
    `a new connect resets the count:\n${textOf(taken)}`,
  );
  assert.equal(fake.state.sends.length, 3);
  assert.equal(
    (await fake.control({})).counts.connect,
    2,
    "take=true is the one cause for a second connect",
  );
});

test("iskron_stand: a place listening under another bridge is registered, never rotated, unless take=true", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({ places: [{ karta: "931", name: "proba", listening: true }] });
  const args = { realm: "nks-dev", karta: 931, name: "proba" };
  const first = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const text = textOf(first);
  assert.match(text, /место уже слушает другой держатель .* — только register/, text);
  assert.match(text, /Слух — у другого держателя/, text);
  assert.ok(
    !/Слушать: node/.test(text),
    "no watchdog command is handed out without a local holder",
  );
  assert.match(text, /Команда сторожа не выдаётся/, text);
  const knock = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, room: "@tester:thread-k2" },
  });
  assert.match(
    textOf(knock),
    /стук не отправлен — ответ комнаты ушёл бы держателю сокета/,
    textOf(knock),
  );
  assert.equal(fake.state.sends.length, 0, "no join while the socket is elsewhere");
  let counts = (await fake.control({})).counts;
  assert.equal(counts.connect, 0, "no connect: the live socket stays with its holder");
  assert.equal(
    counts.register_standing,
    2,
    "both only-register calls registered, neither connected",
  );
  const taken = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, take: true },
  });
  assert.match(textOf(taken), /connect по take/, textOf(taken));
  assert.match(textOf(taken), /hello получен/, "a fresh hello after the explicit take");
  assert.match(textOf(taken), /Слушать: node/, "the watchdog command comes with the local holder");
  counts = (await fake.control({})).counts;
  assert.equal(counts.connect, 1, "take=true is the named cause for rotation");
});

test("iskron_stand refuses control actions on a board it does not recognize", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({ boardText: "Something entirely different came back from the server." });
  const reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", room: "@tester:thread-k2" },
  });
  assert.equal(reply.result?.isError, true);
  assert.match(textOf(reply), /форма доски не распознана/, textOf(reply));
  const counts = (await fake.control({})).counts;
  assert.equal(counts.connect, 0, "no connect on an unrecognized board");
  assert.equal(counts.webhooks_added, 0, "no hook on an unrecognized board");
  assert.equal(fake.state.sends.length, 0, "no join on an unrecognized board");
});

test("iskron_stand refuses a truncated or ambiguous board and leaves a hook list it does not recognize alone", async (t) => {
  const { fake, bridge } = await ready(t);
  const line = (name) =>
    `  #931 👨‍💻 Роль 能 · @tester:${name} — живой · простой 6h · слушает · сокет был сейчас · открыл @tester\n     📥 http://x/api/channel/in/${name}`;
  await fake.control({ boardText: `Каналы (3):\n${line("other")}` });
  const short = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.equal(short.result?.isError, true);
  assert.match(textOf(short), /объявляет 3 мест, разобрано 1/, textOf(short));
  await fake.control({ boardText: `Каналы (2):\n${line("proba")}\n${line("proba")}` });
  const twice = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.equal(twice.result?.isError, true);
  assert.match(textOf(twice), /2 места с именем proba/, textOf(twice));
  assert.equal(
    (await fake.control({})).counts.connect,
    0,
    "no connect on a truncated or ambiguous board",
  );
  await fake.control({ boardText: null, hooksText: "Хуков тут не бывает" });
  const hooks = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.match(textOf(hooks), /список хуков не распознан — не трогаю/, textOf(hooks));
  assert.equal(
    (await fake.control({})).counts.webhooks_added,
    0,
    "no hook on an unrecognized list",
  );
});

test("iskron_stand: take=true on the bridge's own place re-enters with a fresh socket and a fresh hello", async (t) => {
  const { fake, bridge } = await ready(t);
  const args = { realm: "nks-dev", karta: 931, name: "proba" };
  const first = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const firstSocket = /watchdog (\S+)/.exec(textOf(first))?.[1];
  const tokenBefore = fake.state.wsToken;
  const again = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, take: true },
  });
  assert.match(textOf(again), /connect по take — новый цикл входа/, textOf(again));
  assert.match(textOf(again), /hello получен/, "a fresh hello after re-entry");
  const hellos = bridge.notifications.filter(
    (n) => n.params?.logger === "iskron-channel" && n.params?.data?.frame?.type === "hello",
  );
  assert.equal(hellos.length, 2, "the second entry brought its own hello, not the ring's old one");
  assert.notEqual(fake.state.wsToken, tokenBefore, "the surface rotated the socket on connect");
  assert.equal(
    /watchdog (\S+)/.exec(textOf(again))?.[1],
    firstSocket,
    "the local key is the same place",
  );
});

test("revoking one's own standing through the bridge is quiet: no dead-token alarm, no re-registration", async (t) => {
  const { fake, bridge } = await ready(t);
  const args = { realm: "nks-dev", karta: 931, name: "proba" };
  assert.ok(
    !(await bridge.call("tools/call", { name: "iskron_stand", arguments: args })).result?.isError,
  );
  const revoked = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "revoke", realm: "nks-dev", karta: 931, standing: "proba" },
  });
  assert.match(textOf(revoked), /закрыт — место «proba»/, textOf(revoked));
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(
    !bridge.notifications.some((n) => n.params?.data?.kind === "dead"),
    `a self-revoke must not be announced as a dead token:\n${JSON.stringify(bridge.notifications.map((n) => n.params?.data?.kind))}`,
  );
  assert.match(bridge.stderr, /revoked by this session — released quietly/, bridge.stderr);
  const send = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: {
      action: "send",
      realm: "nks-dev",
      karta: 3505,
      standing: "@tester:thread-k2",
      text: "x",
    },
  });
  assert.match(
    textOf(send),
    /не зарегистрирована/,
    "the forgotten binding is not replayed onto a revoked seat",
  );
  assert.equal((await fake.control({})).counts.register_standing, 1, "no re-register after revoke");
});

test("iskron_stand takes the first place in an empty graph: the server's «no channels» phrase is a recognized board", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({
    boardText:
      'Ни одна роль этого графа не держит канала. Открой его: iskron_channel(action="connect", karta=…).',
  });
  const reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.ok(!reply.result?.isError, textOf(reply));
  assert.match(textOf(reply), /connect и register/, textOf(reply));
  assert.equal(
    (await fake.control({})).counts.connect,
    1,
    "the first agent in a fresh graph can stand",
  );
});

test("iskron_stand: a header count that does not match the parsed lines blocks a blind connect, but not when the own place is visible or take=true", async (t) => {
  const { fake, bridge } = await ready(t);
  const line = (name) =>
    `  #931 👨‍💻 Роль 能 · @tester:${name} — живой · простой 6h · слушает · сокет был сейчас · открыл @tester\n     📥 http://x/api/channel/in/${name}`;
  await fake.control({ boardText: `Каналы (2):\n${line("other")}\n  ??? строка иной формы` });
  const blind = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.equal(blind.result?.isError, true, textOf(blind));
  assert.match(textOf(blind), /своего места среди разобранных нет/, textOf(blind));
  assert.equal((await fake.control({})).counts.connect, 0);
  const forced = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", take: true },
  });
  assert.ok(!forced.result?.isError, textOf(forced));
  assert.equal((await fake.control({})).counts.connect, 1, "take=true is the doer's word to go on");
});

test("iskron_stand: a hook waking a longer-named sibling does not count as one's own", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({ places: [{ karta: "931", name: "proba2", listening: false }] });
  await fake.control({ webhooks: [{ karta: "931", wakes: "proba2" }] });
  const reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.match(textOf(reply), /Хук инбокса роли: взведён/, textOf(reply));
  assert.equal(
    (await fake.control({})).counts.webhooks_added,
    1,
    "a hook for proba2 is not a hook for proba",
  );
});
