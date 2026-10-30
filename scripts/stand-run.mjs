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
// --api, --person — the api beside the MCP and a person it trusts by X-Forwarded-User (a LOCAL
// carrier's test identity, the graphs' owner): the owner's stop order (#7519) is laid on the
// seats as the window's button lays it. Without them the order is not run. --api is required:
// the person takes seats off through it (scripts/stand-person.mjs) — as --person, else as the token.
// The release batch: the seat's pulse on the board (#7529; with --api read from GET /me/channels,
// else from the board's text), take onto another name refused while a seat beside stands
// (#6499, needs --realm2), the `stop` subcommand and its refusal of another owner's address
// (#7518). Opt-in: the agent's end — a bridge killed
// without a mark, its seat standing until the death window, then gone (#7493); --with-agent-end
// runs it, --death-ms is then the run's death window (ISKRON_BRIDGE_DEATH_MS of its daemon), 20000.
// Exit 0 — every check passed; 1 — a check failed (the report names it); 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { orderTrace } from "./stand-order.mjs";
import { personApi } from "./stand-person.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
};
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  const head = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  process.stdout.write(head.slice(0, head.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(0);
}
const URL_ = arg("--url", "https://nks.lab.mirari.ru/mcp-test");
const tokenFile = arg("--token-file", join(homedir(), ".iskron-stand", "token"));
const keep = process.argv.includes("--keep");
const realmArg = arg("--realm", null);
const realm2Arg = arg("--realm2", null);
const expectUser = arg("--expect-user", null);
const apiArg = arg("--api", null);
const personArg = arg("--person", null);
const ackLog = arg("--ack-log", null);
// --bridge — another build of the bridge (a release output), dist/dev by default.
const bridgePath = arg("--bridge", join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs"));
const withAgentEnd = process.argv.includes("--with-agent-end");
const OUT_AGENT_END = "SKIP не прогнан: конец агента — --with-agent-end включает";
const deathMs = Number(arg("--death-ms", "20000"));
if (process.argv.includes("--death-ms") && !withAgentEnd) fail(2, "--death-ms is for --with-agent-end only");

if (!existsSync(bridgePath)) fail(2, `no bridge at ${bridgePath} — make build-js or --bridge`);
if (!existsSync(tokenFile)) fail(2, `no stand token at ${tokenFile}`);
const token = readFileSync(tokenFile, "utf8").trim();
if (!token) fail(2, `empty token file ${tokenFile}`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `token file ${tokenFile} is readable by others — chmod 600`);
if (!apiArg) fail(2, "--api is required: the person takes seats off through the api (#7636)");
const person = personApi({ api: apiArg, person: personArg, token });

const run = mkdtempSync(join(tmpdir(), "stand-run-"));
// Every way out, an early setup refusal too, takes the run dir — the token copy with it.
process.on("exit", () => (keep ? process.stderr.write(`run dir kept: ${run}\n`) : rmSync(run, { recursive: true, force: true })));
const envFor = (dir, secret) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "token"), secret + "\n", { mode: 0o600 });
  const e = { ...process.env, HOME: join(run, "home"), ISKRON_BRIDGE_AUTH_DIR: dir, ISKRON_BRIDGE_URL: URL_, ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_DEATH_MS: String(deathMs) };
  delete e.ISKRON_BRIDGE_TOKEN;
  delete e.ISKRON_BRIDGE_LANG; // the default is under test: no variable names the language
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
    list: () => request("tools/list", {}),
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
// The api directly: as the person (test identity) or as the seats' own credential.
async function api(method, path, { body, realm, asSeat } = {}) {
  const h = { "Content-Type": "application/json" };
  if (asSeat) h.Authorization = `Bearer ${token}`;
  else Object.assign(h, { "X-Forwarded-User": personArg, "X-Forwarded-User-Pref-Username": personArg });
  if (realm) h["X-NKS-Realm"] = realm;
  const r = await fetch(apiArg.replace(/\/$/, "") + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j?.data ?? j };
}
const CYR = /[а-яё]/i;

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
// The seat's lines on the board: its head line up to the next seat's.
const seatBlock = (board, name) => {
  const lines = board.split("\n");
  const i = lines.findIndex((l) => l.includes(`:${name} —`));
  if (i === -1) return [];
  const j = lines.findIndex((l, k) => k > i && / · @[\w.-]+:\S+ —/.test(l));
  return lines.slice(i, j === -1 ? i + 10 : Math.min(j, i + 10));
};
// The seat's pulse (graph @nks/nks-dev, node #7529): with --api the deepest object of
// GET /me/channels carrying `pulse` that names the seat, else the board's text.
function pulseIn(x, key) {
  if (!x || typeof x !== "object") return null;
  for (const v of Object.values(x)) {
    const f = pulseIn(v, key);
    if (f) return f;
  }
  return x.pulse && typeof x.pulse === "object" && JSON.stringify(x).includes(key) ? x.pulse : null;
}
function pulseText(block) {
  const t = block.join("\n");
  const j = t.match(/pulse[=:]\s*(\{[^\n]*?\})/);
  if (j)
    try {
      return JSON.parse(j[1]);
    } catch {}
  const s = t.match(/\bstate[=:]\s*(\w+)/);
  if (!s) return null;
  const out = { state: s[1] };
  const p = t.match(/\bpending[=:]\s*(\d+)/);
  if (p) out.pending = Number(p[1]);
  for (const k of ["turn_at", "read_at", "cycle_at"]) {
    const m = t.match(new RegExp(`\\b${k}[=:]\\s*([^\\s,·]+)`));
    if (m) out[k] = m[1];
  }
  return out;
}
const daemonLog = () => {
  const p = join(env.ISKRON_BRIDGE_AUTH_DIR, "run", "daemon.log");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};
// A subcommand of the bridge under the run's env: stop, status.
const sub = (args) =>
  new Promise((res) => {
    const c = spawn("node", [bridgePath, ...args], { env });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => res({ code, out, err }));
  });
const STOP_WORD = /остановлен|you are stopped/;

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const realmSlug = "bridge-night";
let realm;
const nameA = `night-${stamp}.a`;
const nameB = `night-${stamp}.b`;

const A = open("agent");
const P = open("person");
// The board as the person reads it; a refused read is not an empty board — "the seat is gone"
// must not pass on it, so the run fails.
const readBoard = async (r, k) => {
  const x = await P.call("iskron_channel", { realm: r, action: "list", karta: `#${k}` });
  if (x.error) throw new Error(`board of ${r}: ${x.text.slice(0, 300)}`);
  return x.text;
};
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
  const board = (await readBoard(realm, karta));
  const idA = channelId(board, nameA);
  check(!!idA, "board: seat listed with its id", idA ?? "no id");
  const before = A.notes.length;
  const rv = await person.revoke(realm, idA);
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
  const board2 = (await readBoard(realm, karta));
  check(!board2.includes(`:${nameA} —`), "board: no seat after a minute");

  // 2. The name is free: an explicit stand takes it again.
  const again = await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
  check(!again.error && /hello получен/.test(again.text), "explicit stand takes the name again", again.text.split("\n")[0]);

  // Pulse (#7529): the seat's socket carries the agent's liveness — the board shows its state and
  // pending. A bare stdio client is no harness that reports turns: the state is noted, not judged.
  const pulseOf = async (r, k, name) => {
    const brd = (await readBoard(r, k));
    if (!apiArg) return pulseText(seatBlock(brd, name));
    const ch = await api("GET", "/me/channels", { asSeat: true, realm: r });
    return pulseIn(ch.body, seatId(brd, name) ?? `:${name}`);
  };
  await sleep(5_000);
  const pl = await pulseOf(realm, karta, nameA);
  check(typeof pl?.state === "string" && typeof pl?.pending === "number", `pulse: the board shows the seat's state and pending (${apiArg ? "GET /me/channels" : "board text"})`, JSON.stringify(pl));

  // 3. A seat beside — another graph on the same channel; taken off, it is forgotten without a stop.
  let karta2;
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
    karta2 = (k2.text.match(/\(#(\d+)\)/) || [])[1];
    const beside = await A.call("iskron_stand", { realm: realm2Arg, karta: `#${karta2}`, name: nameB, model: "stand-run" });
    check(!beside.error, "seat beside stands in the second graph", beside.text.split("\n")[0].slice(0, 160));
    const idB = channelId((await readBoard(realm2Arg, karta2)), nameB);
    // take onto another main name while the seat beside stands (#6499): refused before connect.
    const nameT = `night-${stamp}.t`;
    const l3 = standingsLog().length;
    const tk = await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameT, model: "stand-run", take: true });
    check(/Отказано|Refused/.test(tk.text) && /рядом|beside/.test(tk.text), "take onto another name with a seat beside — refused", tk.text.split("\n")[0].slice(0, 200));
    const bt = (await readBoard(realm, karta));
    check(!seatId(bt, nameT) && !!seatId(bt, nameA), "take refused: no seat of the new name, the main seat stands");
    check(!standingsLog().slice(l3).includes(nameT), "take refused: no connect of the new name (standings.log)", standingsLog().slice(l3).split("\n").filter((l) => l.includes(nameT)).join(" | ").slice(0, 200));
    check(!!seatId((await readBoard(realm2Arg, karta2)), nameB), "take refused: the seat beside stands");
    const before3 = A.notes.length;
    const rvB = await person.revoke(realm2Arg, idB);
    check(!rvB.error, "person takes the seat beside off", rvB.text.slice(0, 160));
    await sleep(20_000);
    const notes3 = A.notes.slice(before3).map(noteText);
    check(!notes3.some((t) => /остановлен/.test(t) && t.includes(nameA)), "main seat not stopped by the beside removal", notes3.join(" | ").slice(0, 200));
    const board3 = (await readBoard(realm, karta));
    check(board3.includes(`:${nameA} —`), "main seat still held after the one beside is taken off");
  } else report.push("SKIP seat beside — no --realm2");

  // 4. Own revoke in every form the bridge must recognise as its own (graph @nks/nks-dev,
  // node #6987): karta as a JSON number, as "N", as "#N"; standing as the full address and as
  // the name alone. Each is quiet — no stop word; the seat is taken again between them.
  // whoami speaks the session's language: the handle is the first @name that is not a graph.
  const handle = (who.text.match(/(?:^|\s)(@[\w.-]+)(?![\w./-])/m) || [])[1] ?? (expectUser ? `@${expectUser}` : "");
  const forms = [
    ["karta as a JSON number", () => ({ karta: Number(karta) })],
    ['karta as "N"', () => ({ karta: String(karta) })],
    ['karta as "#N"', () => ({ karta: `#${karta}` })],
    ["standing as the full address", () => ({ karta: `#${karta}`, standing: `${handle}:${nameA}` })],
    ["standing as the name alone", () => ({ karta: `#${karta}`, standing: nameA })],
  ];
  for (const [label, args] of forms) {
    if (!seatId((await readBoard(realm, karta)), nameA))
      await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
    const before4 = A.notes.length;
    const own4 = await A.call("iskron_channel", { realm, action: "revoke", ...args() });
    check(!own4.error, `own revoke (${label}) answered`, own4.text.split("\n")[0].slice(0, 160));
    await sleep(12_000);
    const notes4 = A.notes.slice(before4).map(noteText);
    check(!notes4.some((t) => /остановлен/.test(t)), `own revoke (${label}): no stop word`, notes4.join(" | ").slice(0, 200));
    check(!seatId((await readBoard(realm, karta)), nameA), `own revoke (${label}): the seat is gone`);
  }

  // 6. The owner's stop order (#7519): laid on a seat by POST /standings/{id}/stop, it reaches
  // the bridge as a stop frame the agent never sees; the bridge answers accepted, stops the seat
  // as at a revoke and answers stopped. On the seat beside it ends that seat alone; on the
  // founder it ends the channel whole, the seat beside with it.
  if (apiArg && personArg && realm2Arg) {
    const standBoth = async () => {
      for (const [r, k, n] of [[realm, karta, nameA], [realm2Arg, karta2, nameB]])
        if (!seatId((await readBoard(r, k)), n))
          await A.call("iskron_stand", { realm: r, karta: `#${k}`, name: n, model: "stand-run" });
      return [
        seatId((await readBoard(realm, karta)), nameA),
        seatId((await readBoard(realm2Arg, karta2)), nameB),
      ];
    };
    const order = async (label, seat, inRealm, wait) => {
      const n0 = A.notes.length;
      const l0 = standingsLog().length;
      const o = await api("POST", `/standings/${seat}/stop`, {
        realm: inRealm,
        body: { reason_code: "person_request", client_id: `stand-run-${stamp}-${label}` },
      });
      check(o.status === 201 && !!o.body?.id, `order (${label}): laid, 201`, `${o.status} ${JSON.stringify(o.body).slice(0, 160)}`);
      await sleep(wait);
      const notes = A.notes.slice(n0).map(noteText);
      const log = standingsLog().slice(l0);
      const lines = log.split("\n").filter((l) => o.body?.id && l.includes(`stop order ${o.body.id} for `));
      check(!notes.some((t) => /"type":"stop"/.test(t) || /"kind":"frame"/.test(t)), `order (${label}): the stop frame is not the agent's`, notes.filter((t) => /stop/.test(t)).join(" | ").slice(0, 200));
      check(lines.length === 1 && lines[0].includes(`for ${seat}: stopped`), `order (${label}): one "stop order … stopped" line`, lines.join(" | ").slice(0, 200) || "none");
      const mine = await api("GET", "/me/orders?limit=200", { asSeat: true });
      const it = (mine.body?.items ?? []).find((x) => x.id === o.body?.id);
      check(it?.state === "stopped" && !!it.acked_at, `order (${label}): the api holds it stopped`, `${mine.status} ${it ? `${it.state} by ${it.by} acked ${it.acked_at}` : "not listed"}`);
      if (o.body?.id) orderTrace(check, ackLog, label, o.body.id, env.ISKRON_BRIDGE_AUTH_DIR, standingsLog());
      return { notes, log };
    };
    // The main seat alone: its agent is stopped, as by the owner's revoke.
    if (!seatId((await readBoard(realm, karta)), nameA))
      await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
    const a0 = seatId((await readBoard(realm, karta)), nameA);
    const alone = await order("main alone", a0, realm, 20_000);
    check(alone.notes.some((t) => /остановлен/.test(t)), "order (main alone): the agent told it is stopped");
    check(!seatId((await readBoard(realm, karta)), nameA), "order (main alone): the seat is gone");
    const [a1, b1] = await standBoth();
    check(!!a1 && !!b1, "order: the main seat and the seat beside stand", `${a1} ${b1}`);
    const beside = await order("beside", b1, realm2Arg, 20_000);
    check(!seatId((await readBoard(realm2Arg, karta2)), nameB), "order (beside): the seat beside is gone");
    check(!!seatId((await readBoard(realm, karta)), nameA), "order (beside): the main seat holds");
    check(!beside.notes.some((t) => /остановлен/.test(t) && t.includes(nameA)), "order (beside): the main seat is not stopped");
    const [a2, b2] = await standBoth();
    const founder = await order("founder", a2, realm, 30_000);
    check(founder.notes.some((t) => /остановлен/.test(t)), "order (founder): the agent told it is stopped", founder.notes.find((t) => /остановлен/.test(t))?.slice(0, 200) ?? `notes: ${founder.notes.length}`);
    for (const [r, k, n] of [[realm, karta, nameA], [realm2Arg, karta2, nameB]])
      check(!seatId((await readBoard(r, k)), n), `order (founder): ${n} is gone`);
    const after = founder.log.split("\n");
    check(!after.some((l) => / held /.test(l) && (l.includes(nameA) || l.includes(nameB))), "order (founder): no held after it", after.filter((l) => / held /.test(l)).join(" | ").slice(0, 200));
    report.push(`INFO order (founder): 4001 lines — ${after.filter((l) => /4001/.test(l)).join(" | ").slice(0, 300) || "none"} (beside was ${b2})`);
  } else report.push("SKIP stop order — needs --api, --person and --realm2");

  // 7. The bridge asks the server's prose in its own language (#7593): a ru session reads the
  // tools and whoami in Russian, an en session in English, whatever the server's default.
  const sessions = [["ru", A, true]];
  const E = open("en", { ...env, ISKRON_BRIDGE_LANG: "en" });
  try {
    await E.init();
    sessions.push(["en", E, false]);
    for (const [label, b, ru] of sessions) {
      const tools = (await b.list()).result?.tools ?? [];
      const me = tools.find((t) => t.name === "iskron_me")?.description ?? "";
      check(!!me && CYR.test(me) === ru, `language (${label}): the tools' descriptions in ${ru ? "ru" : "en"}`, me.slice(0, 100));
      const who = (await b.call("iskron_me", { action: "whoami" })).text;
      check(ru ? CYR.test(who) && !/You are/.test(who) : /You are/.test(who), `language (${label}): whoami in ${ru ? "ru" : "en"}`, who.split("\n")[0].slice(0, 120));
    }
  } finally {
    await E.close();
  }

  const boardOf = async () => (await readBoard(realm, karta));

  // 8. The stop subcommand (#7518): a human puts down an agent of this machine by its seat — an
  // order to the seat (old api: a revoke), the agent's bridge stops it. Another owner's address
  // of the same name is refused, nothing is sent.
  const nameS = `night-${stamp}.s`;
  const S = open("stop-cli");
  try {
    await S.init();
    const sst = await S.call("iskron_stand", { realm, karta: `#${karta}`, name: nameS, model: "stand-run" });
    check(!sst.error, "stop: the agent's seat stands", sst.text.split("\n")[0].slice(0, 160));
    await sleep(5_000); // the daemon's snapshot learns the seat's id from hello
    const idS = seatId(await boardOf(), nameS);
    const n0 = S.notes.length;
    const foreign = await sub(["stop", `@stand-run-not-owner:${nameS}`, "--auth-dir", env.ISKRON_BRIDGE_AUTH_DIR]);
    check(foreign.code !== 0, "stop @another:name — refused", (foreign.err || foreign.out).split("\n")[0].slice(0, 200));
    await sleep(5_000);
    check(!!seatId(await boardOf(), nameS) && !S.notes.slice(n0).map(noteText).some((t) => STOP_WORD.test(t)), "stop @another:name — nothing taken off, the agent not stopped");
    const l0 = standingsLog().length;
    const sp = await sub(["stop", nameS, "--auth-dir", env.ISKRON_BRIDGE_AUTH_DIR]);
    check(sp.code === 0, "stop <seat>: answered", (sp.out || sp.err).split("\n")[0].slice(0, 200));
    await sleep(20_000);
    const notesS = S.notes.slice(n0).map(noteText);
    check(notesS.some((t) => STOP_WORD.test(t)), "stop <seat>: the agent told it is stopped", notesS.find((t) => STOP_WORD.test(t))?.slice(0, 200) ?? `notes: ${notesS.length}`);
    const logS = standingsLog().slice(l0).split("\n");
    const stopLine = logS.findIndex((l) => (l.includes(nameS) && / stopped /.test(l)) || (idS && l.includes(`for ${idS}: stopped`)));
    check(stopLine !== -1, "stop <seat>: standings.log stops it", logS[stopLine]?.slice(0, 200) ?? "none");
    check(stopLine !== -1 && !logS.slice(stopLine + 1).some((l) => l.includes(nameS) && / held /.test(l)), "stop <seat>: no held after it");
    check(!seatId(await boardOf(), nameS), "stop <seat>: the seat is gone from the board");
    if (apiArg) {
      const orderId = (sp.out.match(/\((?:приказ|order) ([\w-]+)\)/) || [])[1];
      const mine = await api("GET", "/me/orders?limit=200", { asSeat: true });
      const it = (mine.body?.items ?? []).find((x) => (orderId ? x.id === orderId : JSON.stringify(x).includes(idS)));
      check(it?.state === "stopped", "stop <seat>: /me/orders holds the order stopped", `${mine.status} ${it ? `${it.id} ${it.state} acked ${it.acked_at}` : `not listed (order ${orderId ?? "?"})`}`);
    } else report.push("SKIP stop <seat>: /me/orders — no --api");
  } finally {
    await S.close();
  }

  // 9. The agent's end (#7493): a bridge killed without an announced absence keeps its seat until
  // the death window, then the machine daemon closes it — no stop word. Out of the batch unless
  // --with-agent-end only: its death window lengthens the run.
  if (withAgentEnd) {
    const nameK = `night-${stamp}.k`;
    const K = open("killed");
    try {
      await K.init();
      const kst = await K.call("iskron_stand", { realm, karta: `#${karta}`, name: nameK, model: "stand-run" });
      check(!kst.error, "end: the agent's seat stands", kst.text.split("\n")[0].slice(0, 160));
      await sleep(3_000);
      const d0 = daemonLog().length;
      const l0 = standingsLog().length;
      K.child.kill("SIGKILL");
      await sleep(deathMs / 2);
      check(!!seatId(await boardOf(), nameK), `end: before the death window (${deathMs} ms) the killed agent's seat stands`);
      await sleep(deathMs / 2 + 20_000);
      check(!seatId(await boardOf(), nameK), "end: after the death window the seat is gone");
      const died = daemonLog().slice(d0).split("\n").find((l) => /without an announced absence — closing its seats/.test(l));
      check(!!died, "end: the daemon closes it as a death (daemon.log)", died?.slice(0, 200) ?? "none");
      check(!standingsLog().slice(l0).split("\n").some((l) => l.includes(nameK) && / stopped /.test(l)), "end: no stop on a death (standings.log)");
    } finally {
      if (K.child.exitCode === null && K.child.signalCode === null) await K.close();
    }
  } else report.push(OUT_AGENT_END);

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
