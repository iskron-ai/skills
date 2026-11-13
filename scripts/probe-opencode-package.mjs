#!/usr/bin/env node
// Real OpenCode loader; fixture PAT/MCP only. Never inherits the caller's environment.
// Modes: default fixture HTTP tgz; --directory unpacked local package; --url <http(s) specifier>
// (the release HTTPS link; the loader fetches it, this script never does).
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { packOpencode } from "./pack-opencode.mjs";
import { BUILT, REPO } from "../js/tests/built.mjs";
import { startFakeNks } from "../js/tests/fake-nks.mjs";
import { PAT } from "../js/tests/ownseat-kit.mjs";
import { sse } from "./rootseat-realign-run.mjs";

const out = resolve(process.argv[2]);
assert.ok(!existsSync(out), "use a fresh carrier directory");
const urlAt = process.argv.indexOf("--url");
const remote = urlAt === -1 ? null : process.argv[urlAt + 1];
assert.ok(!remote || !process.argv.includes("--directory"), "--url and --directory are exclusive");
assert.ok(!remote || /^https?:\/\//.test(remote), "--url needs an http(s) plugin specifier");
mkdirSync(out, { recursive: true });
const home = join(out, "home"), cwd = join(out, "project"), bin = join(out, "bin");
const config = join(home, ".config/opencode");
for (const dir of [cwd, bin, config, join(home, "tmp")]) mkdirSync(dir, { recursive: true });
execFileSync("git", ["init", "-q", cwd]);
const opencode = execFileSync("which", ["opencode"], { encoding: "utf8" }).trim();
symlinkSync(opencode, join(bin, "opencode"));
const version = JSON.parse(readFileSync(join(REPO, ".claude-plugin/plugin.json"))).version;
const archive = packOpencode({ out, built: BUILT, tag: `v${version}` });
let packageBase = null;
if (!remote) {
  packageBase = join(cwd, ".plugins", `iskron-${version}`);
  mkdirSync(packageBase, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", packageBase]);
}
const fake = await startFakeNks({ pat: PAT, tools: [{ name: "iskron_me", description: "Fixture identity", inputSchema: {
  type: "object", properties: { action: { type: "string", enum: ["whoami"] } }, required: ["action"],
} }] });
await fake.control({ richTools: true, structured: true });
const asset = remote ? null : createServer((req, res) => {
  if (req.url !== `/v${version}/iskron-opencode-${version}.tgz`) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": "application/octet-stream" });
  res.end(readFileSync(archive));
});
if (asset) await new Promise((r) => asset.listen(0, "127.0.0.1", r));
const specifier = remote ?? (process.argv.includes("--directory") ? `./.plugins/iskron-${version}/package` :
  `http://127.0.0.1:${asset.address().port}/v${version}/iskron-opencode-${version}.tgz`);
const wire = [];
let called = false;
const provider = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = JSON.parse(text);
  wire.push(body);
  writeFileSync(join(out, "wire.jsonl"), JSON.stringify(body) + "\n", { flag: "a" });
  let reply = {};
  if (body.tools?.length && !called) {
    called = true;
    const names = body.tools.map((t) => t.function?.name ?? t.name);
    reply = { tool: names.includes("iskron_me") ? { name: "iskron_me", args: { action: "whoami" } } :
      { name: "execute", args: { code: 'await search({query:"iskron_me"}); return await tools.iskron_me({action:"whoami"});' } } };
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(sse(reply));
});
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
writeFileSync(join(cwd, "opencode.json"), JSON.stringify({ plugins: [specifier] }));
writeFileSync(join(config, "opencode.json"), JSON.stringify({
  update: "disable", snapshots: false, model: "scripted/probe",
  permissions: [{ action: "*", resource: "*", effect: "deny" }, { action: "execute", resource: "*", effect: "allow" }, { action: "iskron_me", resource: "*", effect: "allow" }],
  policies: [{ action: "provider.use", resource: "*", effect: "deny" }, { action: "provider.use", resource: "scripted", effect: "allow" }],
  providers: { scripted: { name: "Fixture", env: ["SCRIPTED_API_KEY"], package: "@opencode/ai/providers/openai-compatible",
    settings: { baseURL: `http://127.0.0.1:${provider.address().port}/v1` },
    models: { probe: { name: "Probe", limit: { context: 200000, output: 4096 }, capabilities: { tools: true } } } } },
}));
const env = {
  PATH: bin, HOME: home, TMPDIR: join(home, "tmp"), LANG: "en_US.UTF-8",
  XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_CONFIG_DIR: config, ISKRON_ROOT_SEAT: "0",
  ISKRON_BRIDGE_URL: fake.mcpUrl, ISKRON_BRIDGE_TOKEN: PAT,
  ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_BRIDGE_DAEMON: "0",
  SCRIPTED_API_KEY: "fixture-not-a-key",
};
let serve;
try {
  assert.throws(() => execFileSync("node", ["--version"], { env }), /ENOENT/);
  assert.equal(existsSync(join(home, ".iskron-bridge/iskron-bridge.mjs")), false);
  const port = 40000 + Math.floor(Math.random() * 20000);
  const url = `http://127.0.0.1:${port}`;
  serve = spawn(opencode, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs", "--log-level", "debug"], { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  serve.stdout.on("data", (d) => { stdout += d; });
  serve.stderr.on("data", (d) => writeFileSync(join(out, "serve.log"), d, { flag: "a" }));
  for (let i = 0; i < 120 && !(stdout.includes("server password") && stdout.includes(`server listening on ${url}`)); i++) {
    assert.equal(serve.exitCode, null, stdout);
    await new Promise((r) => setTimeout(r, 250));
  }
  const password = stdout.match(/server password (\S+)/)?.[1];
  assert.ok(password, "private serve password missing");
  assert.ok(stdout.includes(`server listening on ${url}`), "private serve is not listening");
  assert.equal((await fetch(`${url}/api/session/active`)).status, 401, "the private server requires authentication");
  const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "content-type": "application/json" };
  const api = async (path, body) => {
    const res = await fetch(url + path, { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    assert.ok(res.ok, `${res.status}: ${text}`);
    const data = JSON.parse(text);
    return data.data ?? data;
  };
  const schema = await api("/openapi.json");
  writeFileSync(join(out, "openapi.json"), JSON.stringify(schema));
  const session = await api("/api/session", { title: "Package fixture probe", location: { directory: cwd }, model: { providerID: "scripted", id: "probe" } });
  writeFileSync(join(out, "session.json"), JSON.stringify(session));
  await api(`/api/session/${session.id}/prompt`, { text: "Package fixture: call whoami", resume: true });
  for (let i = 0; i < 160 && !fake.state.calls.some((c) => c.name === "iskron_me" && c.arguments.action === "whoami"); i++) await new Promise((r) => setTimeout(r, 250));
  writeFileSync(join(out, "calls.json"), JSON.stringify(fake.state.calls));
  assert.ok(fake.state.calls.some((c) => c.name === "iskron_me" && c.arguments.action === "whoami"), "whoami did not reach fixture MCP");
  for (let i = 0; i < 40 && !wire.some((w) => JSON.stringify(w.messages).includes("tester@probe.example")); i++) await new Promise((r) => setTimeout(r, 250));
  assert.ok(wire.some((w) => JSON.stringify(w.messages).includes("tester@probe.example")), "whoami response absent from provider wire");
  assert.equal(existsSync(join(home, ".iskron-bridge/iskron-bridge.mjs")), false);
  const hashes = Object.fromEntries((remote ? [archive] : [archive, join(packageBase, "package/index.js"), join(packageBase, "package/iskron.mjs")]).map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
  const result = { verdict: "PASS", specifier, hashes, opencode: execFileSync(opencode, ["--version"], { env, encoding: "utf8" }).trim(), ceiling: `${remote ? "remote URL specifier fetched by the loader; " : ""}fixture MCP/PAT and scripted provider, not a real graph`, nodeOnPath: false };
  writeFileSync(join(out, "outcome.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (serve && serve.exitCode === null) { serve.kill("SIGTERM"); await new Promise((r) => serve.once("exit", r)); }
  await fake.stop();
  if (asset) await new Promise((r) => asset.close(r));
  await new Promise((r) => provider.close(r));
}
