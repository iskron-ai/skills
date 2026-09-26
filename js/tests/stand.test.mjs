// Проба тула моста iskron_stand (граф nks-dev: #4508, #4511 под #4504): один
// вызов — доска, выведенное имя, connect и register, хук инбокса роли, стук в
// место человека по полному адресу; повторный вызов не ротирует живое место и не
// шлёт второго join; повтор стука — только осознанный и не раньше двух минут.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: против моста без тула
// tools/list его не несёт и вызов уходит на сервер как чужое имя — та
// краснота, ради которой проба написана.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

function startBridge(serverUrl, authDir, cwd = process.cwd(), env = {}, args = []) {
  const notifications = [];
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir, ...args], {
    cwd,
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_STAND_KNOCK_REPEAT_MS: "300", // шов проб: окно повтора 300 мс вместо 2 минут
      ...env,
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
// Аргументы каждого iskron_channel, какими мост их ПОСЛАЛ — до отсева фейком по схеме снимка.
const sentToChannel = (fake) =>
  fake.state.calls.filter((c) => c.name === "iskron_channel").map((c) => c.arguments);

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
  assert.match(text, /Место человека @tester:thread-k2: стук отправлен/, text);
  assert.match(text, /встанешь рядом с человеком/, text);
  assert.doesNotMatch(text, /[Кк]омнат/, text);
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
  assert.match(textOf(other), /Место человека @tester:thread-k3: стук отправлен/, textOf(other));
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
    /Место человека @tester:thread-none: на доске графа nks-dev этого места нет, а send требует роль его держателя/,
    textOf(unknown),
  );
  assert.equal(fake.state.sends.length, 2, "an address absent from the board is never guessed at");
  const byKarta = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { ...args, room: "@tester:thread-none", room_karta: "#77" },
  });
  assert.match(
    textOf(byKarta),
    /Место человека @tester:thread-none: стук отправлен/,
    textOf(byKarta),
  );
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

// A linked worktree's toplevel is the task directory, not the repository: the
// repository part comes from the main checkout (r5 #5108, second case).
test("iskron_stand names the main checkout's repository from a linked worktree, and a plain checkout as before", async (t) => {
  const { fake, bridge } = await ready(t);
  const host = hostname().split(".")[0].toLowerCase();
  const scratch = mkdtempSync(join(tmpdir(), "stand-wt-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const repo = join(scratch, "repoA");
  mkdirSync(repo);
  const g = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  g("init", "-q");
  g(
    "-c",
    "user.name=probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  g("worktree", "add", "-q", join(scratch, "taskdir"));

  const stand = async (cwd, take) => {
    const reply = await bridge.call("tools/call", {
      name: "iskron_stand",
      arguments: {
        realm: "nks-dev",
        karta: "#931",
        model: "opus-5",
        cwd,
        ...(take ? { take: true } : {}),
      },
    });
    const text = textOf(reply);
    assert.ok(!reply.result?.isError, text);
    return /стояние (\S+) — роль #931/.exec(text)?.[1];
  };

  const inWorktree = join(scratch, "taskdir");
  assert.equal(
    await stand(inWorktree, false),
    `${host}.repoa.opus-5`,
    "in a linked worktree the repository is the main checkout's, not the task directory's",
  );
  assert.ok([...fake.state.places.keys()].includes(`931:${host}.repoa.opus-5`));

  // The plain checkout names the same repository, exactly as before.
  const plain = join(scratch, "repoB");
  mkdirSync(plain);
  execFileSync("git", ["init", "-q", plain]);
  assert.equal(await stand(plain, true), `${host}.repob.opus-5`, "a plain checkout: its toplevel");
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
    /Место человека @[^:]+:[^:]+: стук не отправлен — ответ человека ушёл бы держателю сокета/,
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

// ── a place in each graph on one channel (graph nks-dev: #5838, answering #5837) ──

// One session through one bridge stands in every graph it works in: a channel
// holds places in several graphs (register on it in another graph adds a place),
// a write is signed by the place of its own graph, a frame names its place by
// to_standing_id. Each case below stands up its own bridge, so each can fail alone.
const waitUntil = async (check, what, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A bridge standing in graph A, then in graph B; returns what the cases read. */
async function twoGraphs(t, A, B, init = INIT, beforeB = async () => {}) {
  const { fake, dir, bridge } = await ready(t, init);
  const stand = (args) => bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const a = await stand(A);
  assert.ok(!a.result?.isError, textOf(a));
  await beforeB(fake);
  const b = await stand(B);
  assert.ok(!b.result?.isError, `the second graph's place must stand beside:\n${textOf(b)}`);
  // The key the listener block names (pi's block names none — the same form, computed).
  const keyOfPlace = (p) =>
    `${p.name}--${p.karta}--${p.realm}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  const keyA = keyOfPlace(A);
  const keyB = keyOfPlace(B);
  // The platform's id of each place — what frames carry in to_standing_id.
  const idOf = (canon, name) =>
    [...fake.state.channels.values()].map((c) => c.places.get(canon)).find((p) => p?.name === name)
      ?.standing_id;
  const watch = (key) => {
    const proc = spawn(NODE, [FILE, "watchdog", key, "--auth-dir", dir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const w = { proc, out: "" };
    proc.stdout.on("data", (c) => (w.out += c));
    t.after(() => proc.kill("SIGKILL"));
    return w;
  };
  const write = async (realm, n) =>
    textOf(
      await bridge.call("tools/call", {
        name: "iskron_add_phenomenon",
        arguments: { realm, name: n },
      }),
    );
  return { fake, dir, bridge, stand, a, b, keyA, keyB, idOf, watch, write };
}

/** A frame in the shape observed on the live server (bridge 6.11.0). */
const liveFrame = (id, canon, name, karta, standingId, body, more = {}) => ({
  type: "message",
  id,
  received_at: new Date().toISOString(),
  stale: false,
  content_type: "text/plain",
  body_chars: body.length,
  to_standing_id: standingId,
  to_standing: `@tester:${name}`,
  realm: canon,
  karta_seq: karta,
  body,
  ...more,
});

const NKS = "@nks/nks-dev";
const DRUGOY = "@nks/drugoy";

test("two graphs: the second place stands beside the first on the same channel — one socket, both listening, no second connect", async (t) => {
  const { fake, b, keyA, keyB } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba-b" },
  );
  assert.match(textOf(b), /встаёт рядом на канале/, textOf(b));
  assert.ok(textOf(b).includes(`watchdog ${keyB}`), `B's block names B's key:\n${textOf(b)}`);
  // The place id comes from the register reply's prose («🪪 id этого места»).
  assert.doesNotMatch(
    textOf(b),
    /id места не назвал/,
    `the register id was not parsed:\n${textOf(b)}`,
  );
  // The default fake lists no iskron_admin: the schema is unread, the reply says so and nothing breaks.
  assert.match(textOf(b), /схему тула iskron_admin прочесть не удалось/, textOf(b));
  assert.match(
    textOf(b),
    /Хук инбокса роли: не взведён — у места этого графа своего входящего адреса нет/,
    textOf(b),
  );
  assert.ok(keyA !== keyB, `two places, two watchdog keys: ${keyA} / ${keyB}`);
  assert.equal(fake.state.counts.connect, 1, "the second place rides the same channel");
  // No reopen: the place id comes with register, the open socket carries the new place.
  assert.equal(fake.state.ws.size, 1, "one socket carries both places");
  assert.equal(fake.state.counts.ws_upgrades, 1, "the socket was never reopened");
  assert.equal(fake.state.channels.size, 1, "one channel");
  assert.ok(fake.state.places.get("931:proba")?.listening, "place A listens");
  assert.ok(fake.state.places.get("48:proba-b")?.listening, "place B listens");
});

test("two graphs: each write is signed by the place of its own graph, also after a session turnover", async (t) => {
  const { fake, write } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba-b" },
  );
  assert.match(await write(NKS, "в A"), /автор: proba\)/);
  assert.match(await write(DRUGOY, "в B"), /автор: proba-b\)/);
  await fake.control({ kill_session: true });
  assert.match(await write(DRUGOY, "в B снова"), /автор: proba-b\)/);
  assert.match(await write(NKS, "в A снова"), /автор: proba\)/);
  assert.equal(fake.state.counts.unattributed, 0, "no write went out without its author");
});

test("two graphs under the SAME derived name: frames route by to_standing_id to their own watchdog; an unmatched frame goes to the first place with a word, never silently", async (t) => {
  const { fake, keyA, keyB, idOf, watch } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba" },
  );
  const idA = idOf(NKS, "proba");
  const idB = idOf(DRUGOY, "proba");
  assert.ok(idA && idB && idA !== idB, "the fake gives each place its own id");
  const wa = watch(keyA);
  const wb = watch(keyB);
  await waitUntil(() => wa.out.includes("слушаю стояние"), "watchdog A to attach");
  await waitUntil(() => wb.out.includes("слушаю стояние"), "watchdog B to attach");
  const send = (f) => fake.control({ ws_send: JSON.stringify(f) });
  await send(liveFrame("a-1", NKS, "proba", 931, idA, "слово месту A"));
  await send(liveFrame("b-1", DRUGOY, "proba", 48, idB, "слово месту B"));
  // Only the id: the address and graph cannot decide it, the id does.
  await send({ type: "message", id: "b-2", to_standing_id: idB, body: "по одному id к B" });
  await send(
    liveFrame("x-1", "@nks/chuzhoy", "chuzhoe", 5, "00000000-0000-0000-0000-000000000000", "ничьё"),
  );
  await waitUntil(() => wa.out.includes("слово месту A"), "A's frame at watchdog A");
  await waitUntil(() => wb.out.includes("слово месту B"), "B's frame at watchdog B");
  await waitUntil(() => wb.out.includes("по одному id к B"), "the id-only frame at watchdog B");
  await waitUntil(() => wa.out.includes("не сопоставлен"), "the word about the unmatched frame");
  await pause(300);
  assert.ok(!wa.out.includes("слово месту B"), `B's frame leaked to A:\n${wa.out}`);
  assert.ok(!wa.out.includes("по одному id к B"), `B's id frame leaked to A:\n${wa.out}`);
  assert.ok(!wb.out.includes("слово месту A"), `A's frame leaked to B:\n${wb.out}`);
  assert.ok(!wb.out.includes("ничьё"), `the unmatched frame went to B:\n${wb.out}`);
});

test("r5 and the slug of ANOTHER graph are two graphs: two places, and frames in the canonical form reach the place stood as r5", async (t) => {
  const { fake, b, keyA, keyB, idOf, watch } = await twoGraphs(
    t,
    { realm: "r5", karta: 931, name: "proba" },
    { realm: "@nks/methodology", karta: 12, name: "proba" },
  );
  assert.match(textOf(b), /встаёт рядом на канале/, textOf(b));
  assert.equal(fake.state.counts.connect, 1);
  const wa = watch(keyA);
  const wb = watch(keyB);
  await waitUntil(() => wa.out.includes("слушаю стояние"), "watchdog A to attach");
  await waitUntil(() => wb.out.includes("слушаю стояние"), "watchdog B to attach");
  const idA = idOf(NKS, "proba");
  await fake.control({ ws_send: JSON.stringify(liveFrame("a-5", NKS, "proba", 931, idA, "в r5")) });
  await waitUntil(() => wa.out.includes("в r5"), "the frame for the r5 place at watchdog A");
  await pause(300);
  assert.ok(!wb.out.includes("в r5"), `the r5 frame leaked to the methodology place:\n${wb.out}`);
});

test("r5 and the slug of the SAME graph are one graph: another name there is refused (#5154), the same place is only registered", async (t) => {
  const { fake, bridge } = await ready(t);
  const stand = (args) => bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const a = await stand({ realm: "r5", karta: 931, name: "proba" });
  assert.ok(!a.result?.isError, textOf(a));
  const other = await stand({ realm: NKS, karta: 931, name: "vtoraya" });
  assert.ok(other.result?.isError, `r5 and ${NKS} must be one graph:\n${textOf(other)}`);
  assert.match(textOf(other), /уже ведёт место proba--931--r5/, textOf(other));
  // The bare slug is resolved by the graph list (the live tool's text shape) — the same graph again.
  const bare = await stand({ realm: "nks-dev", karta: 931, name: "vtoraya" });
  assert.ok(bare.result?.isError, `nks-dev and r5 must be one graph:\n${textOf(bare)}`);
  assert.ok(fake.state.counts.realm_list >= 1, "the graph list was read");
  const same = await stand({ realm: NKS, karta: 931, name: "proba" });
  assert.ok(!same.result?.isError, textOf(same));
  assert.doesNotMatch(textOf(same), /встаёт рядом/, "the same graph never stands beside itself");
  assert.equal(fake.state.counts.connect, 1);
});

test("two graphs: within each graph the one-place rule still holds (#5154)", async (t) => {
  const { fake, stand, keyA, keyB } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba-b" },
  );
  const otherA = await stand({ realm: NKS, karta: 931, name: "vtoraya" });
  assert.ok(otherA.result?.isError, textOf(otherA));
  assert.match(textOf(otherA), new RegExp(`уже ведёт место ${keyA}`), textOf(otherA));
  const otherB = await stand({ realm: DRUGOY, karta: 48, name: "tretya" });
  assert.ok(otherB.result?.isError, textOf(otherB));
  assert.match(textOf(otherB), new RegExp(`уже ведёт место ${keyB}`), textOf(otherB));
  assert.equal(fake.state.counts.connect, 1, "a refused place took nothing");
});

test("two graphs: the busy line is held per place — status in a graph carries that place's standing_id", async (t) => {
  const { fake, bridge, idOf } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba" },
  );
  const status = (realm, text) =>
    bridge.call("tools/call", {
      name: "iskron_channel",
      arguments: { realm, action: "status", text },
    });
  const sb = await status(DRUGOY, "занят в B");
  assert.ok(!sb.result?.isError, textOf(sb));
  const sa = await status(NKS, "занят в A");
  assert.ok(!sa.result?.isError, textOf(sa));
  assert.equal(fake.state.placeStatus.get(idOf(DRUGOY, "proba")), "занят в B");
  assert.equal(fake.state.placeStatus.get(idOf(NKS, "proba")), "занят в A");
});

test("two graphs: revoking the first place is refused by the server while another graph's place stands on the channel, the bridge says so and keeps both; revoking the second releases only it", async (t) => {
  const { fake, bridge, keyA, keyB, watch, write } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba-b" },
  );
  const wa = watch(keyA);
  const wb = watch(keyB);
  await waitUntil(() => wb.out.includes("слушаю стояние"), "watchdog B to attach");
  const revoke = (realm, karta, standing) =>
    bridge.call("tools/call", {
      name: "iskron_channel",
      arguments: { realm, action: "revoke", karta, standing },
    });
  const first = await revoke(NKS, 931, "proba");
  assert.ok(first.result?.isError, textOf(first));
  assert.match(textOf(first), /основное место канала моста/, textOf(first));
  await pause(300);
  assert.equal(fake.state.counts.connect, 1, "the channel is untouched");
  assert.ok(fake.state.channels.size === 1, "the channel with both places stands");
  assert.equal(wa.proc.exitCode, null, "watchdog A stays attached");
  assert.equal(wb.proc.exitCode, null, "watchdog B stays attached");
  assert.match(await write(NKS, "A после отказа"), /автор: proba\)/);
  const second = await revoke(DRUGOY, 48, "proba-b");
  assert.ok(!second.result?.isError, textOf(second));
  await waitUntil(() => wb.proc.exitCode !== null, "watchdog B to lose its place");
  assert.equal(fake.state.channels.size, 1, "the channel survives the second place's revoke");
  assert.match(await write(NKS, "A после снятия B"), /автор: proba\)/);
  assert.equal(wa.proc.exitCode, null, "watchdog A stays attached");
});

test("two graphs: the stale batch and the wake batch are per place — each carries only its own frames and marks its own .seen", async (t) => {
  const { fake, dir, bridge, keyB, idOf } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba" },
    { ...INIT, clientInfo: { name: "pi-iskron", version: "0" } },
  );
  const idA = idOf(NKS, "proba");
  const idB = idOf(DRUGOY, "proba");
  const send = (f) => fake.control({ ws_send: JSON.stringify(f) });
  // Stale: one frame for each place.
  await send(liveFrame("sa-1", NKS, "proba", 931, idA, "лежалое A", { stale: true }));
  await send(liveFrame("sb-1", DRUGOY, "proba", 48, idB, "лежалое B", { stale: true }));
  const events = (kind) =>
    bridge.notifications.map((n) => n.params?.data).filter((d) => d?.kind === kind);
  await waitUntil(() => events("stale").length >= 2, "a stale batch per place");
  const staleB = events("stale").find((d) => d.key === keyB);
  const staleA = events("stale").find((d) => !d.key);
  assert.deepEqual(
    staleB?.frames?.map((f) => f.id),
    ["sb-1"],
    JSON.stringify(events("stale")),
  );
  assert.deepEqual(
    staleA?.frames?.map((f) => f.id),
    ["sa-1"],
    JSON.stringify(events("stale")),
  );
  // Wake: a platform frame opens A's batch; B's frame beside it is not swallowed.
  await send(
    liveFrame("wa-1", NKS, "proba", 931, idA, "побудка A", { provenance: { via: "platform" } }),
  );
  await send(liveFrame("wb-1", DRUGOY, "proba", 48, idB, "слово B"));
  await waitUntil(() => events("backlog").length >= 1, "A's wake batch");
  const batch = events("backlog")[0];
  assert.deepEqual(
    batch.frames.map((f) => f.id),
    ["wa-1"],
    JSON.stringify(batch),
  );
  assert.ok(!batch.key, "the batch is A's");
  const lone = events("frame").find((d) => d.frame?.id === "wb-1");
  assert.equal(lone?.key, keyB, "B's frame rides alone, under B's key");
  // Each place's .seen holds its own frames only.
  const standings = join(dir, "standings");
  const seenWith = (id) =>
    readdirSync(standings).filter(
      (f) =>
        f.endsWith(".seen") && readFileSync(join(standings, f), "utf8").split("\n").includes(id),
    );
  await waitUntil(
    () => seenWith("wa-1").length && seenWith("wb-1").length,
    "both marked delivered",
  );
  assert.notDeepEqual(seenWith("wa-1"), seenWith("wb-1"), "the two places share one .seen");
});

test("a graph name the bridge cannot resolve is refused aloud — stand, bare register and leave ask for @owner/slug and name the held places; the list is re-read on each miss", async (t) => {
  const { fake, bridge } = await ready(t);
  const stand = (args) => bridge.call("tools/call", { name: "iskron_stand", arguments: args });
  const channel = (args) => bridge.call("tools/call", { name: "iskron_channel", arguments: args });
  const a = await stand({ realm: NKS, karta: 931, name: "proba" });
  assert.ok(!a.result?.isError, textOf(a));
  const connects = fake.state.counts.connect;
  const registers = fake.state.counts.register_standing;
  const refusedWith = (r, what) => {
    assert.ok(r.result?.isError, `${what} must be refused:\n${textOf(r)}`);
    assert.match(textOf(r), /не разрешил в @owner\/slug/, what);
    assert.match(textOf(r), /полным адресом графа @owner\/slug/, what);
    assert.ok(textOf(r).includes(NKS), `${what} names the held place's graph:\n${textOf(r)}`);
  };
  refusedWith(await stand({ realm: "r99", karta: 931, name: "vtoraya" }), "iskron_stand in r99");
  const listsAfterFirst = fake.state.counts.realm_list;
  refusedWith(
    await channel({ realm: "r99", action: "register", karta: 931, name: "proba" }),
    "a bare register in r99",
  );
  assert.ok(fake.state.counts.realm_list > listsAfterFirst, "a miss re-reads the graph list");
  refusedWith(await channel({ realm: "r99", action: "leave" }), "leave in r99");
  assert.equal(fake.state.counts.connect, connects, "nothing was connected");
  assert.equal(fake.state.counts.register_standing, registers, "nothing was registered");
});

test("status in a graph whose place id is unknown is refused while the bridge holds two places; with one place a line without id still lands", async (t) => {
  const { fake, bridge, idOf } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba" },
    INIT,
    (f) => f.control({ registerNoId: true }),
  );
  const status = (realm, text) =>
    bridge.call("tools/call", {
      name: "iskron_channel",
      arguments: { realm, action: "status", text },
    });
  const sb = await status(DRUGOY, "занят в B");
  assert.ok(sb.result?.isError, `no id, two places — must refuse:\n${textOf(sb)}`);
  assert.match(textOf(sb), /легла бы на все места канала/, textOf(sb));
  assert.equal(fake.state.placeStatus.size, 0, "no line landed anywhere");
  const sa = await status(NKS, "занят в A");
  assert.ok(!sa.result?.isError, textOf(sa));
  assert.equal(fake.state.placeStatus.get(idOf(NKS, "proba")), "занят в A");
  assert.equal(fake.state.placeStatus.get(idOf(DRUGOY, "proba")), undefined, "B untouched");
  // One place, id unknown: the line lands as before.
  const one = await ready(t);
  await one.fake.control({ registerNoId: true });
  const s1 = await one.bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: NKS, karta: 931, name: "odin", status: "один" },
  });
  assert.match(textOf(s1), /Занятость: один/, textOf(s1));
});

test("two graphs: graph B's role hook is armed on the channel (channel=self), and a posed_to question in B reaches watchdog B only", async (t) => {
  const { fake, b, keyA, keyB, watch } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba" },
    INIT,
    (f) => f.control({ adminChannelSelf: true }),
  );
  assert.match(textOf(b), /Хук инбокса роли: взведён на канал \(channel=self\)/, textOf(b));
  // UNVERIFIED: the fake's list_webhooks line for a channel hook and its channel:self
  // delivery are modelled on the API steward's word, not observed — revisit once the
  // server ships channel:self on the MCP tool.
  assert.ok(
    fake.state.webhooks.some((w) => w.channel === "self" && w.karta === "48" && w.realm === DRUGOY),
    "the hook was registered on the channel for B's role in B",
  );
  const wa = watch(keyA);
  const wb = watch(keyB);
  await waitUntil(() => wa.out.includes("слушаю стояние"), "watchdog A to attach");
  await waitUntil(() => wb.out.includes("слушаю стояние"), "watchdog B to attach");
  await fake.control({ posed_to: { realm: DRUGOY, karta: 48, text: "вопрос роли в B" } });
  await waitUntil(() => wb.out.includes("вопрос роли в B"), "the posed_to event at watchdog B");
  await pause(300);
  assert.ok(!wa.out.includes("вопрос роли в B"), `B's question leaked to A:\n${wa.out}`);
});

test("two graphs: leave names every place it leaves — the socket is shared", async (t) => {
  const { bridge, keyA, keyB } = await twoGraphs(
    t,
    { realm: NKS, karta: 931, name: "proba" },
    { realm: DRUGOY, karta: 48, name: "proba" },
  );
  const left = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: NKS, action: "leave" },
  });
  assert.ok(!left.result?.isError, textOf(left));
  assert.ok(textOf(left).includes(keyA) && textOf(left).includes(keyB), textOf(left));
});

// A subagent's own bridge (#6002, the architect's conditions in #6001): Claude
// Code starts the MCP server of an agent file per subagent run, and that bridge
// — started with --satellite or ISKRON_BRIDGE_SATELLITE=1 — takes only a
// satellite place beside the caller's: `<caller>.sub-<N>`, first N free on the
// board, the caller's role, no role-inbox hook, a short channel ttl, no hold
// record; when the run ends (stdin closes) it leaves the place.
const CALLER = "host.repo.opus-5";
const SAT_ARGS = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` };
const holdFiles = (dir) => {
  try {
    return readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".hold"));
  } catch {
    return [];
  }
};
const until = async (check, what) => {
  for (const end = Date.now() + 10_000; !check();) {
    assert.ok(Date.now() < end, `timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
async function withCaller(t) {
  const fake = await startFakeNks({ pat: PAT });
  t.after(() => fake.stop());
  await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  return fake;
}
async function satelliteBridge(t, fake, { dir } = {}) {
  const home = dir ?? mkdtempSync(join(tmpdir(), "iskron-sat-"));
  const b = startBridge(fake.mcpUrl, home, process.cwd(), {}, ["--satellite"]);
  t.after(() => b.stop());
  assert.ok((await b.call("initialize", INIT)).result);
  return b;
}
const standAs = (b, args) => b.call("tools/call", { name: "iskron_stand", arguments: args });

test("satellite: a subagent's bridge stands as <caller>.sub-1 in the caller's role with a short ttl and no inbox hook; the next run takes .sub-2", async (t) => {
  const fake = await withCaller(t);
  const hooks = fake.state.counts.webhooks_added;
  const one = await satelliteBridge(t, fake);
  const r1 = await standAs(one, SAT_ARGS);
  assert.ok(!r1.result?.isError, `${textOf(r1)}\n${one.stderr}`);
  assert.equal(placeOf(r1), `${CALLER}.sub-1`, textOf(r1));
  assert.match(textOf(r1), /роль #931/, textOf(r1));
  const connect = fake.state.placeArgs.find(
    (x) => x.action === "connect" && x.name === `${CALLER}.sub-1`,
  );
  assert.ok(connect, JSON.stringify(fake.state.placeArgs));
  assert.equal(connect.ttl_seconds, 300, "a short channel ttl: invitations do not outlive the run");
  assert.equal(connect.attrs?.satellite_of, `@tester:${CALLER}`, "the board names the caller");
  assert.match(textOf(r1), /Хук инбокса роли: отдельному месту не взводится/, textOf(r1));
  assert.doesNotMatch(textOf(r1), /watchdog/, "a satellite is told no watchdog command");
  // The same run standing again comes back to its place, no new connect.
  const connects = fake.state.counts.connect;
  const again = await standAs(one, SAT_ARGS);
  assert.equal(placeOf(again), `${CALLER}.sub-1`, textOf(again));
  assert.equal(fake.state.counts.connect, connects, "the same run's place, not .sub-2");
  assert.match(textOf(again), /параллельный прогон того же файла агента/, "a shared run is named");
  assert.match(one.stderr, /мост уже держит/, "and warned on stderr");
  // Another run while sub-1 is on the board.
  const two = await satelliteBridge(t, fake);
  const r2 = await standAs(two, SAT_ARGS);
  assert.ok(!r2.result?.isError, `${textOf(r2)}\n${two.stderr}`);
  assert.equal(placeOf(r2), `${CALLER}.sub-2`, textOf(r2));
  assert.equal(fake.state.counts.webhooks_added, hooks, "no role-inbox hook for a satellite");
});

test("satellite: stdin closing leaves the place and no hold record is ever written; a session bridge writes one", async (t) => {
  const fake = await withCaller(t);
  const dir = mkdtempSync(join(tmpdir(), "iskron-sat-"));
  const sat = await satelliteBridge(t, fake, { dir });
  const r = await standAs(sat, SAT_ARGS);
  assert.ok(!r.result?.isError, `${textOf(r)}\n${sat.stderr}`);
  await until(() => fake.state.ws.size === 1, "the satellite's socket");
  assert.deepEqual(holdFiles(dir), [], "no hold record while the run stands");
  const posts = fake.state.counts.status_posts;
  await sat.stop();
  assert.equal(sat.proc.exitCode, 0, "the bridge goes with its run");
  assert.ok(fake.state.counts.status_posts > posts, "the busy line is cleared on the way out");
  assert.equal(fake.state.status, "");
  const journal = readFileSync(join(dir, "standings.log"), "utf8");
  assert.match(journal, /released \S+sub-1\S*: stdin closed/, journal); // the socket let go: left the place
  assert.deepEqual(holdFiles(dir), [], "no hold record after the run: no resume from disk");
  // Contrast: the same fake, a session bridge — the record is there, so the check above is not vacuous.
  const home = mkdtempSync(join(tmpdir(), "iskron-sess-"));
  const session = startBridge(fake.mcpUrl, home);
  t.after(() => session.stop());
  assert.ok((await session.call("initialize", INIT)).result);
  const s = await standAs(session, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!s.result?.isError, textOf(s));
  await until(() => holdFiles(home).length === 1, "the session bridge's hold record");
});

test("satellite: a session bridge still refuses a second name in its graph (#5154) and refuses satellite_of; a satellite bridge refuses anything but a satellite place", async (t) => {
  const { fake, bridge } = await ready(t);
  await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  const mine = await standAs(bridge, { realm: "nks-dev", karta: 931, name: "svoe" });
  assert.ok(!mine.result?.isError, textOf(mine));
  const other = await standAs(bridge, { realm: "nks-dev", karta: 931, name: "chuzhoe" });
  assert.equal(other.result?.isError, true, textOf(other));
  assert.match(textOf(other), /уже ведёт место svoe--931--nks-dev/, textOf(other));
  const connects = fake.state.counts.connect;
  const sub = await standAs(bridge, SAT_ARGS);
  assert.equal(sub.result?.isError, true, textOf(sub));
  assert.match(textOf(sub), /только мосту-спутнику/, textOf(sub));
  assert.equal(fake.state.counts.connect, connects, "nothing is taken");
  const sat = await satelliteBridge(t, fake);
  const plain = await standAs(sat, { realm: "nks-dev", karta: 931, name: "svoe-2" });
  assert.equal(plain.result?.isError, true, textOf(plain));
  assert.match(textOf(plain), /это мост-спутник/, textOf(plain));
  const noCaller = await standAs(sat, { ...SAT_ARGS, satellite_of: "@tester:nobody" });
  assert.equal(noCaller.result?.isError, true, textOf(noCaller));
  assert.match(textOf(noCaller), /на доске этого графа нет/, textOf(noCaller));
  assert.equal(fake.state.counts.connect, connects, "no refused call takes a place");
});

test("satellite: raw connect, register or revoke of the caller's place is refused before and after the satellite stands; its own place passes", async (t) => {
  const fake = await withCaller(t);
  const sat = await satelliteBridge(t, fake);
  const channel = (args) =>
    sat.call("tools/call", {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", karta: 931, ...args },
    });
  const connects = fake.state.counts.connect;
  const callerListens = () => fake.state.places.get(`931:${CALLER}`)?.listening === true;
  const before = await channel({ action: "connect", name: CALLER });
  assert.equal(before.result?.isError, true, textOf(before));
  assert.match(textOf(before), /мост-спутник/, textOf(before));
  const r = await standAs(sat, SAT_ARGS);
  assert.ok(!r.result?.isError, `${textOf(r)}\n${sat.stderr}`);
  const standConnects = fake.state.counts.connect;
  assert.equal(standConnects, connects + 1, "only iskron_stand's own connect went out");
  for (const args of [
    { action: "connect", name: CALLER },
    { action: "mint", name: CALLER },
    { action: "register", name: CALLER },
    { action: "revoke", standing: `@tester:${CALLER}` },
    { action: "revoke", standing: CALLER },
    { action: "connect", name: `${CALLER}.sub-1`, karta: 48 },
  ]) {
    const got = await channel(args);
    assert.equal(got.result?.isError, true, `${JSON.stringify(args)}: ${textOf(got)}`);
    assert.match(textOf(got), /только своего места/, textOf(got));
  }
  assert.equal(fake.state.counts.connect, standConnects, "no refused call reached the server");
  assert.ok(callerListens(), "the caller's place stays on the board, listening");
  const own = await channel({ action: "register", name: `${CALLER}.sub-1` });
  assert.ok(!own.result?.isError, textOf(own));
});

test("satellite: a connect refusing the short ttl in any words is retried without it, and the place is taken", async (t) => {
  const fake = await withCaller(t);
  await fake.control({ connect_refuse_ttl: "Отказано (422): окно простоя вне разброса контура" });
  const sat = await satelliteBridge(t, fake);
  const r = await standAs(sat, SAT_ARGS);
  assert.ok(!r.result?.isError, `${textOf(r)}\n${sat.stderr}`);
  assert.equal(placeOf(r), `${CALLER}.sub-1`, textOf(r));
  assert.equal(fake.state.counts.ttl_refused, 1, "the ttl was offered once");
  const connect = fake.state.placeArgs.find((x) => x.action === "connect");
  assert.equal(connect?.ttl_seconds, undefined, "the retry goes without ttl");
  assert.match(textOf(r), /контур не принял/, textOf(r));
});

// The satellite's role is the one its launcher names — the karta of the call —
// not an inheritance of the caller's role (#6002, the owner's word): the place
// is still `<caller>.sub-N`, and the caller may hold any role.
test("satellite: karta of another role stands as <caller>.sub-1 in THAT role, and the guard lets its own place pass", async (t) => {
  const fake = await withCaller(t);
  const sat = await satelliteBridge(t, fake);
  const r = await standAs(sat, { ...SAT_ARGS, karta: 48 });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${sat.stderr}`);
  assert.equal(placeOf(r), `${CALLER}.sub-1`, textOf(r));
  assert.match(textOf(r), /роль #48/, textOf(r));
  assert.ok(fake.state.places.get(`48:${CALLER}.sub-1`), "the place is taken in role #48");
  assert.ok(!fake.state.places.get(`931:${CALLER}.sub-1`), "not in the caller's role");
  const own = await sat.call("tools/call", {
    name: "iskron_channel",
    arguments: { realm: "nks-dev", karta: 48, action: "register", name: `${CALLER}.sub-1` },
  });
  assert.ok(!own.result?.isError, textOf(own));
});

// The platform learns the place is a satellite from an explicit field, not an
// attr (#6064: a satellite neither inherits the role's undelivered mail nor joins
// its fan-out): satellite_of = the caller's standing_id, in the body of connect
// and register. The id is printed only by the board of ONE role (list with karta),
// last under the place, after 🪪, 💬 and 📥 — the fixture is the live board of
// api 0.91 verbatim; the realm-wide board carries no id line at all. A session
// bridge never sends the field: a server that does not know it yet must not be
// touched by ordinary deliveries.
const LIVE_KARTA_BOARD = `Каналы #931 (4):
  #931 👨‍💻 Разработчик скилл-репозиториев агента 能 · @alari:16-m3.skills.opus-5-5 — живой · простой 6h · слушает · сокет был 2026-09-26T07:11:15.925457Z · открыл @alari
     🪪 claude-opus-5-5 · build={"name":"iskron-bridge","stamp":"dc25f0fd","version":"6.17.0"}, harness=claude-code
     💬 «6.19.0 вышел; волна 2 (дело 13) — после выката на бой» · 2026-09-26T06:15:48.664685Z
     📥 https://app.iskron.ru/api/channel/in/nks_chh_2O4L1IuLhwYxeieF_UI2KVKScmxoquh4TeKQUlfX2yg
     id 9499a342-4b74-486f-848c-b7236b36384d`;
const LIVE_BOARD = LIVE_KARTA_BOARD.replace("Каналы #931 (4):", "Каналы (1):").replace(
  /\n\s*id \S+$/,
  "",
);
test("satellite: connect and register carry satellite_of = the caller's place id; a session bridge sends no such field", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  t.after(() => fake.stop());
  const ID = "9499a342-4b74-486f-848c-b7236b36384d";
  const caller = "16-m3.skills.opus-5-5";
  await fake.control({ boardText: LIVE_BOARD, boardByKarta: { 931: LIVE_KARTA_BOARD } });
  const sat = await satelliteBridge(t, fake);
  const r = await standAs(sat, { ...SAT_ARGS, satellite_of: `@alari:${caller}` });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${sat.stderr}`);
  assert.doesNotMatch(textOf(r), /доска не напечатала/, textOf(r));
  // What the bridge SENT — the raw tools/call, before the fake drops what the schema lacks.
  const mine = sentToChannel(fake).filter((x) => x.name === `${caller}.sub-1`);
  const connect = mine.find((x) => x.action === "connect");
  const register = mine.find((x) => x.action === "register");
  assert.equal(connect?.satellite_of, ID, JSON.stringify(mine));
  assert.equal(register?.satellite_of, ID, JSON.stringify(mine));
  // Tripwire on the snapshot, not evidence about the bridge: what the platform keeps today is
  // nothing — iskron_channel does not declare the field and mcp drops it on the way to
  // /channels (r5 #6102). Red here once a snapshot declares it: then the platform stores the
  // satellite, and this probe should say so.
  for (const x of fake.state.placeArgs)
    assert.ok(!("satellite_of" in x), `dropped as by the server: ${JSON.stringify(x)}`);
  // Contrast on the same fake: a session bridge's connect and register.
  const home = mkdtempSync(join(tmpdir(), "iskron-sess-"));
  const session = startBridge(fake.mcpUrl, home);
  t.after(() => session.stop());
  assert.ok((await session.call("initialize", INIT)).result);
  const s = await standAs(session, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!s.result?.isError, textOf(s));
  const plain = sentToChannel(fake).filter((x) => x.name === "proba");
  assert.ok(
    plain.some((x) => x.action === "connect") && plain.some((x) => x.action === "register"),
  );
  for (const x of plain)
    assert.ok(!("satellite_of" in x), `no field outside satellite mode: ${JSON.stringify(x)}`);
  // «held» names the place: the OpenCode plugin raises a child session's bridge as its satellite.
  const heldPlace = () =>
    session.notifications.find((n) => n.params?.data?.kind === "held")?.params.data.place;
  await until(() => heldPlace(), "the held word");
  assert.equal(heldPlace().name, "proba");
  assert.equal(heldPlace().karta, "931");
});

// Standing in a role of its own gives the satellite no way into anyone else's
// place: the caller's place in either role, a foreign name in its own role.
test("satellite: standing in another role, it still may not take, register or revoke the caller's or a foreign place", async (t) => {
  const fake = await withCaller(t);
  const sat = await satelliteBridge(t, fake);
  const r = await standAs(sat, { ...SAT_ARGS, karta: 48 });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${sat.stderr}`);
  const connects = fake.state.counts.connect;
  for (const args of [
    { action: "connect", name: CALLER, karta: 931 },
    { action: "connect", name: CALLER, karta: 48 },
    { action: "mint", name: "chuzhoe", karta: 48 },
    { action: "register", name: CALLER, karta: 931 },
    { action: "revoke", standing: `@tester:${CALLER}`, karta: 931 },
    { action: "connect", name: `${CALLER}.sub-1`, karta: 931 },
  ]) {
    const got = await sat.call("tools/call", {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", ...args },
    });
    assert.equal(got.result?.isError, true, `${JSON.stringify(args)}: ${textOf(got)}`);
    assert.match(textOf(got), /только своего места/, textOf(got));
  }
  assert.equal(fake.state.counts.connect, connects, "no refused call reached the server");
  assert.ok(
    fake.state.places.get(`931:${CALLER}`)?.listening,
    "the caller's place stays listening",
  );
});

// English Iskron (#6080): the bridge's language follows its server — a host on
// .ai is English, any other Russian; ISKRON_BRIDGE_LANG=en|ru overrides. What the
// bridge writes itself — the iskron_stand answer — speaks that language; an
// English bridge asks the api for English prose (Accept-Language) and names the
// seat's language in connect and register (locale: "en"); a Russian one sends
// neither and leaves it to the server's default.
const CYRILLIC = /[а-яё]/i;

for (const [server, en] of [
  ["https://mcp.iskron.ai/", true],
  ["https://mcp.iskron.ru/", false],
]) {
  test(`a bridge on ${server} answers iskron_stand ${en ? "in English" : "in Russian"} — its own refusal, no network needed`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "iskron-stand-lang-"));
    const bridge = startBridge(server, dir);
    t.after(() => bridge.stop());
    const r = await bridge.call("tools/call", { name: "iskron_stand", arguments: {} });
    const text = textOf(r);
    assert.ok(r.result?.isError, text);
    if (en) {
      assert.doesNotMatch(text, CYRILLIC, text);
      assert.match(text, /^Refused \(bridge\): iskron_stand needs realm and karta/);
    } else assert.match(text, /^Отказано \(мост\): iskron_stand требует realm и karta/);
  });
}

test("an English bridge (ISKRON_BRIDGE_LANG=en) answers a whole iskron_stand without Cyrillic of its own, asks for English prose and sends locale en in connect and register", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-stand-en-"));
  const bridge = startBridge(fake.mcpUrl, dir, process.cwd(), { ISKRON_BRIDGE_LANG: "en" });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  const r = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", model: "opus-5" },
  });
  const text = textOf(r);
  assert.ok(!r.result?.isError, text);
  // The server's own prose echoed in parentheses is the api's half, in the server's language.
  const own = text.replace(/\([^()]*\)/g, "");
  if (process.env.ISKRON_SHOW_STAND) process.stderr.write(text + "\n");
  assert.doesNotMatch(own, CYRILLIC, text);
  assert.match(
    text,
    /^\[iskron_stand\] standing proba — role #931, graph nks-dev: connect and register\./,
  );
  // Judged on what the bridge SENT: iskron_channel does not declare locale yet, and the
  // server drops it (r5 #6102) — so does the fake.
  for (const action of ["connect", "register"]) {
    const got = sentToChannel(fake).find((x) => x.action === action);
    assert.equal(got?.locale, "en", `${action}: ${JSON.stringify(sentToChannel(fake))}`);
  }
  assert.ok(fake.state.acceptLanguage.has("en"), [...fake.state.acceptLanguage].join(","));
});

test("a Russian bridge sends no locale and no Accept-Language — the server's default decides", async (t) => {
  const { fake, bridge } = await ready(t);
  const r = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", model: "opus-5" },
  });
  assert.ok(!r.result?.isError, textOf(r));
  assert.match(textOf(r), /стояние proba — роль #931, граф nks-dev: connect и register/);
  for (const x of sentToChannel(fake)) assert.ok(!("locale" in x), JSON.stringify(x));
  // fetch's own default («*») is not a choice of language.
  assert.ok(!fake.state.acceptLanguage.has("en"), [...fake.state.acceptLanguage].join(","));
});

// The fake treats a tool call as the server does: an argument the tool's schema in
// fixtures/surface.json does not declare is dropped silently, not refused. The one
// way past it is named — futureArgs — for a probe that models a surface still to
// come; the raw call stays in state.calls either way.
test("fake NKS drops arguments the surface snapshot does not declare, silently; futureArgs lets a probe model a pending surface", async (t) => {
  const connectWith = async (opts) => {
    const fake = await startFakeNks({ pat: PAT, ...opts });
    t.after(() => fake.stop());
    const post = (body, sid) =>
      fetch(fake.mcpUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${PAT}`,
          "content-type": "application/json",
          ...(sid ? { "mcp-session-id": sid } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
      });
    const init = await post({ method: "initialize", params: INIT });
    const sid = init.headers.get("mcp-session-id");
    const arguments_ = { action: "connect", realm: "nks-dev", karta: "931", name: "p" };
    const r = await (
      await post(
        {
          method: "tools/call",
          params: { name: "iskron_channel", arguments: { ...arguments_, satellite_of: "u-1" } },
        },
        sid,
      )
    ).json();
    assert.ok(!r.result?.isError, JSON.stringify(r));
    assert.equal(fake.state.calls.at(-1).arguments.satellite_of, "u-1", "the raw call is kept");
    return fake.state.placeArgs.find((x) => x.action === "connect");
  };
  const today = await connectWith({});
  assert.ok(today, "connect went through — no refusal");
  assert.ok(!("satellite_of" in today), JSON.stringify(today));
  // A probe of the pending server change (r5 #6102) opts in by name.
  const pending = await connectWith({ futureArgs: { iskron_channel: ["satellite_of"] } });
  assert.equal(pending?.satellite_of, "u-1", JSON.stringify(pending));
});
