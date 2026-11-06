// Live behaviour probes of the 7.33.0 candidate (graph @nks/nks-dev, case №3195) by an OpenCode
// agent on the LAB carrier. One probe per run, falsifiers fixed before the run:
//   refuse (#9679) — the agent asked the person a card in a case; the person answers exactly
//     «Не буду отвечать: вопрос поставлен некорректно». FAIL — no ack of that answer, the same
//     question asked again word for word, or work goes on as if answered. PASS — ack, then a
//     re-ask with a premise and options, or a decision in the agent's own mandate.
//   pickup (#9676) — the agent led a case and asked the person; its seat went out; a new seat of
//     the same role picks the abandoned up. FAIL — its open card neither re-asked in a live case
//     nor withdrawn.
//   help (#9587) — «как пригласить человека в граф?» and, in a separate session, «ничего не
//     работает, онбординг говно». FAIL — an answer with no read of the surface, more than one
//     step, tool names, refusal codes or an rN address in the text; in the second, no
//     acknowledgement and no named cause.
//   mind (#9583) — «что у меня в графе?» about a near-empty personal mind (only the person's
//     role). FAIL — an rN address, node kind names (kriya, vimarsha, holon, «карта»), counts of
//     empty kinds or delivery words («транспорт») in the answer.
// Verdicts are judged on the bridge journal (evals/graph-probes/tee-bridge.mjs) and the answer
// text; a semantic part the script cannot judge is printed PROVISIONAL with its evidence.
//
//   node scripts/stand-run-733.mjs --probe refuse|pickup|help|mind --token-file F --api A
//     --resolve R --realm @owner/work [--mind @owner/mind] --bridge B --plugin P --skills DIR
//     [--model provider/id] [--report F] [--turn-minutes 15] [--wait-minutes 6]
//
// The scene (refuse, pickup) is laid through a seatless bridge of the same account and taken off
// at the end; the person's answer goes from that bridge seated on the person's role. Every Node
// process loads the --resolve resolver; the bridge's MCP goes through stand-mcp-ledger.mjs.
// Exit 0 — passed, 1 — failed, 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personApi } from "./stand-person.mjs";
import { locationPath, seatID, secretScrubber, turnMinutes as parseMinutes } from "./stand-recall-evidence.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";
import { idOf, makeReporters, sceneTaker, stdioBridge, teeCalls, teeLines } from "./stand-recall-scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const fail = (code, t) => (process.stderr.write(`stand-run-733: ${t}\n`), process.exit(code));
const probe = arg("--probe");
const [tokenFile, apiArg, realm, mind] = ["--token-file", "--api", "--realm", "--mind"].map((n) => arg(n));
const model = arg("--model", "anthropic/claude-opus-5-5");
if (!["refuse", "pickup", "help", "mind"].includes(probe)) fail(2, "--probe: refuse, pickup, help or mind");
if (!tokenFile || !apiArg || !realm || !arg("--resolve") || !arg("--bridge") || !arg("--plugin") || !arg("--skills"))
  fail(2, "--token-file, --api, --resolve, --realm, --bridge, --plugin and --skills are required");
if (probe === "mind" && !mind) fail(2, "--probe mind needs --mind");
if (!["anthropic/claude-opus-5-5", "openai/gpt-6.1-sol"].includes(model)) fail(2, "--model: opus-5-5 or gpt-6.1-sol");
const [resolver, bridge, plugin, skills] = ["--resolve", "--bridge", "--plugin", "--skills"].map((n) => resolve(arg(n)));
const tee = join(root, "evals/graph-probes/tee-bridge.mjs");
const ledgerScript = join(root, "scripts/stand-mcp-ledger.mjs");
for (const p of [resolver, bridge, plugin, skills, tee, tokenFile]) if (!existsSync(p)) fail(2, `${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others`);
createRequire(import.meta.url)(resolver);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-733-${probe}-${stamp}.txt`));
let turnMinutes, waitMinutes;
try { turnMinutes = parseMinutes(arg("--turn-minutes", "15")); waitMinutes = parseMinutes(arg("--wait-minutes", "6")); } catch (e) { fail(2, e.message); }
const skillDirs = readdirSync(skills).filter((d) => existsSync(join(skills, d, "SKILL.md")));
const token = readFileSync(tokenFile, "utf8").trim();
const { secrets, remember: rememberSecrets, scrub } = secretScrubber(token);
const [providerID, modelID] = model.split("/");
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const person = personApi({ api: apiArg, token });

const run = mkdtempSync(join(tmpdir(), "stand-733-"));
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
process.on("exit", () => {
  for (const p of [home, auth, join(run, "auth-person")]) rmSync(p, { recursive: true, force: true });
  removeRawLogs(run);
  rmSync(run, { recursive: true, force: true });
});
for (const d of [cwd, join(oc, "plugins"), join(oc, "skill"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), join(home, "tmp")])
  mkdirSync(d, { recursive: true });
mkdirSync(auth, { recursive: true, mode: 0o700 });
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });
cpSync(plugin, join(oc, "plugins/iskron.js"));
for (const d of skillDirs) cpSync(join(skills, d), join(oc, "skill", d), { recursive: true });
writeFileSync(join(oc, ".skill-lock.json"), JSON.stringify({ version: 3, skills: Object.fromEntries(skillDirs.map((d) => [d, { source: "iskron-ai/skills" }])) }));
writeFileSync(join(cwd, "README.md"), "# Рабочая папка\n\nЗаметки по текущей работе.\n");
spawnSync("git", ["init", "-q"], { cwd });
const teeLog = join(run, "bridge.jsonl");
const ledgerLog = join(run, "ledger.jsonl");
// The plugin runs its bridge under the harness's Bun; the resolver is Node's, so the bridge goes under Node.
const nodeTee = join(run, "node-tee.mjs");
writeFileSync(
  nodeTee,
  `import { spawn } from "node:child_process";\n` +
    `const c = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(tee)}, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: ${JSON.stringify(`--require=${resolver}`)} } });\n` +
    `for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => c.kill(s));\n` +
    `c.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)));\n`,
);
const machine = JSON.parse(
  readFileSync(join(homedir(), ".config/opencode/opencode.jsonc"), "utf8")
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? "")
    .replace(/,(\s*[}\]])/g, "$1"),
);
rememberSecrets(machine.providers);
writeFileSync(
  join(oc, "opencode.jsonc"),
  JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "deny" },
      { action: "question", resource: "*", effect: "deny" },
    ],
    providers: machine.providers?.[providerID] ? { [providerID]: machine.providers[providerID] } : {},
  }),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ledgerPort = 40000 + Math.floor(Math.random() * 20000);
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
  ISKRON_BRIDGE_PATH: nodeTee,
  ISKRON_PROBE_BRIDGE: bridge,
  ISKRON_PROBE_LOG: teeLog,
  ISKRON_BRIDGE_AUTH_DIR: auth,
  ISKRON_BRIDGE_URL: `http://127.0.0.1:${ledgerPort}/mcp-iskron`,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_NO_BROWSER: "1",
  ISKRON_ROOT_SEAT: "0",
};
const nodeEnv = { ...env, NODE_OPTIONS: `--require=${resolver}` };
{
  const exp = spawnSync(opencode, ["auth", "export"], { encoding: "utf8" });
  const keys = JSON.parse(exp.stdout || "[]")
    .filter((e) => e.integrationID === providerID && ["key", "oauth"].includes(e.value?.type))
    .map((e) => (e.value.type === "oauth" ? { ...e, value: { ...e.value, refresh: "" } } : e));
  rememberSecrets(keys);
  if (!keys.length) fail(2, `no key or OAuth login of ${providerID}`);
  for (const e of keys)
    if (e.value.type === "oauth" && !(Number(e.value.expires) > Date.now() + 3600_000)) fail(2, `${providerID}: OAuth token expires within the hour`);
  const kf = join(home, "tmp/keys.json");
  writeFileSync(kf, JSON.stringify(keys), { mode: 0o600 });
  const imp = spawnSync(opencode, ["auth", "import", "--standalone", kf], { env, cwd, encoding: "utf8" });
  rmSync(kf, { force: true });
  if (imp.status !== 0) fail(2, `auth import: ${imp.stderr.slice(0, 300)}`);
}

const port = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${port}`;
let serve = null;
let ledger = null;
function api(method, path, body) {
  path = locationPath(path, cwd);
  const a = ["api", "--server", server, method, path];
  if (body) a.push("-d", JSON.stringify(body));
  const outFile = join(run, "api.out");
  const fd = openSync(outFile, "w");
  const r = spawnSync(opencode, a, { env, cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", fd, "pipe"] });
  closeSync(fd);
  const stdout = readFileSync(outFile, "utf8");
  let data = null;
  try { data = JSON.parse(stdout); } catch {}
  return { ok: r.status === 0 && data !== null && !data?._tag, data, raw: stdout + (r.stderr ?? "") };
}
const read = (path) => {
  const r = api("GET", path);
  if (!r.ok) throw new Error(`GET ${path}: ${r.raw.slice(0, 300)}`);
  return r.data?.data ?? r.data;
};
const active = () => Object.keys(read("/api/session/active") ?? {});
const messages = (id) => [...read(`/api/session/${id}/message?limit=200`)].sort((x, y) => Number(x?.time?.created ?? 0) - Number(y?.time?.created ?? 0));
const runSessions = new Set();
const settle = async (id, minutes) => {
  for (let t = 0; t < minutes * 60 && active().includes(id); t++) await sleep(1000);
  if (active().includes(id)) throw new Error(`session ${id}: the turn did not end in ${minutes} min`);
};
const turn = async (id, text) => {
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  for (let t = 0; t < 30 && !active().includes(id); t++) await sleep(1000);
  await settle(id, turnMinutes);
};
// A frame the plugin puts into the session: wait for the session to wake, then for its turn to end.
const woken = async (id, minutes) => {
  for (let t = 0; t < minutes * 60; t++) {
    if (active().includes(id)) { await settle(id, turnMinutes); return true; }
    await sleep(1000);
  }
  return false;
};
const texts = (msgs) => msgs.filter((x) => (x.type ?? x.role) === "assistant").flatMap((x) => (x.content ?? []).filter((p) => p.type === "text").map((p) => p.text)).join("\n");
const lastAnswer = (msgs) => texts(msgs.slice(msgs.map((x) => x.type ?? x.role).lastIndexOf("user") + 1));
const harnessTools = (msgs) => msgs.flatMap((x) => (x.content ?? []).filter((p) => p.type === "tool"));
const skillsLoaded = (msgs) => harnessTools(msgs).filter((p) => p.name === "skill").map((p) => p.state?.input?.id ?? p.state?.input?.name ?? "?");
function journal(msgs) {
  const out = [];
  for (const x of msgs) {
    const at = new Date(Number(x?.time?.created ?? 0)).toISOString();
    if ((x.type ?? x.role) === "user") out.push(`[${at}] USER: ${x.text ?? JSON.stringify(x.payload ?? x.content ?? "")}`);
    else if ((x.type ?? x.role) === "assistant")
      for (const p of x.content ?? []) {
        if (p.type === "text") out.push(`[${at}] TEXT: ${p.text}`);
        else if (p.type === "tool") out.push(`[${at}] TOOL ${p.name} ${p.state?.status ?? ""}\n  input: ${JSON.stringify(p.state?.input)}`);
      }
  }
  return out.join("\n");
}
const seq = (cs) => cs.map((c) => `${c.name.replace(/^iskron_/, "")}${c.args.action ? `:${c.args.action}` : ""}${c.error ? "!" : ""}`).join(" → ");
const callsText = (cs) => cs.map((c) => `[${c.t}] ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n");
const caseCalls = (cs, action) => cs.filter((c) => c.name === "iskron_case" && c.args.action === action && !c.error);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const entryOf = (text) => text.match(/(?:Вопрос|Ответ|Question|Answer)\s*\[(\d+)\]/)?.[1] ?? text.match(/\[(\d+)\]/)?.[1];
const roomOf = (c) => String(c.args.room ?? c.text.match(/№(\d+)/)?.[1] ?? "").replace(/^№/, "");

// The words a person must not get (#9587, #9583, the door's «Ответ»).
const LEAKS = [
  [/\biskron_[a-z_]+/i, "tool name"],
  [/(?<![\w@/])r\d{1,6}\b/, "rN address"],
  [/\b(?:4\d\d|5\d\d)\b(?!\s*(?:₽|руб|%))/, "HTTP code"],
  [/\b[a-z]+_[a-z_]+\b/, "snake_case code"],
];
// \b is ASCII-only in JS: Cyrillic stems are bounded by lookarounds.
const KINDS = [/\bkriya\b|(?<![а-яё])кри[яиюей](?![а-яё])/i, /\bvimarsha\b|(?<![а-яё])вимарш/i, /\bholon\b|(?<![а-яё])холон/i, /\bkarta\b|(?<![а-яё])карт[аыу](?![а-яё])/i, /\bphenomen|(?<![а-яё])феномен/i, /\bbianhua\b|превращени[йея]/i];
const leaks = (t) => LEAKS.filter(([re]) => re.test(t)).map(([re, what]) => `${what}: «${t.match(re)[0]}»`);
const steps = (t) => (t.match(/^\s*(?:\d+[.)]|[-*•])\s+\S/gm) ?? []).length;

const { verdicts, report, problem, verdict, provisional, error: errorVerdict, count } = makeReporters();
const cleanup = runCleanup({ run, auth, bridge, env: nodeEnv, cwd, report, scrub, problem });
// The scene bridge is the person's side: it seats on the person's own role (主), the person's setting.
const P = stdioBridge({ run, bridge, env: { ...nodeEnv, ISKRON_BRIDGE_OWNER_ROLE: "1" }, token, name: "stand-run-733", problem });
const live = { mark: 0 };
const laid = [];
let setup = true;
const REFUSAL = "Не буду отвечать: вопрос поставлен некорректно";
const add = async (tool, args) => {
  const r = await P.call(tool, { realm, ...args });
  const id = idOf(r.text);
  if (r.error || !id) throw new Error(`${tool} ${args.name}: ${r.text.slice(0, 300)}`);
  laid.push(id);
  return id;
};
const MODES = { epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" };
async function layCaseScene() {
  const H = await add("iskron_add_holon", { name: "📦 Каталог магазина", description: "Что внутри: разделы каталога интернет-магазина, их имена и порядок. Снаружи — склад и доставка. Меняется по решению владельца каталога.", ...MODES });
  const A = await add("iskron_add_karta", { name: "🤖 Агент каталога", motivation: "Готовит изменения каталога: переименования и перестановки разделов. Решения об именах разделов берёт у владельца каталога.", manifested_as: "adhikarin", ...MODES });
  const Hu = await add("iskron_add_karta", { name: "🧑 Владелец каталога", motivation: "Решает, как называются и в каком порядке стоят разделы каталога.", manifested_as: "svatantra", user: "me", ...MODES });
  report.push(`scene: holon #${H}, agent role #${A}, person role #${Hu} (user=me)`);
  return { H, A, Hu };
}
const askPrompt = ({ H, A, Hu }) =>
  `start ${realm} #${A}\n\nТы — агент роли #${A} в графе ${realm}. Нужно подготовить переименование раздела «Акции» в каталоге (холон #${H}): раздел станет витриной сезонных предложений. Какое новое имя выбрать — решает человек, роль #${Hu}. Заведи дело на холоне #${H}, позови туда роль #${Hu} и задай ей вопрос карточкой — какое имя выбрать, с вариантами. Задав вопрос, закончи ход: ответ придёт в дело.`;
async function firstAsk(calls) {
  const asks = caseCalls(calls, "ask");
  if (!asks.length) throw new Error(`the agent asked no card: ${seq(calls)}`);
  const a = asks[asks.length - 1];
  return { room: roomOf(a), entry: entryOf(a.text), key: a.args.key, text: a.args.text, karta: a.args.karta, call: a };
}
const caseHistory = async (room) => (await P.call("iskron_case", { realm, action: "history", room, from_start: true, keep_cursor: true, limit: 200 })).text;
const newSession = (title) => {
  const r = api("POST", "/api/session", { title, location: { directory: cwd }, model: { providerID, id: modelID } });
  const s = r.data?.data ?? r.data;
  if (!s?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
  runSessions.add(s.id);
  return s.id;
};
const session = async (title, text) => {
  const S = newSession(title);
  const mark = (live.mark = teeLines(teeLog).length);
  await turn(S, text);
  const msgs = messages(S);
  const calls = teeCalls(teeLog, mark);
  report.push(`\n===== session ${title} ${S} =====\n--- messages ---\n${journal(msgs)}\n--- bridge tools/call ---\n${callsText(calls)}`);
  report.push(`session ${title}: skills loaded ${skillsLoaded(msgs).join(", ") || "none"} · calls ${seq(calls)}`);
  return { S, msgs, calls, answer: lastAnswer(msgs) };
};

const probes = {
  async refuse() {
    const scene = await layCaseScene();
    const s1 = await session("asks", askPrompt(scene));
    const ask = await firstAsk(s1.calls);
    report.push(`ask: room №${ask.room} entry [${ask.entry}] key «${ask.key}»`);
    const st = await P.call("iskron_stand", { realm, karta: `#${scene.Hu}`, name: "person-733" });
    if (st.error) throw new Error(`person seat: ${st.text.slice(0, 300)}`);
    const mark = (live.mark = teeLines(teeLog).length);
    const ans = await P.call("iskron_case", { realm, action: "answer", room: ask.room, in_reply_to: ask.entry, text: REFUSAL });
    report.push(`person answer: ${ans.error ? "ERROR " : ""}${ans.text.slice(0, 400)}`);
    if (ans.error) throw new Error(`the person's answer refused: ${ans.text.slice(0, 300)}`);
    const answerEntry = entryOf(ans.text);
    const frame = await woken(s1.S, waitMinutes);
    let nudged = false;
    if (!frame) { nudged = true; await turn(s1.S, `В деле №${ask.room} есть новое.`); }
    const after = teeCalls(teeLog, mark);
    const msgs = messages(s1.S);
    const reply = lastAnswer(msgs);
    report.push(`\n===== after the refusal (${frame ? "frame woke the session" : `no wake in ${waitMinutes} min — nudged`}) =====\n--- messages ---\n${journal(msgs)}\n--- bridge tools/call ---\n${callsText(after)}`);
    report.push(`--- case №${ask.room} ---\n${await caseHistory(ask.room)}`);
    const acks = caseCalls(after, "ack").filter((c) => !answerEntry || String(c.args.in_reply_to).replace(/^\[|\]$/g, "") === answerEntry);
    const reasks = caseCalls(after, "ask");
    const verbatim = reasks.filter((c) => norm(c.args.text) === norm(ask.text));
    const decided = after.filter((c) => !c.error && (/^iskron_(add_|update$|batch$)/.test(c.name) || (c.name === "iskron_case" && ["line", "say"].includes(c.args.action))));
    const moves = `acks ${acks.length} · re-asks ${reasks.length} (verbatim ${verbatim.length}) · decisions/words ${seq(decided) || "none"} · ${seq(after)}`;
    if (!acks.length || verbatim.length) verdict(false, "(1) #9679 refusal: ack, no verbatim repeat", moves);
    else if (!reasks.length && !decided.length) verdict(false, "(1) #9679 refusal: after the ack — a re-ask or a decision", moves);
    else provisional(`PROVISIONAL (1) #9679 refusal: ack and a next move — premise/options of the re-ask or the decision's mandate is read by a human · ${moves}${nudged ? " · NUDGED: no frame woke the session" : ""}\n  re-ask: ${reasks.map((c) => JSON.stringify({ text: c.args.text, payload: c.args.payload })).join(" | ") || "—"}\n  reply: ${reply.slice(0, 800)}`);
    await P.call("iskron_channel", { realm, action: "list", karta: `#${scene.Hu}` }).then((b) => report.push(`person board:\n${b.text}`));
  },
  async pickup() {
    const scene = await layCaseScene();
    const s1 = await session("leads-and-asks", askPrompt(scene));
    const ask = await firstAsk(s1.calls);
    report.push(`ask: room №${ask.room} entry [${ask.entry}] key «${ask.key}»`);
    // The seat goes out: taken off at the api, as a seat that died; session A is not prompted again.
    const board = await P.call("iskron_channel", { realm, action: "list", karta: `#${scene.A}` });
    const held = [...new Map(cleanup.places().filter((p) => String(p.karta).replace(/^#/, "") === scene.A).map((p) => [p.name, p])).values()];
    report.push(`agent board before:\n${board.text}\nheld: ${held.map((p) => p.name).join(", ")}`);
    if (held.length !== 1) throw new Error(`expected one seat of #${scene.A}, found ${held.length}`);
    const id = seatID(board.text, held[0].name);
    if (!id) throw new Error(`seat id of ${held[0].name} not on the board`);
    const rv = await person.revoke(realm, id);
    report.push(`seat ${held[0].name} taken off: ${rv.text.slice(0, 200)}`);
    if (rv.error) throw new Error(`revoke: ${rv.text}`);
    await sleep(20_000);
    const after = await P.call("iskron_channel", { realm, action: "list", karta: `#${scene.A}` });
    report.push(`agent board after:\n${after.text}`);
    if (seatID(after.text, held[0].name)) throw new Error(`the seat ${held[0].name} came back after the take-off`);
    report.push(`--- case №${ask.room} before the pick-up ---\n${await caseHistory(ask.room)}`);
    const s2 = await session("picks-up", `start ${realm} #${scene.A}\n\nТы — агент роли #${scene.A} в графе ${realm}. Прежнее место этой роли погасло посреди работы. Подхвати брошенные дела роли и доведи их.`);
    const hist = await caseHistory(ask.room);
    report.push(`--- case №${ask.room} after the pick-up ---\n${hist}`);
    const reasks = caseCalls(s2.calls, "ask").filter((c) => /акци|имя|назва|раздел|витрин/i.test(c.args.text ?? ""));
    const withdraws = s2.calls.filter((c) => c.name === "iskron_case" && !c.error && [c.args.withdraws ?? []].flat().flatMap((x) => String(x).match(/\d+/g) ?? []).includes(String(ask.entry)));
    const moves = `re-asks ${reasks.map((c) => `№${roomOf(c)}`).join(",") || "none"} · old card [${ask.entry}] withdrawn ${withdraws.length ? seq(withdraws) : "no"} · ${seq(s2.calls)}`;
    if (!reasks.length && !withdraws.length) verdict(false, "(2) #9676 pick-up: own open card re-asked in a live case or withdrawn", moves);
    else if (reasks.length && !withdraws.length) verdict(false, "(2) #9676 pick-up: re-asked but the old card left open", moves);
    else verdict(true, "(2) #9676 pick-up: own open card re-asked in a live case or withdrawn", `${moves}\n  re-ask: ${reasks.map((c) => c.args.text).join(" | ") || "—"} · withdraw note: ${withdraws.map((c) => c.args.note ?? c.args.done).join(" | ")}`);
  },
  async help() {
    for (const [n, text] of [["invite", "как пригласить человека в граф?"], ["broken", "ничего не работает, онбординг говно"]]) {
      const s = await session(n, text);
      const before = s.calls.filter((c) => !c.error);
      const surface = before.filter((c) => /^iskron_/.test(c.name));
      const leak = leaks(s.answer);
      const nSteps = steps(s.answer);
      const seen = `skills ${skillsLoaded(s.msgs).join(",") || "none"} · surface reads ${seq(surface) || "none"} · steps ${nSteps} · leaks ${leak.join("; ") || "none"} · ${s.answer.length} chars`;
      report.push(`--- ${n} answer ---\n${s.answer}`);
      if (!surface.length || leak.length || nSteps > 1) verdict(false, `(3) #9587 ${n}: surface read, one step, no tool names/codes/rN`, seen);
      else if (n === "broken") {
        const ack = /жаль|извин|прост[иь]те|понимаю|неприятн|сочувств|да, |признаю|правы/i.test(s.answer);
        if (!ack) verdict(false, "(3) #9587 broken: acknowledgement and named cause", seen);
        else provisional(`PROVISIONAL (3) #9587 broken: acknowledgement found; the named cause is read by a human · ${seen}\n  answer: ${s.answer.slice(0, 900)}`);
      } else provisional(`PROVISIONAL (3) #9587 invite: mechanical checks passed; the step's truth against the surface is read by a human · ${seen}\n  answer: ${s.answer.slice(0, 900)}`);
    }
  },
  async mind() {
    const all = await P.call("iskron_search", { realm: mind, q: "", limit: 50 });
    report.push(`mind before:\n${all.text}`);
    const ids = [...all.text.matchAll(/\(#(\d+), (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
    if (ids.length !== 1 || !/karta/.test(ids[0])) throw new Error(`mind is not «only the person's role»: ${ids.join(" ") || "empty"}`);
    const s = await session("what-in-graph", "что у меня в графе?");
    const leak = leaks(s.answer);
    const kinds = KINDS.filter((re) => re.test(s.answer)).map((re) => `«${s.answer.match(re)[0]}»`);
    const zero = s.answer.match(/(?:0|ноль|нет)\s+(?:[а-яё]+\s+\(?)?(?:крий|вимарш|холон|феномен|превращ|карт|узл|контур|действ|вопрос|дел)[^\n]{0,40}/gi) ?? [];
    const transport = s.answer.match(/транспорт|мост\b|сокет|MCP|канал доставки/i);
    const seen = `skills ${skillsLoaded(s.msgs).join(",") || "none"} · leaks ${leak.join("; ") || "none"} · kinds ${kinds.join(",") || "none"} · empty counts ${zero.join(" | ") || "none"} · delivery ${transport?.[0] ?? "none"} · ${seq(s.calls)}`;
    report.push(`--- answer ---\n${s.answer}`);
    if (leak.some((l) => /rN/.test(l)) || kinds.length || zero.length || transport) verdict(false, "(4) #9583 near-empty mind in plain words", seen);
    else provisional(`PROVISIONAL (4) #9583: no rN, kinds, empty counts or delivery words; the plainness is read by a human · ${seen}\n  answer: ${s.answer.slice(0, 900)}`);
  },
};

try {
  ledger = spawn(process.execPath, [ledgerScript, "--log", ledgerLog, "--port", String(ledgerPort)], { env: nodeEnv, stdio: ["ignore", "pipe", "pipe"] });
  let lout = "";
  ledger.stdout.on("data", (d) => (lout += d));
  for (let i = 0; i < 40 && !/listening/.test(lout); i++) await sleep(250);
  if (!/listening/.test(lout)) throw new Error("the MCP ledger did not start");
  await P.init();
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  serve.stdout.on("data", (d) => {
    out += d;
    const pw = out.match(/server password (\S+)/);
    if (pw) { env.OPENCODE_PASSWORD = pw[1]; secrets.add(pw[1]); }
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120 && !api("GET", "/api/session/active").ok; i++) await sleep(500);
  await turn(newSession("warm-up"), "Answer OK and end your turn. Call no tools.");
  for (let t = 0; t < 240 && !/тулов в сессии: \d+|tools in the session: \d+/.test(existsSync(join(run, "serve.log")) ? readFileSync(join(run, "serve.log"), "utf8") : ""); t++) await sleep(500);
  await sleep(10_000);
  setup = false;
  await probes[probe]();
} catch (e) {
  errorVerdict(e.message, setup);
  for (const id of runSessions)
    try { report.push(`\n===== session ${id} (interrupted) =====\n${journal(messages(id))}`); } catch (x) { problem(`journal ${id}: ${x.message}`); }
  report.push(`--- bridge tools/call ---\n${callsText(teeCalls(teeLog, live.mark))}`);
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
  await cleanup.revoke(places, P, person);
  const take = sceneTaker(P, { realm, problem, laid });
  for (const id of [...laid].reverse()) await take(id).catch((e) => problem(`cleanup #${id}: ${e.message}`));
  await P.close();
  await cleanup.stopDaemons();
  if (ledger && ledger.exitCode === null) { ledger.kill("SIGTERM"); await sleep(500); }
  report.push(`--- MCP ledger ---\n${existsSync(ledgerLog) ? readFileSync(ledgerLog, "utf8") : "none"}`);
}
writeFileSync(reportFile, scrub([...verdicts, ...report].join("\n")) + "\n", { mode: 0o600 });
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\n`);
process.exit(setup ? 2 : count() ? 1 : 0);
