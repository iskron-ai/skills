#!/usr/bin/env node
// A live run of the reply line under a person's direct word (#9128): the scene of one
// run graph — a person's role (karta svatantra bound to the run's user) with its unnamed
// human seat, an agent's role (adhikarin) whose named seat the dev-built bridge holds.
// The person says a word to the agent's seat as themselves (as_person, scripts/stand-person.mjs);
// the frame's provenance is printed verbatim (from_standing, from_standing_id, from_person,
// user, karta — #9171 watches the unnamed seat's from_standing, an empty string included),
// and the frame's text is printed by the bridge's own watchdog (frameToText — the same path
// the pi extension and the OpenCode plugin take). Then the reply line under the word —
// «ответ: iskron_channel(action="send", realm=…, karta=…, standing=…, in_reply_to=…)» — is
// checked whole, executed as it stands, and the answer is verified through the api: laid
// under the person's word (in_reply_to) and addressed to their seat. No browser window is
// claimed: what the api shows is the ceiling of this run (the window itself is #9128's own
// boundary). No direct MCP session is opened by the driver — the bridge's daemon sessions
// die with their daemons; the api answers straight.
//
//   node scripts/stand-run-reply.mjs --token-file F --url U --api A --realm @owner/run \
//     [--bridge B.mjs] [--keep]
//
// The token: a file, one line, mode 0600 or stricter; handed to the bridge only through its
// own isolated auth dir, never argv, never printed. The seats and roles of the scene are the
// run graph's own fixture: taken off and deleted at the end.
// Exit 0 — every check passed; 1 — a check failed (the report names it); 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personApi, seatAddress } from "./stand-person.mjs";

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
const URL_ = arg("--url", "https://nks.lab.mirari.ru/mcp-iskron");
const tokenFile = arg("--token-file", join(homedir(), ".iskron-stand", "token"));
const apiArg = arg("--api", URL_.replace(/\/mcp-iskron$/, "").replace(/\/$/, "") + "/api");
const realm = arg("--realm", null);
const keep = process.argv.includes("--keep");
const bridgePath = arg("--bridge", join(root, "dist/dev/skills/establish-mcp/scripts/iskron.mjs"));
if (!realm) fail(2, "--realm is required: the scene lives in the run's own graph");
if (!existsSync(bridgePath)) fail(2, `no bridge at ${bridgePath} — make build-js or --bridge`);
if (!existsSync(tokenFile)) fail(2, `no stand token at ${tokenFile}`);
const token = readFileSync(tokenFile, "utf8").trim();
if (!token) fail(2, `empty token file ${tokenFile}`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `token file ${tokenFile} is readable by others — chmod 600`);

const run = mkdtempSync(join(tmpdir(), "stand-reply-"));
// Every way out, an early setup refusal too, takes the run dir — the token copy with it.
process.on("exit", () => (keep ? process.stderr.write(`run dir kept: ${run}\n`) : rmSync(run, { recursive: true, force: true })));
const authDir = join(run, "auth");
mkdirSync(authDir, { recursive: true, mode: 0o700 });
writeFileSync(join(authDir, "token"), token + "\n", { mode: 0o600 });
const env = { ...process.env, HOME: join(run, "home"), ISKRON_BRIDGE_AUTH_DIR: authDir, ISKRON_BRIDGE_URL: URL_, ISKRON_BRIDGE_NO_UPDATE: "1" };
delete env.ISKRON_BRIDGE_TOKEN;
delete env.ISKRON_BRIDGE_LANG; // the default language is the live one: the reply line's words come as shipped

const report = [];
let failed = 0;
const check = (ok, what, seen) => {
  report.push(`${ok ? "PASS" : "FAIL"} ${what}${seen ? ` — ${String(seen).slice(0, 400)}` : ""}`);
  if (!ok) failed++;
};

function fail(code, text) {
  process.stderr.write(`stand-run-reply: ${text}\n`);
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
        else if (m.method) notes.push(m);
      } catch {}
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  let id = 1;
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const request = async (method, params, ms = 90_000) => {
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
        clientInfo: { name: `stand-reply-${name}`, version: "0" },
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
// The api straight: as the run's own credential (a PAT is its person, #7561).
async function api(method, path, { body } = {}) {
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-NKS-Realm": realm };
  const r = await fetch(apiArg.replace(/\/$/, "") + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j?.data ?? j };
}
const person = personApi({ api: apiArg, token });

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const seatName = `reply-${stamp}.a`;
const MARK = `REPLY-PROBE-${stamp}`;
const ANSWER = `REPLY-ANSWER-${stamp}: 4`;

// A process of the run with its output kept: the watchdog.
function runProc(args) {
  const child = spawn("node", [bridgePath, ...args], { env });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  return { child, out: () => out, err: () => err };
}

const A = open("agent");
const P = open("maker"); // graph writes of the scene: roles, board reads, deletions
let wd = null;
let setup = 0;
// The scene's fixture as far as it got made: the cleanup takes off what is here.
let humanKarta = null;
let agentKarta = null;
let humanSeatId = null;
const board = async () => {
  const x = await P.call("iskron_channel", { realm, action: "list", karta: `#${agentKarta}` });
  if (x.error) throw new Error(`board: ${x.text.slice(0, 300)}`);
  return x.text;
};

// Seats and roles off — the scene was this run's own fixture. Every way out runs it once; a
// step that fails is said in the report, the run's outcome stays its checks'.
async function cleanup() {
  const said = (ok, what, seen) => report.push(`${ok ? "CLEANUP" : "CLEANUP FAILED"} ${what}${seen ? ` — ${String(seen).slice(0, 200)}` : ""}`);
  const step = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      said(false, what, e.message);
    }
  };
  if (agentKarta)
    await step(`the seat ${seatName}`, async () => {
      const b2 = await board();
      const seatId = b2
        .split("\n")
        .slice(0, 100)
        .map((_, i, ls) => ls.slice(i, i + 8).join("\n"))
        .find((blk) => blk.includes(`:${seatName} —`));
      const sid = (seatId?.match(/^\s+id ([0-9a-f-]{36})/m) || [])[1];
      if (!sid) return report.push("SKIP cleanup seat: no id on the board (already gone?)");
      const rv = await person.revoke(realm, sid);
      said(!rv.error, `the seat ${seatName} taken off`, rv.text);
    });
  if (humanSeatId)
    await step("the person's unnamed seat", async () => {
      const rh = await person.revoke(realm, humanSeatId);
      said(!rh.error, "the person's unnamed seat taken off", rh.text);
    });
  for (const k of [agentKarta, humanKarta].filter(Boolean))
    await step(`роль #${k}`, async () => {
      const look = await P.call("iskron_look", { realm, node_id: `#${k}` });
      const v = (look.text.match(/, v(\d+)\)/) || [])[1];
      if (!v) return report.push(`SKIP cleanup роли #${k}: версия не прочитана — ${look.text.split("\n")[0].slice(0, 160)}`);
      const del = await P.call("iskron_delete_node", { realm, node_id: `#${k}`, basis_version: v, reasoning: "прогон строки ответа: фикстура снята" });
      said(!del.error, `роль #${k} снята`, del.text.split("\n")[0]);
    });
}

try {
  try {
    await A.init();
    await P.init();
  } catch (e) {
    setup = 2;
    throw e;
  }

  // The scene (#7561): the run's user id binds the person's role; the agent's role stands.
  const who = await api("GET", "/whoami");
  const userId = who.body?.id ?? null;
  check(who.status === 200 && !!userId, "whoami names the run's user", `${who.status} ${JSON.stringify(who.body).slice(0, 200)}`);
  if (!userId) throw new Error("no user id from whoami — the person's role cannot be bound");
  const version = await api("GET", "/version");
  report.push(`INFO api version ${JSON.stringify(version.body).slice(0, 160)}`);

  const mk = async (name, motivation, manifested, user) => {
    const k = await P.call("iskron_add_karta", {
      realm,
      name,
      motivation,
      manifested_as: manifested,
      ...(user ? { user } : {}),
      epistemic_mode: "pratyakshita",
      ontic_mode: "vartamana",
      volitive_mode: "upeksha",
    });
    const id = (k.text.match(/\(#(\d+)\)/) || [])[1];
    if (!id) throw new Error(`karta ${name}: ${k.text.slice(0, 300)}`);
    return id;
  };
  humanKarta = await mk("🧪 Человек прогона строки ответа", "Безымянное место человека: его слово идёт агенту, ответ встаёт под ним.", "svatantra", userId);
  agentKarta = await mk("🧪 Агент прогона строки ответа", "Держит место, которому человек говорит как человек; отвечает по строке под словом.", "adhikarin");
  report.push(`INFO realm ${realm} · человек #${humanKarta} (svatantra, user ${userId}) · агент #${agentKarta} (adhikarin) · bridge ${bridgePath}`);
  // The person's own unnamed seat on their role: the api signs an as_person word with its
  // address only when it stands (#48: no such seat — the word goes without one, by design).
  const hs = await api("POST", "/channels", { body: { karta: humanKarta } });
  humanSeatId = hs.body?.standing_id ?? hs.body?.id ?? null;
  check(hs.status === 201 && !!humanSeatId, "the person's unnamed seat on their role", `${hs.status} ${JSON.stringify(hs.body).slice(0, 200)}`);

  // The agent stands; the real watchdog attaches — the frame's text comes out of it.
  const st = await A.call("iskron_stand", { realm, karta: `#${agentKarta}`, name: seatName, model: "stand-run-reply" });
  check(!st.error, "stand: the agent's seat is held", st.text.split("\n")[0].slice(0, 200));
  const wdKey = (st.text.match(/watchdog (\S+)/) || [])[1];
  check(!!wdKey, "stand: the answer names the watchdog command", (st.text.match(/watchdog[^\n]*/) || ["none"])[0].slice(0, 200));
  const b = await board();
  report.push(`INFO board (адрес агента ${seatAddress(b, seatName)}):\n${b.split("\n").slice(0, 14).join("\n")}`);
  if (wdKey) {
    wd = runProc(["watchdog", wdKey, "--auth-dir", authDir]);
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000 && !/слушаю стояние|listening on standing/.test(wd.out())) await sleep(500);
    check(/слушаю стояние|listening on standing/.test(wd.out()), "watchdog attached at the seat", wd.out().split("\n")[0]?.slice(0, 200) ?? "no output");
  }

  // The person's word to the agent's seat, as themselves.
  const sent = await person.send(realm, agentKarta, seatAddress(b, seatName), `${MARK}: сколько будет 2+2?`);
  check(!sent.error, "person's word accepted by the api", sent.text.slice(0, 300));
  if (sent.error && /human_seat_needs_front/.test(sent.text)) {
    report.push(`INFO human_seat_needs_front — ограничение носителя (#7561), ответ подстановкой чужого фронта не ищется: ${sent.text.slice(0, 200)}`);
  }

  // The frame as the session sees it: provenance verbatim.
  let frame = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 60_000 && !frame) {
    for (const n of A.notes.slice().reverse()) {
      const d = n.params ?? {};
      const f = d?.data?.frame ?? null;
      if (d?.data?.kind === "frame" && f && JSON.stringify(f).includes(MARK)) frame = f;
    }
    if (!frame) await sleep(500);
  }
  if (frame) {
    const st1 = await api("GET", "/me/standings");
    report.push(`INFO GET /me/standings после слова человека → ${st1.status} ${JSON.stringify(st1.body).slice(0, 700)}`);
  }
  check(!!frame, "the word reached the agent's session as a frame", `${A.notes.length} notifications seen`);
  if (frame) {
    report.push(`INFO provenance кадра дословно: ${JSON.stringify(frame.provenance ?? {})}`);
    report.push(`INFO кадр целиком: ${JSON.stringify(frame).slice(0, 1200)}`);
    const p = frame.provenance ?? {};
    check("from_standing_id" in p || "from_standing_id" in frame, "provenance carries from_standing_id (#9128 form)", `keys: ${Object.keys(p).join(",")}`);
    // #9171: the unnamed seat's from_standing as it is, an empty string included — its own line.
    check(
      p.from_standing !== "" && p.from_standing != null,
      "#9171: from_standing непуст (пустая строка безымянного места — риск #9171)",
      `from_standing=${JSON.stringify(p.from_standing)}`,
    );
  }

  // The frame's text as the bridge prints it: the watchdog's own rendering (frameToText).
  let seg = "";
  const t2 = Date.now();
  while (Date.now() - t2 < 30_000 && !(wd && wd.out().includes(MARK))) await sleep(500);
  if (wd) {
    const lines = wd.out().split("\n");
    const at = lines.findIndex((l) => l.includes(MARK));
    if (at !== -1) seg = lines.slice(Math.max(0, at - 1), at + 3).join("\n");
    report.push(`INFO watchdog печатает кадр:\n${seg.trim()}`);
  }
  check(!!wd && wd.out().includes(MARK), "watchdog shows the word's text", seg.trim().slice(0, 300));

  // The reply line under the word: present and whole.
  const line = (wd ? wd.out().split("\n").find((l) => /^(ответ|reply): iskron_channel\(action="send"/.test(l.trim())) : null) ?? null;
  const noAddress = (wd ? wd.out().split("\n").find((l) => /адреса для ответа нет|no address to reply/.test(l)) : null) ?? null;
  if (noAddress) report.push(`INFO мост сказал явно: ${noAddress.trim()}`);
  const val = (k) => (line ? ((line.match(new RegExp(` ${k}=([^,]*)`)) || [])[1] ?? "") : "");
  const parts = line ? { realm: val("realm"), karta: val("karta"), standing: val("standing"), in_reply_to: val("in_reply_to") } : {};
  check(!!line, "the reply line is printed under the word", line?.trim() ?? noAddress?.trim() ?? "no line");
  if (line)
    check(
      Object.values(parts).every((v) => v !== ""),
      "the reply line is whole: realm, karta, standing, in_reply_to",
      JSON.stringify(parts),
    );

  // Execute the line as it stands, from the agent's seat.
  let replyAnswer = null;
  if (line && Object.values(parts).every((v) => v !== "")) {
    const r = await A.call("iskron_channel", {
      realm: parts.realm,
      action: "send",
      karta: parts.karta,
      standing: parts.standing,
      in_reply_to: parts.in_reply_to,
      text: ANSWER,
    });
    replyAnswer = r;
    check(!r.error, "the executed line answered", r.text.split("\n")[0].slice(0, 250));
  } else report.push("SKIP the line was not executed — it was not printed whole");

  // Through the api: the answer lies under the person's word, addressed to their seat.
  if (replyAnswer && !replyAnswer.error) {
    report.push(`INFO ответ send (мост): ${replyAnswer.text.split("\n").slice(0, 3).join(" | ").slice(0, 400)}`);
    // The person's seat log (nks-api): what came in to that seat, with in_reply_to per row.
    const q = `realm=${encodeURIComponent(realm)}&standing=${humanSeatId}&kinds=message_in`;
    const log = await api("GET", `/me/channel-log?${q}`);
    const rows = Array.isArray(log.body?.items) ? log.body.items : Array.isArray(log.body) ? log.body : [];
    const row = rows.find((x) => x?.in_reply_to === parts.in_reply_to);
    report.push(`INFO GET /me/channel-log (место человека) → ${log.status}, строк ${rows.length}`);
    check(!!row, "api: the answer carries in_reply_to of the person's word", row ? `${row.id} in_reply_to ${row.in_reply_to}` : `${log.status} ${parts.in_reply_to}`);
    check(row?.standing_id === humanSeatId, "api: the answer is addressed to the person's seat", row ? `${row.standing_id} ← ${row.peer_standing}` : "no row");
  }
} catch (e) {
  report.push(`ERROR ${e.message}`);
  failed++;
} finally {
  await cleanup();
  if (wd && wd.child.exitCode === null) wd.child.kill("SIGKILL");
  await Promise.all([A.close(), P.close()]);
}

// The report never carries the credential, whatever a tool echoed.
process.stdout.write(report.join("\n").split(token).join("<token>") + "\n");
process.stdout.write(`\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
// The machine daemon of this run's auth dir outlives its sessions by an idle window and
// would write into the run dir after its removal: put it down first.
spawnSync("pkill", ["-f", `daemon --auth-dir ${authDir}( |$)`]);
await new Promise((r) => setTimeout(r, 1500));
if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(setup || (failed ? 1 : 0));
