#!/usr/bin/env node
// Real OpenCode serve, built plugin + bridges, loopback MCP and scripted provider only.
// No imported credentials, no model stand: observe the seat at the first HTTP model request.
// node scripts/rootseat-run-opencode.mjs [--keep] [--short-realm] [--halted] [--legacy-bridge] [--onboarding]
// ISKRON_ROOT_SEAT=0 runs the same first prompt with automatic seating disabled.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { BUILT_BRIDGE, BUILT_PLUGIN } from "../js/tests/built.mjs";
import { ONBOARD_START, ROOT_SEAT } from "../js/delivery/index.ts";
import { createHalts } from "../js/opencode/halts.ts";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { COVER, GRAPH_KEY, heardSeats, heldBy, writeAgents } from "../js/tests/rootseat-kit.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = mkdtempSync(join(tmpdir(), "rootseat-serve-"));
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const config = join(home, ".config/opencode");
const keep = process.argv.includes("--keep");
const enabled = process.env.ISKRON_ROOT_SEAT !== "0";
const halted = process.argv.includes("--halted");
const legacy = process.argv.includes("--legacy-bridge"); // Pair with ISKRON_BRIDGE_PATH of a build without the flag.
const onboarding = process.argv.includes("--onboarding"); // No cover, no working realms, same real serve path.
const seats = enabled && !halted && !onboarding;
const fake = await startFakeNks({ pat: PAT });
await fake.control({ richTools: true, structured: true, connect_delay_ms: 700 });
if (onboarding) {
  fake.state.realms = [];
  fake.state.readinessResult = { structuredContent: { wizard_due: true, realms: [] }, content: [{ type: "text", text: "readiness" }] };
}
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
if (!onboarding) writeAgents(cwd, process.argv.includes("--short-realm") ? { ...COVER, [GRAPH_KEY]: "r5" } : COVER);
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
  ISKRON_ROOT_SEAT: enabled ? "1" : "0",
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
  if (halted) createHalts(() => undefined, () => auth, (_s, why) => { throw new Error(why); }, () => {}).stop(session.id, "ROOTSEAT_OWNER_STOP");
  await sleep(1200);
  assert.deepEqual(heardSeats(fake), [], "session.created alone must not take a seat");
  assert.deepEqual(heldBy(auth, session.id), [], "no hold record before the first prompt");
  assert.equal(fake.state.placeArgs.filter((p) => p.action === "connect").length, 0);
  await api("POST", `/api/session/${session.id}/prompt`, { text: "ROOTSEAT_WIRE_PROBE: reply OK only.", resume: true });
  for (let i = 0; i < 120 && !wire.some((w) => w.body.tools?.length); i++) await sleep(250);
  const first = wire.find((w) => w.body.tools?.length);
  assert.ok(first, `no primary provider request; ${join(run, "serve.log")}`);
  assert.equal(first.seats.length, seats ? 1 : 0, JSON.stringify(first));
  assert.deepEqual(heldBy(auth, session.id), first.seats, "the root's own bridge holds it");
  if (seats) {
    const text = JSON.stringify(first.body.messages.filter((m) => m.role === "user"));
    assert.ok(text.includes(first.seats[0]), "model request names the seat");
    assert.ok(!text.includes("граф не сличён"), "fresh rN is resolved by the bridge");
    if (legacy) {
      assert.ok(!/без take|without take/.test(text), "no wire flag: no replacement promise");
      assert.match(text, /своим местом|own seat/, "an older serving bridge gets own-seat wording");
    }
    else assert.match(text, /без take|without take/, "the serving bridge proved its provisional semantics");
  } else assert.equal(fake.state.placeArgs.filter((p) => p.action === "connect").length, 0);
  if (halted) {
    assert.ok(JSON.stringify(first.body.messages).includes("ROOTSEAT_OWNER_STOP"), "model gets the stop's word, not a seating word");
    const stop = readdirSync(auth).filter((name) => name.startsWith("opencode-stopped.")).map((name) => JSON.parse(readFileSync(join(auth, name), "utf8"))).find((r) => r.session === session.id);
    assert.ok(stop?.id && !stop.lifted, "the disk stop is not lifted (read disk, not the driver's registry)");
  }
  const userText = JSON.stringify(first.body.messages.filter((m) => m.role === "user"));
  if (onboarding && !halted) {
    assert.ok(userText.includes(ONBOARD_START.ru.start()), "the first real provider request contains onboarding");
    assert.equal(userText.split(ONBOARD_START.ru.start()).length - 1, 1, "one invitation");
    assert.ok(!userText.includes(ROOT_SEAT.ru.notSeated("")), "no seating refusal without cover");
    assert.equal(fake.state.calls.filter((c) => c.name === "iskron_me" && c.arguments.action === "readiness").length, 1);
    assert.equal(fake.state.counts.register_standing, 0, "onboarding does not register a seat");
  } else assert.ok(!userText.includes(ONBOARD_START.ru.start()), "cover or owner stop excludes onboarding");
  assert.equal(fake.state.writes.length, 0, "the script did not write to the graph");
  const { stdout: version } = await exec(opencode, ["--version"], { env });
  console.log(JSON.stringify({ verdict: "PASS", version: version.trim(), mode: onboarding ? halted ? "onboarding-halted" : "onboarding" : halted ? "halted" : legacy ? "legacy" : enabled ? "auto" : "disabled", seat: first.seats[0] ?? null, session: session.id, requests: wire.length, paidPosts: 0, bridge: env.ISKRON_BRIDGE_PATH, plugin: process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, wire: join(run, "wire.jsonl"), ceiling: "loopback MCP; no production server, no scripted tool call" }, null, 2));
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
