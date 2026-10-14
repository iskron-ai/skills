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
// seats as the window's button lays it. Without them the order is not run.
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
const apiArg = arg("--api", null);
const personArg = arg("--person", null);
const ackLog = arg("--ack-log", null);
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

// The order's trace (#7510): accepted on disk and answered before the stop, the outcome after
// the accepted's answer. The bridge's journal <auth>/orders/<id>.json keeps the accepted's time
// (`at`) under the outcome; the stand's /api proxy logs every ack it carries (--ack-log, JSONL
// {t, done, order, state, status}); standings.log stamps the stop and the outcome.
const stampOf = (line) => Date.parse(line.slice(0, 24));
function orderTrace(label, id, authDir, logText) {
  const lines = logText.split("\n").filter((l) => l.includes(`stop order ${id}`));
  const outcome = lines.find((l) => l.includes(`stop order ${id} for `));
  const action = lines.find((l) => !l.includes(`stop order ${id} for `));
  const jf = join(authDir, "orders", `${id}.json`);
  const j = existsSync(jf) ? JSON.parse(readFileSync(jf, "utf8")) : null;
  check(!!j && j.state === "stopped" && typeof j.at === "number", `order (${label}): the journal holds it, stopped, with the accepted's time`, j ? `${j.state} at ${new Date(j.at).toISOString()} acked ${j.acked}` : "no journal entry");
  const acks = ackLog ? (existsSync(ackLog) ? readFileSync(ackLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.order === id) : [];
  const acc = acks.find((a) => a.state === "accepted");
  const out = acks.find((a) => a.state !== "accepted");
  check(!!acc && acc.status < 300, `order (${label}): accepted reached the api`, acc ? `${acc.status} at ${new Date(acc.t).toISOString()}` : `acks: ${JSON.stringify(acks).slice(0, 160)}`);
  check(!!acc && !!out && out.state === "stopped" && out.status < 300 && acc.done <= out.t, `order (${label}): the outcome went after the accepted's answer`, acc && out ? `accepted answered ${new Date(acc.done).toISOString()}, ${out.state} sent ${new Date(out.t).toISOString()}` : "");
  const stopAt = action ? stampOf(action) : outcome ? stampOf(outcome) : NaN;
  check(!!j && stopAt >= j.at, `order (${label}): accepted on disk before the stop`, j && action ? `accepted ${new Date(j.at).toISOString()} · ${action.slice(0, 120)}` : outcome?.slice(0, 140));
  check(!!acc && !!outcome && stampOf(outcome) >= acc.done - 5, `order (${label}): the outcome line after the accepted's answer`, outcome?.slice(0, 60));
}
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

  // 6. The owner's stop order (#7519): laid on a seat by POST /standings/{id}/stop, it reaches
  // the bridge as a stop frame the agent never sees; the bridge answers accepted, stops the seat
  // as at a revoke and answers stopped. On the seat beside it ends that seat alone; on the
  // founder it ends the channel whole, the seat beside with it.
  if (apiArg && personArg && realm2Arg) {
    const standBoth = async () => {
      for (const [r, k, n] of [[realm, karta, nameA], [realm2Arg, karta2, nameB]])
        if (!seatId((await P.call("iskron_channel", { realm: r, action: "list", karta: `#${k}` })).text, n))
          await A.call("iskron_stand", { realm: r, karta: `#${k}`, name: n, model: "stand-run" });
      return [
        seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA),
        seatId((await P.call("iskron_channel", { realm: realm2Arg, action: "list", karta: `#${karta2}` })).text, nameB),
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
      if (o.body?.id) orderTrace(label, o.body.id, env.ISKRON_BRIDGE_AUTH_DIR, standingsLog());
      return { notes, log };
    };
    // The main seat alone: its agent is stopped, as by the owner's revoke.
    if (!seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA))
      await A.call("iskron_stand", { realm, karta: `#${karta}`, name: nameA, model: "stand-run" });
    const a0 = seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA);
    const alone = await order("main alone", a0, realm, 20_000);
    check(alone.notes.some((t) => /остановлен/.test(t)), "order (main alone): the agent told it is stopped");
    check(!seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA), "order (main alone): the seat is gone");
    const [a1, b1] = await standBoth();
    check(!!a1 && !!b1, "order: the main seat and the seat beside stand", `${a1} ${b1}`);
    const beside = await order("beside", b1, realm2Arg, 20_000);
    check(!seatId((await P.call("iskron_channel", { realm: realm2Arg, action: "list", karta: `#${karta2}` })).text, nameB), "order (beside): the seat beside is gone");
    check(!!seatId((await P.call("iskron_channel", { realm, action: "list", karta: `#${karta}` })).text, nameA), "order (beside): the main seat holds");
    check(!beside.notes.some((t) => /остановлен/.test(t) && t.includes(nameA)), "order (beside): the main seat is not stopped");
    const [a2, b2] = await standBoth();
    const founder = await order("founder", a2, realm, 30_000);
    check(founder.notes.some((t) => /остановлен/.test(t)), "order (founder): the agent told it is stopped", founder.notes.find((t) => /остановлен/.test(t))?.slice(0, 200) ?? `notes: ${founder.notes.length}`);
    for (const [r, k, n] of [[realm, karta, nameA], [realm2Arg, karta2, nameB]])
      check(!seatId((await P.call("iskron_channel", { realm: r, action: "list", karta: `#${k}` })).text, n), `order (founder): ${n} is gone`);
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
