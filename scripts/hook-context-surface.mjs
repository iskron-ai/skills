// OpenCode 2 command correlation: observe metadata, admission ids and context message identity.
// Graph @nks/nks-dev, surface #9867. Default: minimal probe; --delivery: canonical built plugin.
// No production MCP, credentials or paid provider. The delivery mode exercises actual /command.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { OPENCODE } from "../js/delivery/index.ts";
import { graphPosed, progress } from "../js/tests/room-frames.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const graphInbox = process.argv.includes("--graph-inbox");
const delivery = process.argv.includes("--delivery") || graphInbox;
const bundle = process.env.ISKRON_OPENCODE_PLUGIN || fileURLToPath(new URL("../dist/dev/skills/establish-mcp/scripts/opencode-plugin.js", import.meta.url));
const out = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || mkdtempSync(join(tmpdir(), "hook-context-surface-")));
const home = join(out, "home"), cwd = join(out, "project"), config = join(home, ".config/opencode");
for (const p of [cwd, join(config, "plugins"), join(home, "tmp")]) mkdirSync(p, { recursive: true });
const save = (name, data) => writeFileSync(join(out, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
if (delivery) {
  save("home/.config/opencode/plugins/delivery.js", readFileSync(bundle, "utf8"));
  const skills = join(cwd, ".opencode/skills");
  mkdirSync(join(skills, "establish-mcp/scripts"), { recursive: true });
  mkdirSync(join(skills, "correlation-probe"), { recursive: true });
  writeFileSync(join(skills, "establish-mcp/SKILL.md"), '---\nname: establish-mcp\ndescription: Local bridge marker\n---\nMarker only.\n');
  writeFileSync(join(skills, "establish-mcp/scripts/iskron.mjs"), "// marker, never executed\n");
  writeFileSync(join(skills, "correlation-probe/SKILL.md"), '---\nname: correlation-probe\nslash: true\ndescription: Local correlation probe\n---\nProbe only.\n');
}
const wire = [];
let release;
const gate = new Promise((r) => { release = r; });
const llm = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  wire.push(JSON.parse(raw));
  save("wire.json", wire);
  if (wire.length === 1) await gate;
  const chunk = (delta, finish_reason = null) => ({ id: "local", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, delta, finish_reason }] });
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(`data: ${JSON.stringify(chunk({ role: "assistant", content: "OK" }))}\n\ndata: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`);
});
await new Promise((r) => llm.listen(0, "127.0.0.1", r));
save("home/.config/opencode/plugins/probe.js", `import {appendFileSync} from 'node:fs';
export default {id:'command-correlation-surface',async setup(ctx){
 const log=(kind,e)=>appendFileSync(${JSON.stringify(join(out, "hooks.jsonl"))},JSON.stringify({kind,...e})+'\\n');
 await ctx.session.hook('prompt',e=>log('prompt',e));
 await ctx.session.hook('context',e=>log('context',{sessionID:e.sessionID,system:e.system,messages:e.messages}));
 await ctx.session.hook('title',e=>{e.result='Local surface';});
}};`);
save("home/.config/opencode/opencode.json", {
  model: "scripted/probe", snapshots: false, update: "disable",
  policies: [{ action: "provider.use", resource: "*", effect: "deny" }, { action: "provider.use", resource: "scripted", effect: "allow" }],
  providers: { scripted: { name: "Local only", env: ["SCRIPTED_API_KEY"], package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: `http://127.0.0.1:${llm.address().port}/v1` }, models: { probe: { name: "Probe", limit: { context: 200000, output: 4096 }, capabilities: { tools: true } } } } },
});
const bin = (await exec("which", ["opencode"])).stdout.trim();
const env = { PATH: `${dirname(bin)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: join(home, "tmp"), LANG: "en_US.UTF-8", XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"), OPENCODE_CONFIG_DIR: config, SCRIPTED_API_KEY: "local-not-a-secret", ISKRON_ROOT_SEAT: "0", ISKRON_BRIDGE_LANG: "ru", ISKRON_BRIDGE_PATH: join(out, "no-bridge.mjs") };
if (graphInbox) {
  env.ISKRON_BRIDGE_PATH = fileURLToPath(new URL("../js/tests/fake-bridge.mjs", import.meta.url));
  env.FB_EVENTS = join(out, "graph-events.jsonl");
  env.FB_LOG = join(out, "bridges.log");
  env.FB_TOOLS = JSON.stringify([{ name: "iskron_channel", inputSchema: { type: "object" } }]);
  writeFileSync(env.FB_EVENTS, "");
}
const port = 48000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
let serve, stdout = "", headers;
const until = async (fn, why) => { for (let i = 0; i < 160 && !fn(); i++) await sleep(250); assert.ok(fn(), why); };
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { ...headers, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  if (!r.ok) throw Error(`${method} ${path}: ${r.status} ${text}`);
  const data = text ? JSON.parse(text) : null;
  return data?.data ?? data;
};
try {
  serve = spawn(bin, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  serve.stdout.on("data", (b) => { stdout += b; });
  serve.stderr.on("data", (b) => writeFileSync(join(out, "serve.log"), b, { flag: "a" }));
  await until(() => stdout.includes(`server listening on ${base}`) && /server password (\S+)/.test(stdout), "private serve ready");
  headers = { authorization: `Basic ${Buffer.from(`opencode:${stdout.match(/server password (\S+)/)[1]}`).toString("base64")}` };
  assert.equal((await fetch(base + "/api/session/active")).status, 401);
  assert.equal((await exec("lsof", ["-nP", "-t", `-iTCP@127.0.0.1:${port}`, "-sTCP:LISTEN"])).stdout.trim(), String(serve.pid));
  const session = await api("POST", "/api/session", { title: "Correlation surface", location: { directory: cwd }, model: { providerID: "scripted", id: "probe" } });
  const schema = await api("GET", "/openapi.json");
  save("command-api.json", Object.fromEntries(Object.entries(schema.paths).filter(([p]) => p.includes("command"))));
  if (delivery) save("skills.json", await api("GET", "/api/skill"));
  const input = "  IDENTICAL_COMMAND_ARGUMENTS 🙂\r\n  ";
  const ordinary = await api("POST", `/api/session/${session.id}/prompt`, { text: input, resume: true, delivery: "queue" });
  await until(() => wire.length === 1, "ordinary request held at provider");
  if (graphInbox) {
    const old = graphPosed("graph-old", 733350);
    old.body.vimarsha_name = "GRAPH_OLD_VERSION";
    const last = graphPosed("graph-last", 733351);
    Object.assign(last.body, { vimarsha_version: 2, vimarsha_name: "GRAPH_LAST_VERSION", reason: "updated" });
    const copy = { ...progress(733351), event_id: 733351 };
    writeFileSync(env.FB_EVENTS, [old, last, copy].map((frame) => JSON.stringify({ kind: "frame", frame, raw: JSON.stringify(frame) })).join("\n") + "\n");
    await sleep(1500);
    assert.equal(wire.length, 1, "graph inbox does not interrupt the held HTTP turn");
  }
  const nonce = "command-correlation-probe";
  const command = delivery && !graphInbox
    ? await api("POST", `/api/session/${session.id}/command`, { name: "correlation-probe", text: input, delivery: "queue" })
    : await api("POST", `/api/session/${session.id}/prompt`, { text: input, metadata: { probeNonce: nonce }, resume: true, delivery: "queue" });
  save("admissions.json", { ordinary, command });
  release();
  await until(() => wire.length >= 2, "queued identical input reaches another context");
  await sleep(1000);
  const hooks = readFileSync(join(out, "hooks.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const admitted = hooks.find((e) => e.kind === "prompt" && (delivery && !graphInbox ? typeof e.metadata?.["iskron:command"] === "string" : e.metadata?.probeNonce === nonce));
  assert.ok(admitted?.messageID, "the command metadata reaches its exact prompt hook");
  if (!delivery) assert.equal(admitted.messageID, command.id, "metadata and the exact admitted message id roundtrip");
  const commandID = admitted.messageID;
  const contexts = hooks.filter((e) => e.kind === "context");
  assert.equal(wire.length, 2, "two human inputs, no additional model request");
  assert.ok(contexts[0].messages.some((m) => m.id === ordinary.id));
  assert.ok(!contexts[0].messages.some((m) => m.id === commandID), "earlier context excludes later admission");
  assert.ok(contexts[1].messages.some((m) => m.id === commandID));
  save("contexts.json", contexts);
  const history = await api("GET", `/api/session/${session.id}/context`);
  save("history.json", history);
  assert.deepEqual(history.filter((m) => m.type === "user").map((m) => m.text), [input, input]);
  assert.ok(history.some((m) => m.id === commandID), "context identity matches durable admission");
  if (delivery) {
    const strings = (x) => typeof x === "string" ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === "object" ? Object.values(x).flatMap(strings) : [];
    const system = (body) => strings(body.messages.filter((m) => m.role === "system")).join("\n");
    const head = OPENCODE.ru.commandHead("correlation-probe");
    for (const [i, body] of wire.entries()) {
      const users = body.messages.filter((m) => m.role === "user");
      assert.equal(users.length, i + 1, "no extra user message on the wire");
      for (const user of users) assert.ok(strings(user.content).includes(input), "exact human bytes on the wire");
    }
    if (graphInbox) {
      assert.ok(!system(wire[0]).includes("GRAPH_"), "no graph in the earlier HTTP");
      assert.ok(system(wire[1]).includes("GRAPH_LAST_VERSION"), "latest graph is separate context at next turn");
      assert.ok(!system(wire[1]).includes("GRAPH_OLD_VERSION"), "superseded graph is absent");
      assert.ok(!/№7 «Стенд»: записей/.test(system(wire[1])), "room event copy adds no count");
    } else {
      assert.ok(!system(wire[0]).includes(head), "the ordinary request has no command header");
      assert.ok(system(wire[1]).includes(head), "header is in the first HTTP containing the command admission");
    }
    await api("POST", `/api/session/${session.id}/prompt`, { text: input, delivery: "queue", resume: true });
    await until(() => wire.length >= 3, "later identical ordinary input");
    await sleep(500);
    assert.equal(wire.length, 3, "three human inputs, three HTTP requests");
    assert.ok(!system(wire[2]).includes(head), "a historical command id cannot replay its word");
    if (graphInbox) assert.ok(!system(wire[2]).includes("GRAPH_"), "graph context is not repeated");
  }
  const finalContexts = readFileSync(join(out, "hooks.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter((e) => e.kind === "context");
  save("contexts.json", finalContexts);
  console.log(JSON.stringify({ out, version: (await exec(bin, ["--version"], { env })).stdout.trim(), delivery, graphInbox, plugin: delivery ? bundle : null, digest: delivery ? createHash("sha256").update(readFileSync(join(config, "plugins/delivery.js"))).digest("hex") : null, admitted: admitted.messageID, ordinary: ordinary.id, requests: wire.length, contexts: finalContexts.length, metadataRoundtrip: true, ceiling: "local scripted provider, no production graph or bridge transport; own private serve stopped after assertions" }, null, 2));
} catch (e) {
  save("failure.txt", e.stack);
  console.error(e);
  console.error(`surface kept: ${out}`);
  process.exitCode = 1;
} finally {
  release();
  if (serve && serve.exitCode === null) {
    const exited = new Promise((r) => serve.once("exit", r));
    serve.kill("SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    if (serve.exitCode === null) serve.kill("SIGKILL");
  }
  llm.closeAllConnections();
  await new Promise((r) => llm.close(r));
}
