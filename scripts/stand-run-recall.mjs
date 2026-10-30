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
//     [--report F] [--raw-json F] [--keep] [--only a,b,c,d,e,f,g]
//     [--turn-minutes 15] [--require-empty]
// (f) opt-in multi-actor intake by ingester; (g) opt-in short intake without ingester.
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
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personApi } from "./stand-person.mjs";
import { SUB_TOOL, roleOf, has45, actualModels, sessionTree, turnMinutes as parseMinutes, locationPath, secretScrubber } from "./stand-recall-evidence.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";
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
const PROBES = ["a", "b", "c", "d", "e"];
const AVAILABLE = [...PROBES, "f", "g"];
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
// OpenCode 2.2.1 reads <config>/skill (singular), not <config>/skills (case №2306).
for (const d of skillDirs) cpSync(join(skills, d), join(oc, "skill", d), { recursive: true });
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

// Model keys: export from the real home, keep key entries, import into the isolated one.
{
  const exp = spawnSync(opencode, ["auth", "export"], { encoding: "utf8" });
  const keys = JSON.parse(exp.stdout || "[]").filter((e) => [providerID, subProvider].includes(e.integrationID) && e.value?.type === "key");
  rememberSecrets(keys);
  for (const p of [providerID, ...(roles.length ? [subProvider] : [])])
    if (!keys.some((e) => e.integrationID === p)) fail(2, `no static key of ${p} in this machine's opencode auth export`);
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

// The seatless bridge of the same account: lays and takes off the scene, holds the brother seat.
function stdioBridge() {
  const dir = join(run, "auth-person");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "token"), token + "\n", { mode: 0o600 });
  const child = spawn(process.execPath, [bridge], { env: { ...env, ISKRON_BRIDGE_AUTH_DIR: dir }, stdio: ["pipe", "pipe", "ignore"] });
  let childError;
  child.on("error", (e) => { childError = e; });
  child.stdin.on("error", (e) => { childError = e; });
  const rep = new Map();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(l);
        if (msg.id !== undefined && !msg.method) rep.set(msg.id, msg);
      } catch {}
    }
  });
  let id = 1;
  const req = async (method, params) => {
    const my = id++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
    for (let t = 0; t < 900; t++) {
      if (childError || child.exitCode !== null || child.signalCode !== null) throw new Error(`scene bridge stopped: ${childError?.code ?? child.exitCode ?? child.signalCode}`);
      if (rep.has(my)) { const value = rep.get(my); rep.delete(my); return value; }
      await sleep(100);
    }
    throw new Error(`scene bridge: no reply to ${method}`);
  };
  return {
    async init() {
      await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stand-run-recall", version: "0" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    },
    async call(name, args) {
      const r = await req("tools/call", { name, arguments: args });
      return { text: (r.result?.content ?? []).map((c) => c.text ?? "").join("\n") || (r.error?.message ?? ""), error: !!(r.error || r.result?.isError) };
    },
    async close() {
      if (childError || child.exitCode !== null || child.signalCode !== null) return;
      const done = new Promise((r) => child.once("exit", r));
      child.stdin.end();
      await Promise.race([done, sleep(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([done, sleep(5000)]);
      }
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); problem("scene bridge required SIGKILL"); await Promise.race([done, sleep(5000)]); }
    },
  };
}

// The tee's journal: tools/call requests of the plugin's bridge (not the plugin's own service
// calls), each with its answer — from line `mark` on.
const teeLines = () => (existsSync(teeLog) ? readFileSync(teeLog, "utf8").split("\n").filter(Boolean) : []);
function teeCalls(mark) {
  const reqs = [];
  const answers = new Map();
  for (const l of teeLines().slice(mark)) {
    let e, m;
    try {
      e = JSON.parse(l);
      m = JSON.parse(e.line);
    } catch {
      continue;
    }
    const key = `${e.pid}:${m.id}`;
    if (e.dir === "plugin→bridge" && m.method === "tools/call" && !String(m.id).startsWith("iskron-service-"))
      reqs.push({ t: e.t, key, name: m.params?.name, args: m.params?.arguments ?? {} });
    else if (e.dir === "bridge→plugin" && m.id !== undefined && !m.method) answers.set(key, m);
  }
  return reqs.map((r) => {
    const a = answers.get(r.key);
    return { ...r, text: (a?.result?.content ?? []).map((c) => c.text ?? "").join("\n"), error: !a || !!(a.error || a.result?.isError) };
  });
}

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

const idOf = (text) => (text.match(/\(#(\d+)[,)]/) || [])[1];
const node = (v) => String(v ?? "").replace(/^#/, "").trim();
const report = [];
const rawJournals = [];
const runSessions = new Set();
const verdicts = [];
let failed = 0;
let setup = true; // until the first probe: a refusal here is the run's, exit 2
const problem = (text) => { verdicts.push(`BLOCKER ${text}`); report.push(`BLOCKER ${text}`); failed++; };
const cleanup = runCleanup({ run, auth, bridge, env, cwd, report, scrub, problem });
const verdict = (ok, what, seen) => {
  verdicts.push(`${ok ? "PASS" : "FAIL"} ${what}${seen ? ` — ${String(seen).slice(0, 300)}` : ""}`);
  if (!ok) failed++;
};

const P = stdioBridge();
const laid = []; // node ids in the order laid, taken off in reverse
const add = async (tool, args) => {
  checkInterrupted();
  const r = await P.call(tool, { realm, ...args });
  const id = idOf(r.text);
  if (r.error || !id) throw new Error(`${tool} ${args.name}: ${r.text.slice(0, 300)}`);
  laid.push(id);
  return id;
};
const take = async (id) => {
  const v = ((await P.call("iskron_look", { realm, node_id: `#${id}` })).text.match(/\(#\d+, [^,)]+, v(\d+)\)/) || [])[1];
  const r = v ? await P.call("iskron_delete_node", { realm, node_id: `#${id}`, basis_version: v, reasoning: "stand-run-recall: the scene is taken off" }) : { error: true, text: "no version" };
  if (r.error) problem(`scene: #${id} not taken off — ${r.text.slice(0, 160)}`);
  else laid.splice(laid.indexOf(id), 1);
};
const M = { epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" };
const FACT = {
  // With the question's word — (a) and (c) find it by it.
  word: {
    name: "⏱️ Таймаут очереди импорта — 45 секунд",
    description: "Таймаут очереди импорта — 45 секунд: дольше задача ждёт воркера и уходит в повтор. Решено 45 с; вариант 30 с отвергнут — крупные каталоги поставщиков не успевали.",
  },
  // Without it — (b): a search by «таймаут» comes back empty.
  plain: {
    name: "⏱️ Сколько очередь импорта ждёт воркера: 45 секунд",
    description: "Очередь импорта ждёт ответа воркера не дольше 45 секунд, затем задача уходит в повтор. Решено 45 с; вариант 30 с отвергнут — крупные каталоги поставщиков не успевали.",
  },
};
const scene = {};
const factOn = async (variant) => {
  if (scene.variant === variant) return scene.fact;
  if (scene.fact) await take(scene.fact);
  scene.fact = await add("iskron_add_phenomenon", {
    ...FACT[variant],
    given_as: "grundsatz",
    ...M,
    volitive_mode: "adhimoksha",
    arrows: [{ arrow_type: "context", target: `#${scene.foreign}`, volitive_mode: "upeksha", sense: "решение границы очередей" }],
  });
  scene.variant = variant;
  await sleep(20_000); // the search index takes the fresh node in
  return scene.fact;
};

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = new Error(`${signal}: run interrupted; cleanup requested`);
  process.stderr.write(`stand-run-recall: ${interrupted.message}\n`);
});
try {
  await P.init();
  checkInterrupted();
  if (process.argv.includes("--require-empty")) {
    const empty = await P.call("iskron_search", { realm, q: "", limit: 1 });
    report.push(`pre-fixture empty graph check: ${empty.text}`);
    if (empty.error || /#\d+/.test(empty.text)) throw new Error("--require-empty: graph is not demonstrably empty before fixture creation");
  }
  scene.agent = await add("iskron_add_karta", {
    name: "🧪 Разработчик импорта каталогов",
    motivation: "Ведёт импорт каталогов поставщиков: правит загрузку и её настройки, отвечает за то, чтобы каталоги доходили целиком.",
    manifested_as: "adhikarin",
    ...M,
  });
  scene.human = await add("iskron_add_karta", {
    name: "🧪 Владелец продукта каталогов",
    motivation: "Решает, что входит в выпуск и какие фичи берутся, отвечает за продукт каталогов перед клиентами.",
    manifested_as: "svatantra",
    ...M,
  });
  scene.steward = await add("iskron_add_karta", {
    name: "🧪 Разработчик фоновых очередей",
    motivation: "Держит фоновые очереди задач: их ожидание, повторы и пропускную способность для всех, кто ставит туда задачи.",
    manifested_as: "adhikarin",
    ...M,
  });
  const steward = (k) => [{ arrow_type: "steward", target: `#${k}`, direction: "from", volitive_mode: "upeksha", sense: "кто держит границу" }];
  scene.own = await add("iskron_add_holon", {
    name: "📦 Импорт каталогов поставщиков",
    description: "Что внутри: загрузка каталогов поставщиков и её настройки; снаружи — очереди, в которые она ставит задачи, и витрина, читающая итог.",
    ...M,
    arrows: steward(scene.agent),
  });
  scene.foreign = await add("iskron_add_holon", {
    name: "🧵 Фоновые очереди задач",
    description: "Что внутри: очереди фоновых задач, их ожидание, повторы и пропускная способность; снаружи — те, кто ставит задачи и читает итог.",
    ...M,
    arrows: steward(scene.steward),
  });
  scene.file = await add("iskron_add_phenomenon", {
    name: "📄 Файл каталога поставщика",
    description: "Файл каталога, который поставщик выкладывает на загрузку: позиции, цены, остатки.",
    given_as: "ding",
    ...M,
    arrows: [{ arrow_type: "context", target: `#${scene.own}`, volitive_mode: "upeksha", sense: "вход импорта" }],
  });
  scene.kriya = await add("iskron_add_kriya", {
    name: "📥 Загрузка каталога поставщика в очередь импорта",
    description: "Файл каталога лежит у поставщика → позиции каталога стоят задачами в очереди импорта с выставленным временем ожидания ответа воркера.",
    ...M,
    arrows: [
      { arrow_type: "ahara", target: `#${scene.file}`, volitive_mode: "upeksha", sense: "что загрузка съедает" },
      { arrow_type: "actor", target: `#${scene.agent}`, volitive_mode: "upeksha", sense: "кто загружает" },
    ],
  });
  await P.call("iskron_arrow", { realm, action: "link", source: `#${scene.own}`, target: `#${scene.kriya}`, arrow_type: "contains", volitive_mode: "upeksha", sense: "действие границы" }).then(
    (r) => r.error && report.push(`WARN scene: contains own→kriya — ${r.text.slice(0, 160)}`),
  );
  // The brother: another seat of the agent's role, held by the scene bridge.
  scene.brother = `recall-${stamp}.brother`;
  const b = await P.call("iskron_stand", { realm, karta: `#${scene.agent}`, name: scene.brother, model: "stand-run" });
  if (b.error) throw new Error(`brother seat: ${b.text.slice(0, 300)}`);

  writeFileSync(
    join(cwd, "AGENTS.md"),
    `---\n'Граф': '${realm}'\n'Граф — источник': 'согласовано: владелец'\n'Фокус-контур': '\`#${scene.own} «📦 Импорт каталогов поставщиков»\`'\n'Роль агента': '\`#${scene.agent} «🧪 Разработчик импорта каталогов»\` — adhikarin, стюард #${scene.own}'\n'Роль агента — источник': 'согласовано: владелец'\n'Роль владельца': '\`#${scene.human} «🧪 Владелец продукта каталогов»\` (svatantra)'\n---\n# Импорт каталогов поставщиков\n\nСервис загрузки каталогов поставщиков.\n\n*(iskronify: контракт 36, штамп 2026-10-29)*\n`,
  );
  report.push(`realm ${realm} · model ${model} · bridge ${bridge} · plugin ${plugin} · skills ${skills} (${skillDirs.length})`);
  report.push(`roles (.opencode/agents, ${subModel}): ${roles.map((r) => r.name).join(", ") || "none"}`);
  report.push(`scene: agent #${scene.agent} · human #${scene.human} · foreign steward #${scene.steward} · own #${scene.own} · foreign #${scene.foreign} · kriya #${scene.kriya} · brother ${scene.brother}`);

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

  const PROMPTS = {
    ...intakePrompts(scene),
    a: ["Правлю импорт, какой таймаут очереди ставить?"],
    b: ["Какой таймаут у очереди импорта?"],
    c: [
      "Сводка после сжатия контекста, продолжаем с этого места:\n- Задача: правим импорт каталогов поставщиков.\n- Решено: таймаут очереди импорта — 30 секунд (вариант 45 отвергнут как слишком долгий).\n- Дальше: выставить таймаут в конфиге импорта.\nПодтверди, что понял, и жди следующего сообщения.",
      "Ок, выставляю в конфиге импорта таймаут очереди 30 секунд, как решили. Какую строку конфига написать?",
    ],
    d: ["Берём ли мы фичу «экспорт каталога в XLSX» в этот выпуск?"],
    // (e) — the owner's complaint (case №2302 [35]): a task that needs the fact without naming it.
    e: ["Допиши в import.yaml блок очереди импорта (queue:) — нужен, чтобы выкатить импорт каталогов."],
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
      report.push(`OBSERVATIONS (${key})\n${JSON.stringify(evidence, null, 2)}`);
      if (evidence.errors.length) verdict(false, `(${key}) intake evidence`, evidence.errors.join("; "));
      else { verdicts.push(`PROVISIONAL (${key}) intake: human semantic acceptance required`); failed++; }
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
  }
} catch (e) {
  verdicts.push(`ERROR${setup ? " (setup)" : ""} ${e.message}`);
  failed++;
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
process.exit(setup ? 2 : failed ? 1 : 0);
