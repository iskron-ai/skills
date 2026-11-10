#!/usr/bin/env node
// Real OpenCode serve, built plugin + bridges, loopback MCP and scripted provider only (rootseat-run-opencode.mjs).
// Falsifies: auto-compaction → the role word in the system of the FIRST continued provider request,
// not in the compaction request, in one request only, no extra model step; exit 1 otherwise.
// node scripts/compaction-run-opencode.mjs <fresh-out-dir> [--negative] [--pending-command] [--keep]
// --negative: a plugin without the role return (ISKRON_OPENCODE_PLUGIN=<old plugin>) — expect no word.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { BUILT_BRIDGE, BUILT_PLUGIN } from "../js/tests/built.mjs";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { COVER, heardSeats, writeAgents } from "../js/tests/rootseat-kit.mjs";
import { OPENCODE } from "../js/delivery/index.ts";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2];
assert.ok(out && !out.startsWith("--"), "usage: compaction-run-opencode.mjs <out-dir> [--negative]");
const negative = process.argv.includes("--negative");
// --pending-command: queue a real delivery /skill behind the held first HTTP;
// its near-limit usage forces real auto-compaction before the command's HTTP.
// In this mode --negative labels the control but does not alter its assertions or exit:
// a good plugin exits 0 as UNEXPECTED_PASS; inspect the exact failure of a bad one.
const pendingCommand = process.argv.includes("--pending-command");
const keep = process.argv.includes("--keep");
const commandName = "compaction-probe";
const commandInput = "  COMPACT_COMMAND_ARGUMENTS 🙂\r\n  ";
mkdirSync(out, { recursive: true });
assert.ok(!existsSync(join(out, "wire.jsonl")), "use a fresh output directory (never mix runs)");
const run = mkdtempSync(join(tmpdir(), "compaction-serve-"));
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const config = join(home, ".config/opencode");
const CONTEXT = Number(process.env.PROBE_CONTEXT || 60000);
const fake = await startFakeNks({ pat: PAT });
// A confirmed empty personal graph (#9817): this probe observes the successful return path.
// Unknown readiness is a read failure, covered by opencode-compaction-read.mjs.
await fake.control({ richTools: true, structured: true, connect_delay_ms: 700, mind: { rules: [] } });
const wire = [];
let primaries = 0;
let release;
const gate = new Promise((r) => { release = r; });
const isCompaction = (body) => JSON.stringify(body.messages ?? []).includes("<template>");
const llm = createServer(async (req, res) => {
  try {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    const compaction = isCompaction(body);
    const n = compaction ? null : ++primaries;
    // The first primary reply reports usage near the model's context: the next step must compact.
    const prompt_tokens = n === 1 ? CONTEXT - 100 : 1000;
    const kind = compaction ? "compaction" : `primary-${n}`;
    const observation = { i: wire.length + 1, kind, at: new Date().toISOString(), path: req.url, seats: heardSeats(fake), usageReplied: prompt_tokens, body };
    wire.push(observation);
    writeFileSync(join(out, "wire.jsonl"), JSON.stringify(observation) + "\n", { flag: "a" });
    if (pendingCommand && n === 1) await gate;
    const text = compaction
      ? "## Objective\n- Probe compaction.\n## Requirements\n- (none)\n## Decisions\n- (none)\n## Work State\n### Completed\n- (none)\n### Active\n- probe\n### Blocked\n- (none)\n## Next Move\n1. (none)\n## Relevant Files\n- (none)\n## Important Context\n- (none)"
      : "OK";
    const chunk = (delta, finish_reason = null, usage) => ({
      id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe",
      choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
    });
    const usage = { prompt_tokens, completion_tokens: 2, total_tokens: prompt_tokens + 2 };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(chunk({ role: "assistant", content: text }))}\n\ndata: ${JSON.stringify(chunk({}, "stop", usage))}\n\ndata: [DONE]\n\n`);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => llm.listen(0, "127.0.0.1", r));
for (const dir of [cwd, auth, join(config, "plugins"), join(home, "tmp")]) mkdirSync(dir, { recursive: true });
writeAgents(cwd, COVER);
const plugin = process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN;
copyFileSync(plugin, join(config, "plugins/iskron.js"));
if (pendingCommand) {
  const skills = join(cwd, ".opencode/skills");
  for (const name of ["establish-mcp/scripts", commandName]) mkdirSync(join(skills, name), { recursive: true });
  writeFileSync(join(skills, "establish-mcp/SKILL.md"), '---\nname: establish-mcp\ndescription: Local marker\n---\nMarker only.\n');
  writeFileSync(join(skills, "establish-mcp/scripts/iskron.mjs"), "// marker, never executed\n");
  writeFileSync(join(skills, commandName, "SKILL.md"), `---\nname: ${commandName}\nslash: true\ndescription: Local compaction probe\n---\nProbe only.\n`);
  // Observe only: never synthesize or modify a context-hook result.
  writeFileSync(join(config, "plugins/observer.js"), `import {appendFileSync} from 'node:fs';
export default {id:'compaction-observer',async setup(ctx){
 const log=(kind,e)=>appendFileSync(${JSON.stringify(join(out, "hooks.jsonl"))},JSON.stringify({kind,...e})+'\\n');
 await ctx.session.hook('prompt',e=>log('prompt',e));
 await ctx.session.hook('context',e=>log('context',{sessionID:e.sessionID,system:e.system,messages:e.messages}));
}};`);
}
writeFileSync(join(config, "opencode.json"), JSON.stringify({
  model: "scripted/probe", snapshots: false, update: "disable",
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "scripted", effect: "allow" },
  ],
  providers: { scripted: {
    name: "Loopback script (no model)", env: ["SCRIPTED_API_KEY"],
    package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: `http://127.0.0.1:${llm.address().port}/v1` },
    models: { probe: { name: "Probe", limit: { context: CONTEXT, output: 4096 }, capabilities: { tools: true } } },
  } },
}));
const { stdout: bin } = await exec("which", ["opencode"]);
const opencode = bin.trim();
const env = {
  PATH: `${dirname(opencode)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: home, TMPDIR: join(home, "tmp"), LANG: "en_US.UTF-8",
  XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_CONFIG_DIR: config, SCRIPTED_API_KEY: "probe-not-a-key",
  ISKRON_BRIDGE_PATH: process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE,
  ISKRON_BRIDGE_AUTH_DIR: auth, ISKRON_BRIDGE_URL: fake.mcpUrl,
  ISKRON_BRIDGE_TOKEN: PAT, ISKRON_BRIDGE_DAEMON: "0",
  ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_NO_BROWSER: "1",
  ISKRON_ROOT_SEAT: "1",
  ISKRON_BRIDGE_LANG: "ru",
};
const serverPort = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${serverPort}`;
let serve, events;
async function api(method, path, body) {
  const args = ["api", "--server", server, method, path];
  if (body) args.push("-d", JSON.stringify(body));
  const r = await exec(opencode, args, { cwd, env, timeout: 20000 });
  const data = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  if (data?._tag) throw new Error(r.stdout);
  return data?.data ?? data;
}
const eventsFile = join(out, "events.ndjson");
const primary = (pred) => wire.find((w) => w.kind.startsWith("primary") && pred(w));
function saveDigests() {
  const files = ["wire.jsonl", "history.json", "events.ndjson", "hooks.jsonl", "summary.json", "command-results.json"];
  writeFileSync(join(out, "digests.json"), JSON.stringify(Object.fromEntries(files.flatMap((file) => {
    try { return [[file, createHash("sha256").update(readFileSync(join(out, file))).digest("hex")]]; }
    catch (e) { if (e.code === "ENOENT") return []; throw e; }
  })), null, 2) + "\n");
}
async function until(pred, what, ms = 40000) {
  for (let t = 0; t < ms && !pred(); t += 250) await sleep(250);
  assert.ok(pred(), `timeout: ${what}`);
}
try {
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(serverPort), "--print-logs", "--log-level", "warn"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  serve.stdout.on("data", (d) => {
    stdout += d;
    const password = stdout.match(/server password (\S+)/);
    if (password) env.OPENCODE_PASSWORD = password[1];
  });
  serve.stderr.on("data", (d) => writeFileSync(join(out, "serve.log"), String(d).replace(/^(?=.)/gm, `${new Date().toISOString()} `), { flag: "a" }));
  // The port is ours only if our serve says it listens there with its own per-process password,
  // the server refuses requests without it, and lsof names our pid as the listener.
  await until(() => serve.exitCode === null && stdout.includes(`server listening on ${server}`) && env.OPENCODE_PASSWORD, "our serve's listening line and password", 30000);
  const status = async (auth) => (await fetch(`${server}/api/session/active`, auth ? { headers: { authorization: `Basic ${Buffer.from(auth).toString("base64")}` } } : {})).status;
  assert.equal(await status(null), 401, "the server requires authentication");
  assert.equal(await status("opencode:not-this-run"), 401, "another password is refused");
  assert.equal(await status(`opencode:${env.OPENCODE_PASSWORD}`), 200, "this run's password is accepted");
  const { stdout: listeners } = await exec("lsof", ["-nP", "-t", `-iTCP@127.0.0.1:${serverPort}`, "-sTCP:LISTEN"]);
  assert.deepEqual(listeners.trim().split("\n"), [String(serve.pid)], `port ${serverPort} is listened by our serve only`);
  await api("GET", "/api/session/active");
  // The serve's own event stream, each line stamped on arrival.
  events = new AbortController();
  const headers = env.OPENCODE_PASSWORD ? { authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString("base64")}` } : {};
  const stream = await fetch(`${server}/api/event`, { headers, signal: events.signal });
  writeFileSync(join(out, "events.status"), `${stream.status} ${stream.headers.get("content-type")}\n`);
  void (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const d of stream.body) {
        buf += dec.decode(d, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) if (line.trim()) writeFileSync(eventsFile, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
      }
    } catch {}
  })();
  await sleep(1000);
  const session = await api("POST", "/api/session", { title: "Compaction probe", location: { directory: cwd }, model: { providerID: "scripted", id: "probe" } });
  assert.ok(session.id, JSON.stringify(session));
  const save = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + "\n");
  save("carrier.json", { run, home, cwd, server, pid: serve.pid, probePid: process.pid, plugin, pluginDigest: createHash("sha256").update(readFileSync(plugin)).digest("hex"), bridgeDigest: createHash("sha256").update(readFileSync(env.ISKRON_BRIDGE_PATH)).digest("hex"), version: (await exec(opencode, ["--version"], { env })).stdout.trim(), pendingCommand, negative });
  if (keep) writeFileSync(join(out, "private-password.txt"), env.OPENCODE_PASSWORD, { mode: 0o600 });
  if (pendingCommand) save("skills.json", await api("GET", "/api/skill"));
  await api("POST", `/api/session/${session.id}/prompt`, { text: "COMPACT_PROBE_1: reply OK only.", resume: true });
  await until(() => primary(() => true), "first primary request");
  assert.equal(wire[0].seats.length, 1, "the root sits at its first request");
  if (!pendingCommand) await sleep(3000);
  const admission = pendingCommand
    ? await api("POST", `/api/session/${session.id}/command`, { name: commandName, text: commandInput, delivery: "queue" })
    : await api("POST", `/api/session/${session.id}/prompt`, { text: "COMPACT_PROBE_2: reply OK only.", resume: true });
  save("admission.json", admission);
  release();
  const has2 = (w) => JSON.stringify(w.body.messages).includes(pendingCommand ? "COMPACT_COMMAND_ARGUMENTS" : "COMPACT_PROBE_2");
  await until(() => primary(has2), "primary request carrying the second prompt", 60000);
  await sleep(3000);
  await api("POST", `/api/session/${session.id}/prompt`, { text: "COMPACT_PROBE_3: reply OK only.", resume: true });
  await until(() => primary((w) => JSON.stringify(w.body.messages).includes("COMPACT_PROBE_3")), "third primary request");
  await sleep(2000);
  save("history.json", await api("GET", `/api/session/${session.id}/context`));
  const WORD = "контекст сжат. Роль";
  const KEEP = "Искрон: сохрани в сводке роль";
   const count = (v, s) => typeof v === "string" ? v.split(s).length - 1
     : Array.isArray(v) ? v.reduce((n, x) => n + count(x, s), 0)
       : v && typeof v === "object" ? count(Object.values(v), s) : 0;
  const inSystem = (w, s) => count((w.body.messages ?? []).filter((m) => m.role === "system"), s);
  const summary = wire.map((w) => ({ i: w.i, kind: w.kind, at: w.at, word: count(w.body, WORD), wordInSystem: inSystem(w, WORD), keep: count(w.body, KEEP), bytes: JSON.stringify(w.body).length }));
  writeFileSync(join(out, "summary.json"), JSON.stringify({ plugin, mode: negative ? "negative" : "positive", session: session.id, context: CONTEXT, seat: wire[0].seats[0] ?? null, requests: summary }, null, 2) + "\n");
  console.log(JSON.stringify({ plugin, mode: negative ? "negative" : "positive", requests: summary }, null, 2));
  // (a) OpenCode compacted this session.
  const types = readFileSync(eventsFile, "utf8").split("\n").map((l) => l.match(/"type":"([^"]+)".*"sessionID":"([^"]+)"/)).filter((m) => m && m[2] === session.id).map((m) => m[1]);
  for (const t of ["session.compaction.started", "session.compaction.ended"]) assert.ok(types.includes(t), `${t} in the event stream`);
  const compactions = wire.filter((w) => w.kind === "compaction");
  assert.equal(compactions.length, 1, "one compaction request");
  // (e) Three prompts and one compaction — no extra model step, whatever the plugin.
  assert.equal(wire.length, 4, `requests: ${wire.map((w) => w.kind).join(", ")}`);
  const continued = wire.find((w) => w.i > compactions[0].i && w.kind.startsWith("primary"));
  assert.ok(continued, "a continued request after the compaction");
  if (pendingCommand) {
    const hooks = readFileSync(join(out, "hooks.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    const admitted = hooks.find((e) => e.kind === "prompt" && typeof e.metadata?.["iskron:command"] === "string");
    assert.ok(admitted?.messageID, "real command metadata and admission id");
    save("command-identity.json", admitted);
    const context = hooks.find((e) => e.kind === "context" && e.messages?.some((m) => m.id === admitted.messageID));
    const checkpoints = hooks.filter((e) => e.kind === "context").flatMap((e) => e.messages ?? []).filter((m) => m.role === "user" && m.metadata?.keepID === admitted.messageID);
    const strings = (x) => typeof x === "string" ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === "object" ? Object.values(x).flatMap(strings) : [];
    const head = OPENCODE.ru.commandHead(commandName);
    const history = JSON.parse(readFileSync(join(out, "history.json"), "utf8"));
    save("command-results.json", {
      commandID: admitted.messageID, directContextID: !!context,
      retainedByCompaction: checkpoints,
      headInCompaction: count(compactions[0].body, head), headInContinuedSystem: inSystem(continued, head),
      headOverall: wire.reduce((n, w) => n + count(w.body, head), 0),
      exactHTTPUser: strings(continued.body.messages.filter((m) => m.role === "user")).includes(commandInput),
      exactHistoryUser: history.find((m) => m.id === admitted.messageID)?.text === commandInput,
      expectedFailure: negative, requests: wire.length,
    });
    assert.equal(admitted.prompt.text, commandInput, "prompt-hook sees exact human bytes BEFORE native compaction");
    assert.ok(!context, "this mode observes a native checkpoint, not a direct user");
    assert.ok(checkpoints.length > 0, "native compaction retains the admission through keepID");
    for (const cp of checkpoints) {
      assert.notEqual(cp.id, admitted.messageID, "native checkpoint has its own new id");
      assert.ok(!hooks.some((e) => e.kind === "prompt" && e.messageID === cp.id), "checkpoint id never passed prompt preparation");
      assert.equal(cp.metadata.recent, `[User]: ${commandInput}`, "exact recent serialization, without delivery additions");
      assert.ok(cp.content.some((p) => p.type === "text" && p.text.startsWith("<conversation-checkpoint>\n")), "native checkpoint on HTTP context");
    }
    const stored = history.find((m) => m.type === "compaction" && m.metadata?.keepID === admitted.messageID);
    assert.ok(stored, "native checkpoint is durable history");
    assert.equal(stored.metadata.recent, `[User]: ${commandInput}`, "durable recent remains unmodified");
    assert.equal(count(compactions[0].body, head), 0, "pending command head must not enter compaction");
    assert.equal(inSystem(continued, head), 1, "pending command head in first continued system exactly once");
    assert.equal(wire.reduce((n, w) => n + count(w.body, head), 0), 1, "command head appears once overall, only system");
    assert.ok(strings(continued.body.messages.filter((m) => m.role === "user")).some((s) => s.includes(`<recent-context>\n[User]: ${commandInput}\n</recent-context>`)), "continued HTTP preserves native recent exactly");
  }
  if (negative && !pendingCommand) {
    assert.ok(summary.every((r) => r.word === 0 && r.keep === 0), "the old plugin: neither the order nor the word");
  } else {
    assert.equal(count(compactions[0].body, KEEP), 1, "the compaction request carries the summary's order");
    assert.equal(count(compactions[0].body, WORD), 0, "(c) the compaction request carries no role word");
    assert.equal(inSystem(continued, WORD), 1, `(b) the first continued request (#${continued.i}) carries the word in its system`);
    assert.ok(summary.every((r) => r.word === r.wordInSystem), "the word only ever rides in system");
    assert.equal(summary.filter((r) => r.wordInSystem > 0).length, 1, "(d) the word rides in one request only");
  }
  console.log(JSON.stringify({ verdict: pendingCommand && negative ? "UNEXPECTED_PASS" : "PASS", mode: negative ? "negative" : "positive", continued: continued.i }));
  if (keep) {
    saveDigests();
    writeFileSync(join(out, "assertions-exit-code.txt"), "0\n");
    save("ready.json", { verdict: "PASS", session: session.id, server, probePid: process.pid, note: "Private endpoints and HOME held; send SIGTERM to probePid after independent verification" });
    console.log(`Carrier held for verification; SIGTERM probe pid ${process.pid} to cleanly stop.`);
    await new Promise((resolve) => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  }
} catch (e) {
  writeFileSync(join(out, "failure.txt"), e.stack + "\n");
  if (pendingCommand && negative) console.error("Negative-control run failed; inspect failure.txt to distinguish a behavioural counterexample from an infrastructure failure.");
  console.error(e);
  process.exitCode = 1;
} finally {
  release();
  events?.abort();
  if (serve && serve.exitCode === null) {
    const exited = new Promise((r) => serve.once("exit", r));
    serve.kill("SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    if (serve.exitCode === null) serve.kill("SIGKILL");
  }
  await fake.stop();
  llm.closeAllConnections();
  await new Promise((r) => llm.close(r));
  // --keep holds the live endpoints until an explicit signal; pending-command HOME
  // also survives shutdown for inspection, never claimed as a still-live endpoint.
  if (!pendingCommand) rmSync(run, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  saveDigests();
  writeFileSync(join(out, "exit-code.txt"), `${process.exitCode || 0}\n`);
}
