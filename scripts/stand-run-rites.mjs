// A live run of the delivery's session rituals in OpenCode (graph @nks/nks-dev, node #9319,
// section RITUALS; cover — #9316) and of prepare's holon and role derived from the graph by
// origin (#9325, item 2) against a PAT carrier. Real `opencode serve` in an isolated HOME/XDG,
// plugin and bridge of the branch (dist/dev), a scripted loopback provider instead of a model:
// each prompt names its step, the provider answers it with one tool call, then text.
//
//   node scripts/stand-run-rites.mjs --token-file F --url U --api A --realm @owner/slug
//     [--ledger-log F] [--bridge B] [--plugin P] [--report F] [--rituals "start push"]
//
// --rituals — the covers of A and B carry this `rituals:` field (#9341): a ritual left out of it
// keeps silent — no start word, no push or merge line, the guard lets the write pass.
//
// Scene: an agent role, stewarding a holon whose attribute repository names the prepare
// project's origin; taken off at the end. Projects: (A) a git repository with an `iskron:` cover
// and a bare remote, no rituals of its own — the start word in the first request, a push line
// after `git push` (none on a refused push), a merge line after `gh pr merge` (a stand-in gh on
// PATH printing the forge's outcome) and after `git checkout main && git pull`, the memory guard
// refuses a write into ~/.claude/projects/…/memory/, an ordinary file passes; (B) the same with
// its own `.opencode/plugins/iskron-rituals.js` — the delivery keeps silent, the own plugin's
// word comes once; (C) a clean repository with origin = the scene's repository — `prepare --json`
// without --holon/--agent-role writes both into the cover (derived). --ledger-log (the
// stand-mcp-ledger.mjs journal behind --url): every initialize 200 of the run is closed by a
// DELETE 200, the prepare's session included. Exit 0 — passed, 1 — failed, 2 — setup failed.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { PREPARE, RITES } from "../js/delivery/index.ts";
import { BUILT_BRIDGE, BUILT_PLUGIN } from "../js/tests/built.mjs";
import { runCleanup } from "./stand-recall-cleanup.mjs";
import { secretScrubber } from "./stand-recall-evidence.mjs";
import { idOf, makeReporters, sceneTaker, stdioBridge } from "./stand-recall-scene.mjs";
import { personApi } from "./stand-person.mjs";

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const fail = (code, t) => (process.stderr.write(`stand-run-rites: ${t}\n`), process.exit(code));
const tokenFile = arg("--token-file");
const URL_ = arg("--url");
const apiArg = arg("--api");
const realm = arg("--realm");
const ledgerLog = arg("--ledger-log");
const ritesField = arg("--rituals");
const on = (r) => ritesField === undefined || ritesField.split(/\s+/).includes(r);
if (!tokenFile || !URL_ || !apiArg || !realm) fail(2, "--token-file, --url, --api and --realm are required");
const bridge = resolve(arg("--bridge", BUILT_BRIDGE));
const plugin = resolve(arg("--plugin", BUILT_PLUGIN));
for (const p of [bridge, plugin, tokenFile]) if (!existsSync(p)) fail(2, `${p} does not exist`);
if ((statSync(tokenFile).mode & 0o077) !== 0) fail(2, `${tokenFile} is readable by others`);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
const reportFile = resolve(arg("--report", `stand-run-rites-${stamp}.txt`));
const token = readFileSync(tokenFile, "utf8").trim();
const { secrets, scrub } = secretScrubber(token);
const opencode = spawnSync("sh", ["-c", "command -v opencode"]).stdout.toString().trim();
if (!opencode) fail(2, "no opencode on PATH");
const startedAt = new Date().toISOString();

const run = mkdtempSync(join(tmpdir(), "stand-rites-"));
const home = join(run, "home");
const auth = join(run, "auth");
const oc = join(home, ".config/opencode");
const bin = join(run, "bin");
const proj = { A: join(run, "rites-a"), B: join(run, "rites-b"), C: join(run, "prepare-c") };
process.on("exit", () => rmSync(run, { recursive: true, force: true }));
for (const d of [join(oc, "plugins"), join(home, ".local/share"), join(home, ".local/state"), join(home, ".cache"), join(home, "tmp"), bin, ...Object.values(proj)])
  mkdirSync(d, { recursive: true });
mkdirSync(auth, { recursive: true, mode: 0o700 });
writeFileSync(join(auth, "token"), token + "\n", { mode: 0o600 });
cpSync(plugin, join(oc, "plugins/iskron.js"));
// The forge's merge stands in: gh prints what a squash merge prints; the judgment is by outcome.
writeFileSync(join(bin, "gh"), "#!/bin/sh\necho '✓ Squashed and merged pull request stand-rites/probe#1 (feat: probe)'\n");
chmodSync(join(bin, "gh"), 0o755);
const memoryFile = join(home, ".claude/projects/-probe/memory/note.md");

const env = {
  PATH: `${bin}:${dirname(opencode)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
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
  ISKRON_ROOT_SEAT: "0",
};
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.slice(0, 300)}`);
  return r.stdout.trim();
};
const cover = (graph, holon, role) => `---\niskron:\n  graph: ${graph}\n  holon: ${holon}\n  agent_role: ${role}\n  contract: 38\n  stamp: 2026-11-03\n${ritesField === undefined ? "" : `  rituals: ${ritesField}\n`}---\n# Пробный проект ритуалов\n`;
/** A repository with the cover, main pushed to a bare remote and feat/x one commit ahead. */
function rituals(dir, text, own) {
  const remote = `${dir}.remote.git`;
  git(run, "init", "-q", "--bare", "-b", "main", remote);
  git(run, "init", "-q", "-b", "main", dir);
  writeFileSync(join(dir, "AGENTS.md"), text);
  if (own) {
    mkdirSync(join(dir, ".opencode/plugins"), { recursive: true });
    writeFileSync(join(dir, ".opencode/plugins/iskron-rituals.js"), OWN_PLUGIN);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "remote", "add", "origin", remote);
  git(dir, "push", "-q", "-u", "origin", "main");
  git(dir, "checkout", "-q", "-b", "feat/x");
  writeFileSync(join(dir, "x.txt"), "x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "feat: x");
}
const OWN_WORD = "OWN_RITUALS_START_WORD";
const OWN_PLUGIN = `export default {\n  id: "probe-own-rituals",\n  async setup(ctx) {\n    const said = (globalThis.__probeOwnSaid ??= new Set());\n    await ctx.session.hook("prompt", async (p) => {\n      if (said.has(p.sessionID)) return;\n      said.add(p.sessionID);\n      p.prompt.text += "\\n\\n${OWN_WORD}";\n    });\n  },\n};\n`;

// ── The scripted provider: the step named in the last user message gets one tool call ────────
const wire = [];
const steps = {};
let callN = 0;
const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join("\n"));
function reply(body) {
  const msgs = body.messages ?? [];
  const u = msgs.map((m) => m.role).lastIndexOf("user");
  const step = textOf(msgs[u]).match(/RITES_STEP=(\w+)/)?.[1];
  const s = steps[step];
  if (!body.tools?.length || !(s?.write || s?.shell) || msgs.slice(u + 1).some((m) => m.role === "tool")) return null;
  const names = body.tools.map((t) => t.function?.name ?? t.name);
  const name = s.write ? "write" : ["shell", "bash"].find((n) => names.includes(n));
  if (!name || !names.includes(name)) throw new Error(`no ${s.write ? "write" : "shell"} tool among ${names.join(", ")}`);
  const schema = body.tools.find((t) => (t.function?.name ?? t.name) === name);
  const props = Object.keys((schema.function ?? schema).parameters?.properties ?? {});
  const args = s.write
    ? { [props.find((p) => /path/i.test(p)) ?? "filePath"]: s.write, content: "probe note\n" }
    : {
        command: props.includes("workdir") ? s.shell : `cd '${s.dir}' && ${s.shell}`,
        ...(props.includes("workdir") ? { workdir: s.dir } : {}),
        ...(props.includes("description") ? { description: `probe ${step}` } : {}),
      };
  s.id = `call_rites_${step}_${++callN}`;
  s.tool = name;
  return { id: s.id, name, args };
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
      : [chunk({ role: "assistant", content: "OK" }), chunk({}, "stop")];
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
async function turn(id, text) {
  const r = api("POST", `/api/session/${id}/prompt`, { text, resume: true });
  if (!r.ok) throw new Error(`prompt ${id}: ${r.raw.slice(0, 300)}`);
  for (let t = 0; t < 30 && !active().includes(id); t++) await sleep(500);
  for (let t = 0; t < 240 && active().includes(id); t++) await sleep(500);
  if (active().includes(id)) throw new Error(`session ${id}: the turn did not end in 2 min`);
}
function session(dir, title) {
  const r = api("POST", "/api/session", { title, location: { directory: dir }, model: { providerID: "scripted", id: "probe" } });
  if (!r.data?.id) throw new Error(`session create: ${r.raw.slice(0, 300)}`);
  return r.data.id;
}
const primaries = () => wire.filter((b) => b.tools?.length);
const users = (b) => (b.messages ?? []).filter((m) => m.role === "user").map(textOf).join("\n");
/** What the model saw of a step's tool call: the tool message in the next request. */
const resultOf = (step) => {
  const id = steps[step]?.id;
  for (const b of primaries()) {
    const m = (b.messages ?? []).find((x) => x.role === "tool" && x.tool_call_id === id);
    if (m) return textOf(m);
  }
  return null;
};
const count = (text, word) => (text ?? "").split(word).length - 1;
const either = (text, f) => count(text, f("ru")) + count(text, f("en"));

const { verdicts, report, problem, verdict, error: errorVerdict, count: failures } = makeReporters();
const P = stdioBridge({ run, bridge, env, token, name: "stand-run-rites", problem });
const cleanup = runCleanup({ run, auth, bridge, env, cwd: run, report, scrub, problem });
const person = personApi({ api: apiArg, token });
const laid = [];
const take = sceneTaker(P, { realm, problem, laid });
let setup = true;
try {
  await P.init();
  const realms = (await P.call("iskron_realm", { action: "list" })).text;
  const slug = realm.replace(/^@/, "");
  const line = realms.split("\n").find((l) => l.includes(slug)) ?? "";
  const graph = line.match(/\br(\d+)\b/)?.[0];
  if (!graph) throw new Error(`no rN of ${realm} in the realm list: ${line.slice(0, 200) || realms.slice(0, 300)}`);
  const repository = `github.com/stand-rites/probe-${stamp}-${Math.random().toString(16).slice(2, 8)}`;
  const M = { epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" };
  const add = async (tool, args) => {
    const r = await P.call(tool, { realm, ...args });
    const id = idOf(r.text);
    if (r.error || !id) throw new Error(`${tool} ${args.name}: ${r.text.slice(0, 300)}`);
    laid.push(id);
    return id;
  };
  const role = await add("iskron_add_karta", { name: "🧪 Агент пробного репозитория ритуалов", motivation: "Ведёт пробный репозиторий прогона ритуалов: правит его и держит его контур.", manifested_as: "adhikarin", ...M });
  const holon = await add("iskron_add_holon", { name: "🧪 Пробный репозиторий ритуалов", description: "Что внутри: пробный репозиторий прогона ритуалов поставки и prepare.", attrs: { repository }, ...M, arrows: [{ arrow_type: "steward", target: `#${role}`, direction: "from", volitive_mode: "upeksha", sense: "кто держит границу" }] });
  report.push(`graph ${realm} = ${graph} · scene: role #${role} stewards holon #${holon} (repository ${repository})`);
  rituals(proj.A, cover(graph, holon, role), false);
  rituals(proj.B, cover(graph, holon, role), true);
  git(run, "init", "-q", "-b", "main", proj.C);
  git(proj.C, "remote", "add", "origin", `https://${repository}.git`);
  await sleep(20_000); // the search index takes the fresh nodes in

  // ── (2) prepare derives the holon and the role from the graph by origin ────────────────────
  const ledgerAt = ledgerLog && existsSync(ledgerLog) ? readFileSync(ledgerLog, "utf8").split("\n").filter(Boolean).length : 0;
  const prep = spawnSync(process.execPath, [bridge, "prepare", "--json", "--dir", proj.C, "--graph", graph], { env, cwd: proj.C, encoding: "utf8", timeout: 60_000 });
  let out = {};
  try { out = JSON.parse(prep.stdout); } catch {}
  const coverC = existsSync(join(proj.C, "AGENTS.md")) ? readFileSync(join(proj.C, "AGENTS.md"), "utf8") : "";
  report.push(`--- prepare (exit ${prep.status}) ---\n${prep.stdout}\n${prep.stderr}\n--- AGENTS.md of C ---\n${coverC}`);
  verdict(
    out.derived?.holon === holon && out.derived?.agent_role === role && new RegExp(`^  holon: ${holon}$`, "m").test(coverC) && new RegExp(`^  agent_role: ${role}$`, "m").test(coverC),
    `(2) prepare --json without --holon/--agent-role: derived holon #${holon}, role #${role}, both in the cover`,
    `exit ${prep.status} · derived ${JSON.stringify(out.derived ?? null)} · repository ${out.repository}`,
  );
  if (ledgerLog) {
    const own = readFileSync(ledgerLog, "utf8").split("\n").filter(Boolean).slice(ledgerAt).map((l) => JSON.parse(l));
    const opened = own.filter((e) => e.kind === "initialize" && e.status === 200).map((e) => e.session_id);
    const closed = own.filter((e) => e.kind === "delete" && e.status === 200).map((e) => e.session_id);
    verdict(opened.length >= 1 && opened.every((s) => closed.includes(s)), "(2) the ledger sees prepare's session opened and closed by DELETE 200", `initialize ${opened.length} · delete ${closed.length}`);
  }

  // ── (1) the rituals in OpenCode ─────────────────────────────────────────────────────────────
  Object.assign(steps, {
    a_start: {},
    a_push: { dir: proj.A, shell: "git push -u origin feat/x" },
    a_refused: { dir: proj.A, shell: "git push nowhere feat/x" },
    a_gh: { dir: proj.A, shell: "gh pr merge 1 --squash" },
    a_pull: { dir: proj.A, shell: "git checkout main && git pull" },
    a_guard: { write: memoryFile },
    a_file: { write: join(proj.A, "notes.md") },
    b_start: {},
    b_push: { dir: proj.B, shell: "git push -u origin feat/x" },
    b_guard: { write: memoryFile },
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
  setup = false;

  const A = session(proj.A, "rites A");
  await turn(A, "RITES_STEP=a_start: reply OK.");
  const firstA = primaries().find((b) => users(b).includes("RITES_STEP=a_start"));
  const starts = (b) => either(users(b), (l) => PREPARE[l].start({ graph, holon, role }));
  const field = ritesField === undefined ? "" : ` (cover rituals: ${ritesField})`;
  const one = (r) => (on(r) ? 1 : 0);
  verdict(firstA && starts(firstA) === one("start"), `(1a) the start word with ${graph}, #${holon}, #${role} ${on("start") ? "once" : "none"} in the root's first request${field}`, `start words ${firstA ? starts(firstA) : "no request"}`);
  for (const s of ["a_push", "a_refused", "a_gh", "a_pull", "a_guard", "a_file"]) await turn(A, `RITES_STEP=${s}: run the step.`);
  const lastA = primaries().filter((b) => users(b).includes("RITES_STEP=a_file")).at(-1);
  verdict(lastA && starts(lastA) === one("start"), "(1a) no second start word on the root's later prompts", `start words in the last request ${lastA ? starts(lastA) : "—"}`);
  const push = (l) => RITES[l].push();
  const merge = (l) => RITES[l].merge(holon);
  const r = Object.fromEntries(Object.keys(steps).map((s) => [s, resultOf(s)]));
  verdict(r.a_push !== null && either(r.a_push, push) === one("push"), `(1b) after git push — ${on("push") ? "one push line" : "no push line"} in the result${field}`, `push lines ${either(r.a_push, push)}`);
  verdict(r.a_refused !== null && either(r.a_refused, push) === 0, "(1b) a refused push — no push line", `push lines ${either(r.a_refused, push)}`);
  verdict(r.a_gh !== null && either(r.a_gh, merge) === one("merge"), `(1c) after gh pr merge — ${on("merge") ? "one merge line naming the holon" : "no merge line"}${field}`, `merge lines ${either(r.a_gh, merge)}`);
  verdict(r.a_pull !== null && either(r.a_pull, merge) === one("merge"), `(1c) after git checkout main && git pull — ${on("merge") ? "one merge line" : "no merge line"}${field}`, `merge lines ${either(r.a_pull, merge)}`);
  const guarded = either(r.a_guard, (l) => PREPARE[l].guard(graph));
  verdict(on("guard") ? guarded === 1 && !existsSync(memoryFile) : r.a_guard !== null && guarded === 0 && existsSync(memoryFile), `(1d) a write into ~/.claude/projects/…/memory — ${on("guard") ? "refused by the guard, nothing written" : "the guard keeps silent, the write passes"}${field}`, `guard ${guarded} · file ${existsSync(memoryFile)}`);
  verdict(existsSync(join(proj.A, "notes.md")) && !/BLOCKED/.test(r.a_file ?? ""), "(1d) an ordinary file of the repository passes");
  rmSync(memoryFile, { force: true }); // B judges its own write

  const B = session(proj.B, "rites B");
  await turn(B, "RITES_STEP=b_start: reply OK.");
  for (const s of ["b_push", "b_guard"]) await turn(B, `RITES_STEP=${s}: run the step.`);
  const firstB = primaries().find((b) => users(b).includes("RITES_STEP=b_start"));
  verdict(firstB && count(users(firstB), OWN_WORD) === 1 && starts(firstB) === 0, "(1e) own .opencode/plugins/iskron-rituals.js: its word once, the delivery's start word none", `own ${firstB ? count(users(firstB), OWN_WORD) : "—"} · delivery ${firstB ? starts(firstB) : "—"}`);
  verdict(resultOf("b_push") !== null && either(resultOf("b_push"), push) === 0, "(1e) beside its own plugin — no push line after git push", `push lines ${either(resultOf("b_push"), push)}`);
  verdict(existsSync(memoryFile) && !/BLOCKED/.test(resultOf("b_guard") ?? ""), "(1e) beside its own plugin — the delivery's guard keeps silent (the write passes)", `file ${existsSync(memoryFile)}`);
  report.push(`--- tool results the model saw ---\n${Object.keys(steps).map((s) => `[${s} ${steps[s].tool ?? ""}] ${resultOf(s) ?? "—"}`).join("\n")}`);
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
