// A live run of the person's way (graph @nks/nks-dev: question #9651, canon #9648, #9649, #9650;
// case №3122) by an OpenCode agent on the LAB carrier. Session 1: the person, working in the work
// graph, dictates a personal, portable way by steps. Session 2 — a fresh session: a task of the same
// kind. Falsifiers, fixed before the run: (1) after session 1 the mind graph holds no umbrella kriya
// with attrs slice=ways whose step kriyas hang by contains in the dictated order, linked by next —
// fail; the way laid as one card's prose or in the work graph — fail. (2) Session 2's first reply,
// before any writing work, does not show these steps and ask «так и делаю?» — fail. Judged on the
// bridge journal (evals/graph-probes/tee-bridge.mjs) and a fresh read of the mind graph.
//
//   node scripts/stand-run-ways.mjs --token-file F --api A --resolve R --mind @owner/mind
//     --work @owner/work --bridge B --plugin P --skills DIR [--model provider/id] [--report F]
//     [--turn-minutes 15] [--scene report|interview] [--again] [--cover]
//
// --again: the way session 1 laid already stands (exactly one ways umbrella) — its graph is
// re-judged by (1) and session 2 runs alone, a second sample of (2).
// --cover: the work folder carries an iskron: cover (the work graph, a holon laid for the run and
// taken off, the person's role #1) and the root seats by it — the start a person's session gets;
// a session 2 that did not read the personal slice of mind (attrs_filter with ways) is INVALID.
//
// --resolve — a process-only resolver (node --require) for the LAB's LAN ingress: HTTPS, Host, SNI
// and certificate checks stay. The bridge's MCP goes through stand-mcp-ledger.mjs (session evidence);
// every Node process — the runner, the ledger, the bridges and their daemon — loads the resolver.
// What the agent wrote stays in the graph: the person's way is the run's outcome. Exit 0 — passed,
// 1 — failed, 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personApi } from "./stand-person.mjs";
import { locationPath, secretScrubber, turnMinutes as parseMinutes } from "./stand-recall-evidence.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";
import { idOf, makeReporters, sceneTaker, stdioBridge, teeCalls, teeLines } from "./stand-recall-scene.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const fail = (code, t) => (process.stderr.write(`stand-run-ways: ${t}\n`), process.exit(code));
const [tokenFile, apiArg, mind, work] = ["--token-file", "--api", "--mind", "--work"].map((n) => arg(n));
const model = arg("--model", "anthropic/claude-opus-5-5");
const again = process.argv.includes("--again");
const withCover = process.argv.includes("--cover");
if (!tokenFile || !apiArg || !mind || !work || !arg("--resolve") || !arg("--bridge") || !arg("--plugin") || !arg("--skills"))
  fail(2, "--token-file, --api, --resolve, --mind, --work, --bridge, --plugin and --skills are required");
if (!["anthropic/claude-opus-5-5", "openai/gpt-6.1-sol"].includes(model)) fail(2, "--model: opus-5-5 or gpt-6.1-sol");
const [resolver, bridge, plugin, skills] = ["--resolve", "--bridge", "--plugin", "--skills"].map((n) => resolve(arg(n)));
const tee = join(root, "evals/graph-probes/tee-bridge.mjs");
const ledgerScript = join(root, "scripts/stand-mcp-ledger.mjs");
for (const p of [resolver, bridge, plugin, skills, tee, tokenFile]) if (!existsSync(p)) fail(2, `${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others`);
createRequire(import.meta.url)(resolver);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-ways-${stamp}.txt`));
let turnMinutes;
try { turnMinutes = parseMinutes(arg("--turn-minutes", "15")); } catch (e) { fail(2, e.message); }
const skillDirs = readdirSync(skills).filter((d) => existsSync(join(skills, d, "SKILL.md")));
const token = readFileSync(tokenFile, "utf8").trim();
const { secrets, remember: rememberSecrets, scrub } = secretScrubber(token);
const [providerID, modelID] = model.split("/");
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const person = personApi({ api: apiArg, token });

const run = mkdtempSync(join(tmpdir(), "stand-ways-"));
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
writeFileSync(join(cwd, "README.md"), "# Рабочая папка\n\nЗаметки и отчёты по текущей работе.\n");
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
  // With a cover the session starts as a person's does: the root seats by it and gets the start word.
  ISKRON_ROOT_SEAT: withCover ? "1" : "0",
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
const turn = async (id, text) => {
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  for (let t = 0; t < 30 && !active().includes(id); t++) await sleep(1000);
  for (let t = 0; t < turnMinutes * 60 && active().includes(id); t++) await sleep(1000);
  if (active().includes(id)) throw new Error(`session ${id}: the turn did not end in ${turnMinutes} min`);
};
const texts = (msgs) => msgs.filter((x) => (x.type ?? x.role) === "assistant").flatMap((x) => (x.content ?? []).filter((p) => p.type === "text").map((p) => p.text)).join("\n");
const lastAnswer = (msgs) => texts(msgs.slice(msgs.map((x) => x.type ?? x.role).lastIndexOf("user") + 1));
const harnessTools = (msgs) => msgs.flatMap((x) => (x.content ?? []).filter((p) => p.type === "tool"));
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

// The dictated ways, one per scene: four steps, each with words a step kriya's name or description
// carries; `kind` tells this scene's umbrella from another kind's in the same mind.
const SCENES = {
  report: {
    kind: /отч[её]т/i,
    steps: [
      { text: "сначала выгружаю из трекера все задачи, закрытые за неделю", re: /выгру|трекер|закрыт/i },
      { text: "потом раскладываю их на три группы — сделано, в работе, риски", re: /групп|раскла|риск/i },
      { text: "затем пишу сверху итог в три строки, не больше", re: /итог|три строки|резюм/i },
      { text: "и в конце отправляю руководителю в личные сообщения до пятницы 16:00, не в общий канал", re: /отправ|руковод|16:00|пятниц/i },
    ],
    dictate: "как я готовлю еженедельный отчёт руководителю",
    task: "Подготовь, пожалуйста, мой еженедельный отчёт руководителю за эту неделю.",
  },
  interview: {
    kind: /собесед|кандидат/i,
    steps: [
      { text: "сначала читаю резюме и выписываю три вопроса по его прошлому опыту", re: /резюме|три вопрос/i },
      { text: "потом прошу у рекрутера тестовое задание кандидата и просматриваю его", re: /тестов|рекрутер/i },
      { text: "затем составляю план беседы на 45 минут: 10 — знакомство, 25 — техника, 10 — вопросы кандидата", re: /план|45/i },
      { text: "и в тот же день после встречи пишу отзыв в пять строк с решением «да» или «нет»", re: /отзыв|пять строк|да.{0,8}нет/i },
    ],
    dictate: "как я готовлюсь к собеседованию с кандидатом",
    task: "Завтра у меня собеседование с кандидатом на бэкенд-разработчика, помоги подготовиться.",
  },
};
const scene = SCENES[arg("--scene", "report")];
if (!scene) fail(2, `--scene: ${Object.keys(SCENES).join(" or ")}`);
const STEPS = scene.steps;
const SESSION1 = `Я работаю в графе ${work}. Расскажу, ${scene.dictate} — это мой собственный способ, я так делаю на любой работе: ${STEPS.map((s) => s.text).join("; ")}.`;
const SESSION1_ANSWER = "Это мой личный способ, не проекта.";
const SESSION2 = `Я работаю в графе ${work}. ${scene.task}`;
// The umbrella's essence carries the check «так и делаю?» in its «После» (fix/ways-carry).
const CARRIES = /после[\s\S]*(так и делаю|подтверди|сверк|свери)/i;
const WRITES = /^iskron_(add_|update$|batch$|arrow$|delete_node$)/;
const CASE_READS = new Set(["read", "history", "mine", "at", "?"]);
const writing = (c) => WRITES.test(c.name) || (c.name === "iskron_case" && !CASE_READS.has(c.args.action));
const FILE_WRITES = /^(write|edit|patch|apply_patch|multiedit)$/;
const seq = (cs) => cs.map((c) => `${c.name.replace(/^iskron_/, "")}${c.args.action ? `:${c.args.action}` : ""}${c.args.realm ? `@${c.args.realm}` : ""}${c.error ? "!" : ""}`).join(" → ");
const inRealm = (c, realm, short) => [realm, short, realm.split("/").pop()].includes(c.args.realm);
const skillsLoaded = (msgs) => harnessTools(msgs).filter((p) => p.name === "skill").map((p) => p.state?.input?.id ?? p.state?.input?.name ?? "?");

const { verdicts, report, problem, verdict, error: errorVerdict, count } = makeReporters();
const cleanup = runCleanup({ run, auth, bridge, env: nodeEnv, cwd, report, scrub, problem });
const P = stdioBridge({ run, bridge, env: nodeEnv, token, name: "stand-run-ways", problem });
const live = { mark: 0 };
const laid = [];
let setup = true;
const ids = (text) => [...new Set([...String(text).matchAll(/#(\d+)\)/g)].map((m) => m[1]))];
// An arrow block of a look: its header line and the condensed «↳» lines under it.
const arrowIds = (look, type, dir) => {
  const lines = look.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp(`^\\s*${dir}\\s*${type}(?=[\\s:(])`).test(lines[i])) continue;
    out.push(...ids(lines[i]));
    for (let j = i + 1; j < lines.length && /^\s*↳/.test(lines[j]); j++) out.push(...ids(lines[j]));
  }
  return [...new Set(out)];
};
const look = async (realm, id) => (await P.call("iskron_look", { realm, node_id: `#${id}` })).text;
const nameOf = (text) => text.split("\n")[0];
async function ways() {
  const r = await P.call("iskron_search", { realm: mind, q: "", node_type: "kriya", attrs_filter: "slice:ways", limit: 50 });
  if (r.error) throw new Error(`search ${mind} slice:ways: ${r.text.slice(0, 300)}`);
  const all = [...r.text.matchAll(/\(#(\d+), kriya/g)].map((m) => m[1]);
  const ids = [];
  for (const u of all) if (scene.kind.test(await look(mind, u))) ids.push(u);
  return { text: r.text, all, ids };
}
// The umbrella's steps in the next-chain order, read from the steps' own looks.
async function wayOf(u) {
  const ul = await look(mind, u);
  const all = (await P.call("iskron_search", { realm: mind, q: "", node_type: "kriya", limit: 100 })).text;
  const steps = [];
  for (const k of [...all.matchAll(/\(#(\d+), kriya/g)].map((m) => m[1])) {
    if (k === u) continue;
    const l = await look(mind, k);
    if (arrowIds(l, "contains", "←").includes(u)) steps.push({ id: k, look: l, next: arrowIds(l, "(?:next|далее)", "→") });
  }
  const inSteps = new Set(steps.map((s) => s.id));
  const pointed = new Set(steps.flatMap((s) => s.next.filter((n) => inSteps.has(n))));
  const heads = steps.filter((s) => !pointed.has(s.id));
  const chain = [];
  for (let s = heads.length === 1 ? heads[0] : null; s && !chain.includes(s); s = steps.find((x) => s.next.includes(x.id))) chain.push(s);
  return { look: ul, steps, heads, chain };
}
try {
  ledger = spawn(process.execPath, [ledgerScript, "--log", ledgerLog, "--port", String(ledgerPort)], { env: nodeEnv, stdio: ["ignore", "pipe", "pipe"] });
  let lout = "";
  ledger.stdout.on("data", (d) => (lout += d));
  for (let i = 0; i < 40 && !/listening/.test(lout); i++) await sleep(250);
  if (!/listening/.test(lout)) throw new Error("the MCP ledger did not start");
  await P.init();
  if (withCover) {
    // The work folder aligned as a person's is: the cover names the work graph, a holon of it and the person's role.
    const r = await P.call("iskron_add_holon", { realm: work, name: "📦 Моя текущая работа", description: "Что внутри: текущая работа человека в команде — задачи и встречи. Снаружи — работа других команд.", epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" });
    const id = idOf(r.text);
    if (r.error || !id) throw new Error(`cover holon: ${r.text.slice(0, 300)}`);
    laid.push(id);
    writeFileSync(join(cwd, "AGENTS.md"), `---\niskron:\n  graph: "${work}"\n  holon: ${id}\n  agent_role: 1\n  contract: 39\n  stamp: 2026-11-03\n---\n# Рабочая папка\n\nЗаметки и отчёты по текущей работе.\n\n## Жизненный цикл сессии\n- Старт — раздел «Старт» двери iskron.\n`);
    report.push(`cover: AGENTS.md iskron: graph ${work}, holon #${id} (laid for the run), agent_role #1 · ISKRON_ROOT_SEAT=1`);
  }
  const before = await ways();
  report.push(`mind ways before: ${before.all.map((i) => `#${i}`).join(" ") || "none"} · of this kind: ${before.ids.map((i) => `#${i}`).join(" ") || "none"}`);
  if (again ? before.ids.length !== 1 : before.ids.length) throw new Error(again ? `--again needs exactly one ways umbrella of this kind in ${mind}` : `a ways umbrella of this kind already stands in ${mind} — not a fresh way (--again runs session 2 alone)`);

  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  serve.stdout.on("data", (d) => {
    out += d;
    const pw = out.match(/server password (\S+)/);
    if (pw) { env.OPENCODE_PASSWORD = pw[1]; secrets.add(pw[1]); }
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120 && !api("GET", "/api/session/active").ok; i++) await sleep(500);
  const newSession = (title) => {
    const r = api("POST", "/api/session", { title, location: { directory: cwd }, model: { providerID, id: modelID } });
    const s = r.data?.data ?? r.data;
    if (!s?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
    runSessions.add(s.id);
    return s.id;
  };
  await turn(newSession("warm-up"), "Answer OK and end your turn. Call no tools.");
  for (let t = 0; t < 240 && !/тулов в сессии: \d+|tools in the session: \d+/.test(existsSync(join(run, "serve.log")) ? readFileSync(join(run, "serve.log"), "utf8") : ""); t++) await sleep(500);
  await sleep(10_000);
  setup = false;

  // Session 1: the person dictates the way; --again re-reads the way session 1 laid before.
  let after1 = before;
  let answered = false;
  let calls1 = [];
  if (!again) {
    const S1 = newSession("way dictated");
    const mark1 = (live.mark = teeLines(teeLog).length);
    await turn(S1, SESSION1);
    after1 = await ways();
    if (!after1.ids.length && /\?/.test(lastAnswer(messages(S1)))) {
      // The skill's one line «ваш способ или проекта?» gets its answer; nothing else is prompted.
      answered = true;
      await turn(S1, SESSION1_ANSWER);
      after1 = await ways();
    }
    calls1 = teeCalls(teeLog, mark1);
    report.push(`session 1 skills loaded: ${skillsLoaded(messages(S1)).join(", ") || "none"}`);
    report.push(`\n===== session 1 ${S1} =====\n--- messages ---\n${journal(messages(S1))}\n--- bridge tools/call ---\n${calls1.map((c) => `[${c.t}] ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
  }
  const workWays = calls1.filter((c) => !c.error && /^iskron_add_|^iskron_batch$/.test(c.name) && inRealm(c, work, "r294") && [scene.kind, ...STEPS.map((s) => s.re)].some((re) => re.test(JSON.stringify(c.args))));
  const found = [];
  for (const u of after1.ids) found.push({ u, ...(await wayOf(u)) });
  const essence = (l) => l.split(/^\s*(?:СУТЬ|ESSENCE):\s*$/m)[1]?.split(/^\s*[А-ЯA-Z ]+:\s*$/m)[0] ?? "";
  const good = found.find((w) => CARRIES.test(essence(w.look)) && w.chain.length === w.steps.length && w.chain.length >= STEPS.length
    && STEPS.every((s, i) => s.re.test(nameOf(w.chain[i]?.look ?? "")) || s.re.test(w.chain[i]?.look ?? "")));
  for (const w of found) {
    report.push(`--- umbrella #${w.u} ---\n${w.look}`);
    for (const s of w.steps) report.push(`--- step #${s.id} (next → ${s.next.join(",") || "—"}) ---\n${s.look}`);
  }
  verdict(
    !!good && workWays.length === 0,
    `(1) the dictated way lies in mind: umbrella kriya slice=ways whose essence «После» carries «так и делаю?», steps by contains in order, linked by next; not in work${again ? " (--again: graph re-read only)" : ""}`,
    `ways after: ${after1.ids.map((i) => `#${i}`).join(" ") || "none"} · ${found.map((w) => `#${w.u}: essence carries the check ${CARRIES.test(essence(w.look)) ? "yes" : "no"}, steps ${w.steps.map((s) => `#${s.id}`).join(",") || "—"}, chain ${w.chain.map((s) => `#${s.id}`).join("→") || "—"}, heads ${w.heads.length}`).join(" | ") || "no umbrella"} · way-like writes in work: ${workWays.length}${answered ? ` · the agent asked, answered «${SESSION1_ANSWER}»` : ""} · ${seq(calls1.filter(writing))}`,
  );
  report.push(`session 1 calls: ${seq(calls1)}`);
  if (!again) await sleep(20_000); // the search index takes the fresh nodes in

  // Session 2: a fresh session, a task of the same kind.
  const S2 = newSession("same kind");
  const mark2 = (live.mark = teeLines(teeLog).length);
  await turn(S2, SESSION2);
  const calls2 = teeCalls(teeLog, mark2);
  const msgs2 = messages(S2);
  const answer = lastAnswer(msgs2);
  const fileWrites = harnessTools(msgs2).filter((p) => FILE_WRITES.test(p.name));
  const graphWrites = calls2.filter((c) => !c.error && writing(c));
  const shown = STEPS.filter((s) => s.re.test(answer));
  const asks = (answer.match(/[^.!?\n]*\?/g) ?? []).map((q) => q.trim());
  const checkQ = asks.filter((q) => /так(?![а-яё])|по этому|этим способом|этой схем|как обычно|подходит|верно/i.test(q));
  report.push(`\n===== session 2 ${S2} =====\n--- messages ---\n${journal(msgs2)}\n--- bridge tools/call ---\n${calls2.map((c) => `[${c.t}] ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
  // With a cover: how the start reached the session, and whether it read the personal slice of mind.
  const firstUser = msgs2.find((x) => (x.type ?? x.role) === "user");
  const userText = String(firstUser?.text ?? JSON.stringify(firstUser?.content ?? ""));
  const sliceRead = calls2.filter((c) => c.name === "iskron_search" && inRealm(c, mind, "r293") && /ways/.test(String(c.args.attrs_filter ?? "")));
  if (withCover)
    report.push(`start delivered: start word in the first prompt ${/раздел «Старт» двери iskron|Start section of the iskron door/.test(userText) ? "yes" : "no"} · iskron door loaded ${skillsLoaded(msgs2).includes("iskron") ? "yes" : "no"} · slice read: ${seq(sliceRead) || "none"} ${sliceRead.map((c) => JSON.stringify(c.args)).join(" ")}`);
  if (withCover && !sliceRead.length)
    verdicts.push(`INVALID (2) the start did not read the personal slice (attrs_filter with ways) — neither pass nor fail · start word ${/раздел «Старт» двери iskron|Start section of the iskron door/.test(userText) ? "delivered" : "absent"} · skills loaded: ${skillsLoaded(msgs2).join(", ") || "none"} · ${seq(calls2).slice(0, 300)}`);
  else verdict(
    shown.length === STEPS.length && checkQ.length >= 1 && graphWrites.length === 0 && fileWrites.length === 0,
    "(2) session 2's first reply shows the steps and asks «так и делаю?» before any writing work",
    `steps shown ${shown.length}/${STEPS.length} · check question: ${checkQ.join(" | ") || `none (questions: ${asks.join(" | ") || "none"})`} · graph writes: ${seq(graphWrites) || "none"} · file writes: ${fileWrites.map((p) => p.name).join(",") || "none"} · skills loaded: ${skillsLoaded(msgs2).join(", ") || "none"} · mind reads: ${seq(calls2.filter((c) => inRealm(c, mind, "r293"))) || "none"}`,
  );
  report.push(`session 2 calls: ${seq(calls2)} · skills loaded: ${skillsLoaded(msgs2).join(", ") || "none"}`);
  report.push(`--- session 2 first reply ---\n${answer}`);
  const left = await ways();
  report.push(`mind ways left: ${left.ids.map((i) => `#${i}`).join(" ") || "none"}\n${left.text}`);
} catch (e) {
  errorVerdict(e.message, setup);
  for (const id of runSessions)
    try { report.push(`\n===== session ${id} (interrupted) =====\n${journal(messages(id))}`); } catch (x) { problem(`journal ${id}: ${x.message}`); }
  report.push(`--- bridge tools/call ---\n${teeCalls(teeLog, live.mark).map((c) => `[${c.t}] ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`).join("\n")}`);
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
  const take = sceneTaker(P, { realm: work, problem, laid });
  for (const id of [...laid].reverse()) await take(id).catch((e) => problem(`cleanup #${id}: ${e.message}`));
  await P.close();
  await cleanup.stopDaemons();
  if (ledger && ledger.exitCode === null) { ledger.kill("SIGTERM"); await sleep(500); }
  report.push(`--- MCP ledger ---\n${existsSync(ledgerLog) ? readFileSync(ledgerLog, "utf8") : "none"}`);
}
writeFileSync(reportFile, scrub([...verdicts, ...report].join("\n")) + "\n", { mode: 0o600 });
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\n`);
process.exit(setup ? 2 : count() ? 1 : 0);
