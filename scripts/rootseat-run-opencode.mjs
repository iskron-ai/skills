#!/usr/bin/env node
// Real OpenCode serve, built plugin + bridges, loopback MCP and scripted provider only.
// No imported credentials, no model stand: observe the seat at the first HTTP model request.
// node scripts/rootseat-run-opencode.mjs [--keep]
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { BUILT_BRIDGE, BUILT_PLUGIN } from "../js/tests/built.mjs";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { heardSeats, heldBy, writeAgents } from "../js/tests/rootseat-kit.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = mkdtempSync(join(tmpdir(), "rootseat-serve-"));
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const config = join(home, ".config/opencode");
const keep = process.argv.includes("--keep");
const fake = await startFakeNks({ pat: PAT });
await fake.control({ richTools: true, connect_delay_ms: 700 });
const wire = [];
const llm = createServer(async (req, res) => {
  try {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    const observation = { path: req.url, body, seats: heardSeats(fake), at: Date.now() };
    wire.push(observation);
    writeFileSync(join(run, "wire.jsonl"), JSON.stringify(observation) + "\n", { flag: "a" });
    // A script, not a paid model: the only response is OK, with no stand or register call.
    const chunk = (delta, finish_reason = null) => ({
      id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe",
      choices: [{ index: 0, delta, finish_reason }],
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(chunk({ role: "assistant", content: "OK" }))}\n\ndata: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => llm.listen(0, "127.0.0.1", r));
for (const dir of [cwd, auth, join(config, "plugins"), join(home, "tmp")]) mkdirSync(dir, { recursive: true });
writeAgents(cwd);
copyFileSync(process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, join(config, "plugins/iskron.js"));
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
    models: { probe: { name: "Probe", limit: { context: 200000, output: 4096 }, capabilities: { tools: true } } },
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
};
const serverPort = 40000 + Math.floor(Math.random() * 20000);
const server = `http://127.0.0.1:${serverPort}`;
let serve;
async function api(method, path, body) {
  const args = ["api", "--server", server, method, path];
  if (body) args.push("-d", JSON.stringify(body));
  const r = await exec(opencode, args, { cwd, env, timeout: 20000 });
  const data = JSON.parse(r.stdout);
  if (data?._tag) throw new Error(r.stdout);
  return data?.data ?? data;
}
try {
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(serverPort), "--print-logs", "--log-level", "warn"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  serve.stdout.on("data", (d) => {
    stdout += d;
    const password = stdout.match(/server password (\S+)/);
    if (password) env.OPENCODE_PASSWORD = password[1];
  });
  serve.stderr.on("data", (d) => writeFileSync(join(run, "serve.log"), d, { flag: "a" }));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { await api("GET", "/api/session/active"); ready = true; break; } catch { await sleep(500); }
  }
  assert.ok(ready, `serve unavailable; ${join(run, "serve.log")}`);
  const session = await api("POST", "/api/session", { title: "Root seating probe", location: { directory: cwd }, model: { providerID: "scripted", id: "probe" } });
  assert.ok(session.id, JSON.stringify(session));
  await api("POST", `/api/session/${session.id}/prompt`, { text: "ROOTSEAT_WIRE_PROBE: reply OK only.", resume: true });
  for (let i = 0; i < 120 && !wire.some((w) => w.body.tools?.length); i++) await sleep(250);
  const first = wire.find((w) => w.body.tools?.length);
  assert.ok(first, `no primary provider request; ${join(run, "serve.log")}`);
  assert.equal(first.seats.length, 1, JSON.stringify(first));
  assert.deepEqual(heldBy(auth, session.id), first.seats, "the root's own bridge holds it");
  assert.ok(JSON.stringify(first.body.messages).includes(first.seats[0]), "model request names the seat");
  assert.equal(fake.state.writes.length, 0, "the script did not write to the graph");
  const { stdout: version } = await exec(opencode, ["--version"], { env });
  console.log(JSON.stringify({ verdict: "PASS", version: version.trim(), seat: first.seats[0], session: session.id, requests: wire.length, paidPosts: 0, bridge: env.ISKRON_BRIDGE_PATH, plugin: process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, wire: join(run, "wire.jsonl"), ceiling: "loopback MCP; no production server, no scripted tool call" }, null, 2));
} catch (e) {
  console.error(e);
  try { console.error(readFileSync(join(run, "serve.log"), "utf8").slice(-12000)); } catch {}
  process.exitCode = 1;
} finally {
  if (serve && serve.exitCode === null) {
    const exited = new Promise((r) => serve.once("exit", r));
    serve.kill("SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    if (serve.exitCode === null) serve.kill("SIGKILL");
  }
  await fake.stop();
  llm.closeAllConnections();
  await new Promise((r) => llm.close(r));
  if (!keep) rmSync(run, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  else console.error(`run kept: ${run}`);
}
