// A live run of the turn's end on a watch in OpenCode (graph @nks/nks-dev, kriya #9345, question
// #9342) against a PAT carrier. Real `opencode serve` in an isolated HOME/XDG, plugin and bridge
// of the branch (dist/dev) or of a release candidate, a scripted loopback provider instead of a
// model: a prompt naming a step with calls gets them one by one, then the step's text (a long
// report with no question by default).
//
//   node scripts/stand-run-turnend.mjs --token-file F --url U --api A --realm @owner/slug
//     [--ledger-log F] [--bridge B] [--plugin P] [--report F]
//     [--wire-report F] [--matrix]
//
// Scene: the agent role and the asked role, a holon with a case on it (the scene bridge stands
// as the asked role and opens it); taken off at the end. Every session is a root seated on the
// agent role by automatic seating (the cover names it), each by its first prompt — the seat is
// read off the board. Case by case of #9345:
// R — no human ever writes: its first prompt carries the delivery's mark (a turn no human word
//   started, as a frame's) and joins the case. (0) that turn, no frame in it, ends with a report —
//   no word; (q) a case record addressed to nobody (the scene seat's say without `to`) — no turn,
//   no word; (r) a frame answered with a line under 280 signs without «?» — no word; (1) a frame
//   answered with a report — exactly one wake word, and the turn it starts ends with a report
//   again — no second word (the word's own turn); (?) a frame answered with a short line with «?»
//   — exactly one word; (a) a frame whose turn puts an ask card in the case — no word.
// A — a human writes its first prompt: (w) a frame answered with a report within 30 minutes of
//   that — no word (the console is watched).
// B — no human, a cover with `rituals: start push` (no turn): (o) a frame answered with a
//   report — no word.
// --ledger-log (the stand-mcp-ledger.mjs journal behind --url): every initialize 200 of the run is
// closed by a DELETE 200. Exit 0 — passed, 1 — failed, 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { FRAME_MARK, TURN } from "../js/delivery/index.ts";
import { quiet } from "../js/shared/quietframe.ts";
import { BUILT_BRIDGE, BUILT_PLUGIN } from "../js/tests/built.mjs";
import { runCleanup } from "./stand-recall-cleanup.mjs";
import { secretScrubber } from "./stand-recall-evidence.mjs";
import { idOf, makeReporters, sceneTaker, stdioBridge } from "./stand-recall-scene.mjs";
import { personApi, seatAddress } from "./stand-person.mjs";

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const fail = (code, t) => (process.stderr.write(`stand-run-turnend: ${t}\n`), process.exit(code));
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const apiArg = arg("--api");
const realm = arg("--realm");
const ledgerLog = arg("--ledger-log");
if (!tokenFile || !URL_ || !apiArg || !realm) fail(2, "--token-file, --url, --api and --realm are required");
const bridge = resolve(arg("--bridge", BUILT_BRIDGE));
const plugin = resolve(arg("--plugin", BUILT_PLUGIN));
for (const p of [bridge, plugin, tokenFile]) if (!existsSync(p)) fail(2, `${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others`);
const stamp = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}-${randomUUID().slice(0, 8)}`;
const reportFile = resolve(arg("--report", `stand-run-turnend-${stamp}.txt`));
const wireFile = arg("--wire-report");
const token = readFileSync(tokenFile, "utf8").trim();
const { secrets, scrub } = secretScrubber(token);
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const startedAt = new Date().toISOString();

const run = mkdtempSync(join(tmpdir(), "stand-turnend-"));
const home = join(run, "home");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
const proj = { R: join(run, "turn-r"), A: join(run, "turn-a"), B: join(run, "turn-b") };
process.on("exit", () => rmSync(run, { recursive: true, force: true }));
for (const d of [join(oc, "plugins"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), join(home, "tmp"), ...Object.values(proj)])
  mkdirSync(d, { recursive: true });
mkdirSync(auth, { recursive: true, mode: 0o700 });
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });
cpSync(plugin, join(oc, "plugins/iskron.js"));

const env = {
  PATH: `${dirname(opencode)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: home,
  TMPDIR: join(home, "tmp"),
  LANG: "en_US.UTF-8",
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
  XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_CONFIG_DIR: oc,
  SCRIPTED_API_KEY: "probe-not-a-key",
  GIT_AUTHOR_NAME: "probe", GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "probe", GIT_COMMITTER_EMAIL: "probe@example.invalid",
  ISKRON_BRIDGE_PATH: bridge,
  ISKRON_BRIDGE_AUTH_DIR: auth,
  ISKRON_BRIDGE_URL: URL_,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_NO_BROWSER: "1",
  // Automatic seating stays on: the sessions with no human word get their seat from it.
};
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.slice(0, 300)}`);
};
const cover = (graph, holon, role, rites) =>
  `---\niskron:\n  graph: ${graph}\n  holon: ${holon}\n  agent_role: ${role}\n  contract: 39\n  stamp: 2026-11-03\n${rites ? `  rituals: ${rites}\n` : ""}---\n# Пробный проект конца хода\n`;
function project(dir, text) {
  git(run, "init", "-q", "-b", "main", dir);
  writeFileSync(join(dir, "AGENTS.md"), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
}

// ── The scripted provider: a step's calls one per request, then its text ──────────────────
const REPORT = `Отчёт пробы конца хода: шаг пройден, изменений нет, всё на месте. ${"Строка отчёта тянется дальше квитанции, чтобы правило коротких строк её не взяло. ".repeat(4)}Конец отчёта.`;
const RECEIPT = "Принято.";
const QUESTION = "Повторить шаг?";
const wire = [];
const steps = {};
let callN = 0;
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join("\n"));
function reply(body) {
  const msgs = body.messages ?? [];
  const u = msgs.map((m) => m.role).lastIndexOf("user");
  const step = textOf(msgs[u]).match(/TURN_STEP=(\w+)/)?.[1];
  const s = steps[step];
  const done = msgs.slice(u + 1).filter((m) => m.role === "tool").length;
  if (!body.tools?.length || !s?.calls || done >= s.calls.length) return { text: s?.text ?? REPORT };
  const [want, args] = s.calls[done];
  const names = body.tools.map((t) => t.function?.name ?? t.name);
  const direct = names.find((n) => n === want || n.endsWith(`_${want}`));
  // OpenCode's Code Mode keeps the plugin's tools behind one `execute` tool.
  if (!direct && !names.includes("execute")) throw new Error(`no ${want} tool among ${names.join(", ")}`);
  const id = `call_turn_${step}_${++callN}`;
  (s.ids ??= []).push(id);
  s.via = direct ?? "execute";
  return direct ? { id, name: direct, args } : { id, name: "execute", args: { code: `return await tools.${want}(${JSON.stringify(args)});` } };
}
const llm = createServer(async (req, res) => {
  try {
    let data = "";
    for await (const c of req) data += c;
    const body = JSON.parse(data);
    wire.push(body);
    const call = reply(body);
    const chunk = (delta, finish_reason = null) => ({ id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason }] });
    const parts = call.id
      ? [chunk({ role: "assistant", tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }), chunk({}, "tool_calls")]
      : [chunk({ role: "assistant", content: call.text }), chunk({}, "stop")];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n");
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => llm.listen(0, "127.0.0.1", r));
writeFileSync(join(oc, "opencode.json"), JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  model: "scripted/probe", snapshots: false, update: "disable",
  permissions: [{ action: "*", resource: "*", effect: "allow" }],
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "scripted", effect: "allow" },
  ],
  providers: { scripted: {
    name: "Loopback script (no model)", env: ["SCRIPTED_API_KEY"],
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: `http://127.0.0.1:${llm.address().port}/v1` },
    models: { probe: { name: "Probe", limit: { context: 200000, output: 4096 }, capabilities: { tools: true } } },
  } },
}));

// ── opencode serve and its API ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${port}`;
let serve = null;
function api(method, path, body) {
  const a = ["api", "--server", server, method, path];
  if (body) a.push("-d", JSON.stringify(body));
  const r = spawnSync(opencode, a, { env, cwd: run, encoding: "utf8", timeout: 30_000 });
  let data = null;
  try { data = JSON.parse(r.stdout); } catch {}
  return { ok: r.status === 0 && data !== null && !data?._tag, data: data?.data ?? data, raw: (r.stdout ?? "") + (r.stderr ?? "") };
}
const active = () => Object.keys(api("GET", "/api/session/active").data ?? {});
function session(dir, title) {
  const r = api("POST", "/api/session", { title, location: { directory: dir }, model: { providerID: "scripted", id: "probe" } });
  if (!r.data?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
  return r.data.id;
}
const primaries = () => wire.filter((b) => b.tools?.length);
const users = (b) => (b.messages ?? []).filter((m) => m.role === "user").map(textOf);
const lastUser = (b) => users(b).at(-1) ?? "";
const count = (text, word) => (text ?? "").split(word).length - 1;
const wakes = (text) => count(text, TURN.ru.wake()) + count(text, TURN.en.wake());
/** The session's requests: its history carries its own first step's marker. */
const of = (first, from = 0) => primaries().slice(from).filter((b) => users(b).some((t) => t.includes(`TURN_STEP=${first}`)));
/** Waits until the provider saw `marker` (5 min), then until the session is idle and the wire quiet for `quiet` ms. */
async function settle(id, marker, quiet = 20_000) {
  for (let t = 0; !primaries().some((b) => users(b).some((x) => x.includes(marker))); t++) {
    if (t > 600) throw new Error(`${marker}: no request carried it in 5 min`);
    await sleep(500);
  }
  await hush(id, quiet);
}
/** Waits until the session is idle and the wire quiet for `quiet` ms (4 min). */
async function hush(id, quiet) {
  let seen = wire.length;
  let since = Date.now();
  for (const until = Date.now() + 240_000; Date.now() < until; await sleep(1000)) {
    if (wire.length !== seen || active().includes(id)) { seen = wire.length; since = Date.now(); continue; }
    if (Date.now() - since >= quiet) return;
  }
  throw new Error(`session ${id} did not go quiet in 4 min`);
}
async function prompt(id, text) {
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  await settle(id, text.match(/TURN_STEP=\w+/)[0], 15_000);
}
/** What the model saw of a step's calls: the tool messages in later requests. */
const resultsOf = (step) => (steps[step]?.ids ?? []).map((id) => {
  for (const b of primaries()) {
    const m = (b.messages ?? []).find((x) => x.role === "tool" && x.tool_call_id === id);
    if (m) return textOf(m);
  }
  return null;
});
const seatsIn = (board) => new Set([...board.matchAll(/@[^\s:]+:(\S+) —/g)].map((m) => m[1]));

const { verdicts, report, problem, verdict, error: errorVerdict, count: failures } = makeReporters();
for (const [label, file] of [["bridge", bridge], ["plugin", plugin]])
  report.push(`${label}: ${file} · sha256 ${createHash("sha256").update(readFileSync(file)).digest("hex")}`);
const P = stdioBridge({ run, bridge, env, token, name: "stand-run-turnend", problem });
const cleanup = runCleanup({ run, auth, bridge, env, cwd: run, report, scrub, problem });
const person = personApi({ api: apiArg, token });
const laid = [];
const take = sceneTaker(P, { realm, problem, laid });
let setup = true;
try {
  await P.init();
  const realms = (await P.call("iskron_realm", { action: "list" })).text;
  const slug = realm.replace(/^@/, "");
  const graph = (realms.split("\n").find((l) => l.includes(slug)) ?? "").match(/\br(\d+)\b/)?.[0];
  if (!graph) throw new Error(`no rN of ${realm} in the realm list: ${realms.slice(0, 300)}`);
  const M = { epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" };
  const add = async (tool, args) => {
    const r = await P.call(tool, { realm, ...args });
    const id = idOf(r.text);
    if (r.error || !id) throw new Error(`${tool} ${args.name}: ${r.text.slice(0, 300)}`);
    laid.push(id);
    return { id, text: r.text };
  };
  const role = (await add("iskron_add_karta", { name: `🧪 Агент пробы конца хода ${stamp}`, motivation: "Стоит на вахте в пробной сессии OpenCode: отвечает на кадры.", manifested_as: "adhikarin", ...M })).id;
  const asked = (await add("iskron_add_karta", { name: `🧪 Спрашиваемый пробы конца хода ${stamp}`, motivation: "Получает вопрос карточкой ask от агента пробы.", manifested_as: "adhikarin", ...M })).id;
  const ownerSeat = `turnend-asked-${stamp}`;
  const st = await P.call("iskron_stand", { realm, karta: `#${asked}`, name: ownerSeat, model: "stand-run" });
  if (st.error) throw new Error(`scene stand: ${st.text.slice(0, 300)}`);
  const h = await add("iskron_add_holon", { name: `🧪 Пробный проект конца хода ${stamp}`, description: "Что внутри: пробный проект прогона знака конца хода на вахте.", ...M, open_room: "проба конца хода: вопрос карточкой", arrows: [{ arrow_type: "steward", target: `#${role}`, direction: "from", volitive_mode: "upeksha", sense: "кто держит границу" }] });
  const holon = h.id;
  const room = h.text.match(/№\s*(\d+)/)?.[1];
  if (!room) throw new Error(`no case opened on #${holon}: ${h.text.slice(0, 300)}`);
  report.push(`graph ${realm} = ${graph} · scene: role #${role}, asked role #${asked} (seat ${ownerSeat}), holon #${holon}, case №${room}`);
  project(proj.R, cover(graph, holon, role, null));
  project(proj.A, cover(graph, holon, role, null));
  project(proj.B, cover(graph, holon, role, "start push"));
  Object.assign(steps, {
    r_kick: { calls: [["iskron_case", { realm, action: "join", room }]] },
    r_receipt: { text: RECEIPT },
    r_report: {},
    r_question: { text: QUESTION },
    r_ask: { calls: [["iskron_case", { realm, action: "ask", room, key: "проба конца хода", karta: `#${asked}`, text: "Проба конца хода: вопрос карточкой, отвечать не нужно.", payload: { form: "free" } }]] },
    a_human: { text: RECEIPT },
    a_report: {},
    b_kick: { text: RECEIPT },
    b_report: {},
  });

  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { env, cwd: run, stdio: ["ignore", "pipe", "pipe"] });
  let so = "";
  serve.stdout.on("data", (d) => {
    so += d;
    const pw = so.match(/server password (\S+)/);
    if (pw) { env.OPENCODE_PASSWORD = pw[1]; secrets.add(pw[1]); }
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120 && !api("GET", "/api/session/active").ok; i++) await sleep(500);
  // OpenCode loads the plugin with the first prompt, its bridge lists the graph tools a moment
  // later: a session prompted before that gets no iskron tools (stand-run-opencode.mjs, case №1622).
  const listed = () => existsSync(join(run, "serve.log")) && /тулов в сессии: \d+|tools in the session: \d+/.test(readFileSync(join(run, "serve.log"), "utf8"));
  api("POST", `/api/session/${session(run, "warm-up")}/prompt`, { text: "warm-up: reply OK.", resume: true });
  for (let t = 0; t < 240 && !listed(); t++) await sleep(500);
  if (!listed()) throw new Error("the plugin's bridge listed no graph tools in 120 s");
  await sleep(10_000);
  setup = false;

  const board = async () => (await P.call("iskron_channel", { realm, action: "list", karta: `#${role}` })).text;
  /** The session's first prompt seats it automatically: its seat is the one new on the role's board. */
  async function seated(id, text, label) {
    const before = seatsIn(await board());
    await prompt(id, text);
    let fresh = [];
    for (let t = 0; t < 12 && fresh.length !== 1; t++) {
      fresh = [...seatsIn(await board())].filter((n) => !before.has(n));
      if (fresh.length !== 1) await sleep(5_000);
    }
    if (fresh.length !== 1) throw new Error(`${label}: ${fresh.length} new seats on the role's board after the first prompt (${fresh.join(", ")})`);
    report.push(`${label}: seated automatically as ${fresh[0]}`);
    return fresh[0];
  }
  const frame = async (seat, step, text) => {
    const r = await person.send(realm, role, seatAddress(await board(), seat), `TURN_STEP=${step}: ${text}`);
    if (r.error) throw new Error(`the person's word ${step}: ${r.text.split("\n")[0]}`);
  };
  /** The session's last request's wake words: the history counts every word ever laid. */
  const total = (first) => wakes(users(of(first).at(-1) ?? { messages: [] }).join("\n"));
  /** A frame to the seat, the session settled: the wake words it added and the requests the word started. */
  async function framed(id, first, seat, step, text) {
    const w0 = total(first);
    const at = primaries().length;
    await frame(seat, step, text);
    await settle(id, `TURN_STEP=${step}`);
    const after = of(first, at);
    report.push(`--- ${step}: last user words ---\n${after.map((b) => lastUser(b).slice(0, 160)).join("\n")}`);
    return { added: total(first) - w0, started: after.filter((b) => wakes(lastUser(b)) === 1).length, requests: after.length };
  }
  const seen = (x) => `wake words added ${x.added} · requests the word started ${x.started} · requests ${x.requests}`;

  // ── R: no human ever writes ───────────────────────────────────────────────────────────────
  const R = session(proj.R, "turnend R");
  const seatR = await seated(R, `${FRAME_MARK} TURN_STEP=r_kick: a turn the delivery's mark starts; join the case.`, "R");
  const [joinR] = resultsOf("r_kick");
  report.push(`--- R join (via ${steps.r_kick.via}) ---\n${joinR}`);
  verdict(of("r_kick").length > 0 && total("r_kick") === 0, "(0) R: a turn the delivery's mark started, no frame in it, ended with a report — no wake word", `requests ${of("r_kick").length} · wake words ${total("r_kick")}`);

  let at = primaries().length;
  const said = await P.call("iskron_case", { realm, action: "say", room, text: "Проба конца хода: служебная запись в деле, никому не адресована." });
  if (said.error) throw new Error(`the scene's say: ${said.text.slice(0, 300)}`);
  await sleep(45_000);
  await hush(R, 10_000);
  const quietRequests = of("r_kick", at);
  verdict(quietRequests.length === 0 && !active().includes(R), "(q) R: a case record addressed to nobody — no turn, no wake word", `requests since the record ${quietRequests.length} · wake words ${quietRequests.reduce((n, b) => n + wakes(lastUser(b)), 0)}`);

  const rec = await framed(R, "r_kick", seatR, "r_receipt", "a frame; the probe answers with a short line without a question.");
  verdict(rec.added === 0, `(r) R: a frame answered «${RECEIPT}» (under 280 signs, no «?») — no wake word`, seen(rec));
  const rode = of("r_kick").find((b) => lastUser(b).includes("TURN_STEP=r_receipt"));
  verdict(!!rode && lastUser(rode).split("\n").some((l) => l.trim() && quiet(l)), "(q) the record's quiet count rode the next prompt");

  const rep = await framed(R, "r_kick", seatR, "r_report", "a frame; the probe answers with a report in the console.");
  verdict(rep.added === 1, "(1) R: a frame's turn ended with a report — exactly one wake word", seen(rep));
  verdict(rep.started === 1, "(1) R: the turn the wake word started ended with a report — no second word (its own turn)", seen(rep));

  const q = await framed(R, "r_kick", seatR, "r_question", "a frame; the probe answers with a short question.");
  verdict(q.added === 1 && q.started === 1, `(?) R: a frame answered «${QUESTION}» (short, with «?») — exactly one wake word`, seen(q));

  const ask = await framed(R, "r_kick", seatR, "r_ask", "a frame; the probe puts an ask card in the case.");
  const [askR] = resultsOf("r_ask");
  report.push(`--- R ask ---\n${askR}`);
  verdict(askR !== null && ask.added === 0, "(a) R: a frame's turn that put an ask card in the case, then a report — no wake word", `ask ${askR === null ? "—" : JSON.stringify(askR.slice(0, 120))} · ${seen(ask)}`);

  if (process.argv.includes("--matrix")) {
    const address = seatAddress(await board(), seatR);
    const matrixBody = (step, marker) => `TURN_STEP=${step}: ${marker}\nПервая строка тела пробы; пробелы и переносы должны сохраниться по смыслу.\n${"Средняя строка продолжается за короткую подпись кадра. ".repeat(3)}\nBODY-END-${step}`;
    const entry = (r) => {
      const n = r.text.match(/\[(\d+)\]/)?.[1];
      if (r.error || !n) throw new Error(`matrix call refused: ${r.text.slice(0, 300)}`);
      return n;
    };
    async function delivered(step, marker, send) {
      steps[step] = { text: RECEIPT };
      const before = primaries().length;
      await send();
      await settle(R, marker);
      const requests = of("r_kick", before).filter((b) => lastUser(b).includes(marker));
      const flat = (text) => text.replace(/\s+/g, " ").trim();
      verdict(requests.length > 0 && requests.every((b) => count(lastUser(b), marker) === 1 && flat(lastUser(b)).includes(flat(matrixBody(step, marker)))), `matrix ${step}: full multiline body, marker exactly once in each delivered prompt`, `requests ${requests.length}`);
      report.push(`--- matrix ${step}: delivered text ---\n${requests.map(lastUser).join("\n---\n")}`);
    }
    await delivered("m_say", "MATRIX-SAY-733", async () => {
      const r = await P.call("iskron_case", { realm, action: "say", room, to: address, text: matrixBody("m_say", "MATRIX-SAY-733") });
      if (r.error) throw new Error(r.text);
    });
    await delivered("m_answer", "MATRIX-ANSWER-733", async () => {
      const answer = entry(await P.call("iskron_case", { realm, action: "answer", room, in_reply_to: askR.match(/\[(\d+)\]/)[1], text: matrixBody("m_answer", "MATRIX-ANSWER-733") }));
      steps.m_answer.calls = [["iskron_case", { realm, action: "ack", room, in_reply_to: answer, text: "Принял ответ пробы." }]];
    });
    await delivered("m_ask", "MATRIX-ASK-733", async () => {
      const askedEntry = entry(await P.call("iskron_case", { realm, action: "ask", room, key: "matrix inbound ask", karta: `#${role}`, standing: address, text: matrixBody("m_ask", "MATRIX-ASK-733"), payload: { form: "free" } }));
      steps.m_ask.calls = [["iskron_case", { realm, action: "answer", room, in_reply_to: askedEntry, text: "Ответ пробы входящего вопроса." }]];
    });
    const [answerResult] = resultsOf("m_ask");
    const answeredEntry = answerResult?.match(/\[(\d+)\]/)?.[1];
    if (!answeredEntry) throw new Error(`matrix answer result: ${answerResult}`);
    await delivered("m_ack", "MATRIX-ACK-733", async () => {
      const r = await P.call("iskron_case", { realm, action: "ack", room, in_reply_to: answeredEntry, text: matrixBody("m_ack", "MATRIX-ACK-733") });
      if (r.error) throw new Error(r.text);
    });
  }

  // ── A: a human wrote within 30 minutes ───────────────────────────────────────────────────
  const A = session(proj.A, "turnend A");
  const seatA = await seated(A, "TURN_STEP=a_human: a human's word; reply.", "A");
  const wA = await framed(A, "a_human", seatA, "a_report", "a frame; the probe answers with a report in the console.");
  verdict(wA.requests > 0 && wA.added === 0, "(w) A: a human wrote in the session minutes ago — a frame's turn ended with a report gets no wake word", seen(wA));

  // ── B: no human, the cover's rituals leave `turn` out ────────────────────────────────────
  const B = session(proj.B, "turnend B");
  const seatB = await seated(B, `${FRAME_MARK} TURN_STEP=b_kick: a turn the delivery's mark starts.`, "B");
  const oB = await framed(B, "b_kick", seatB, "b_report", "a frame; the probe answers with a report in the console.");
  verdict(oB.requests > 0 && oB.added === 0, "(o) B: a cover with `rituals: start push` — a frame's turn ended with a report gets no wake word", seen(oB));
  report.push(`--- wire: ${wire.length} requests, ${primaries().length} primary ---`);
} catch (e) {
  errorVerdict(e.message, setup);
  try { report.push(`--- serve.log tail ---\n${readFileSync(join(run, "serve.log"), "utf8").slice(-6000)}`); } catch {}
} finally {
  let places = [];
  try { places = cleanup.places(); } catch (e) { problem(e.message); }
  delete env.OPENCODE_PASSWORD;
  if (serve && serve.exitCode === null) {
    const done = new Promise((r) => serve.once("exit", r));
    serve.kill("SIGTERM");
    await Promise.race([done, sleep(15_000)]);
    if (serve.exitCode === null && serve.signalCode === null) { serve.kill("SIGKILL"); problem("serve required SIGKILL"); }
  }
  try { places.push(...cleanup.places()); } catch (e) { problem(e.message); }
  if (places.length) report.push(`seats left at the end: ${places.map((p) => p.name).join(", ")}`);
  await cleanup.revoke(places, P, person);
  for (const id of [...laid].reverse()) await take(id).catch((e) => problem(`cleanup #${id}: ${e.message}`));
  await P.close();
  await cleanup.stopDaemons();
  llm.closeAllConnections();
  await new Promise((r) => llm.close(r));
  if (ledgerLog && existsSync(ledgerLog)) {
    await sleep(3000);
    const own = readFileSync(ledgerLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.at >= startedAt);
    const opened = own.filter((e) => e.kind === "initialize");
    const closed = own.filter((e) => e.kind === "delete");
    const open = opened.filter((e) => e.status === 200 && !closed.some((d) => d.session_id === e.session_id && d.status === 200));
    report.push(`--- ledger since ${startedAt} ---\n${own.map((e) => `${e.at} ${e.kind} ${e.status} ${e.session_id}`).join("\n")}`);
    verdict(opened.length > 0 && open.length === 0 && opened.every((e) => e.status === 200), "ledger: every initialize 200 of the run closed by a DELETE 200", `initialize ${opened.length} · delete ${closed.length} · unclosed ${open.map((e) => e.session_id).join(" ") || "none"}`);
  }
}
writeFileSync(reportFile, scrub([...verdicts, ...report].join("\n")) + "\n", { mode: 0o600 });
if (wireFile) writeFileSync(resolve(wireFile), scrub(JSON.stringify(wire, null, 2)) + "\n", { mode: 0o600 });
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\n`);
const exitCode = setup ? 2 : failures() ? 1 : 0;
process.stdout.write(`exit: ${exitCode}\n`);
process.exit(exitCode);
