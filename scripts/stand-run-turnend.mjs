// A live run of the turn's end on a watch in OpenCode (graph @nks/nks-dev, kriya #9345, question
// #9342) against a PAT carrier. Real `opencode serve` in an isolated HOME/XDG, plugin and bridge
// of the branch (dist/dev) or of a release candidate, a scripted loopback provider instead of a
// model: a prompt naming a step with calls gets them one by one, then text; anything else — text.
//
//   node scripts/stand-run-turnend.mjs --token-file F --url U --api A --realm @owner/slug
//     [--ledger-log F] [--bridge B] [--plugin P] [--report F]
//
// Scene: the agent role and the asked role, a holon with a case on it (the scene bridge stands
// as the asked role and opens it); taken off at the end. Session A (a cover with no rituals
// field) stands as the agent role by an explicit iskron_stand and joins the case in a human
// turn; the person's word to its seat (api, scripts/stand-person.mjs) is a frame the provider
// answers with text only — exactly one wake word «no human at the console…» follows; the turn
// that word starts ends with text again — no second word (no loop); a frame whose turn puts an
// ask card in the case — no word. Session B (a cover with `rituals: start push`) — a frame
// answered with text gets no word. --ledger-log (the stand-mcp-ledger.mjs journal behind --url):
// every initialize 200 of the run is closed by a DELETE 200. Exit 0 — passed, 1 — failed,
// 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { TURN } from "../js/delivery/index.ts";
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
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-turnend-${stamp}.txt`));
const token = readFileSync(tokenFile, "utf8").trim();
const { secrets, scrub } = secretScrubber(token);
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const startedAt = new Date().toISOString();

const run = mkdtempSync(join(tmpdir(), "stand-turnend-"));
const home = join(run, "home");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
const proj = { A: join(run, "turn-a"), B: join(run, "turn-b") };
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
  ISKRON_ROOT_SEAT: "0", // the seat is an explicit stand: the run judges the turn's end, not auto-seating
};
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.slice(0, 300)}`);
};
const cover = (graph, holon, role, rites) =>
  `---\niskron:\n  graph: ${graph}\n  holon: ${holon}\n  agent_role: ${role}\n  contract: 38\n  stamp: 2026-11-03\n${rites ? `  rituals: ${rites}\n` : ""}---\n# Пробный проект конца хода\n`;
function project(dir, text) {
  git(run, "init", "-q", "-b", "main", dir);
  writeFileSync(join(dir, "AGENTS.md"), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
}

// ── The scripted provider: a step's calls one per request, then text; no step — text ───────
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
  if (!body.tools?.length || !s?.calls || done >= s.calls.length) return null;
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
    const parts = call
      ? [chunk({ role: "assistant", tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }), chunk({}, "tool_calls")]
      : [chunk({ role: "assistant", content: "OK — answered in the console only" }), chunk({}, "stop")];
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
  let seen = wire.length;
  let since = Date.now();
  for (const until = Date.now() + 240_000; Date.now() < until; await sleep(1000)) {
    if (wire.length !== seen || active().includes(id)) { seen = wire.length; since = Date.now(); continue; }
    if (Date.now() - since >= quiet) return;
  }
  throw new Error(`${marker}: the session did not go quiet in 4 min`);
}
async function humanTurn(id, text) {
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

const { verdicts, report, problem, verdict, error: errorVerdict, count: failures } = makeReporters();
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
  const role = (await add("iskron_add_karta", { name: "🧪 Агент пробы конца хода", motivation: "Стоит на вахте в пробной сессии OpenCode: отвечает на кадры.", manifested_as: "adhikarin", ...M })).id;
  const asked = (await add("iskron_add_karta", { name: "🧪 Спрашиваемый пробы конца хода", motivation: "Получает вопрос карточкой ask от агента пробы.", manifested_as: "adhikarin", ...M })).id;
  const ownerSeat = `turnend-asked-${stamp}`;
  const st = await P.call("iskron_stand", { realm, karta: `#${asked}`, name: ownerSeat, model: "stand-run" });
  if (st.error) throw new Error(`scene stand: ${st.text.slice(0, 300)}`);
  const h = await add("iskron_add_holon", { name: "🧪 Пробный проект конца хода", description: "Что внутри: пробный проект прогона знака конца хода на вахте.", ...M, open_room: "проба конца хода: вопрос карточкой", arrows: [{ arrow_type: "steward", target: `#${role}`, direction: "from", volitive_mode: "upeksha", sense: "кто держит границу" }] });
  const holon = h.id;
  const room = h.text.match(/№\s*(\d+)/)?.[1];
  if (!room) throw new Error(`no case opened on #${holon}: ${h.text.slice(0, 300)}`);
  report.push(`graph ${realm} = ${graph} · scene: role #${role}, asked role #${asked} (seat ${ownerSeat}), holon #${holon}, case №${room}`);
  project(proj.A, cover(graph, holon, role, null));
  project(proj.B, cover(graph, holon, role, "start push"));
  const seatA = `turnend-a-${stamp}`;
  const seatB = `turnend-b-${stamp}`;
  Object.assign(steps, {
    a_seat: { calls: [["iskron_stand", { realm, karta: `#${role}`, name: seatA, model: "stand-run" }], ["iskron_case", { realm, action: "join", room }]] },
    a_text: {},
    a_ask: { calls: [["iskron_case", { realm, action: "ask", room, key: "проба конца хода", karta: `#${asked}`, text: "Проба конца хода: вопрос карточкой, отвечать не нужно.", payload: { form: "free" } }]] },
    b_seat: { calls: [["iskron_stand", { realm, karta: `#${role}`, name: seatB, model: "stand-run" }]] },
    b_text: {},
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
  const frame = async (seat, step, text) => {
    const r = await person.send(realm, role, seatAddress(await board(), seat), `TURN_STEP=${step}: ${text}`);
    if (r.error) throw new Error(`the person's word ${step}: ${r.text.split("\n")[0]}`);
  };
  const A = session(proj.A, "turnend A");
  await humanTurn(A, "TURN_STEP=a_seat: stand and join the case.");
  const [standA, joinA] = resultsOf("a_seat");
  const tools0 = of("a_seat")[0]?.tools ?? [];
  const exec = tools0.find((t) => (t.function?.name ?? t.name) === "execute");
  report.push(`--- A tools: ${tools0.map((t) => t.function?.name ?? t.name).join(", ")} ---\n${exec ? `execute: ${String((exec.function ?? exec).description).slice(0, 3000)}\n` : ""}--- A seat (via ${steps.a_seat.via}) ---\n[stand] ${standA}\n[join] ${joinA}`);
  if (!(await board()).includes(`:${seatA}`)) throw new Error(`A: seat ${seatA} not on the board — ${String(standA).slice(0, 200)}`);
  verdict(of("a_seat").every((b) => wakes(users(b).join("\n")) === 0), "(0) a human turn (stand, join) — no wake word");

  let at = primaries().length;
  await frame(seatA, "a_text", "a frame to the seat; the probe answers in the console only.");
  await settle(A, "TURN_STEP=a_text");
  const afterText = of("a_seat", at);
  const woken = afterText.filter((b) => wakes(lastUser(b)) === 1);
  const first = afterText.findIndex((b) => lastUser(b).includes("TURN_STEP=a_text"));
  const next = afterText.slice(first + 1).find((b) => !lastUser(b).includes("TURN_STEP=a_text"));
  verdict(first >= 0 && next && wakes(lastUser(next)) === 1 && wakes(users(next).join("\n")) === 1,
    "(1) a frame's turn ended with text: exactly one wake word in the next request", `requests after the frame ${afterText.length - first - 1} · wake words in the next ${next ? wakes(users(next).join("\n")) : "—"}`);
  const lastText = afterText.at(-1);
  verdict(woken.length === 1 && lastText && wakes(users(lastText).join("\n")) === 1,
    "(2) the turn the wake word started ended with text — no second word (no loop)", `requests whose last user word is the wake word ${woken.length} · wake words in the session's last request ${lastText ? wakes(users(lastText).join("\n")) : "—"}`);
  report.push(`--- A after the text frame: last user words ---\n${afterText.map((b) => lastUser(b).slice(0, 160)).join("\n")}`);

  at = primaries().length;
  await frame(seatA, "a_ask", "a frame to the seat; the probe puts an ask card in the case.");
  await settle(A, "TURN_STEP=a_ask");
  const [askA] = resultsOf("a_ask");
  const afterAsk = of("a_seat", at);
  report.push(`--- A ask ---\n${askA}\n--- A after the ask frame: last user words ---\n${afterAsk.map((b) => lastUser(b).slice(0, 160)).join("\n")}`);
  verdict(askA !== null && afterAsk.every((b) => wakes(lastUser(b)) === 0) && wakes(users(afterAsk.at(-1)).join("\n")) === 1,
    "(3) a frame's turn that put an ask in the case — no wake word", `ask answered ${askA === null ? "—" : JSON.stringify(askA.slice(0, 120))} · wake words since the frame ${afterAsk.filter((b) => wakes(lastUser(b))).length}`);

  const B = session(proj.B, "turnend B");
  await humanTurn(B, "TURN_STEP=b_seat: stand.");
  const [standB] = resultsOf("b_seat");
  if (!(await board()).includes(`:${seatB}`)) throw new Error(`B: seat ${seatB} not on the board — ${String(standB).slice(0, 200)}`);
  at = primaries().length;
  await frame(seatB, "b_text", "a frame to the seat; the probe answers in the console only.");
  await settle(B, "TURN_STEP=b_text");
  const afterB = of("b_seat", at);
  report.push(`--- B after the text frame: last user words ---\n${afterB.map((b) => lastUser(b).slice(0, 160)).join("\n")}`);
  verdict(afterB.some((b) => lastUser(b).includes("TURN_STEP=b_text")) && afterB.every((b) => wakes(users(b).join("\n")) === 0),
    "(4) a cover with `rituals: start push` — a frame's turn ended with text gets no wake word", `requests ${afterB.length} · wake words ${afterB.reduce((n, b) => n + wakes(users(b).join("\n")), 0)}`);
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
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\n`);
process.exit(setup ? 2 : failures() ? 1 : 0);
