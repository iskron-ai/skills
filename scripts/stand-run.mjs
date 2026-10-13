#!/usr/bin/env node
// A live run of the dev-built bridge against the nks stand, without a human: an isolated
// HOME and auth dir, a personal token of the stand, a graph and a role of its own. It checks
// the owner's stop (#7439): a seat taken off by a person stops its holder — the word
// "stopped", a `stopped` line in standings.log, no `held` or reconnect after it — while the
// name stays free and an own revoke stays quiet.
//
//   node scripts/stand-run.mjs [--token-file F] [--url U] [--keep]
//
// Exit 0 — every check passed; 1 — a check failed (the report names it); 2 — setup failed.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
};
const URL_ = arg("--url", "https://nks.lab.mirari.ru/mcp-test");
const tokenFile = arg("--token-file", join(homedir(), ".iskron-stand", "token"));
const keep = process.argv.includes("--keep");
const bridgePath = join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs");

if (!existsSync(bridgePath)) fail(2, `no dev build at ${bridgePath} — make build-js`);
if (!existsSync(tokenFile)) fail(2, `no stand token at ${tokenFile}`);
const token = readFileSync(tokenFile, "utf8").trim();

const run = mkdtempSync(join(tmpdir(), "stand-run-"));
const env = {
  ...process.env,
  HOME: join(run, "home"),
  ISKRON_BRIDGE_AUTH_DIR: join(run, "auth"),
  ISKRON_BRIDGE_URL: URL_,
  ISKRON_BRIDGE_TOKEN: token,
  ISKRON_BRIDGE_NO_UPDATE: "1",
};
const report = [];
let failed = 0;
const check = (ok, what, seen) => {
  report.push(`${ok ? "PASS" : "FAIL"} ${what}${seen ? ` — ${seen}` : ""}`);
  if (!ok) failed++;
};

function fail(code, text) {
  process.stderr.write(`stand-run: ${text}\n`);
  process.exit(code);
}

function open(name) {
  const child = spawn("node", [bridgePath], { env, stdio: ["pipe", "pipe", "pipe"] });
  const replies = new Map();
  const notes = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.id !== undefined && m.method === undefined) replies.set(m.id, m);
        else if (m.method) notes.push({ at: Date.now(), m });
      } catch {}
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  let id = 1;
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const request = async (method, params, ms = 60_000) => {
    const my = id++;
    send({ jsonrpc: "2.0", id: my, method, params });
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (replies.has(my)) return replies.get(my);
      await sleep(100);
    }
    throw new Error(`${name}: no reply to ${method}`);
  };
  const call = async (tool, args) => {
    const r = await request("tools/call", { name: tool, arguments: args });
    const text = (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    return { text, error: !!(r.error || r.result?.isError), raw: r };
  };
  return {
    name,
    child,
    notes,
    stderr: () => stderr,
    call,
    async init() {
      const r = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: `stand-run-${name}`, version: "0" },
      });
      if (r.error) throw new Error(`${name}: initialize — ${JSON.stringify(r.error)}`);
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
    },
    close() {
      child.stdin.end();
      child.kill("SIGTERM");
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const standingsLog = () => {
  const p = join(env.ISKRON_BRIDGE_AUTH_DIR, "standings.log");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
const noteText = (n) => JSON.stringify(n.m.params ?? {});
const channelId = (board, name) => {
  const lines = board.split("\n");
  for (let i = 0; i < lines.length; i++)
    if (lines[i].includes(`:${name} —`))
      for (let j = i + 1; j < i + 8 && j < lines.length; j++) {
        const m = lines[j].match(/^\s+id ([0-9a-f-]{36})/);
        if (m) return m[1];
      }
  return null;
};

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const realmSlug = "bridge-night";
let realm;
const nameA = `night-${stamp}.a`;
const nameB = `night-${stamp}.b`;

const A = open("agent");
const P = open("person");
try {
  await A.init();
  await P.init();

  // The token authenticates: a real tool call, not initialize or tools/list.
  const who = await P.call("iskron_me", { action: "whoami" });
  check(!who.error && !/401|отвергнут|rejected/i.test(who.text), "whoami answers under the token", who.text.split("\n")[0].slice(0, 160));
  if (who.error) throw new Error(`whoami: ${who.text.slice(0, 300)}`);

  // A graph and a role of the run's own: the stand's data, nobody's live seat.
  const list = await P.call("iskron_realm", { action: "list" });
  const own = list.text.match(new RegExp(`(@[\\w-]+/${realmSlug})\\b`));
  if (own) realm = own[1];
  else {
    const made = await P.call("iskron_realm", { action: "create", slug: realmSlug, name: "Ночной прогон моста" });
    const m = made.text.match(/(@[\w-]+\/[\w-]+)/);
    if (made.error || !m) fail(2, `realm create: ${made.text.slice(0, 400)}`);
    realm = m[1];
  }
  const found = await P.call("iskron_search", { realm, q: "Ночной агент моста", node_type: "karta", limit: 3 });
  let karta = (found.text.match(/\(#(\d+), karta/) || [])[1];
  if (!karta) {
    const k = await P.call("iskron_add_karta", {
      realm,
      name: "🧪 Ночной агент моста",
      motivation: "Держит место, чтобы ночной прогон проверил остановку и возврат места мостом.",
      manifested_as: "adhikarin",
      epistemic_mode: "pratyakshita",
      ontic_mode: "vartamana",
      volitive_mode: "upeksha",
    });
    karta = (k.text.match(/\(#(\d+)\)/) || [])[1];
    if (!karta) fail(2, `karta: ${k.text.slice(0, 400)}`);
  }
  report.push(`realm ${realm} · karta #${karta} · bridge ${bridgePath}`);

  // 1. The agent stands; the person takes the seat off; the agent is stopped.
  const st = await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
  check(!st.error && /hello получен/.test(st.text), "stand: seat held, hello", st.text.split("\n")[0]);
  const board = (await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text;
  const idA = channelId(board, nameA);
  check(!!idA, "board: seat listed with its id", idA ?? "no id");
  const before = A.notes.length;
  const rv = await P.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: idA, as_person: true });
  check(!rv.error, "person revokes the seat", rv.text.split("\n")[0].slice(0, 160));
  await sleep(60_000);
  const after = A.notes.slice(before).map(noteText);
  check(after.some((t) => /остановлен/.test(t)), "agent told it is stopped", after.find((t) => /остановлен/.test(t))?.slice(0, 200) ?? `notes: ${after.length}`);
  check(!after.some((t) => /зови connect/.test(t)), "no «зови connect» in the word");
  const log = standingsLog();
  const keyA = log.split("\n").filter((l) => l.includes(nameA));
  const stopIdx = keyA.findIndex((l) => / stopped /.test(l));
  check(stopIdx !== -1, "standings.log: stopped line", keyA[stopIdx]?.slice(0, 200) ?? "none");
  check(stopIdx !== -1 && /revoked:person/.test(keyA[stopIdx]), "stop names revoked:person");
  check(stopIdx !== -1 && !keyA.slice(stopIdx + 1).some((l) => / held /.test(l)), "no held after the stop", keyA.slice(stopIdx + 1).join(" | ").slice(0, 200));
  const board2 = (await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text;
  check(!board2.includes(`:${nameA} —`), "board: no seat after a minute");

  // 2. The name is free: an explicit stand takes it again.
  const again = await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
  check(!again.error && /hello получен/.test(again.text), "explicit stand takes the name again", again.text.split("\n")[0]);

  // 3. A seat beside on the same channel, taken off: forgotten without a stop of the main seat.
  const beside = await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameB, model: "stand-run" });
  check(!beside.error, "second seat stands", beside.text.split("\n")[0]);
  const idB = channelId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameB);
  const before3 = A.notes.length;
  await P.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: idB, as_person: true });
  await sleep(20_000);
  const board3 = (await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text;
  check(board3.includes(`:${nameA} —`), "main seat still held after the other one is taken off");
  report.push(`notes after the beside revoke: ${A.notes.slice(before3).map(noteText).join(" | ").slice(0, 300)}`);

  // 4. Own revoke: quiet, revoked:self, no stop word.
  const idA2 = channelId(board3, nameA);
  const before4 = A.notes.length;
  const own4 = await A.call("iskron_channel", { realm, action: "revoke", karta: `#${karta}`, channel: idA2 });
  check(!own4.error, "own revoke answered", own4.text.split("\n")[0].slice(0, 160));
  await sleep(15_000);
  const notes4 = A.notes.slice(before4).map(noteText);
  check(!notes4.some((t) => /остановлен/.test(t)), "own revoke: no stop word", notes4.join(" | ").slice(0, 200));

  // 5. status names what is attached on this (isolated) machine.
  const status = await new Promise((res) => {
    const c = spawn("node", [bridgePath, "status"], { env });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => res({ code, out }));
  });
  check(status.code === 0, "status exits 0", status.out.split("\n").slice(0, 3).join(" / ").slice(0, 200));
} catch (e) {
  report.push(`ERROR ${e.message}`);
  failed++;
} finally {
  A.close();
  P.close();
}

process.stdout.write(report.join("\n") + "\n");
process.stdout.write(`\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
if (!keep) rmSync(run, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
