// Verify the deterministic HTTP executor before using it on a paid VM.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as portLease } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const binary = process.argv[2];
assert.ok(binary, "Usage: node js/tests/opencode-shell-live.mjs /absolute/path/to/opencode");
const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0);
mkdirSync(join(root, "dist"), { recursive: true });
const dir = mkdtempSync(join(root, "dist/shell-live-"));
let modelCalls = 0;
let guestReads = 0;
const guestMarker = `GUEST_${randomUUID().replaceAll("-", "")}`;
const model = createServer((req, res) => {
  if (req.url === "/guest-health") {
    guestReads++;
    res.writeHead(200);
    return res.end(guestMarker);
  }
  if (req.url === "/guest-refused") {
    guestReads++;
    res.writeHead(503);
    return res.end("fixture unavailable");
  }
  modelCalls++;
  res.writeHead(500);
  res.end("The shell executor must not call a model");
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const lease = portLease();
await new Promise((r) => lease.listen(0, "127.0.0.1", r));
const port = lease.address().port;
await new Promise((r) => lease.close(r));
const home = join(dir, "home");
mkdirSync(home);
const config = join(dir, "opencode.json");
writeFileSync(
  config,
  JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: "fixture/fixture",
    enabled_providers: ["fixture"],
    provider: {
      fixture: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: `http://127.0.0.1:${model.address().port}/v1`,
          apiKey: "fixture",
        },
        models: { fixture: { name: "fixture", limit: { context: 200000, output: 4096 } } },
      },
    },
    plugin: [],
    permission: "allow",
    autoupdate: false,
  }),
);
const proc = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: dir,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local/state"),
    OPENCODE_CONFIG: config,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  },
});
let output = "";
let error;
proc.on("error", (e) => {
  error = e;
});
proc.stdout.on("data", (c) => {
  output += c;
});
proc.stderr.on("data", (c) => {
  output += c;
});
const base = `http://127.0.0.1:${port}`;
const request = async (path, method = "GET", body) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  assert.ok(res.ok, `${method} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
};
try {
  const deadline = Date.now() + 30000;
  while (!output.includes(base)) {
    if (error) throw error;
    assert.equal(proc.exitCode, null, "serve must stay running");
    assert.ok(Date.now() < deadline, "serve start deadline");
    await new Promise((r) => setTimeout(r, 100));
  }
  const session = await request("/session", "POST", { title: "deterministic-executor-probe" });
  try {
    for (const code of [0, 7]) {
      const marker = `EXEC_${randomUUID().replaceAll("-", "")}`;
      const result = await request(`/session/${session.id}/shell`, "POST", {
        agent: "build",
        model: { providerID: "fixture", modelID: "fixture" },
        command: `printf '${marker}\\n'; if (exit ${code}); then printf 'EXEC_RC=0\\n'; else printf 'EXEC_RC=7\\n'; fi`,
      });
      const tools = result.parts.filter((p) => p.type === "tool");
      assert.equal(tools.length, 1);
      assert.equal(tools[0].state.status, "completed");
      assert.equal(tools[0].state.output.trim(), `${marker}\nEXEC_RC=${code}`);
      assert.equal(modelCalls, 0, "POST shell must not call a model");
      process.stdout.write(`PASS shell marker + explicit exit ${code}, zero model calls\n`);
    }
    for (const [path, expected] of [
      ["guest-health", "HTTP_OK"],
      ["guest-refused", "HTTP_REFUSED"],
    ]) {
      const response = await request(`/session/${session.id}/shell`, "POST", {
        agent: "build",
        model: { providerID: "fixture", modelID: "fixture" },
        command: `if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:${model.address().port}/${path}; then printf '\\nHTTP_OK\\n'; else printf '\\nHTTP_REFUSED\\n'; fi`,
      });
      const text = response.parts.find((p) => p.type === "tool")?.state?.output ?? "";
      assert.ok(text.trim().endsWith(expected));
      assert.equal(text.includes(guestMarker), path === "guest-health");
      assert.equal(modelCalls, 0);
      process.stdout.write(`PASS loopback ${path}, ${expected}, zero model calls\n`);
    }
    assert.equal(guestReads, 2, "HTTP commands really reached the fixture");
    const client = join(root, "js/tests/opencode-vm.mjs");
    for (const action of ["probe", "tools", "catalog", "observe"]) {
      const result = await promisify(execFile)(
        process.execPath,
        [client, action, base, session.id],
        { env: { ...process.env, VERIFY_OPENCODE_NO_AUTH: "1" } },
      );
      const evidence = JSON.parse(result.stdout);
      assert.ok(evidence, `${action} returns structured evidence`);
      if (action === "catalog") {
        assert.ok(evidence.agents.some((a) => a.name === "build"));
        assert.ok(
          evidence.agents.every((a) => Object.keys(a).every((k) => ["name", "model"].includes(k))),
        );
        assert.ok(evidence.tools.length > 0);
      }
    }
    for (const code of [0, 7]) {
      const script = join(dir, `client-${code}.sh`);
      writeFileSync(script, `printf 'CLIENT_MARKER\\n'\nexit ${code}\n`);
      let result;
      try {
        result = await promisify(execFile)(
          process.execPath,
          [client, "shell", base, session.id, script],
          {
            env: {
              ...process.env,
              VERIFY_OPENCODE_NO_AUTH: "1",
              VERIFY_OPENCODE_MODEL: "fixture/fixture",
            },
          },
        );
        assert.equal(code, 0, "negative command must fail in the operator client");
        assert.match(result.stdout, /CLIENT_MARKER/);
        assert.match(result.stdout, /"shellCompleted":true/);
      } catch (error) {
        assert.equal(code, 7);
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Shell failed or result incomplete/);
      }
      assert.equal(modelCalls, 0);
      process.stdout.write(`PASS operator CLI base64 script, exit ${code}, zero model calls\n`);
    }
    await request(`/session/${session.id}/message`, "POST", {
      agent: "build",
      model: { providerID: "fixture", modelID: "fixture" },
      noReply: true,
      parts: [{ type: "text", text: "READY-A" }],
    });
    await assert.rejects(
      promisify(execFile)(process.execPath, [client, "wait", base, session.id, "READY-A"], {
        env: { ...process.env, VERIFY_OPENCODE_NO_AUTH: "1", VERIFY_OPENCODE_WAIT_MS: "1000" },
      }),
      (error) => error.code === 1 && /no completed assistant response/.test(error.stderr),
      "a marker in the input is not an assistant response",
    );
    assert.equal(modelCalls, 0);
    process.stdout.write("PASS reply observer rejects user-only marker\n");
    if (process.env.VERIFY_CONTAINER_PEER_SCRIPTS) {
      const controls = await promisify(execFile)(
        "python3",
        [
          join(root, "js/tests/container-via-opencode.py"),
          base,
          session.id,
          process.env.VERIFY_CONTAINER_PEER_SCRIPTS,
          client,
          process.execPath,
        ],
        { timeout: 90000 },
      );
      process.stdout.write(controls.stdout);
      assert.equal(modelCalls, 0);
      process.stdout.write("PASS exact container controls through HTTP shell, zero model calls\n");
    }
  } finally {
    await request(`/session/${session.id}`, "DELETE");
  }
  process.stdout.write(`PASS deterministic executor on OpenCode ${version.stdout.trim()}\n`);
} finally {
  proc.kill("SIGTERM");
  const hard = setTimeout(() => proc.kill("SIGKILL"), 3000);
  if (proc.pid && proc.exitCode === null) await once(proc, "exit");
  clearTimeout(hard);
  model.closeAllConnections();
  await new Promise((r) => model.close(r));
  writeFileSync(join(dir, "serve.log"), output);
  process.stdout.write(`Artifacts: ${dir}\n`);
}
