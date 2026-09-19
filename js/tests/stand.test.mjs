// Проба тула моста iskron_stand (граф nks-dev: #4508, #4511 под #4504): один
// вызов — доска, выведенное имя, connect и register, хук инбокса роли, стук в
// комнату по полному адресу; повторный вызов не ротирует живое место и не
// шлёт второго join; повтор стука — только осознанный и не раньше двух минут.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: против моста без тула
// tools/list его не несёт и вызов уходит на сервер как чужое имя — та
// краснота, ради которой проба написана.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

function startBridge(serverUrl, authDir, cwd = process.cwd()) {
  const notifications = [];
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    cwd,
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

async function ready(t, init = INIT) {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-stand-"));
  const bridge = startBridge(fake.mcpUrl, dir);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const reply = await bridge.call("initialize", init);
  assert.ok(reply.result, `initialize: ${JSON.stringify(reply)}`);
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
    /Слушать: .*node ".*" watchdog \S+/,
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

// The third part of a derived name is the model the agent runs on, never the
// branch: at session start the branch is almost always main and tells two
// sessions of one machine over one repository apart from nothing.
// A name is the place's address: an explicit one is taken exactly or refused
// aloud — never shortened in silence to a name that addresses another place; a
// derived one is cut to the server's limit with a note (graph nks-dev: #5068).
test("an explicit name past the server's rule is refused aloud, not truncated; a long derived name is cut to the limit and said so", async (t) => {
  const { fake, bridge } = await ready(t);
  const long = "alekseis-macbook-pro.some-very-long-repository-name.fable-5-1";
  const refused = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: long },
  });
  const said = textOf(refused);
  assert.ok(refused.result?.isError, said);
  assert.match(said, /длиннее предела: \d+ знаков/, said);
  assert.match(said, /не укорачивается молча/, said);
  assert.equal(
    fake.state.counts.connect,
    0,
    "no place is taken under a name the doer did not ask for",
  );
  const upper = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "Proba" },
  });
  assert.match(textOf(upper), /заглавные буквы/, textOf(upper));
  assert.equal(fake.state.counts.connect, 0);
  const exact = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "alekseis-macbook-pro.rauthy.fable-5-1" },
  });
  assert.match(
    textOf(exact),
    /стояние alekseis-macbook-pro\.rauthy\.fable-5-1 — роль #931/,
    "a 37-char explicit name is taken exactly, not cut at 32",
  );
});

// The model id may carry dots (glm-5.3 — the very model of the field case), so
// the name is cut by parts, never split on dots; the repo part goes first, the
// model survives whole, and the note names what was cut.
for (const model of ["claude-opus-5", "glm-5.3"]) {
  test(`a derived name longer than the limit is cut on the repository part, the model (${model}) survives, and the note says what was cut`, async (t) => {
    const fake = await startFakeNks({ pat: PAT });
    const dir = mkdtempSync(join(tmpdir(), "iskron-stand-"));
    const cwd = mkdtempSync(join(tmpdir(), "a-very-long-repository-directory-name-for-the-probe-"));
    const bridge = startBridge(fake.mcpUrl, dir, cwd);
    t.after(async () => {
      await bridge.stop();
      await fake.stop();
    });
    assert.ok((await bridge.call("initialize", INIT)).result);
    const reply = await bridge.call("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: "#931", model },
    });
    const text = textOf(reply);
    assert.ok(!reply.result?.isError, text);
    const name = /стояние (\S+) — роль #931/.exec(text)?.[1];
    assert.ok(name && name.length <= 48, `the derived name must fit the limit: ${name}`);
    const short = model.replace(/^claude-/, "");
    assert.ok(name.endsWith(`.${short}`), `the model part survives the cut whole: ${name}`);
    const host = hostname().split(".")[0].toLowerCase();
    assert.ok(
      name.startsWith(`${host}.`),
      `the machine part is kept when the repo alone suffices: ${name}`,
    );
    assert.match(text, /укорочено до \S+ \(срезано: репо\)/, text);
    assert.ok(
      [...fake.state.places.keys()].includes(`931:${name}`),
      "the place is taken under the cut name",
    );
  });
}

test("iskron_stand derives the name from machine, repository and the model given — not the branch", async (t) => {
  const { fake, bridge } = await ready(t);
  const reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: "#931", model: "claude-opus-5" },
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
    name.endsWith(".opus-5"),
    `the model, without the vendor prefix, must be the last part: ${name}`,
  );
  assert.equal(name.split(".").length, 3, `machine.repo.model, nothing else: ${name}`);
  assert.ok(
    [...fake.state.places.keys()].includes(`931:${name}`),
    "the place is taken under the derived name",
  );
});

// The bridge is not always started from the working copy: the OpenCode plugin
// spawns it from the server's cwd, so the repository part of the name comes from
// the harness session's directory when the call names one (r5 #5108).
test("iskron_stand names the repository of the session directory given as cwd, not the bridge's own", async (t) => {
  const { fake, bridge } = await ready(t);
  const host = hostname().split(".")[0].toLowerCase();
  const scratch = mkdtempSync(join(tmpdir(), "stand-cwd-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const repo = join(scratch, "harness-repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  const inside = join(repo, "src");
  mkdirSync(inside);
  let reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: "#931", model: "opus-5", cwd: inside },
  });
  let text = textOf(reply);
  assert.ok(!reply.result?.isError, text);
  assert.equal(
    /стояние (\S+) — роль #931/.exec(text)?.[1],
    `${host}.harness-repo.opus-5`,
    `the repository is the git toplevel of cwd, not of the bridge's cwd: ${text}`,
  );
  assert.ok(
    [...fake.state.places.keys()].includes(`931:${host}.harness-repo.opus-5`),
    "the place is taken under that name",
  );

  const plain = join(scratch, "no-repo-here");
  mkdirSync(plain);
  reply = await bridge.call("tools/call", {
    name: "iskron_stand",
    // The bridge already leads the first place: another derived name is a deliberate move (take, #5154).
    arguments: { realm: "nks-dev", karta: "#931", model: "opus-5", cwd: plain, take: true },
  });
  text = textOf(reply);
  assert.ok(!reply.result?.isError, text);
  assert.equal(
    /стояние (\S+) — роль #931/.exec(text)?.[1],
    `${host}.no-repo-here.opus-5`,
    `outside any git repository the directory's own name stands in: ${text}`,
  );

  // A cwd that is not an existing absolute directory would name a place out of
  // nowhere, or out of the bridge's own repository: refused aloud, nothing taken.
  const taken = fake.state.places.size;
  for (const bad of [join(scratch, "gone"), "relative/path"]) {
    reply = await bridge.call("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: "#931", model: "opus-5", cwd: bad },
    });
    text = textOf(reply);
    assert.ok(reply.result?.isError, `a bad cwd is refused: ${text}`);
    assert.match(text, /cwd должен быть существующим абсолютным каталогом/, text);
    assert.equal(fake.state.places.size, taken, "a refused call takes no place");
  }
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
  assert.ok(!/Слушать:/.test(text), "no watchdog command is handed out without a local holder");
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
  assert.match(
    textOf(taken),
    /Слушать: .*node "/,
    "the watchdog command comes with the local holder",
  );
  counts = (await fake.control({})).counts;
  assert.equal(counts.connect, 1, "take=true is the named cause for rotation");
});

// After an eviction the bridge keeps the standing (#5033): a repeated stand is
// register only and says the place was taken; the busy line still goes out from
// the standing, and take=true brings the hearing back.
test("iskron_stand after an eviction: register only, the busy line still published, take=true re-enters", async (t) => {
  const { fake, bridge } = await ready(t);
  const args = { realm: "nks-dev", karta: 931, name: "proba" };
  const first = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.match(textOf(first), /connect и register/, textOf(first));
  const waitFor = async (check, what) => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const known = new Set(fake.state.ws);
  await fake.control({ ws_close: 4000 });
  await waitFor(() => [...fake.state.ws].some((s) => !known.has(s)), "the reopen");
  await fake.control({ ws_close: 4000 });
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "evicted"),
    "the eviction",
  );
  const again = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, status: "после отъёма" },
  });
  const text = textOf(again);
  assert.match(text, /место отняли у этого моста/, text);
  assert.match(text, /только register/, text);
  assert.match(text, /^Занятость: после отъёма$/m, "the busy line is the standing's word");
  assert.equal(fake.state.status, "после отъёма");
  const taken = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, take: true },
  });
  assert.match(textOf(taken), /connect по take/, textOf(taken));
  assert.match(textOf(taken), /hello получен/, "a fresh hello after the explicit take");
});

// The busy line is the standing's word — of THIS standing: a call for another
// name must not post onto the address the bridge holds for the first one.
test("iskron_stand with status for another standing is refused outright — one standing per bridge — and the held one's line stays untouched", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({ places: [{ karta: "931", name: "chuzhoe", listening: true }] });
  const mine = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "svoe", status: "своё дело" },
  });
  assert.match(textOf(mine), /^Занятость: своё дело$/m, textOf(mine));
  const posts = fake.state.counts.status_posts;
  const other = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "chuzhoe", status: "чужое дело" },
  });
  assert.equal(other.result?.isError, true, textOf(other));
  assert.match(textOf(other), /уже ведёт место svoe--931--nks-dev/, textOf(other)); // #5154
  assert.equal(fake.state.status, "своё дело", "the held standing's line must stay untouched");
  assert.equal(fake.state.counts.status_posts, posts, "nothing is posted anywhere");
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

// What the place is travels with every taking and registration (#5174): model
// without the vendor prefix, attrs with the build sign {name, version, stamp}
// and the harness — the whole set each time, since attrs replace whole.
test("iskron_stand names the place: model and attrs ride connect and register", async (t) => {
  const { fake, bridge } = await ready(t);
  const r = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", model: "anthropic/claude-opus-5" },
  });
  assert.ok(!r.result?.isError, textOf(r));
  const connect = fake.state.placeArgs.find((x) => x.action === "connect");
  const register = fake.state.placeArgs.find((x) => x.action === "register");
  for (const got of [connect, register]) {
    assert.ok(got, JSON.stringify(fake.state.placeArgs));
    assert.equal(got.model, "claude-opus-5");
    assert.equal(got.attrs?.build?.name, "iskron-bridge");
    assert.match(String(got.attrs?.build?.version), /^\d+\.\d+\.\d+$/);
    assert.match(String(got.attrs?.build?.stamp), /^[0-9a-f]{8}$/);
  }
});

// A second live session of one model over one working copy — another session
// or a subagent — derives the same name (#5402, #5407): it takes the first
// free `name.N` instead of evicting; "taken" is read positively, by a live
// local socket this bridge does not own; the separate place arms no role-inbox
// hook (the owner's word); the base of the suffix is the derived name.
const standText = (r) => textOf(r);
const placeOf = (r) => /стояние (?:@[^:\s]+:)?(\S+) — роль/.exec(textOf(r))?.[1];
async function twoSessions(t) {
  const { fake, dir, bridge } = await ready(t);
  const args = { realm: "nks-dev", karta: 931, model: "opus-5" };
  const first = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const base = placeOf(first);
  assert.ok(base, standText(first));
  for (const end = Date.now() + 10_000; fake.state.ws.size !== 1;) {
    assert.ok(Date.now() < end, "the first session's socket");
    await new Promise((res) => setTimeout(res, 50));
  }
  const second = startBridge(fake.mcpUrl, dir);
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", INIT)).result);
  return { fake, dir, bridge, second, args, base };
}

test("iskron_stand: a derived name another live session holds yields a separate place without a role-inbox hook", async (t) => {
  const { fake, second, args, base } = await twoSessions(t);
  const connects = fake.state.counts.connect;
  const hooks = fake.state.counts.webhooks_added;
  const r = await second.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.ok(!r.result?.isError, standText(r));
  assert.equal(placeOf(r), `${base}.2`, standText(r));
  assert.ok(standText(r).includes(`место ${base} держит живая сессия`), standText(r));
  assert.ok(
    standText(r).includes(`вернись: iskron_stand(name="${base}", take=true)`),
    "the answer names the way back to one's own place",
  );
  assert.equal(fake.state.counts.connect, connects + 1, "one connect — for the new place");
  assert.equal(fake.state.ws.size, 2, "the first session keeps its socket");
  assert.equal(fake.state.counts.webhooks_added, hooks, "no role-inbox hook for a separate place");
  const again = await second.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(placeOf(again), `${base}.2`, standText(again));
  assert.equal(
    fake.state.counts.connect,
    connects + 1,
    "the second call comes back, no new connect",
  );
});

test("iskron_stand: a bridge that left its place comes back to it, not to name.2", async (t) => {
  const { fake, bridge } = await ready(t);
  const args = { realm: "nks-dev", karta: 931, model: "opus-5" };
  const first = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const base = placeOf(first);
  const left = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  assert.ok(!left.result?.isError, textOf(left));
  const connects = fake.state.counts.connect;
  const back = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(placeOf(back), base, standText(back));
  assert.equal(fake.state.counts.connect, connects, "a return, not a connect");
});

test("iskron_stand: a place whose bridge died is taken back, not skipped to name.3", async (t) => {
  const { fake, dir, second, args, base } = await twoSessions(t);
  const r = await second.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(placeOf(r), `${base}.2`, standText(r));
  await second.stop();
  const third = startBridge(fake.mcpUrl, dir);
  t.after(() => third.stop());
  assert.ok((await third.call("initialize", INIT)).result);
  const t3 = await third.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(placeOf(t3), `${base}.2`, standText(t3));
  const last = fake.state.placeArgs.filter((x) => x.action === "register").at(-1);
  assert.equal(last?.attrs?.build?.name, "iskron-bridge", "the taken-back place is named too");
});

// A live session away from its place (leave, or deafness) keeps its local
// socket: the board may read the place «не слушает», but its mail is still
// that session's — the newcomer stands beside it, not on it (#5407).
test("iskron_stand: a live session away from its place keeps it — the newcomer takes name.2", async (t) => {
  const { fake, bridge, second, args, base } = await twoSessions(t);
  await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  await fake.control({ places: [{ karta: 931, name: base, listening: false }] });
  const r = await second.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(placeOf(r), `${base}.2`, standText(r));
});

test("iskron_stand: a separate place that left and stands again does not stack name.2.2", async (t) => {
  const { second, args, base } = await twoSessions(t);
  await second.call("tools/call", { name: "iskron_stand", arguments: args });
  await second.call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", action: "leave" },
  });
  const back = await second.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.equal(placeOf(back), `${base}.2`, standText(back));
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

// On the real surface the 4001 close reaches the socket before the HTTP answer
// to revoke does; read as a dead token, it sent obedient agents straight back
// into connect+register on the seat they had just closed (seen live in
// OpenCode and Codex). The bridge knows it is revoking its own seat before it
// asks, and the early close is then a quiet release.
test("a 4001 that arrives before the revoke answer is still a quiet self-revoke, not a dead token", async (t) => {
  const { fake, bridge } = await ready(t);
  const args = { realm: "nks-dev", karta: 931, name: "proba" };
  assert.ok(
    !(await bridge.call("tools/call", { name: "iskron_stand", arguments: args })).result?.isError,
  );
  await fake.control({ revokeReplyDelayMs: 600 });
  const revoked = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "revoke", realm: "nks-dev", karta: 931, standing: "proba" },
  });
  assert.match(textOf(revoked), /закрыт — место «proba»/, textOf(revoked));
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(
    !bridge.notifications.some((n) => n.params?.data?.kind === "dead"),
    `an early 4001 on one's own revoke must not be announced as a dead token:\n${bridge.stderr}`,
  );
  assert.match(bridge.stderr, /revoked by this session — released quietly/, bridge.stderr);
  const again = await bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  assert.match(
    textOf(again),
    /connect и register/,
    "the seat is gone and forgotten: a fresh entry, no replay",
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

// Both phrasings are the server's: 0.43 said «не держит канала», the surface
// of 2026-09-19 (observed on mcp.iskron.ru, an empty graph) says «нигде не стоит».
for (const phrase of [
  'Ни одна роль этого графа не держит канала. Открой его: iskron_channel(action="connect", karta=…).',
  'Ни одна роль этого графа нигде не стоит. Открой место: iskron_channel(action="mint", karta="#N").',
])
  test(`iskron_stand takes the first place in an empty graph: «${phrase.slice(26, 48)}» is a recognized board`, async (t) => {
    const { fake, bridge } = await ready(t);
    await fake.control({ boardText: phrase });
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

// The listener block names the doer's own harness — one line, not three: an
// agent in pi launched the Claude Code watchdog from a block that offered all
// of them (#5047). The bridge knows the harness from clientInfo.name.
for (const [client, expect, forbid] of [
  ["claude-code", /Слушать: под Monitor.*без Monitor — фоновой задачей/, /watchdog-codex/],
  ["codex-probe", /Слушать: в Codex внутри одной длинной команды.*без двери app-server/, /Monitor/],
  ["pi-iskron", /Слушает расширение pi само — сторож не нужен/, /watchdog/],
  ["opencode-iskron", /Слушает плагин OpenCode само — сторож не нужен/, /watchdog/],
  ["stand-probe", /Monitor.*watchdog-exit.*watchdog-codex/s, /никогда/],
]) {
  test(`the listener block speaks to its harness: ${client}`, async (t) => {
    const { bridge } = await ready(t, { ...INIT, clientInfo: { name: client, version: "0" } });
    const reply = await bridge.call("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: "proba" },
    });
    const text = textOf(reply);
    assert.ok(!reply.result?.isError, text);
    assert.match(text, expect, text);
    assert.ok(!forbid.test(text), `a foreign harness's command must not be offered:\n${text}`);
  });
}
