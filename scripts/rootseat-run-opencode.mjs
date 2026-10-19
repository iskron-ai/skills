#!/usr/bin/env node
// Real OpenCode serve, built plugin + bridges, loopback MCP and scripted provider only.
// No imported credentials, no model stand: observe the seat at the first HTTP model request.
// node scripts/rootseat-run-opencode.mjs [--keep] [--short-realm] [--halted] [--legacy-bridge] [--onboarding[=fresh|partial|outside]]
// ISKRON_ROOT_SEAT=0 runs the same first prompt with automatic seating disabled.
// --onboarding: no cover; the project is a fresh git repository (fresh, the default), one with
// only an alignment sign — a Claude Code start hook (partial), or no repository (outside).
// --realign=write|bash [--negative] [--out=<dir>]: AGENTS.md without front matter, the scripted
// model writes the cover by a tool call in the same turn (rootseat-realign-run.mjs); --out keeps
// the carrier: wire, events, serve log, bridge calls, AGENTS.md before/after, outcome.
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
import { PROMPT, realignCarrier, realignCheck, realignProject, sse, toolCall } from "./rootseat-realign-run.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = mkdtempSync(join(tmpdir(), "rootseat-serve-"));
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const realign = flag("realign") ?? null;
assert.ok(realign === null || ["write", "bash"].includes(realign), `--realign=${realign}`);
const negative = process.argv.includes("--negative");
const out = flag("out") ?? run;
mkdirSync(out, { recursive: true });
let sid = null;
let lastReply = { tool: true, at: 0 };
const home = join(run, "home");
const cwd = join(run, "project");
const auth = join(run, "auth");
const config = join(home, ".config/opencode");
const keep = process.argv.includes("--keep");
const enabled = process.env.ISKRON_ROOT_SEAT !== "0";
const halted = process.argv.includes("--halted");
const legacy = process.argv.includes("--legacy-bridge"); // Pair with ISKRON_BRIDGE_PATH of a build without the flag.
const repoArg = process.argv.find((a) => a === "--onboarding" || a.startsWith("--onboarding="));
const repo = repoArg ? repoArg.split("=")[1] || "fresh" : null; // No cover, same real serve path.
assert.ok(repo === null || ["fresh", "partial", "outside"].includes(repo), `--onboarding=${repo}`);
const onboarding = repo !== null;
const invites = repo === "fresh" && !halted;
const seats = enabled && !halted && !onboarding && !realign;
const fake = await startFakeNks({ pat: PAT });
await fake.control({ richTools: true, structured: true, connect_delay_ms: 700 });
const wire = [];
const llm = createServer(async (req, res) => {
  try {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    const observation = { i: wire.length + 1, path: req.url, body, seats: heardSeats(fake), at: Date.now() };
    if (realign) Object.assign(observation, { connects: fake.state.placeArgs.filter((p) => p.action === "connect").length, held: sid ? heldBy(auth, sid) : [] });
    wire.push(observation);
    writeFileSync(join(out, "wire.jsonl"), JSON.stringify(observation) + "\n", { flag: "a" });
    if (realign) {
      // The first primary request gets the cover's tool call, every other one plain text.
      const primaries = wire.filter((w) => w.body.tools?.length).length;
      const reply = body.tools?.length && primaries === 1 ? { tool: toolCall(realign, body.tools, cwd) } : {};
      writeFileSync(join(out, "wire.jsonl"), JSON.stringify({ i: observation.i, reply }) + "\n", { flag: "a" });
      if (body.tools?.length) lastReply = { tool: Boolean(reply.tool), at: Date.now() };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      return res.end(sse(reply));
    }
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
if (realign) await realignProject(cwd);
else if (!onboarding) writeAgents(cwd, process.argv.includes("--short-realm") ? { ...COVER, [GRAPH_KEY]: "r5" } : COVER);
if (repo === "fresh" || repo === "partial") await exec("git", ["init", "-q", cwd]);
if (repo === "partial") {
  mkdirSync(join(cwd, ".claude"));
  const command = "echo 'read the iskron door Start section first'";
  writeFileSync(join(cwd, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } }));
}
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
let serve, events, failure;
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
  serve.stderr.on("data", (d) => writeFileSync(join(out, "serve.log"), String(d).replace(/^(?=.)/gm, `${new Date().toISOString()} `), { flag: "a" }));
  // The port is ours only if our serve says it listens there with its own per-process password,
  // the server refuses requests without it, and lsof names our pid as the listener.
  for (let i = 0; i < 120 && !(serve.exitCode === null && stdout.includes(`server listening on ${server}`) && env.OPENCODE_PASSWORD); i++) await sleep(250);
  assert.ok(stdout.includes(`server listening on ${server}`) && env.OPENCODE_PASSWORD, `serve unavailable; ${join(out, "serve.log")}`);
  const basic = (auth) => ({ authorization: `Basic ${Buffer.from(auth).toString("base64")}` });
  const status = async (auth) => (await fetch(`${server}/api/session/active`, auth ? { headers: basic(auth) } : {})).status;
  assert.equal(await status(null), 401, "the server requires authentication");
  assert.equal(await status("opencode:not-this-run"), 401, "another password is refused");
  assert.equal(await status(`opencode:${env.OPENCODE_PASSWORD}`), 200, "this run's password is accepted");
  const { stdout: listeners } = await exec("lsof", ["-nP", "-t", `-iTCP@127.0.0.1:${serverPort}`, "-sTCP:LISTEN"]);
  assert.deepEqual(listeners.trim().split("\n"), [String(serve.pid)], `port ${serverPort} is listened by our serve only`);
  writeFileSync(join(out, "serve-owner.txt"), `pid ${serve.pid} port ${serverPort}: no password 401, other 401, own 200; lsof listener ${listeners.trim()}\n`);
  await api("GET", "/api/session/active");
  // The serve's own event stream, each line stamped on arrival.
  events = new AbortController();
  const stream = await fetch(`${server}/api/event`, { headers: basic(`opencode:${env.OPENCODE_PASSWORD}`), signal: events.signal });
  void (async () => {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const d of stream.body) {
        buf += dec.decode(d, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) if (line.trim()) writeFileSync(join(out, "events.ndjson"), `${new Date().toISOString()} ${line}\n`, { flag: "a" });
      }
    } catch {}
  })();
  const session = await api("POST", "/api/session", { title: "Root seating probe", location: { directory: cwd }, model: { providerID: "scripted", id: "probe" } });
  assert.ok(session.id, JSON.stringify(session));
  sid = session.id;
  if (halted) createHalts(() => undefined, () => auth, (_s, why) => { throw new Error(why); }, () => {}).stop(session.id, "ROOTSEAT_OWNER_STOP");
  await sleep(1200);
  assert.deepEqual(heardSeats(fake), [], "session.created alone must not take a seat");
  assert.deepEqual(heldBy(auth, session.id), [], "no hold record before the first prompt");
  assert.equal(fake.state.placeArgs.filter((p) => p.action === "connect").length, 0);
  if (realign) {
    await api("POST", `/api/session/${session.id}/prompt`, { text: PROMPT, resume: true });
    const idle = () => !lastReply.tool && Date.now() - lastReply.at > 3000;
    const r = await realignCheck({ fake, auth, wire, session: session.id, cwd, out, negative, idle });
    assert.equal(fake.state.writes.length, 0, "the script did not write to the graph");
    console.log(JSON.stringify({ verdict: "PASS", mode: `realign-${realign}${negative ? "-negative" : ""}`, session: session.id, afterTool: r.afterTool, end: r.end, requests: wire.length, paidPosts: 0 }, null, 2));
  } else {
    await api("POST", `/api/session/${session.id}/prompt`, { text: "ROOTSEAT_WIRE_PROBE: reply OK only.", resume: true });
    for (let i = 0; i < 120 && !wire.some((w) => w.body.tools?.length); i++) await sleep(250);
    const first = wire.find((w) => w.body.tools?.length);
    assert.ok(first, `no primary provider request; ${join(out, "serve.log")}`);
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
    const invitation = ONBOARD_START.ru.start();
    if (invites) {
      assert.ok(userText.includes(invitation), "the first real provider request contains onboarding");
      assert.equal(userText.split(invitation).length - 1, 1, "one invitation");
      assert.ok(!userText.includes(ROOT_SEAT.ru.notSeated("")), "no seating refusal without cover");
      assert.equal(fake.state.counts.register_standing, 0, "onboarding does not register a seat");
    } else assert.ok(!userText.includes(invitation), "cover, a sign, no repository or owner stop excludes onboarding");
    if (onboarding)
      assert.equal(fake.state.calls.filter((c) => ["iskron_me", "iskron_realm"].includes(c.name)).length, 0, "the signs are local");
    let secondPrompt = null;
    if (onboarding) {
      // The same root's second prompt carries no second invitation.
      await api("POST", `/api/session/${session.id}/prompt`, { text: "ONBOARD_SECOND_PROMPT_PROBE: reply OK only.", resume: true });
      const later = () => wire.find((w) => w.body.tools?.length && JSON.stringify(w.body.messages).includes("ONBOARD_SECOND_PROMPT_PROBE"));
      for (let i = 0; i < 120 && !later(); i++) await sleep(250);
      assert.ok(later(), "second primary request observed");
      const said = JSON.stringify(later().body.messages.filter((m) => m.role === "user")).split(invitation).length - 1;
      assert.equal(said, invites ? 1 : 0, "the history keeps the first invitation, the second prompt adds none");
      secondPrompt = { invitations: said };
    }
    assert.equal(fake.state.writes.length, 0, "the script did not write to the graph");
    const { stdout: version } = await exec(opencode, ["--version"], { env });
    console.log(JSON.stringify({ verdict: "PASS", version: version.trim(), mode: onboarding ? `onboarding-${repo}${halted ? "-halted" : ""}` : halted ? "halted" : legacy ? "legacy" : enabled ? "auto" : "disabled", invited: onboarding ? invites : undefined, seat: first.seats[0] ?? null, session: session.id, secondPrompt, requests: wire.length, paidPosts: 0, bridge: env.ISKRON_BRIDGE_PATH, plugin: process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, wire: join(out, "wire.jsonl"), ceiling: "loopback MCP and scripted provider; no production server, no scripted tool call" }, null, 2));
  }
} catch (e) {
  failure = e;
  console.error(e);
  try { console.error(readFileSync(join(out, "serve.log"), "utf8").slice(-12000)); } catch {}
  process.exitCode = 1;
} finally {
  events?.abort();
  if (realign) await realignCarrier({ out, fake, auth, cwd, wire, failure, opencode, env, plugin: process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, mode: realign, negative });
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
