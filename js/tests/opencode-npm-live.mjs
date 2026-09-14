// Opt-in acceptance: actual npm tarball, OpenCode serve, real bridge/WebSocket,
// local MCP and deterministic model. No production credentials or model calls.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createPortLease } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tarball = resolve(process.argv[2] || "");
assert.ok(process.argv[2], "Usage: node js/tests/opencode-npm-live.mjs TARBALL [OPENCODE_BINARY]");
const binary = process.argv[3] || "opencode";
const mode = process.env.ISKRON_NPM_PROBE_MODE || "tarball";
assert.ok(["tarball", "registry"].includes(mode), "ISKRON_NPM_PROBE_MODE: tarball or registry");
const manifest = JSON.parse(
  execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" }),
);
const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0);
mkdirSync(join(root, "dist"), { recursive: true });
const sandbox = mkdtempSync(join(root, "dist/npm-live-"));
const work = join(sandbox, "work");
mkdirSync(work);
const home = join(sandbox, "home");
mkdirSync(home);
const fake = await startFakeNks({ pat: "fixture-pat" });
await fake.control({ richTools: true });
let downloads = 0;
let metadataRequests = 0;
const modelRequests = [];
const api = createServer(async (req, res) => {
  if (req.method === "GET" && decodeURIComponent(req.url).startsWith("/@iskron/opencode")) {
    metadataRequests++;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        name: manifest.name,
        "dist-tags": { latest: manifest.version },
        versions: {
          [manifest.version]: { ...manifest, dist: { tarball: `${base}/plugin.tgz`, integrity } },
        },
      }),
    );
  }
  if (req.url === "/plugin.tgz") {
    downloads++;
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(readFileSync(tarball));
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  const messages = body.messages ?? [];
  modelRequests.push(messages);
  const lastUser = messages.filter((m) => m.role === "user").at(-1);
  const text =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : (lastUser?.content ?? [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
  const boot = /BOOT:([AB])/.exec(text)?.[1];
  const wake = /WAKE:[A-Z0-9-]+/.exec(text)?.[0];
  const needsTool = boot && messages.at(-1)?.role !== "tool";
  const delta = needsTool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `stand-${boot}`,
            type: "function",
            function: {
              name: "iskron_stand",
              arguments: JSON.stringify({ realm: "nks-dev", karta: "931", name: `npm-${boot}` }),
            },
          },
        ],
      }
    : { role: "assistant", content: wake ? `ACK:${wake}` : `BOOTED:${boot ?? "helper"}` };
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (d, finish_reason = null) =>
    `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: d, finish_reason }] })}\n\n`;
  res.end(chunk(delta) + chunk({}, needsTool ? "tool_calls" : "stop") + "data: [DONE]\n\n");
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${api.address().port}`;
writeFileSync(join(home, ".npmrc"), `@iskron:registry=${base}/\n`);
const config = {
  $schema: "https://opencode.ai/config.json",
  plugin: [mode === "registry" ? `${manifest.name}@${manifest.version}` : `${base}/plugin.tgz`],
  model: "fixture/fixture",
  small_model: "fixture/fixture",
  enabled_providers: ["fixture"],
  provider: {
    fixture: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: `${base}/v1`, apiKey: "fixture" },
      models: { fixture: { name: "fixture", limit: { context: 200000, output: 4096 } } },
    },
  },
  permission: "allow",
  skills: { paths: [join(sandbox, "existing-skills")] },
  autoupdate: false,
};
mkdirSync(join(sandbox, "existing-skills"));
writeFileSync(join(sandbox, "opencode.json"), JSON.stringify(config));
const env = {
  PATH: process.env.PATH,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
  OPENCODE_CONFIG: join(sandbox, "opencode.json"),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  ISKRON_BRIDGE_TOKEN: "fixture-pat",
  ISKRON_BRIDGE_URL: fake.mcpUrl,
  ISKRON_BRIDGE_AUTH_DIR: join(home, "auth"),
  ISKRON_BRIDGE_NO_BROWSER: "1",
};
const lease = createPortLease();
await new Promise((r) => lease.listen(0, "127.0.0.1", r));
const port = lease.address().port;
await new Promise((r) => lease.close(r));
const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: work,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let startupError;
child.on("error", (error) => {
  startupError = error;
});
child.stdout.on("data", (c) => {
  output += c;
});
child.stderr.on("data", (c) => {
  output += c;
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`serve exited: ${child.exitCode}`);
    if (await fn()) return;
    await delay(150);
  }
  throw new Error(`Timeout: ${label}`);
}
function wsFrame(text) {
  const data = Buffer.from(text);
  const header =
    data.length < 126
      ? Buffer.from([0x81, data.length])
      : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
  return Buffer.concat([header, data]);
}
try {
  await until(() => /http:\/\/127\.0\.0\.1:\d+/.test(output), "server URL");
  const server = /http:\/\/127\.0\.0\.1:\d+/.exec(output)[0];
  async function request(path, method = "GET", body) {
    const response = await fetch(server + path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(90000),
    });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const skills = await request("/skill");
  assert.ok(
    skills.some((s) => s.name === "iskron"),
    "first request discovers packaged skills",
  );
  assert.equal(skills.filter((s) => s.name === "iskron").length, 1);
  assert.match(
    skills.find((s) => s.name === "establish-mcp")?.content ?? "",
    /Сначала различи npm-установку OpenCode/,
  );
  assert.ok(downloads > 0, "tarball fetched by OpenCode on a cold cache");
  if (mode === "registry")
    assert.ok(metadataRequests > 0, "npm name/version resolved from the scoped registry");
  const actual = await request("/config");
  assert.ok(actual.skills.paths.includes(join(sandbox, "existing-skills")));
  const ids = {};
  const sockets = {};
  async function texts(id) {
    const messages = await request(`/session/${id}/message`);
    return messages
      .filter((m) => m.info.role === "assistant")
      .flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text));
  }
  async function idle(id) {
    await until(
      async () =>
        !(await request("/session/status"))[id] ||
        (await request("/session/status"))[id]?.type === "idle",
      "idle",
    );
  }
  for (const label of ["A", "B"]) {
    const before = new Set(fake.state.ws);
    const session = await request("/session", "POST", { title: `npm-${label}` });
    ids[label] = session.id;
    await request(`/session/${session.id}/prompt_async`, "POST", {
      parts: [{ type: "text", text: `BOOT:${label}` }],
    });
    await until(async () => (await texts(session.id)).includes(`BOOTED:${label}`), `boot ${label}`);
    await idle(session.id);
    sockets[label] = [...fake.state.ws].find((s) => !before.has(s));
    assert.ok(sockets[label], `${label} took a real bridge socket`);
    sockets[label].resume(); // Drain client close frames so TCP EOF is observable in this fixture.
    sockets[label].once("end", () => sockets[label].end()); // Upgraded HTTP sockets allow half-close.
  }
  for (const [label, marker] of [
    ["B", "WAKE:B-1"],
    ["A", "WAKE:A-1"],
    ["B", "WAKE:B-2"],
  ]) {
    await delay(500);
    sockets[label].write(wsFrame(JSON.stringify({ type: "message", id: marker, body: marker })));
    await until(
      async () => (await texts(ids[label])).includes(`ACK:${marker}`),
      `channel wake ${marker}`,
    );
    await idle(ids[label]);
    const other = label === "A" ? "B" : "A";
    assert.ok(!(await texts(ids[other])).includes(`ACK:${marker}`), "no cross-session delivery");
  }
  await request(`/session/${ids.A}`, "DELETE");
  await until(() => sockets.A.destroyed, "A bridge socket closes");
  sockets.B.write(
    wsFrame(JSON.stringify({ type: "message", id: "after-delete", body: "WAKE:B-3" })),
  );
  await until(async () => (await texts(ids.B)).includes("ACK:WAKE:B-3"), "B survives A deletion");
  assert.equal(fake.state.counts.authorize, 0, "PAT never opens OAuth");
  process.stdout.write(
    `PASS OpenCode ${version.stdout.trim()} (${mode}): cold npm download, skills, PAT, A/B idle wake, repeated wake, deletion isolation; model requests=${modelRequests.length}\n`,
  );
} finally {
  child.kill("SIGTERM");
  const hard = setTimeout(() => child.kill("SIGKILL"), 3000);
  if (child.pid && child.exitCode === null) await once(child, "exit").catch(() => {});
  clearTimeout(hard);
  await fake.stop();
  api.closeAllConnections();
  await new Promise((r) => api.close(r));
  writeFileSync(join(sandbox, "serve.log"), output);
  writeFileSync(join(sandbox, "model-requests.json"), JSON.stringify(modelRequests, null, 2));
  process.stdout.write(`Artifacts: ${sandbox}\n`);
}
