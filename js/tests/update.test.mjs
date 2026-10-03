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

import { BUILT_BRIDGE, REPO } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
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

/** Сброс лимита в подставном ответе: секунды эпохи, как в x-ratelimit-reset GitHub. */
const RESET = Math.floor(Date.now() / 1000) + 17 * 60;

/**
 * Подставные релизы: /releases/latest (API), /page/latest (страница релизов:
 * 302 на тег) и сырые файлы тега. limited — API отвечает исчерпанным анонимным
 * лимитом, как GitHub (true — со сбросом RESET; число — до этого мгновения, мс
 * эпохи, и сброс назван им); reset — назвать этот сброс (секунды эпохи) вместо
 * своего; secondary — вторичный лимит: 403 с retry-after в секундах при
 * оставшемся первичном; page: false — страница релизов тега не отдаёт.
 */
async function releases(
  t,
  tag = `v${NEWER}`,
  { limited = false, reset = null, secondary = null, page = true } = {},
) {
  const hits = [];
  const srv = createServer((req, res) => {
    hits.push(req.url);
    const end = (code, body) => {
      res.writeHead(code, { "content-type": "text/plain" });
      res.end(body);
    };
    const limitedNow = limited === true || (typeof limited === "number" && Date.now() < limited);
    if (req.url === "/releases/latest" && limitedNow) {
      res.writeHead(403, {
        "content-type": "application/json",
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(
          reset ?? (limited === true ? RESET : Math.ceil(limited / 1000)),
        ),
      });
      return res.end(JSON.stringify({ message: "API rate limit exceeded for 127.0.0.1." }));
    }
    if (req.url === "/releases/latest" && secondary) {
      res.writeHead(403, {
        "content-type": "application/json",
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "55",
        "x-ratelimit-reset": String(RESET),
        "retry-after": String(secondary),
      });
      return res.end(JSON.stringify({ message: "You have exceeded a secondary rate limit." }));
    }
    if (req.url === "/releases/latest") return end(200, JSON.stringify({ tag_name: tag }));
    if (req.url === "/page/latest" && page) {
      res.writeHead(302, { location: `http://${req.headers.host}/releases/tag/${tag}` });
      return res.end();
    }
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
      ISKRON_BRIDGE_RELEASES_PAGE_URL: `${base}/page/latest`,
      ISKRON_BRIDGE_RAW_URL: `${base}/raw`,
      ISKRON_BRIDGE_UPDATE_DELAY_MS: "0",
    },
  };
}

function startBridge(serverUrl, authDir, env, file = FILE) {
  const clean = { ...process.env };
  delete clean.ISKRON_BRIDGE_NO_UPDATE; // пробы гонят под выключателем; здесь он снимается, если сама проба его не ставит
  Object.assign(clean, env);
  const proc = spawn(NODE, [file, serverUrl, "--no-browser", "--auth-dir", authDir], {
    // ISKRON_BRIDGE_DAEMON=0 — полный мост в процессе: эти пробы о нём, не о шве.
    env: {
      ...clean,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_DAEMON: "0",
    },
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

// The home copy lies outside any skill set, so the set the starter came from
// rides to it in the environment (#6226): the place names the running bridge by
// build and the INSTALLED set by skills — here they differ, and that is the signal.
test("the skill set survives the hand-over: the home copy names the starter's set, not its own", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  writeFileSync(h.bridgePath, newerBuild());
  // The dev build in dist/dev carries no SKILL.md: the starter's set is the working copy's.
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), {
    HOME: h.root,
    ISKRON_SKILLS_ROOT: join(REPO, "skills"),
    CLAUDE_PLUGIN_ROOT: "",
  });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await waitFor(() => bridge.stderr.includes(`v${NEWER}+`), "the newer build to announce itself");
  const r = await bridge.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, name: "proba", model: "opus-5" },
  });
  assert.ok(!r.result?.isError, JSON.stringify(r));
  const connect = fake.state.placeArgs.find((x) => x.action === "connect");
  assert.equal(connect?.attrs?.build?.version, NEWER, JSON.stringify(connect));
  assert.equal(connect?.attrs?.skills?.version, MINE, JSON.stringify(connect?.attrs));
  assert.match(String(connect?.attrs?.skills?.stamp), /^[0-9a-f]{8}$/);
});

// #6650: only a release build refreshes the home — the release job stamps the channel
// (js/build.mjs under ISKRON_BUILD_CHANNEL=release); a working copy's make build-js is dev.
const OLD_HOME = '#!/usr/bin/env node\nconst VERSION = "0.0.1";\n';
const releaseBuildOf = (text) => text.replaceAll('"iskron-build:dev"', '"iskron-build:release"');

test("a newer release build lays itself into an older home at start", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  writeFileSync(h.bridgePath, OLD_HOME);
  const release = join(h.root, "release", "iskron.mjs");
  mkdirSync(dirname(release), { recursive: true });
  writeFileSync(release, releaseBuildOf(SELF));
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), { HOME: h.root }, release);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  assert.equal(
    readFileSync(h.bridgePath, "utf8"),
    releaseBuildOf(SELF),
    "the home copy must now be this very build",
  );
  assert.match(bridge.stderr, /дом обновлён этой сборкой/, bridge.stderr);
});

// #147 [140] 2: a machine whose home caught a dev build (#6650) is healed by the release
// of the same version — at an equal version the channel decides; a dev starter leaves a
// release home alone.
test("at an equal version a release build replaces only an explicit dev home — not an unmarked release — and a dev build leaves a release home", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const devText = SELF.replaceAll('"iskron-build:release"', '"iskron-build:dev"');
  const relText = releaseBuildOf(SELF);
  const at = (name, text) => {
    const p = join(h.root, name, "iskron.mjs");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    return p;
  };
  t.after(() => fake.stop());
  // #147 [145]: a home without a mark is a release before the marks (7.2.7): the same
  // version from main — other bytes, release mark — never rewrites it.
  const unmarked = devText.replaceAll('"iskron-build:dev"', '"no-mark"');
  writeFileSync(h.bridgePath, unmarked);
  const main = startBridge(fake.mcpUrl, join(h.root, "a0"), { HOME: h.root }, at("main", relText));
  try {
    assert.ok((await main.call("initialize", INIT)).result);
    assert.equal(readFileSync(h.bridgePath, "utf8"), unmarked, "an unmarked release home stays");
  } finally {
    await main.stop();
  }
  writeFileSync(h.bridgePath, devText);
  const healer = startBridge(fake.mcpUrl, join(h.root, "a1"), { HOME: h.root }, at("rel", relText));
  try {
    assert.ok((await healer.call("initialize", INIT)).result);
    assert.equal(readFileSync(h.bridgePath, "utf8"), relText, "the release healed the dev home");
  } finally {
    await healer.stop();
  }
  const dev = startBridge(fake.mcpUrl, join(h.root, "a2"), { HOME: h.root }, at("dev", devText));
  t.after(() => dev.stop());
  assert.ok((await dev.call("initialize", INIT)).result);
  assert.equal(
    readFileSync(h.bridgePath, "utf8"),
    relText,
    "a dev starter leaves the release home",
  );
});

test("a working copy's build, newer than the home, never lays itself into it — bridge or watchdog", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  writeFileSync(h.bridgePath, OLD_HOME);
  // Выход под пробой может быть и выпуском (main сразу после релиза): dev — та же сборка без метки выпуска.
  const dev = join(h.root, "worktree", "iskron.mjs");
  mkdirSync(dirname(dev), { recursive: true });
  writeFileSync(dev, SELF.replaceAll('"iskron-build:release"', '"iskron-build:dev"'));
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), { HOME: h.root }, dev);
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  assert.equal(readFileSync(h.bridgePath, "utf8"), OLD_HOME, "the bridge left the home as it was");
  assert.doesNotMatch(bridge.stderr, /дом обновлён этой сборкой/);
  const clean = { ...process.env, HOME: h.root };
  delete clean.ISKRON_BRIDGE_NO_UPDATE;
  const watchdog = spawn(NODE, [dev, "watchdog", "--help"], { env: clean, stdio: "pipe" });
  let err = "";
  watchdog.stderr.on("data", (c) => (err += c));
  await new Promise((r) => watchdog.on("exit", r));
  assert.equal(readFileSync(h.bridgePath, "utf8"), OLD_HOME, "nor did the watchdog");
  assert.doesNotMatch(err, /дом обновлён этой сборкой/);
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
  // Плоская установка: update ходит только по lock-файлу, набор приносит повторный
  // add --all; снятое убирается руками — проба держит строку, которой дверь
  // «обнови» ведёт плоский канал (#4659).
  assert.match(
    text,
    /плоская установка — повторный npx skills add iskron-ai\/skills --all --global/,
    "the flat-install order repeats add --all, not update",
  );
  assert.match(
    text,
    /npx skills remove <имя> --global/,
    "a skill dropped from the supply is named as a hand removal",
  );
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

function runUpdate(h, rel, authDir) {
  return new Promise((resolve) => {
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
}

test("update: fetches the release on demand and reports what was laid where", async (t) => {
  const h = home(t);
  const rel = await releases(t);
  const authDir = join(h.root, "auth");
  const r = await runUpdate(h, rel, authDir);
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

// Anonymous GitHub API gives 60 requests an hour per external address, and every
// bridge behind it (watches, subagent satellites, update) spends the same budget
// (graph @nks/nks-dev, vimarsha #6467). The releases page is not that API: its
// redirect names the fresh tag.
test("update: the API rate limit does not hide the fresh release — the tag comes from the releases page redirect", async (t) => {
  const h = home(t);
  const rel = await releases(t, `v${NEWER}`, { limited: true });
  const r = await runUpdate(h, rel, join(h.root, "auth"));
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, new RegExp(`свежий релиз: v${NEWER} \\(v${NEWER}\\)`), r.out);
  assert.equal(versionIn(readFileSync(h.bridgePath, "utf8")), NEWER, "the release is laid home");
  assert.ok(rel.hits.includes("/page/latest"), `the releases page was asked: ${rel.hits}`);
  const again = await runUpdate(h, rel, join(h.root, "auth-2"));
  assert.equal(again.code, 0, again.out + again.err);
  assert.equal(
    rel.hits.filter((u) => u === "/releases/latest").length,
    1,
    "a known exhausted limit is not asked again before its reset",
  );
});

test("update: a rate limit with no way around it is named as the limit with its reset, not as the network", async (t) => {
  const h = home(t);
  const rel = await releases(t, `v${NEWER}`, { limited: true, page: false });
  const r = await runUpdate(h, rel, join(h.root, "auth"));
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /лимит анонимного API GitHub исчерпан/, r.out);
  assert.match(r.out, /60 запросов в час/, r.out);
  assert.ok(r.out.includes(new Date(RESET * 1000).toISOString()), `the reset time: ${r.out}`);
  assert.ok(!/сеть или GitHub/.test(r.out), `no blame on the network: ${r.out}`);
});

test("update: a secondary rate limit (retry-after while the hourly budget remains) is a limit too, named with its deadline", async (t) => {
  const h = home(t);
  const rel = await releases(t, `v${NEWER}`, { secondary: 120, page: false });
  const r = await runUpdate(h, rel, join(h.root, "auth"));
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /вторичный лимит API GitHub/, r.out);
  assert.match(r.out, /сброс \S+ \(через 2 мин\)/, r.out);
  assert.match(r.out, /— лимит GitHub; повтори после сброса/, r.out);
  assert.ok(!/сеть или GitHub/.test(r.out), `no blame on the network: ${r.out}`);
});

// Bridges under ONE auth dir (the default ~/.iskron-bridge, satellites too)
// already shared latest.json before this change. What this probe proves is the
// narrower thing added here: the tag answer lives in the bridge home, so a
// bridge under ANOTHER auth dir takes it without asking GitHub.
test("a bridge under another auth dir takes the fresh tag from the home's release answer, not from GitHub", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const rel = await releases(t);
  t.after(() => fake.stop());
  const staleSeen = (b) => () => b.notifications.some((n) => n.params?.data?.kind === "stale");
  const first = startBridge(fake.mcpUrl, join(h.root, "auth-1"), { HOME: h.root, ...rel.env });
  t.after(() => first.stop());
  assert.ok((await first.call("initialize", INIT)).result);
  await waitFor(staleSeen(first), "the first bridge's stale notice");
  // The first one laid the release home, so the second runs as that newer copy
  // and has nothing stale to say — its finished check is its record.
  const secondDir = join(h.root, "auth-2");
  const second = startBridge(fake.mcpUrl, secondDir, { HOME: h.root, ...rel.env });
  t.after(() => second.stop());
  assert.ok((await second.call("initialize", INIT)).result);
  await waitFor(() => existsSync(join(secondDir, "latest.json")), "the second bridge's check");
  assert.equal(JSON.parse(readFileSync(join(secondDir, "latest.json"), "utf8")).tag, `v${NEWER}`);
  assert.equal(
    rel.hits.filter((u) => u === "/releases/latest" || u === "/page/latest").length,
    1,
    `one question to GitHub for the machine: ${rel.hits}`,
  );
});

// A failed check used to be recorded as "checked" for six hours and silenced the
// check of every bridge sharing the record (vimarsha #6467).
test("a failed check is not a six-hour answer: after the limit resets the watching bridge asks again", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const rel = await releases(t, `v${NEWER}`, { limited: Date.now() + 1500, page: false });
  const bridge = startBridge(fake.mcpUrl, join(h.root, "auth"), {
    HOME: h.root,
    ...rel.env,
    ISKRON_BRIDGE_RETRY_FLOOR_MS: "0", // пол и разброс повтора — минуты; проба ждёт секунды
    ISKRON_BRIDGE_RETRY_JITTER_MS: "300",
  });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await waitFor(
    () => bridge.notifications.some((n) => n.params?.data?.kind === "stale"),
    "the stale notice after the limit's reset",
  );
  assert.ok(
    rel.hits.filter((u) => u === "/releases/latest").length >= 2,
    `refused, then asked again: ${rel.hits}`,
  );
  assert.equal(versionIn(readFileSync(h.bridgePath, "utf8")), NEWER);
});

// A machine clock running ahead of GitHub reads the named reset as already past
// while the API still refuses: without a floor the retry would come every second.
test("a limit whose reset the machine clock already sees as past is retried after the floor, not in a tight loop", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const h = home(t);
  const past = Math.floor(Date.now() / 1000) - 60;
  const rel = await releases(t, `v${NEWER}`, { limited: true, reset: past, page: false });
  const authDir = join(h.root, "auth");
  const bridge = startBridge(fake.mcpUrl, authDir, {
    HOME: h.root,
    ...rel.env,
    ISKRON_BRIDGE_RETRY_JITTER_MS: "0",
  });
  t.after(async () => {
    await bridge.stop();
    await fake.stop();
  });
  assert.ok((await bridge.call("initialize", INIT)).result);
  await waitFor(() => existsSync(join(authDir, "latest.json")), "the first, refused check");
  await new Promise((r) => setTimeout(r, 3500));
  assert.equal(
    rel.hits.filter((u) => u === "/releases/latest").length,
    1,
    `no retry before the floor: ${rel.hits}`,
  );
});

for (const [what, seed] of [
  [
    "a rate limit that has reset",
    { error: "лимит анонимного API GitHub исчерпан", rate_limited_until: Date.now() - 1000 },
  ],
  ["a network failure a quarter of an hour old", { error: "fetch failed", ago: 16 * 60 * 1000 }],
]) {
  test(`a bridge started after a failed check (${what}) asks the releases instead of trusting the failure`, async (t) => {
    const fake = await startFakeNks({ pat: PAT });
    const h = home(t);
    const rel = await releases(t);
    const authDir = join(h.root, "auth");
    mkdirSync(authDir, { recursive: true });
    const { ago = 60 * 1000, ...rest } = seed;
    writeFileSync(
      join(authDir, "latest.json"),
      JSON.stringify({
        checked_at: Date.now() - ago,
        version: null,
        tag: null,
        downloaded: [],
        ...rest,
      }),
    );
    const bridge = startBridge(fake.mcpUrl, authDir, { HOME: h.root, ...rel.env });
    t.after(async () => {
      await bridge.stop();
      await fake.stop();
    });
    assert.ok((await bridge.call("initialize", INIT)).result);
    await waitFor(
      () => bridge.notifications.some((n) => n.params?.data?.kind === "stale"),
      "the stale notice from a fresh check",
    );
    assert.equal(JSON.parse(readFileSync(join(authDir, "latest.json"), "utf8")).version, NEWER);
  });
}

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
