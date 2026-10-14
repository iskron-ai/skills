#!/usr/bin/env node
// A live run of the dev-built bridge against the nks stand, without a human: an isolated
// HOME and auth dir, a personal token of the stand, a graph and a role of its own. It checks
// the owner's stop (#7439): a seat taken off by a person stops its holder — the word
// "stopped", a `stopped` line in standings.log, no `held` or reconnect after it — while the
// name stays free and an own revoke stays quiet.
//
//   node scripts/stand-run.mjs [--token-file F] [--realm @owner/slug] [--expect-user U] [--url U] [--keep]
//
// The token: a file (default ~/.iskron-stand/token), one line, mode 0600 or stricter; it is
// handed to the bridge only through its own isolated auth dir, never argv, and never printed.
// --realm2 — a second graph in the token's territory, for the seat beside (one seat per graph per bridge).
// --realm — the run's graph when the token is scoped to it (a territorial writer PAT);
// without it the run takes or creates @<self>/bridge-night. --expect-user — whoami must name it.
// Exit 0 — every check passed; 1 — a check failed (the report names it); 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const realmArg = arg("--realm", null);
const realm2Arg = arg("--realm2", null);
const expectUser = arg("--expect-user", null);
// --bridge — another build of the bridge (a release output), dist/dev by default.
const bridgePath = arg("--bridge", join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs"));

if (!existsSync(bridgePath)) fail(2, `no bridge at ${bridgePath} — make build-js or --bridge`);
if (!existsSync(tokenFile)) fail(2, `no stand token at ${tokenFile}`);
const token = readFileSync(tokenFile, "utf8").trim();
if (!token) fail(2, `empty token file ${tokenFile}`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `token file ${tokenFile} is readable by others — chmod 600`);

const run = mkdtempSync(join(tmpdir(), "stand-run-"));
const envFor = (dir, secret) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "token"), secret + "\n", { mode: 0o600 });
  const e = { ...process.env, HOME: join(run, "home"), ISKRON_BRIDGE_AUTH_DIR: dir, ISKRON_BRIDGE_URL: URL_, ISKRON_BRIDGE_NO_UPDATE: "1" };
  delete e.ISKRON_BRIDGE_TOKEN;
  return e;
};
const env = envFor(join(run, "auth"), token);
const badEnv = envFor(join(run, "auth-bad"), "stand-run-invalid-token");
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

function open(name, e = env) {
  const child = spawn("node", [bridgePath], { env: e, stdio: ["pipe", "pipe", "pipe"] });
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
      if (child.exitCode !== null) return Promise.resolve();
      const done = new Promise((r) => child.once("exit", r));
      child.stdin.end();
      child.kill("SIGTERM");
      return Promise.race([done, sleep(10_000)]);
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const standingsLog = () => {
  const p = join(env.ISKRON_BRIDGE_AUTH_DIR, "standings.log");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
const noteText = (n) => JSON.stringify(n.m.params ?? {});
const seatId = (board, name) => channelId(board, name);
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
let setup = 0;
try {
  try {
    await A.init();
    await P.init();
  } catch (e) {
    setup = 2;
    throw e;
  }

  // The token authenticates: a real tool call, not initialize or tools/list.
  const who = await P.call("iskron_me", { action: "whoami" });
  check(!who.error && !/401|отвергнут|rejected/i.test(who.text), "whoami answers under the token", who.text.split("\n")[0].slice(0, 160));
  if (who.error) throw new Error(`whoami: ${who.text.slice(0, 300)}`);
  if (expectUser) check(who.text.includes(expectUser), `whoami names ${expectUser}`);

  // Negative control: a token the stand never issued is refused on a real call.
  const B = open("bad", badEnv);
  try {
    await B.init().catch(() => {});
    const bad = await B.call("iskron_me", { action: "whoami" });
    check(bad.error || /401|отверг|rejected/i.test(bad.text), "an unknown token is refused", bad.text.split("\n")[0].slice(0, 160));
  } finally {
    await B.close();
  }

  // A graph and a role of the run's own: the stand's data, nobody's live seat.
  const list = realmArg ? { text: realmArg } : await P.call("iskron_realm", { action: "list" });
  const own = realmArg ? [null, realmArg] : list.text.match(new RegExp(`(@[\\w-]+/${realmSlug})\\b`));
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

  // 3. A seat beside — another graph on the same channel; taken off, it is forgotten without a stop.
  if (realm2Arg) {
    const k2 = await P.call("iskron_add_karta", {
      realm: realm2Arg,
      name: "🧪 Ночной агент моста рядом",
      motivation: "Держит место рядом, чтобы прогон проверил снятие места рядом.",
      manifested_as: "adhikarin",
      epistemic_mode: "pratyakshita",
      ontic_mode: "vartamana",
      volitive_mode: "upeksha",
    });
    const karta2 = (k2.text.match(/\(#(\d+)\)/) || [])[1];
    const beside = await A.call("iskron_stand", { realm: realm2Arg, karta: `#${karta2}`, name: nameB, model: "stand-run" });
    check(!beside.error, "seat beside stands in the second graph", beside.text.split("\n")[0].slice(0, 160));
    const idB = channelId((await P.call("iskron_channel", { realm: realm2Arg, action: "list", karta: `#${karta2}` })).text, nameB);
    const before3 = A.notes.length;
    await P.call("iskron_channel", { realm: realm2Arg, action: "revoke", karta: `#${karta2}`, channel: idB, as_person: true });
    await sleep(20_000);
    const notes3 = A.notes.slice(before3).map(noteText);
    check(!notes3.some((t) => /остановлен/.test(t) && t.includes(nameA)), "main seat not stopped by the beside removal", notes3.join(" | ").slice(0, 200));
    const board3 = (await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text;
    check(board3.includes(`:${nameA} —`), "main seat still held after the one beside is taken off");
  } else report.push("SKIP seat beside — no --realm2");

  // 4. Own revoke in every form the bridge must recognise as its own (graph @nks/nks-dev,
  // node #6987): karta as a JSON number, as "N", as "#N"; standing as the full address and as
  // the name alone. Each is quiet — no stop word; the seat is taken again between them.
  const handle = (who.text.match(/You are (@[\w.-]+)/) || [])[1] ?? "";
  const forms = [
    ["karta as a JSON number", () => ({ karta: Number(karta) })],
    ['karta as "N"', () => ({ karta: String(karta) })],
    ['karta as "#N"', () => ({ karta: `#${karta}` })],
    ["standing as the full address", () => ({ karta: `#${karta}`, standing: `${handle}:${nameA}` })],
    ["standing as the name alone", () => ({ karta: `#${karta}`, standing: nameA })],
  ];
  for (const [label, args] of forms) {
    if (!seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA))
      await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
    const before4 = A.notes.length;
    const own4 = await A.call("iskron_channel", { realm, action: "revoke", ...args() });
    check(!own4.error, `own revoke (${label}) answered`, own4.text.split("\n")[0].slice(0, 160));
    await sleep(12_000);
    const notes4 = A.notes.slice(before4).map(noteText);
    check(!notes4.some((t) => /остановлен/.test(t)), `own revoke (${label}): no stop word`, notes4.join(" | ").slice(0, 200));
    check(!seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA), `own revoke (${label}): the seat is gone`);
  }

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
  await Promise.all([A.close(), P.close()]);
}

// The report never carries the credential, whatever a tool echoed.
process.stdout.write(report.join("\n").split(token).join("<token>") + "\n");
process.stdout.write(`\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
// The machine daemons of this run's auth dirs outlive their sessions by an idle window and
// would write into the run dir after its removal: put them down first.
for (const d of [join(run, "auth"), join(run, "auth-bad")]) spawnSync("pkill", ["-f", `daemon --auth-dir ${d}( |$)`]);
await new Promise((r) => setTimeout(r, 1500));
if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(setup || (failed ? 1 : 0));
