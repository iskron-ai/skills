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
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
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
  assert.match(textOf(unknown), /адреса нет на доске/, textOf(unknown));
  assert.equal(fake.state.sends.length, 2, "an address absent from the board is never guessed at");
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
