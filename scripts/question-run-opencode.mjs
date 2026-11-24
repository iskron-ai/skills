#!/usr/bin/env node
// Real OpenCode, scripted provider and loopback NKS; never contacts a model or a graph.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { BUILT_BRIDGE, BUILT_PLUGIN } from "../js/tests/built.mjs";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { sse } from "./rootseat-realign-run.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2), outArg = args.shift();
const scopeIndex = args.indexOf("--scope"), scope = scopeIndex < 0 ? "own" : args[scopeIndex + 1];
if (!outArg || outArg.startsWith("--") || !["own", "none", "foreign"].includes(scope)) {
  console.error("usage: question-run-opencode.mjs <fresh-out-dir> [--scope own|none|foreign] [--negative] [--keep]");
  process.exit(2);
}
const out = resolve(outArg), negative = args.includes("--negative"), keep = args.includes("--keep");
if (existsSync(out)) { console.error(`output already exists: ${out}`); process.exit(2); }
mkdirSync(out, { recursive: true });
const run = mkdtempSync(join(tmpdir(), "question-serve-")), home = join(run, "home"), cwd = join(run, "project");
const auth = join(run, "auth"), config = join(home, ".config/opencode"), wire = [];
const save = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + "\n");
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
let fake, llm, serve, events, prepared = false, failed = false;
const verdict = (ok, message) => { console.log(`${ok ? "PASS" : "FAIL"} ${message}`); if (!ok) failed = true; };
try {
  for (const d of [cwd, auth, join(config, "plugins"), join(home, "tmp")]) mkdirSync(d, { recursive: true });
  await exec("git", ["init", "-q", cwd]);
  if (scope === "own") writeFileSync(join(cwd, "AGENTS.md"), "---\niskron:\n  graph: r5\n  agent_role: 931\n---\n# Probe\n");
  if (scope === "foreign") writeFileSync(join(cwd, "AGENTS.md"), "---\nother:\n  graph: r5\n---\n# Foreign instructions\n");
  const file = join(cwd, "probe.txt");
  writeFileSync(file, "QUESTION_READ_PROBE_9f31\n");
  fake = await startFakeNks({ pat: PAT });
  await fake.control({ richTools: true, structured: true });
  let primary = 0;
  llm = createServer(async (req, res) => {
    try {
      let data = ""; for await (const chunk of req) data += chunk;
      const body = JSON.parse(data), n = body.tools?.length ? ++primary : 0;
      wire.push({ n, body }); writeFileSync(join(out, "wire.jsonl"), JSON.stringify({ n, body }) + "\n", { flag: "a" });
      const tool = n === 1 ? { name: "question", args: { questions: [{ question: "Which colour?", header: "Colour", options: [{ label: "Blue", description: "Choose blue" }, { label: "Red", description: "Choose red" }] }] } }
        : n === 2 ? { name: "read", args: { path: file } } : null;
      res.writeHead(200, { "Content-Type": "text/event-stream" }); res.end(sse(tool ? { tool } : {}).replaceAll("call_realign_1", `call_probe_${n}`));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise((r) => llm.listen(0, "127.0.0.1", r));
  let plugin = process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN;
  if (negative && !process.env.ISKRON_OPENCODE_PLUGIN) {
    plugin = join(run, "old-plugin.js");
    const { build } = await import("../js/node_modules/esbuild/lib/main.js");
    await build({ entryPoints: ["js/opencode/plugin.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outfile: plugin, plugins: [{ name: "without-question-guard", setup(b) { b.onLoad({ filter: /opencode\/questions\.ts$/ }, () => ({ contents: "export async function setupQuestionGuard() {}", loader: "ts" })); } }] });
  }
  copyFileSync(plugin, join(config, "plugins/iskron.js"));
  writeFileSync(join(config, "plugins/observer.js"), `import {appendFileSync} from 'node:fs'; export default {id:'probe-observer',async setup(ctx){await ctx.permission.hook('evaluate',e=>appendFileSync(${JSON.stringify(join(out, "permission-hook.jsonl"))},JSON.stringify({location:ctx.location,event:e})+'\\n'));}};`);
  const settings = join(config, "opencode.json");
  const projectSettings = join(cwd, "opencode.json");
  writeFileSync(projectSettings, JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "allow" }] }));
  writeFileSync(settings, JSON.stringify({ model: "scripted/probe", snapshots: false, update: "disable", policies: [{ action: "provider.use", resource: "*", effect: "deny" }, { action: "provider.use", resource: "scripted", effect: "allow" }], providers: { scripted: { name: "Loopback", env: ["SCRIPTED_API_KEY"], package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: `http://127.0.0.1:${llm.address().port}/v1` }, models: { probe: { name: "Probe", limit: { context: 200000, output: 4096 }, capabilities: { tools: true } } } } } }));
  const opencode = (await exec("which", ["opencode"])).stdout.trim();
  const env = { PATH: `${dirname(opencode)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: join(home, "tmp"), LANG: "en_US.UTF-8", XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"), OPENCODE_CONFIG_DIR: config, SCRIPTED_API_KEY: "probe", ISKRON_BRIDGE_PATH: process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE, ISKRON_BRIDGE_AUTH_DIR: auth, ISKRON_BRIDGE_URL: fake.mcpUrl, ISKRON_BRIDGE_TOKEN: PAT, ISKRON_BRIDGE_DAEMON: "0", ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_ROOT_SEAT: "0" };
  const port = 40000 + Math.floor(Math.random() * 20000), server = `http://127.0.0.1:${port}`;
  const api = async (method, path, body) => { const a = ["api", "--server", server, method, path]; if (body) a.push("-d", JSON.stringify(body)); const text = (await exec(opencode, a, { cwd, env, timeout: 20000 })).stdout; const result = text.trim() ? JSON.parse(text) : null; if (result?._tag) throw Error(text); return result?.data ?? result; };
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "warn"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; serve.stdout.on("data", (d) => { stdout += d; const m = stdout.match(/server password (\S+)/); if (m) env.OPENCODE_PASSWORD = m[1]; });
  serve.stderr.on("data", (d) => writeFileSync(join(out, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120 && !(stdout.includes(`server listening on ${server}`) && env.OPENCODE_PASSWORD); i++) await sleep(250);
  assert.ok(env.OPENCODE_PASSWORD && stdout.includes(`server listening on ${server}`), "serve did not start");
  const headers = { authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString("base64")}` };
  assert.equal((await fetch(`${server}/api/session/active`)).status, 401);
  const listener = (await exec("lsof", ["-nP", "-t", `-iTCP@127.0.0.1:${port}`, "-sTCP:LISTEN"])).stdout.trim();
  assert.equal(listener, String(serve.pid));
  events = new AbortController();
  const stream = await fetch(`${server}/api/event`, { headers, signal: events.signal });
  assert.equal(stream.status, 200, "event stream unavailable");
  void (async () => { try { for await (const d of stream.body) writeFileSync(join(out, "events.sse"), d, { flag: "a" }); } catch {} })();
  const session = await api("POST", "/api/session", { title: "Question probe", location: { directory: cwd }, model: { providerID: "scripted", id: "probe" } });
  save("config.json", await api("GET", "/api/config"));
  save("agents.json", await api("GET", "/api/agent"));
  save("carrier.json", { scope, negative, plugin, pluginSha256: hash(plugin), settingsSha256: hash(settings), projectSettingsSha256: hash(projectSettings), coverSha256: scope === "none" ? null : hash(join(cwd, "AGENTS.md")), bridgeSha256: hash(env.ISKRON_BRIDGE_PATH), version: (await exec(opencode, ["--version"], { env })).stdout.trim(), session: session.id });
  await api("POST", `/api/session/${session.id}/prompt`, { text: "Execute the scripted probe.", resume: true });
  for (let i = 0; i < 160 && primary < (scope === "own" ? 3 : 1); i++) await sleep(250);
  await sleep(1000);
  const forms = await api("GET", `/api/session/${session.id}/form`);
  const history = await api("GET", `/api/session/${session.id}/context`);
  save("forms.json", forms); save("history.json", history);
  const message = history.find((m) => m.content?.some((p) => p.id === "call_probe_1"));
  assert.ok(message, "question call missing from history");
  const permission = await api("POST", `/api/session/${session.id}/permission`, { action: "question", resources: ["*"], agent: "build", source: { type: "tool", messageID: message.id, id: "call_probe_1" } });
  save("permission.json", permission);
  const first = wire.find((w) => w.n === 1); assert.ok(first, "no provider request");
  prepared = true;
  const names = first.body.tools.map((t) => t.function?.name ?? t.name); save("catalog.json", first.body.tools);
  verdict(names.includes("question") === (scope !== "own"), `question ${scope === "own" ? "absent from" : "present in"} provider catalog`);
  verdict(permission.effect === (scope === "own" ? "deny" : "allow"), `POST session permission: ${permission.effect}`);
  if (scope === "own") {
    const messages = wire.flatMap((w) => w.body.messages ?? []);
    const result = messages.filter((m) => m.role === "tool"); save("tool-results.json", result);
    const question = message.content.find((p) => p.id === "call_probe_1");
    verdict(question?.state?.status === "error" && /denied|not found|no tool named|unavailable/i.test(JSON.stringify(question.state.error)), "question returned unavailable or denied");
    const eventText = existsSync(join(out, "events.sse")) ? readFileSync(join(out, "events.sse"), "utf8") : "";
    verdict(Array.isArray(forms) && forms.length === 0 && !eventText.includes('"type":"form.created"'), "GET session/form and event stream: no forms");
    const read = history.flatMap((m) => m.content ?? []).find((p) => p.id === "call_probe_2");
    verdict(read?.state?.status === "completed" && result.some((m) => m.tool_call_id === "call_probe_2" && JSON.stringify(m).includes("QUESTION_READ_PROBE_9f31")), "read returned the file marker");
  }
} catch (e) { console.error(e.stack); writeFileSync(join(out, "failure.txt"), e.stack + "\n"); process.exitCode = prepared ? 1 : 2; }
finally {
  events?.abort();
  if (serve && serve.exitCode === null) { const end = new Promise((r) => serve.once("exit", r)); serve.kill("SIGTERM"); await Promise.race([end, sleep(5000)]); if (serve.exitCode === null) serve.kill("SIGKILL"); }
  if (fake) await fake.stop();
  if (llm) { llm.closeAllConnections(); await new Promise((r) => llm.close(r)); }
  if (keep) console.log(`run kept: ${run}`); else rmSync(run, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  if (failed && !process.exitCode) process.exitCode = 1;
}
