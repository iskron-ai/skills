// Проба самообновления моста (граф nks-dev: #4509 под #4504): дом против себя
// при старте (своя новее — ложится в дом; домашняя новее — запускается она),
// сверка с релизами и скачивание свежего в дом, строка отставания в ответе
// тула, подкоманда update, выключатель для проб.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: прежний мост не выравнивает
// дом и не знает подкоманды update — краснота, ради которой проба написана.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const HERE = dirname(fileURLToPath(import.meta.url));
const FILE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "update-probe", version: "0" },
};
const PAT = "nks_pat_update";
const SELF = readFileSync(FILE, "utf8");
const versionIn = (text) => /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
const MINE = versionIn(SELF);
const NEWER = "99.0.0";
/** Та же сборка, назвавшаяся новее: версия — единственное, чем дом судит о старшинстве. */
const newerBuild = () => SELF.replace(/^((?:const|let|var) VERSION = ")[^"]+(")/m, `$1${NEWER}$2`);

function home(t) {
  const root = mkdtempSync(join(tmpdir(), "iskron-update-home-"));
  const dir = join(root, ".iskron-bridge");
  mkdirSync(dir, { recursive: true });
  return { root, dir, bridgePath: join(dir, "iskron-bridge.mjs") };
}

/** Подставные релизы: /releases/latest и сырые файлы тега. */
async function releases(t, tag = `v${NEWER}`) {
  const hits = [];
  const srv = createServer((req, res) => {
    hits.push(req.url);
    const end = (code, body) => {
      res.writeHead(code, { "content-type": "text/plain" });
      res.end(body);
    };
    if (req.url === "/releases/latest") return end(200, JSON.stringify({ tag_name: tag }));
    if (req.url === `/raw/${tag}/skills/establish-mcp/scripts/iskron.mjs`)
      return end(200, newerBuild());
    if (req.url === `/raw/${tag}/skills/establish-mcp/scripts/opencode-plugin.js`)
      return end(200, "// plugin 99\n");
    if (req.url === `/raw/${tag}/SETUP.md`) return end(200, "# Установка 99\n");
    end(404, "нет");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => srv.close(r)));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    hits,
    env: {
      ISKRON_BRIDGE_RELEASES_URL: `${base}/releases/latest`,
      ISKRON_BRIDGE_RAW_URL: `${base}/raw`,
      ISKRON_BRIDGE_UPDATE_DELAY_MS: "0",
    },
  };
}

function startBridge(serverUrl, authDir, env) {
  const clean = { ...process.env };
  delete clean.ISKRON_BRIDGE_NO_UPDATE; // пробы гонят под выключателем; здесь он снимается, если сама проба его не ставит
  Object.assign(clean, env);
  const proc = spawn(NODE, [FILE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...clean, ISKRON_BRIDGE_NO_BROWSER: "1", ISKRON_BRIDGE_TOKEN: PAT },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  const notifications = [];
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined && msg.method) {
        notifications.push(msg);
        continue;
      }
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let id = 0;
  return {
    proc,
    notifications,
    get stderr() {
      return stderr;
    },
    call(method, params = {}) {
      const myId = ++id;
      const p = new Promise((res, rej) => {
        waiters.set(myId, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${myId})`)), 20_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return p;
    },
    stop: () =>
      proc.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.kill("SIGKILL");
          }),
  };
}

async function waitFor(check, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("a bridge started from any path hands over to a newer home copy — same stdio, newer build", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  writeFileSync(h.bridgePath, newerBuild());
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), { HOME: h.root });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  const init = await bridge.call("initialize", INIT);
  assert.ok(init.result, `initialize through the handed-over bridge: ${JSON.stringify(init)}`);
  await waitFor(() => bridge.stderr.includes(`v${NEWER}+`), "the newer build to announce itself");
  assert.match(bridge.stderr, /домашняя копия новее этой сборки/, bridge.stderr);
  assert.equal(
    readFileSync(h.bridgePath, "utf8"),
    newerBuild(),
    "the home copy is untouched by the older starter",
  );
});

test("a newer bridge lays itself into an older home at start", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  writeFileSync(h.bridgePath, '#!/usr/bin/env node\nconst VERSION = "0.0.1";\n');
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), { HOME: h.root });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  assert.equal(
    readFileSync(h.bridgePath, "utf8"),
    SELF,
    "the home copy must now be this very build",
  );
  assert.match(bridge.stderr, /дом обновлён этой сборкой/, bridge.stderr);
});

test("a newer release is fetched into the home once per six hours and named in the first tool answer", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const rel = await releases(t);
  const authDir = join(h.root, "auth");
  const bridge = startBridge(fake.mcpUrl, authDir, { HOME: h.root, ...rel.env });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await waitFor(
    () =>
      bridge.notifications.some(
        (n) => n.params?.logger === "iskron-bridge" && n.params?.data?.kind === "stale",
      ),
    "the stale notice as an MCP notification",
  );
  assert.equal(
    versionIn(readFileSync(h.bridgePath, "utf8")),
    NEWER,
    "the newer bridge must be in the home",
  );
  assert.equal(
    readFileSync(join(authDir, "SETUP.md"), "utf8"),
    "# Установка 99\n",
    "the installer rides along",
  );
  const latest = JSON.parse(readFileSync(join(authDir, "latest.json"), "utf8"));
  assert.equal(latest.version, NEWER);
  const reply = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "list", realm: "nks-dev" },
  });
  const text = (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.match(text, /ПОСТАВКА ОТСТАЛА: этот мост v\d+\.\d+\.\d+, свежий релиз v99\.0\.0/, text);
  assert.match(text, /СКАЗАТЬ ЧЕЛОВЕКУ/, "the notice tells the agent to pass the word on");
  const again = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "list", realm: "nks-dev" },
  });
  assert.ok(
    !JSON.stringify(again).includes("ПОСТАВКА ОТСТАЛА"),
    "the notice rides one answer, not every one",
  );
  assert.equal(
    rel.hits.filter((u) => u === "/releases/latest").length,
    1,
    "one question to the releases per window",
  );
});

test("update: fetches the release on demand and reports what was laid where", async (t) => {
  const h = home(t);
  const rel = await releases(t);
  const authDir = join(h.root, "auth");
  const r = await new Promise((resolve) => {
    const proc = spawn(NODE, [FILE, "update", "--auth-dir", authDir], {
      env: { ...process.env, HOME: h.root, ...rel.env, ISKRON_BRIDGE_NO_UPDATE: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("exit", (code) => resolve({ code, out, err }));
  });
  assert.equal(r.code, 0, r.err);
  assert.match(
    r.out,
    new RegExp(`свежий релиз: v${NEWER} \\(v${NEWER}\\); этот файл: v${MINE} — отстал`),
    r.out,
  );
  assert.match(r.out, /положено: .*iskron-bridge\.mjs/, r.out);
  assert.match(r.out, /положено: .*SETUP\.md/, r.out);
  assert.match(r.out, /прочти его и исполни/, "the report hands the fresh installer to the agent");
  assert.equal(versionIn(readFileSync(h.bridgePath, "utf8")), NEWER);
  assert.ok(existsSync(join(authDir, "SETUP.md")));
});

test("ISKRON_BRIDGE_NO_UPDATE: neither the home nor the releases are touched", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const rel = await releases(t);
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), {
    HOME: h.root,
    ...rel.env,
    ISKRON_BRIDGE_NO_UPDATE: "1",
  });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!existsSync(h.bridgePath), "no home copy is written under the switch");
  assert.equal(rel.hits.length, 0, "no question to the releases under the switch");
});

test("a symlinked home is never replaced, and the stale notice says so instead of claiming a download", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const rel = await releases(t);
  const target = join(h.root, "working-copy.mjs");
  writeFileSync(target, '#!/usr/bin/env node\nconst VERSION = "0.0.1";\n');
  symlinkSync(target, h.bridgePath);
  const authDir = join(h.root, "auth");
  const bridge = startBridge(fake.mcpUrl, authDir, { HOME: h.root, ...rel.env });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "stale"),
    "the stale notice",
  );
  assert.ok(lstatSync(h.bridgePath).isSymbolicLink(), "the symlink survives");
  assert.equal(
    versionIn(readFileSync(target, "utf8")),
    "0.0.1",
    "the symlink's target is untouched",
  );
  const notice = bridge.notifications.find((n) => n.params?.data?.kind === "stale").params.data
    .text;
  assert.match(notice, /дом — симлинк/, notice);
  assert.ok(!/уже лежит в/.test(notice), "no claim that a fresh bridge was laid down");
});

test("the stale notice survives an errored first tool answer and rides the next one with a body", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const rel = await releases(t);
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), { HOME: h.root, ...rel.env });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "stale"),
    "the stale notice",
  );
  await fake.control({ mcpStatus: 503 });
  const failed = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "list", realm: "nks-dev" },
  });
  assert.ok(failed.error, "the faulted call must come back as an error");
  await fake.control({ mcpStatus: null });
  const next = await bridge.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "list", realm: "nks-dev" },
  });
  const text = (next.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  assert.match(text, /ПОСТАВКА ОТСТАЛА/, "the notice was kept for the first answer with a body");
});
