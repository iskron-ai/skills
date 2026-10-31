#!/usr/bin/env node
// Recall probes by a live OpenCode agent against a PAT carrier (case №2305 under №2302): an
// isolated `opencode serve` with the given plugin, bridge and skill set; the scene is laid in the
// graph through a seatless bridge of the same account and taken off at the end. One session per
// probe, the prompt as a person writes it, nothing said about recall:
//   (a) mid-task a fact of a foreign holon is needed;
//   (b) the fact is worded without the question's word — an empty search, then another wording
//       or semantic search, and «не вижу» with what was walked, not «нет»;
//   (c) the first message is a «summary after compaction» with the wrong decision (30 s), the
//       next leans on it;
//   (d) negative: the present will is the person's — asked at once, not a brother (another seat
//       of the role) via case or channel; looking for a permission already given is lawful.
//
//   node scripts/stand-run-recall.mjs --token-file F --url U --api A --realm @owner/slug
//     --bridge B --plugin P --skills DIR [--model provider/id] [--sub-model provider/id] [--no-roles]
//     [--report F] [--raw-json F] [--keep] [--only a,b,c,d,e,f,g,h]
//     [--turn-minutes 15] [--require-empty] [--fixed-brief F] [--installed]
// (f) opt-in multi-actor intake by ingester; (g) opt-in short intake without ingester;
// (h) opt-in search delegated to a recaller — the prompt of scene (д) of case №2302 word for word.
// Their semantic acceptance remains PROVISIONAL pending human inspection of raw journals.
// (e) — a task needing the fact without naming it («допиши в import.yaml блок очереди»): the
//     agent's own look of the fact before any question, 45 written with a reference to the node.
//
// --model: anthropic/claude-opus-5-5 (default) or openai/gpt-6.1-sol, nothing else. Roles: every
// role block of <skills>/iskronify/references/delegation-*.md is projected into the project as
// .opencode/agents/<name>.md in its OpenCode form (mode: subagent, model --sub-model, default
// zai/glm-5.3 — the person's choice); a set without recaller (7.25.0) gets its own roles only;
// --no-roles projects none. Subagent calls (task/subagent) are journaled with their role, and
// each graph call is told the agent's or a subagent's by the tool part it ran in. --skills: a
// directory of skill directories (each with SKILL.md), copied to <home>/.config/opencode/skill —
// where OpenCode 2 reads them in an isolated home; the project dir lies in the system temp dir,
// as OpenCode also walks up from it to .agents/skills and .claude/skills (observed on 2.2.1).
// The carrier: the raw journal of each session — its messages (tool parts in full) and every
// tools/call line between the plugin and the bridge (evals/graph-probes/tee-bridge.mjs) —
// printed whole to the report (default ./stand-run-recall-<stamp>.txt), PASS/FAIL per probe
// judged on the journal. Control: the same probes on 7.25.0, e.g.
//   mkdir -p .control && git archive v7.25.0 skills | tar -x -C .control
//   --bridge .control/skills/establish-mcp/scripts/iskron.mjs
//   --plugin .control/skills/establish-mcp/scripts/opencode-plugin.js --skills .control/skills
// Default probes a-e. Exit 0 — all passed, 1 — failed/blocked/provisional, 2 — setup failed.
// Raw root/child messages are scrubbed into the text report and optional --raw-json.
// For upstream session lifecycle evidence run stand-mcp-ledger.mjs separately and pass its
// loopback URL as --url. Local grant/standing logs alone cannot prove initialize/DELETE parity.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personApi } from "./stand-person.mjs";
import { SUB_TOOL, roleOf, has45, actualModels, sessionTree, turnMinutes as parseMinutes, locationPath, secretScrubber } from "./stand-recall-evidence.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";
import {
  H_PROMPT,
  fixedBriefPrompt,
  idOf,
  layScene,
  makeReporters,
  nodeOf,
  sceneTaker,
  stdioBridge,
  teeCalls as sceneTeeCalls,
  teeLines as sceneTeeLines,
} from "./stand-recall-scene.mjs";
import { intakePrompts, intakeEvidence } from "./stand-recall-intake.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  const head = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  process.stdout.write(head.slice(0, head.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(0);
}
const fail = (code, t) => (process.stderr.write(`stand-run-recall: ${t}\n`), process.exit(code));
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const apiArg = arg("--api");
const realm = arg("--realm");
const bridgeArg = arg("--bridge");
const pluginArg = arg("--plugin");
const skillsArg = arg("--skills");
const model = arg("--model", "anthropic/claude-opus-5-5");
const subModel = arg("--sub-model", "zai/glm-5.3");
const noRoles = process.argv.includes("--no-roles");
const keep = process.argv.includes("--keep");
// --installed: --skills is the machine's installed root (<x>/.agents/skills, its lock beside it),
// seen through the isolated home as it lies, foreign skills of that root included.
const installed = process.argv.includes("--installed");
// --fixed-brief F (with f): the ingester's brief, the same for every model compared (case №2394
// [18]); the root lays it word for word, filling only {REALM} {SEAT} {CASE} {SOURCE}.
const fixedBrief = arg("--fixed-brief", null) ? readFileSync(arg("--fixed-brief", null), "utf8").trim() : null;
const PROBES = ["a", "b", "c", "d", "e"];
const AVAILABLE = [...PROBES, "f", "g", "h"];
const only = arg("--only", PROBES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-recall-${stamp}.txt`));
const rawFile = arg("--raw-json") ? resolve(arg("--raw-json")) : null;
let turnMinutes;
try { turnMinutes = parseMinutes(arg("--turn-minutes", "15")); } catch (e) { fail(2, e.message); }
// Haiku runs nothing (owner's word): only the two models of the brief.
const MODELS = ["anthropic/claude-opus-5-5", "openai/gpt-6.1-sol"];
if (!tokenFile || !URL_ || !apiArg || !realm || !bridgeArg || !pluginArg || !skillsArg)
  fail(2, "--token-file, --url, --api, --realm, --bridge, --plugin and --skills are required");
if (!MODELS.includes(model)) fail(2, `--model must be one of ${MODELS.join(", ")}`);
if (!/^[\w.-]+\/[\w.-]+$/.test(subModel) || /haiku/i.test(subModel)) fail(2, "--sub-model: provider/id, never haiku");
if (!only.length || only.some((p) => !AVAILABLE.includes(p))) fail(2, `--only takes a subset of ${AVAILABLE.join(",")}`);
const bridge = resolve(bridgeArg);
const plugin = resolve(pluginArg);
const skills = resolve(skillsArg);
const tee = join(root, "evals/graph-probes/tee-bridge.mjs");
for (const [n, p] of [["--bridge", bridge], ["--plugin", plugin], ["--skills", skills], ["tee", tee], ["--token-file", tokenFile]])
  if (!existsSync(p)) fail(2, `${n}: ${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others — chmod 600`);
const skillDirs = readdirSync(skills).filter((d) => existsSync(join(skills, d, "SKILL.md")));
if (!skillDirs.length) fail(2, `--skills: no <name>/SKILL.md under ${skills}`);
// The role files of the set (iskronify's delegation parts): each ```markdown block with a name.
const roles = [];
if (!noRoles)
  for (const f of ["delegation-1.md", "delegation-2.md"]) {
    const p = join(skills, "iskronify/references", f);
    if (!existsSync(p)) continue;
    for (const [, fm, body] of readFileSync(p, "utf8").matchAll(/```markdown\n---\n([\s\S]*?)\n---\n([\s\S]*?)\n```/g)) {
      const name = fm.match(/^name: ([\w-]+)$/m)?.[1];
      const description = fm.match(/^description: (.+)$/m)?.[1];
      if (name && description) roles.push({ name, description, body: body.trim() });
    }
  }
const token = readFileSync(tokenFile, "utf8").trim();
if (!token) fail(2, "empty token file");
const { secrets, remember: rememberSecrets, scrub } = secretScrubber(token);
const [providerID, modelID] = model.split("/");
const subProvider = subModel.split("/")[0];
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const person = personApi({ api: apiArg, token });
// The carrier answers at all before anything is laid: the run's credential reads its channels.
{
  let st = 0;
  try {
    st = (await fetch(apiArg.replace(/\/$/, "") + "/me/channels", { headers: { Authorization: `Bearer ${token}`, "X-NKS-Realm": realm } })).status;
  } catch (e) {
    fail(2, `--api ${apiArg}: ${e.message}`);
  }
  if (st !== 200) fail(2, `--api ${apiArg}: GET /me/channels → ${st}`);
}

const run = mkdtempSync(join(tmpdir(), "stand-recall-"));
// Evidence is in scrubbed reports; --keep never retains raw transport logs or credentials.
process.on("exit", () => {
  for (const p of [home, auth, join(run, "auth-person")]) rmSync(p, { recursive: true, force: true });
  removeRawLogs(run);
  if (keep) process.stderr.write(`run dir kept (credentials removed): ${run}\n`);
  else rmSync(run, { recursive: true, force: true });
});
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
for (const d of [cwd, join(oc, "plugins"), join(oc, "skill"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), join(home, "tmp")])
  mkdirSync(d, { recursive: true });
mkdirSync(auth, { recursive: true, mode: 0o700 });
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });
cpSync(plugin, join(oc, "plugins/iskron.js"));
if (installed) {
  // The machine's own set as it lies (case №2394 [34]): <home>/.agents is the installed .agents with its lock.
  symlinkSync(dirname(skills), join(home, ".agents"));
} else {
  // OpenCode 2.2.1 reads <config>/skill (singular), not <config>/skills (case №2306).
  for (const d of skillDirs) cpSync(join(skills, d), join(oc, "skill", d), { recursive: true });
  // The install lock beside the root, as `npx skills add` lays it: without it the plugin opens
  // only the bridge skill to a child's reads, and a subagent cannot read references (case №2394).
  writeFileSync(join(oc, ".skill-lock.json"), JSON.stringify({ version: 3, skills: Object.fromEntries(skillDirs.map((d) => [d, { source: "iskron-ai/skills" }])) }));
}
// The roles in their OpenCode form (delegation-2.md, «OpenCode»): the same body, the frontmatter
// description, mode subagent and the pinned model.
mkdirSync(join(cwd, ".opencode/agents"), { recursive: true });
for (const r of roles) writeFileSync(join(cwd, ".opencode/agents", `${r.name}.md`), `---\ndescription: ${r.description}\nmode: subagent\nmodel: ${subModel}\n---\n\n${r.body}\n`);
const teeLog = join(run, "bridge.jsonl");

// Provider settings from the machine config (comments stripped), nothing else.
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
    ],
    providers: Object.fromEntries([...new Set([providerID, subProvider])].filter((p) => machine.providers?.[p]).map((p) => [p, machine.providers[p]])),
  }),
);

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
  // The plugin starts the tee, the tee the bridge under probe, every JSON-RPC line journaled.
  ISKRON_BRIDGE_PATH: tee,
  ISKRON_PROBE_BRIDGE: bridge,
  ISKRON_PROBE_LOG: teeLog,
  ISKRON_BRIDGE_AUTH_DIR: auth,
  ISKRON_BRIDGE_URL: URL_,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_NO_BROWSER: "1",
  // A person's session: the root sits on the cover's role itself, as at a human's desk.
  ISKRON_ROOT_SEAT: "1",
};

// Model keys: export from the real home, keep key entries, import into the isolated one. An OAuth
// entry goes without its refresh token (case №2394): the isolated home must never rotate the
// person's login, so it runs on the access token alone and fails when that has expired.
{
  const exp = spawnSync(opencode, ["auth", "export"], { encoding: "utf8" });
  const keys = JSON.parse(exp.stdout || "[]")
    .filter((e) => [providerID, subProvider].includes(e.integrationID) && ["key", "oauth"].includes(e.value?.type))
    .map((e) => (e.value.type === "oauth" ? { ...e, value: { ...e.value, refresh: "" } } : e));
  rememberSecrets(keys);
  for (const p of [providerID, ...(roles.length ? [subProvider] : [])])
    if (!keys.some((e) => e.integrationID === p)) fail(2, `no key or OAuth login of ${p} in this machine's opencode auth export`);
  for (const e of keys)
    if (e.value.type === "oauth" && !(Number(e.value.expires) > Date.now() + 3600_000))
      fail(2, `${e.integrationID}: the OAuth access token expires within the hour — refresh the login in the real home first`);
  const kf = join(home, "tmp/keys.json");
  writeFileSync(kf, JSON.stringify(keys), { mode: 0o600 });
  const imp = spawnSync(opencode, ["auth", "import", "--standalone", kf], { env, cwd, encoding: "utf8" });
  rmSync(kf, { force: true });
  if (imp.status !== 0) fail(2, `auth import: ${imp.stderr.slice(0, 300)}`);
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${port}`;
let serve = null;
let serveError;
let interrupted;
const checkInterrupted = () => { if (interrupted) throw interrupted; };
function api(method, path, body) {
  path = locationPath(path, cwd);
  const a = ["api", "--server", server, method, path];
  if (body) a.push("-d", JSON.stringify(body));
  // `opencode api` cuts a piped stdout at a 64 KiB boundary with status 0 (case №2306): the
  // answer goes to a file instead.
  const outFile = join(run, "api.out");
  const fd = openSync(outFile, "w");
  const r = spawnSync(opencode, a, { env, cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", fd, "pipe"] });
  closeSync(fd);
  const stdout = readFileSync(outFile, "utf8");
  let data = null;
  try {
    data = JSON.parse(stdout);
  } catch {}
  return { ok: r.status === 0 && data !== null && !data?._tag, data, raw: stdout + (r.stderr ?? "") };
}
function read(path) {
  const r = api("GET", path);
  if (!r.ok) throw new Error(`GET ${path}: ${r.raw.slice(0, 300)}`);
  return r.data?.data ?? r.data;
}
const startServe = async () => {
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  serve.on("error", (e) => { serveError = e; });
  let out = "";
  serve.stdout.on("data", (d) => {
    out += d;
    const pw = out.match(/server password (\S+)/);
    if (pw) { env.OPENCODE_PASSWORD = pw[1]; secrets.add(pw[1]); }
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120; i++) {
    checkInterrupted();
    if (serveError || serve.exitCode !== null || serve.signalCode !== null) throw new Error(`serve stopped: ${serveError?.code ?? serve.exitCode ?? serve.signalCode}`);
    if (api("GET", "/api/session/active").ok) return;
    await sleep(500);
  }
  throw new Error("serve did not come up");
};
const stopServe = async () => {
  delete env.OPENCODE_PASSWORD;
  if (!serve || serveError || serve.exitCode !== null || serve.signalCode !== null) return;
  const done = new Promise((r) => serve.once("exit", r));
  serve.kill("SIGTERM");
  await Promise.race([done, sleep(15_000)]);
  if (serve.exitCode === null && serve.signalCode === null) {
    serve.kill("SIGKILL");
    await Promise.race([done, sleep(5000)]);
    problem("OpenCode serve required SIGKILL");
  }
};
const active = () => Object.keys(read("/api/session/active") ?? {});
const messages = (id) => {
  const l = read(`/api/session/${id}/message?limit=200`);
  if (!Array.isArray(l)) throw new Error(`messages of ${id}: not a list`);
  if (l.length >= 200) problem(`messages of ${id}: reached observed API limit 200; completeness not established`);
  return [...l].sort((x, y) => Number(x?.time?.created ?? 0) - Number(y?.time?.created ?? 0));
};
const newSession = (title) => {
  const r = api("POST", "/api/session", { title, location: { directory: cwd }, model: { providerID, id: modelID } });
  const s = r.data?.data ?? r.data;
  if (!s?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
  runSessions.add(s.id);
  return s.id;
};
// One turn: the prompt, the session running, then idle within the declared bound.
const turn = async (id, text) => {
  checkInterrupted();
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  for (let t = 0; t < 30 && !active().includes(id); t++) { checkInterrupted(); await sleep(1000); }
  for (let t = 0; t < turnMinutes * 60 && active().includes(id); t++) { checkInterrupted(); await sleep(1000); }
  checkInterrupted();
  if (active().includes(id)) throw new Error(`session ${id}: the turn did not end in ${turnMinutes} min`);
};

// The seatless bridge of the same account (scene module) and the tee journal of THIS run.
const teeLines = () => sceneTeeLines(teeLog);
const teeCalls = (mark) => sceneTeeCalls(teeLog, mark);

// A subagent call of the harness and the role it named.
// Whose a graph call is: the tool part of the session it ran in — a subagent call's window makes
// it that role's, any other part's (execute, a direct iskron_* tool) the agent's own.
function attribute(calls, msgs) {
  const wins = msgs
    .filter((x) => (x.type ?? x.role) === "assistant")
    .flatMap((x) => (x.content ?? []).filter((p) => p.type === "tool"))
    .map((p) => ({ by: SUB_TOOL.test(p.name) ? `sub:${roleOf(p)}` : "agent", from: Number(p.time?.ran ?? p.time?.created ?? 0), to: Number(p.time?.completed ?? Infinity) }));
  return calls.map((c) => {
    const t = Date.parse(c.t);
    const w = wins.filter((x) => x.from <= t && t <= x.to);
    return { ...c, by: (w.find((x) => x.by !== "agent") ?? w[0])?.by ?? "agent?" };
  });
}
// The session's messages, whole: the person's words, the model's text, every tool part.
function journal(msgs) {
  const out = [];
  for (const x of msgs) {
    const at = new Date(Number(x?.time?.created ?? 0)).toISOString();
    if ((x.type ?? x.role) === "user") out.push(`[${at}] USER: ${x.text ?? JSON.stringify(x.payload ?? x.content ?? "")}`);
    else if ((x.type ?? x.role) === "assistant")
      for (const p of x.content ?? []) {
        if (p.type === "text") out.push(`[${at}] TEXT: ${p.text}`);
        else if (p.type === "tool")
          out.push(
            `[${at}] ${SUB_TOOL.test(p.name) ? `SUBAGENT ${roleOf(p)} via ` : ""}TOOL ${p.name} ${p.state?.status ?? ""}\n  input: ${JSON.stringify(p.state?.input)}\n  output: ${(p.state?.content ?? []).map((c) => c.text ?? JSON.stringify(c)).join("\n")}${p.state?.error ? `\n  error: ${JSON.stringify(p.state.error)}` : ""}${p.state?.metadata?.toolCalls ? `\n  toolCalls: ${JSON.stringify(p.state.metadata.toolCalls)}` : ""}`,
          );
      }
  }
  return out.join("\n");
}
// The text of the model's answer to the last turn: assistant text after the last user message.
const lastAnswer = (msgs) => {
  const u = msgs.map((x) => x.type ?? x.role).lastIndexOf("user");
  return msgs
    .slice(u + 1)
    .filter((x) => (x.type ?? x.role) === "assistant")
    .flatMap((x) => (x.content ?? []).filter((p) => p.type === "text").map((p) => p.text))
    .join("\n");
};

const node = nodeOf;
const rawJournals = [];
const runSessions = new Set();
let setup = true; // until the first probe: a refusal here is the run's, exit 2
const { verdicts, report, problem, verdict, provisional, error: errorVerdict, count } = makeReporters();
const cleanup = runCleanup({ run, auth, bridge, env, cwd, report, scrub, problem });

const P = stdioBridge({ run, bridge, env, token, name: "stand-run-recall", problem });
const laid = []; // node ids in the order laid, taken off in reverse
const scene = {};
// Ready before the scene is laid: a half-laid scene is taken off too (review of PR #618).
let take = sceneTaker(P, { realm, problem, laid });
let factOn = async () => {
  throw new Error("the scene was never laid");
};

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = new Error(`${signal}: run interrupted; cleanup requested`);
  process.stderr.write(`stand-run-recall: ${interrupted.message}\n`);
});
try {
  await P.init();
  checkInterrupted();
  ({ factOn, take } = await layScene(P, { realm, stamp, cwd, report, problem, requireEmpty: process.argv.includes("--require-empty"), sleep, scene, laid }));
  report.push(`realm ${realm} · model ${model} · bridge ${bridge} · plugin ${plugin} · skills ${skills} (${skillDirs.length})`);
  report.push(`roles (.opencode/agents, ${subModel}): ${roles.map((r) => r.name).join(", ") || "none"}`);

  await startServe();
  // The plugin rises with the first prompt; a warm-up lists its tools and the loaded skills.
  const warm = newSession("warm-up");
  await turn(warm, "Answer OK and end your turn. Call no tools.");
  // The list fills per project directory and a few seconds late (case №2306): ask with it, wait for it.
  let skillResponse = read("/api/skill") ?? [];
  for (let t = 0; t < 60 && skillDirs.some((id) => !skillResponse.some((s) => s.id === id)); t++) {
    checkInterrupted();
    await sleep(500);
    skillResponse = read("/api/skill") ?? [];
  }
  report.push(`skill discovery: ${JSON.stringify(skillResponse.map((s) => ({ id: s.id, path: s.path })))}`);
  const listed = skillResponse.map((s) => s.id);
  const foreign = skillResponse.filter((s) => !skillDirs.includes(s.id) && !s.path?.startsWith("/builtin/")).map((s) => s.id);
  if (skillDirs.some((s) => !listed.includes(s)) || foreign.length)
    throw new Error(`skills: missing ${skillDirs.filter((s) => !listed.includes(s)).join(",") || "—"}, foreign ${foreign.join(",") || "—"}`);
  // Every projected role is a subagent of the project on the pinned model.
  const agents = read("/api/agent") ?? [];
  const lost = roles.filter((x) => !agents.some((a) => a.id === x.name && a.mode === "subagent" && `${a.model?.providerID}/${a.model?.id}` === subModel));
  if (lost.length) throw new Error(`roles not seen as subagents on ${subModel}: ${lost.map((x) => x.name).join(", ")}`);
  for (let t = 0; t < 240 && !/тулов в сессии: \d+|tools in the session: \d+/.test(existsSync(join(run, "serve.log")) ? readFileSync(join(run, "serve.log"), "utf8") : ""); t++) { checkInterrupted(); await sleep(500); }
  await sleep(10_000);

  const intake = intakePrompts(scene);
  if (fixedBrief)
    intake.f = [fixedBriefPrompt(intake.f[0], scene, fixedBrief)];
  const PROMPTS = {
    ...intake,
    a: ["Правлю импорт, какой таймаут очереди ставить?"],
    b: ["Какой таймаут у очереди импорта?"],
    c: [
      "Сводка после сжатия контекста, продолжаем с этого места:\n- Задача: правим импорт каталогов поставщиков.\n- Решено: таймаут очереди импорта — 30 секунд (вариант 45 отвергнут как слишком долгий).\n- Дальше: выставить таймаут в конфиге импорта.\nПодтверди, что понял, и жди следующего сообщения.",
      "Ок, выставляю в конфиге импорта таймаут очереди 30 секунд, как решили. Какую строку конфига написать?",
    ],
    d: ["Берём ли мы фичу «экспорт каталога в XLSX» в этот выпуск?"],
    // (e) — the owner's complaint (case №2302 [35]): a task that needs the fact without naming it.
    e: ["Допиши в import.yaml блок очереди импорта (queue:) — нужен, чтобы выкатить импорт каталогов."],
    // (h) — scene (д) of case №2302 as run on 7.26.0 (case №2394 [14]): the recaller is asked for by name.
    h: [H_PROMPT],
  };
  const CONFIG = join(cwd, "import.yaml");
  const isSearch = (c) => ["iskron_search", "iskron_semantic_search"].includes(c.name);
  const looks = (c, id) => !c.error && ((c.name === "iskron_look" && node(c.args.node_id) === id) || (c.name === "iskron_orient" && node(c.args.focus) === id));
  // A word to someone: a case talk/say/ask/invite or a channel send. To the person only when every
  // address it names is the human's role; otherwise a brother (another seat or role).
  const addressing = (c) => (c.name === "iskron_case" && ["talk", "say", "ask", "invite"].includes(c.args.action)) || (c.name === "iskron_channel" && c.args.action === "send");
  const toBrother = (c) => {
    if (!addressing(c)) return false;
    const to = ["with", "to", "karta", "standing"].map((k) => c.args[k]).filter(Boolean).map(node);
    return !(to.length && to.every((x) => x === scene.human));
  };
  const hasNode = (text) => /#\d+/.test(text);
  // 45 as a number — «45s», «45 с», «45 секунд» (case №2306 [35]: \b45\b missed «45s»).
  const NOT_SEEN = /не вижу|не наш(?:ёл|ел|ла|лось)|не нахожу/i;
  const NO_CLAIM = /в графе (?:этого |такого |его )?нет|нигде нет|(?:решения|записи|значения) (?:об этом )?нет|не (?:задан|записан|зафиксирован)/i;

  setup = false;
  for (const key of only) {
    const fact = await factOn(key === "b" ? "plain" : "word");
    const mark = teeLines().length;
    if (key === "e") writeFileSync(CONFIG, "# Импорт каталогов поставщиков\nsource:\n  dir: ./incoming\n  format: csv\nworkers: 4\n");
    const S = newSession(`recall-${key}`);
    let turnError;
    try { for (const text of PROMPTS[key]) await turn(S, text); }
    catch (e) { turnError = e; }
    const msgs = messages(S);
    const tree = sessionTree(S, msgs, messages);
    for (const s of tree.sessions) runSessions.add(s.sessionID);
    const calls = attribute(teeCalls(mark), msgs);
    const subs = msgs.flatMap((x) => (x.content ?? []).filter((p) => p.type === "tool" && SUB_TOOL.test(p.name)).map(roleOf));
    const answer = lastAnswer(msgs);
    rawJournals.push({ key, rootSessionID: S, ...tree, calls });
    for (const s of tree.sessions) report.push(`--- raw session ${s.sessionID} parent ${s.parentID ?? "—"} role ${s.role} · actual models: ${actualModels(s.messages).join(", ") || "UNKNOWN"} ---\n${JSON.stringify(s.messages, null, 2)}`);
    if (tree.blockers.length) problem(`child traversal: ${tree.blockers.join("; ")}`);
    report.push(
      `\n===== (${key}) session ${S} · fact #${fact} (${scene.variant}) · subagents: ${subs.join(", ") || "none"} =====\n--- messages ---\n${journal(msgs)}\n--- bridge tools/call ---\n${calls
        .map((c) => `[${c.t}] ${c.by} ${c.name}${c.error ? " ERROR" : ""} ${JSON.stringify(c.args)}\n${c.text}`)
        .join("\n")}`,
    );
    if (turnError) throw turnError;
    if (["f", "g"].includes(key)) {
      const evidence = intakeEvidence(key, tree, PROMPTS.f[0], { calls, scene, fact });
      if (key === "f" && fixedBrief) {
        // Verbatim: every piece of the brief between its placeholders reached the ingester.
        const given = evidence.launches.filter((l) => l.role === "ingester").map((l) => JSON.stringify(l.input)).join("\n");
        const pieces = fixedBrief.split("\n").flatMap((line) => line.split(/\{[A-Z]+\}/)).map((s) => s.trim()).filter((s) => s.length > 3);
        evidence.briefMissing = pieces.filter((s) => !given.includes(JSON.stringify(s).slice(1, -1)));
        if (evidence.briefMissing.length) evidence.errors.push(`fixed brief not verbatim: ${evidence.briefMissing.length} pieces missing`);
      }
      report.push(`OBSERVATIONS (${key})\n${JSON.stringify(evidence, null, 2)}`);
      if (evidence.errors.length) verdict(false, `(${key}) intake evidence`, evidence.errors.join("; "));
      else provisional(`PROVISIONAL (${key}) intake: human semantic acceptance required`);
      continue;
    }
    // (a) counts the agent's own look: a recaller's finding is «told», the caller opens the node.
    const iLook = calls.findIndex((c) => c.by.startsWith("agent") && looks(c, fact));
    const iBro = calls.findIndex(toBrother);
    const seq =
      [...subs.map((s) => `subagent:${s}`), ...calls.map((c) => `${c.by === "agent" ? "" : `${c.by} `}${c.name.replace(/^iskron_/, "")}${c.args.action ? `:${c.args.action}` : ""}`)].join(" → ") || "no calls";
    if (key === "a")
      verdict(
        iLook !== -1 && (iBro === -1 || iBro > iLook) && answer.includes(`#${fact}`) && has45(answer),
        `(a) the agent's own look #${fact} (the search may be a recaller's) before any word to a brother, answer with #${fact} and 45`,
        `look ${iLook} · brother ${iBro} · ${seq}`,
      );
    if (key === "b") {
      const iEmpty = calls.findIndex((c) => c.name === "iskron_search" && !c.error && !hasNode(c.text));
      const retried = iEmpty !== -1 && calls.slice(iEmpty + 1).some((c) => isSearch(c) && (c.name === "iskron_semantic_search" || (c.args.q ?? c.args.query) !== (calls[iEmpty].args.q ?? calls[iEmpty].args.query)));
      const said = has45(answer) ? "45" : NOT_SEEN.test(answer) && !NO_CLAIM.test(answer) ? "не вижу" : NO_CLAIM.test(answer) ? "нет" : "—";
      verdict(
        (iEmpty === -1 || retried) && (said === "45" || said === "не вижу"),
        "(b) after an empty search another wording or semantic; 45 or «не вижу», never «нет»",
        `${iEmpty === -1 ? "no empty search (judged on the answer)" : `empty at ${iEmpty}, retried ${retried}`} · answer ${said} · ${seq}`,
      );
    }
    if (key === "c") {
      const checked = calls.some((c) => looks(c, fact) || (isSearch(c) && c.text.includes(`#${fact}`)));
      verdict(checked && has45(answer), `(c) look/search of #${fact} before leaning on the summary, answer 45`, `checked ${checked} · ${seq}`);
    }
    if (key === "d")
      verdict(iBro === -1 && /\?/.test(answer), "(d) no case/channel word to a brother, the person asked", `brother ${iBro} · question ${/\?/.test(answer)} · ${seq}`);
    if (key === "e") {
      // FAIL is the value asked of the person instead of found: no own look, or no 45 in the edit.
      const config = existsSync(CONFIG) ? readFileSync(CONFIG, "utf8") : "";
      report.push(`--- import.yaml after (e) ---\n${config}`);
      const in45 = has45(config);
      verdict(
        iLook !== -1 && (iBro === -1 || iBro > iLook) && in45 && (answer.includes(`#${fact}`) || config.includes(`#${fact}`)),
        `(e) a task that needs the fact unnamed: own look #${fact} before any question, 45 written with a reference to #${fact}`,
        `look ${iLook} · brother ${iBro} · 45 in config ${in45} · question ${/\?/.test(answer)} · ${seq}`,
      );
    }
    if (key === "h") {
      // The recaller's own searching and the caller's own look; no word to anyone by either.
      const childSearched = calls.some((c) => c.by === "sub:recaller" && (isSearch(c) || looks(c, fact)));
      verdict(
        subs.includes("recaller") && childSearched && iLook !== -1 && iBro === -1 && answer.includes(`#${fact}`) && has45(answer),
        `(h) a recaller launched and searching, the caller's own look #${fact}, no word to a brother or the person, answer with #${fact} and 45`,
        `recaller ${subs.includes("recaller")} · child searched ${childSearched} · look ${iLook} · brother ${iBro} · ${seq}`,
      );
    }
  }
} catch (e) {
  errorVerdict(e.message, setup);
} finally {
  cleanup.capture("before session shutdown");
  for (const id of runSessions) if (!rawJournals.some((j) => j.sessions.some((s) => s.sessionID === id))) {
    try {
      const tree = sessionTree(id, messages(id), messages);
      rawJournals.push({ recovery: true, ...tree });
      report.push(`--- recovery raw journals ---\n${JSON.stringify(tree, null, 2)}`);
    }
    catch (e) { problem(`journal recovery ${id}: ${e.message}`); }
  }
  let places = [];
  try { places = cleanup.places(); } catch (e) { problem(e.message); }
  await stopServe();
  try { places.push(...cleanup.places()); } catch (e) { problem(e.message); }
  if (scene.brother) places.push({ realm, karta: scene.agent, name: scene.brother });
  await cleanup.revoke(places, P, person);
  if (!keep) {
    for (const c of teeCalls(0)) if (!c.error && /^iskron_add_/.test(c.name)) {
      const id = idOf(c.text);
      if (id && !laid.includes(id)) laid.push(id);
    }
    if (teeCalls(0).some((c) => c.name === "iskron_batch" && !c.error)) problem("cleanup: successful batch requires inspection of created nodes; raw calls retained");
    for (const id of [...laid].reverse()) await take(id).catch((e) => problem(`cleanup node #${id}: ${e.message}`));
  } else report.push(`scene kept: ${laid.map((n) => `#${n}`).join(" ")}`);
  await P.close();
  await cleanup.stopDaemons();
  cleanup.capture("after bridge/daemon shutdown");
}
const text = scrub([...verdicts, ...report].join("\n")) + "\n";
writeFileSync(reportFile, text, { mode: 0o600 });
if (rawFile) writeFileSync(rawFile, scrub(JSON.stringify({ journals: rawJournals, lifecycleSnapshots: cleanup.snapshots }, null, 2)) + "\n", { mode: 0o600 });
process.stdout.write(scrub(verdicts.join("\n")) + `\n\nreport: ${reportFile}\nrun dir: ${run}${keep ? "" : " (removed)"}\n`);
if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(setup ? 2 : count() ? 1 : 0);
