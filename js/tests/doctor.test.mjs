// Probe for the single shipped file's front door — subcommand dispatch, the
// build string, and `doctor` (graph nks-dev: bianhua #4220). `doctor` is the
// one command that answers, on the user's machine, "which build is standing
// here and does it work"; its whole value is that every line is a fact read
// now, so the probe checks the facts against a fake server and a scratch
// grant store, and that the run leaves both untouched.
//
// ISKRON_BRIDGE_PATH points the same probe at any copy so it can be shown red
// before a change — against the previous single-purpose bridge, `doctor` is
// read as a server URL and refused, which is exactly the red this probe wants.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

// Чем запускать поставку: node по умолчанию; ISKRON_NODE подставляет другой рантайм
// (например, `opencode` под BUN_BE_BUN=1 — Bun, встроенный в OpenCode).
const NODE = process.env.ISKRON_NODE || process.execPath;

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const PLUGIN = JSON.parse(
  readFileSync(join(HERE, "..", "..", ".claude-plugin", "plugin.json"), "utf8"),
);

function run(args, env = {}, cwd = undefined) {
  return new Promise((resolve) => {
    const proc = spawn(NODE, [FILE, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("exit", (code) => resolve({ code, out, err }));
  });
}

test("--version names the plugin's version as the build, whichever subcommand asks", async () => {
  const re = new RegExp(`^v${PLUGIN.version.replaceAll(".", "\\.")}\\+[0-9a-f]{8}$`);
  const top = await run(["--version"]);
  assert.match(top.out.trim(), re, `top-level --version: ${top.out}`);
  const viaBridge = await run(["bridge", "--version"]);
  assert.equal(
    viaBridge.out.trim(),
    top.out.trim(),
    "the bridge subcommand must name the same build",
  );
});

test("--help lists every subcommand and exits 0", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  for (const sub of ["bridge", "watchdog", "watchdog-exit", "doctor"]) {
    assert.ok(r.out.includes(sub), `usage does not mention ${sub}`);
  }
});

test("doctor: names the build, the server, an empty grant — and writes nothing", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const authDir = join(home, ".iskron-bridge");
  try {
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home });
    assert.equal(r.code, 0, `doctor exited ${r.code}: ${r.err}`);
    assert.match(
      r.out,
      /iskron doctor — v\d+\.\d+\.\d+\+[0-9a-f]{8}/,
      "the first line must name the build",
    );
    assert.ok(r.out.includes(`сервер: ${fake.mcpUrl}`), "the server must be named as given");
    assert.match(
      r.out,
      /отвечает: HTTP 401 \(просит OAuth\)/,
      "an unauthenticated ping must read as the server asking for OAuth",
    );
    assert.match(
      r.out,
      /token endpoint http:\/\/127\.0\.0\.1:\d+\/token/,
      "discovery must name the token endpoint it found",
    );
    assert.match(
      r.out,
      /хранилища нет/,
      "with no store the grant must read as absent, not as broken",
    );
    assert.match(
      r.out,
      /домашняя копия: нет/,
      "a home without a bridge copy is named, not assumed",
    );
    assert.ok(
      !readdirSync(home).includes(".iskron-bridge") || readdirSync(authDir).length === 0,
      "doctor must not create a grant store or a log",
    );
  } finally {
    await fake.stop();
  }
});

test("doctor: reads an existing grant without touching it, and sees the home copy", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const authDir = join(home, ".iskron-bridge");
  try {
    // Let a real bridge run lay down the store: initialize once, no browser.
    const bridge = spawn(
      process.execPath,
      [FILE, fake.mcpUrl, "--no-browser", "--auth-dir", authDir],
      {
        env: { ...process.env, HOME: home },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let first = "";
    const firstReply = new Promise((res) =>
      bridge.stdout.on("data", (c) => {
        first += c;
        if (first.includes("\n")) res(first);
      }),
    );
    bridge.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }) + "\n",
    );
    await firstReply;
    // Open the login link as a human would: the sign-in page is minted then, and
    // the client registration with it (#4794) — the client doctor must report.
    const link = /(http:\/\/127\.0\.0\.1:\d+\/login\?k=[\w-]+)/.exec(first)?.[1];
    assert.ok(link, `the bridge must hand out a login link: ${first}`);
    await (await fetch(link, { redirect: "manual" })).text();
    // The bridge outlives a pending login on purpose (the human may be mid-click),
    // so a polite stdin close would wait for that flow; the store is already
    // written by discovery, and the probe only needs the store.
    bridge.kill("SIGKILL");
    await new Promise((res) => bridge.on("exit", res));
    const files = readdirSync(authDir);
    const storeFile = files.find((f) => f.endsWith(".json"));
    assert.ok(storeFile, `the bridge left no store in ${authDir}: ${files.join(", ")}`);
    const before = readFileSync(join(authDir, storeFile), "utf8");
    // A home copy that differs from the packaged file, with a readable version.
    writeFileSync(
      join(authDir, "iskron-bridge.mjs"),
      '#!/usr/bin/env node\nconst VERSION = "0.0.1";\n',
    );

    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /грант: .*\.json/, "the store path must be named");
    assert.match(r.out, /client_id: /, "the registered client must be reported");
    assert.match(
      r.out,
      /домашняя копия: .*v0\.0\.1\+[0-9a-f]{8}, ДРУГИЕ байты/,
      "a diverged home copy must be named with its version and hash",
    );
    assert.equal(
      readFileSync(join(authDir, storeFile), "utf8"),
      before,
      "doctor must leave the store byte-identical",
    );
  } finally {
    await fake.stop();
  }
});

// A regular install keeps the bridge entry in the plugin manifests, not in the
// user's config, and the Codex home is wherever CODEX_HOME points (graph
// @nks/nks-dev, node #4279). doctor must see the plugins, not report "no entry".
test("doctor: sees the bridge entry inside the Claude Code and Codex plugins, not only the user configs", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  try {
    const install = join(home, ".claude", "plugins", "cache", "iskron", "iskron", "9.9.9");
    mkdirSync(install, { recursive: true });
    writeFileSync(
      join(install, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          iskron: {
            command: "node",
            args: ["${CLAUDE_PLUGIN_ROOT}/skills/establish-mcp/scripts/iskron.mjs"],
          },
        },
      }),
    );
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "iskron@iskron": [{ scope: "user", installPath: install, version: "9.9.9" }] },
      }),
    );
    const codexHome = join(home, "cxh");
    const codexPlugin = join(codexHome, "plugins", "cache", "iskron", "iskron", ".codex-plugin");
    mkdirSync(codexPlugin, { recursive: true });
    writeFileSync(
      join(codexPlugin, "plugin.json"),
      JSON.stringify({
        name: "iskron",
        version: "9.9.9",
        mcpServers: {
          iskron: {
            command: "node",
            args: ["./skills/establish-mcp/scripts/iskron.mjs"],
            cwd: ".",
          },
        },
      }),
    );

    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")], {
      HOME: home,
      CODEX_HOME: codexHome,
    });
    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /Claude Code: плагин iskron@iskron v9\.9\.9 \(user\) — запись «iskron» → мост из плагина/,
      `the plugin-scoped entry must be reported: ${r.out}`,
    );
    assert.match(
      r.out,
      /Codex: плагин iskron@iskron — v9\.9\.9, запись моста в манифесте есть/,
      `the Codex plugin under CODEX_HOME must be reported: ${r.out}`,
    );
    assert.doesNotMatch(
      r.out,
      /Claude Code: в пользовательском конфиге записи моста нет/,
      "a healthy install must not be reported as having no entry",
    );
  } finally {
    await fake.stop();
  }
});

// Рядом с плагином OpenCode может стоять запись mcp того же моста: её тулы едут
// namespaced и ведут ОДИН мост на все сессии сервиса, поэтому запись дочерней
// сессии уходит под подписью соседа (граф nks-dev: #5553, класс #4283). doctor
// обязан назвать эту запись: выбор соседнего тула иначе ничем не виден.
test("doctor names an mcp entry of the same bridge next to the OpenCode plugin", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  try {
    const cfg = join(home, ".config", "opencode");
    mkdirSync(join(cfg, "plugins"), { recursive: true });
    writeFileSync(join(cfg, "plugins", "iskron.js"), "// плагин поставки");
    writeFileSync(
      join(cfg, "opencode.json"),
      JSON.stringify({
        mcp: {
          iskron: {
            type: "local",
            command: ["node", join(home, ".iskron-bridge", "iskron-bridge.mjs")],
          },
        },
      }),
    );
    const authDir = mkdtempSync(join(tmpdir(), "iskron-doctor-auth-"));
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home });
    assert.match(r.out, /OpenCode: запись mcp «iskron»/, `the entry must be named: ${r.out}`);
  } finally {
    await fake.stop();
  }
});

// `opencode mcp add` без --global пишет в конфиг ПРОЕКТА (поверхность #5559):
// смотреть только глобальный файл значит молчать там, где запись вероятнее.
// И наоборот: чужой сервер, чей путь лежит в каталоге со словом iskron, своим
// не становится — иначе совет «убери запись» приходит на чужую работу.
test("doctor reads the project config too, and leaves a foreign server alone", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const project = mkdtempSync(join(tmpdir(), "iskron-doctor-proj-"));
  try {
    writeFileSync(
      join(project, "opencode.json"),
      JSON.stringify({
        mcp: {
          "iskron-bridge": {
            type: "local",
            command: ["node", join(home, ".iskron-bridge", "iskron-bridge.mjs")],
          },
          чужой: { type: "local", command: ["node", join(home, "code", "iskron", "other.mjs")] },
          "чужой-удалённый": { type: "remote", url: "https://example.com/mcp" },
        },
      }),
    );
    const authDir = mkdtempSync(join(tmpdir(), "iskron-doctor-auth-"));
    // Конфиг читается вверх по дереву: запись этажом выше так же опасна.
    const deep = join(project, "child", "deep");
    mkdirSync(deep, { recursive: true });
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home }, deep);
    assert.match(r.out, /запись mcp «iskron-bridge»/, `the entry above must be named: ${r.out}`);
    assert.doesNotMatch(
      r.out,
      /«чужой»|«чужой-удалённый»/,
      `a foreign server must be left alone: ${r.out}`,
    );
    // Чистый отчёт обязан называть охват: doctor идёт вверх от своего каталога.
    const elsewhere = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", authDir],
      { HOME: home },
      home,
    );
    assert.match(
      elsewhere.out,
      /записей mcp Искрона не нашёл — смотрел вверх от/,
      `an empty report must name what it looked at: ${elsewhere.out}`,
    );
  } finally {
    await fake.stop();
  }
});

// Три рода записи различаются ценой: мост поставки — чужая подпись, нативная
// http-запись — законный запасной путь, выключенная — не в игре. И .jsonc
// существует ради комментариев: JSON.parse на них падает (#5559).
test("doctor tells the bridge entry from the http fallback and reads jsonc with comments", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const project = mkdtempSync(join(tmpdir(), "iskron-doctor-proj-"));
  try {
    writeFileSync(
      join(project, "opencode.jsonc"),
      [
        "{",
        "  // запись поставки, заведённая руками",
        '  "mcp": {',
        '    "прямой": { "type": "remote", "url": "https://mcp.iskron.ru/" },',
        '    "английский": { "type": "remote", "url": "https://mcp.iskron.ai/" },',
        '    "выключенный": { "type": "local", "enabled": false,',
        `      "command": ["node", ${JSON.stringify(join(home, ".iskron-bridge", "iskron-bridge.mjs"))}], },`,
        "  }",
        "}",
      ].join("\n"),
    );
    const authDir = mkdtempSync(join(tmpdir(), "iskron-doctor-auth-"));
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home }, project);
    assert.doesNotMatch(r.out, /opencode\.jsonc не читается/, `jsonc must parse: ${r.out}`);
    assert.match(
      r.out,
      /«прямой».*напрямую по http/,
      `the http fallback must be told apart: ${r.out}`,
    );
    assert.doesNotMatch(
      r.out,
      /«прямой».*Убери/,
      `the http fallback must not be ordered away: ${r.out}`,
    );
    assert.match(
      r.out,
      /«выключенный».*выключена/,
      `a disabled entry must be named as such: ${r.out}`,
    );
    assert.match(
      r.out,
      /«английский».*напрямую по http/,
      `the English production address counts too: ${r.out}`,
    );
  } finally {
    await fake.stop();
  }
});

// Конфиг приходит и мимо дерева — файлом из переменной или её содержимым; а
// выключенный проектный слой значит, что файлы дерева OpenCode не читает и
// советовать по ним нечего (#5559).
test("doctor reads the config from the env vars and skips the project layer when it is off", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const project = mkdtempSync(join(tmpdir(), "iskron-doctor-proj-"));
  const bridge = join(home, ".iskron-bridge", "iskron-bridge.mjs");
  try {
    writeFileSync(
      join(project, "opencode.json"),
      JSON.stringify({ mcp: { "из-дерева": { type: "local", command: ["node", bridge] } } }),
    );
    const external = join(home, "внешний.json");
    writeFileSync(
      external,
      JSON.stringify({ mcp: { "из-переменной": { type: "local", command: ["node", bridge] } } }),
    );
    const authDir = mkdtempSync(join(tmpdir(), "iskron-doctor-auth-"));
    const byVar = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", authDir],
      { HOME: home, OPENCODE_CONFIG: external, OPENCODE_CONFIG_PROJECT_DISABLE: "1" },
      project,
    );
    assert.match(
      byVar.out,
      /«из-переменной»/,
      `the file from the env var must be read: ${byVar.out}`,
    );
    assert.doesNotMatch(
      byVar.out,
      /«из-дерева»/,
      `the project layer is off — its files must be left alone: ${byVar.out}`,
    );
    const byContent = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", authDir],
      {
        HOME: home,
        OPENCODE_CONFIG_PROJECT_DISABLE: "1",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          mcp: { "из-содержимого": { type: "local", command: ["node", bridge] } },
        }),
      },
      project,
    );
    assert.match(
      byContent.out,
      /«из-содержимого»/,
      `the config passed as content must be read: ${byContent.out}`,
    );
  } finally {
    await fake.stop();
  }
});

// Нечитаемый файл на пути обхода (каталог вместо файла) не смеет ронять отчёт,
// а «,}» внутри строки — текст, а не висячая запятая (#5559).
test("doctor survives an unreadable config on the way up and keeps strings intact", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const project = mkdtempSync(join(tmpdir(), "iskron-doctor-proj-"));
  try {
    // Каталог с именем файла конфига: existsSync истинен, чтение падает EISDIR.
    mkdirSync(join(project, "opencode.json"), { recursive: true });
    const deep = join(project, "ниже");
    mkdirSync(deep, { recursive: true });
    writeFileSync(
      join(deep, "opencode.jsonc"),
      [
        "{",
        '  "mcp": {',
        '    "сОписанием": { "type": "remote", "url": "https://mcp.iskron.ru/",',
        '      "описание": "скобка и запятая внутри строки: {a,} — это текст", }, // хвост',
        "  },",
        "}",
      ].join("\n"),
    );
    const authDir = mkdtempSync(join(tmpdir(), "iskron-doctor-auth-"));
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home }, deep);
    assert.match(r.out, /грант:/, `the report must survive an unreadable file: ${r.out}`);
    assert.match(r.out, /«сОписанием»/, `the entry below must still be found: ${r.out}`);
    assert.match(
      r.out,
      /opencode\.json не читается/,
      `the unreadable file must be named: ${r.out}`,
    );
  } finally {
    await fake.stop();
  }
});

test("doctor with a personal access token names its source and judges it by a live handshake", async () => {
  const fake = await startFakeNks({ pat: "nks_pat_doc" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-doctor-pat-"));
  // Свой дом: иначе раздел «субагенты» нашёл бы настоящий домашний мост машины и
  // пробовал бы его с подложным токеном против продового адреса.
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  try {
    const good = await run(["doctor", fake.mcpUrl, "--auth-dir", dir], {
      HOME: home,
      ISKRON_BRIDGE_TOKEN: "nks_pat_doc",
    });
    assert.equal(good.code, 0, good.err);
    assert.match(good.out, /грант: личный токен \(PAT\) из ISKRON_BRIDGE_TOKEN/);
    assert.match(good.out, /токен принят сервером/);
    assert.equal(readdirSync(dir).length, 0, "doctor must write nothing");
    const bad = await run(["doctor", fake.mcpUrl, "--auth-dir", dir], {
      HOME: home,
      ISKRON_BRIDGE_TOKEN: "nks_pat_wrong",
    });
    assert.match(bad.out, /ТОКЕН ОТВЕРГНУТ/);
  } finally {
    await fake.stop();
  }
});

// `use` — the standing choice of the server on this machine (graph nks-dev:
// #5040): `en` is the English production address, `ru` the Russian one, a full
// URL another instance; doctor and update say what the bridge looks at and why.
test("use en writes the English production address next to the grant; doctor names the file and the choice", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const authDir = join(home, ".iskron-bridge");
  try {
    const en = await run(["use", "en", "--auth-dir", authDir], { HOME: home });
    assert.equal(en.code, 0, `use exited ${en.code}: ${en.err}`);
    assert.equal(readFileSync(join(authDir, "server"), "utf8"), "https://mcp.iskron.ai/\n");
    assert.match(en.out, /мост смотрит на https:\/\/mcp\.iskron\.ai\//);
    assert.match(en.out, /продовый адрес: самообновление с релизов поставки включено/);
    const other = await run(["use", fake.mcpUrl, "--auth-dir", authDir], { HOME: home });
    assert.equal(other.code, 0, other.err);
    assert.match(other.out, /другой инстанс: обновлений с релизов поставки нет/);
    const bad = await run(["use", "nowhere", "--auth-dir", authDir], { HOME: home });
    assert.equal(bad.code, 2, "a word that is neither en, ru nor a URL is refused");
    const r = await run(["doctor", "--auth-dir", authDir], { HOME: home });
    assert.equal(r.code, 0, `doctor exited ${r.code}: ${r.err}`);
    assert.ok(
      r.out.includes(`сервер: ${fake.mcpUrl} (файл выбора ${join(authDir, "server")})`),
      `doctor must name the server from the file and the file itself:\n${r.out}`,
    );
    assert.match(r.out, /другой инстанс: обновлений с релизов поставки нет/);
    const ru = await run(["use", "ru", "--auth-dir", authDir], { HOME: home });
    assert.equal(readFileSync(join(authDir, "server"), "utf8"), "https://mcp.iskron.ru/\n", ru.out);
  } finally {
    await fake.stop();
  }
});

// Раздел «субагенты»: агент пользователя сам находит, почему его субагент без
// тулов графа или падает на 400, — doctor называет файл агента, поломку и
// готовое действие (делегирование: skills/iskronify/references/delegation.md).
// Единая форма записи (проверена живым Claude Code 2.1.285): node сам собирает
// путь к дому, `--` отделяет флаг моста, splice кладёт путь моста в argv[1].
// Эталон — SATELLITE_CODE в js/cli/satform.ts: проба берёт его оттуда, копий не держит.
const SAT_CODE = JSON.parse(
  /SATELLITE_CODE\s*=\s*("(?:[^"\\]|\\.)*")/.exec(
    readFileSync(join(HERE, "..", "cli", "satform.ts"), "utf8"),
  )[1],
);
const SAT_ARGS = `args: [${["-e", SAT_CODE, "--", "--satellite"].map((a) => JSON.stringify(a)).join(", ")}]`;
const NODE_E = ["type: stdio", "command: node", SAT_ARGS];
const SH_FORM =
  'args: ["-c", "exec node \\"$HOME/.iskron-bridge/iskron-bridge.mjs\\" --satellite"]';

function agentFile(role, entryName, spec = NODE_E) {
  return [
    "---",
    `name: ${role}`,
    `description: роль ${role}`,
    "model: sonnet",
    "mcpServers:",
    `  - ${entryName}:`,
    ...spec.map((l) => `      ${l}`),
    "disallowedTools: mcp__iskron-bridge, mcp__plugin_iskron_iskron, mcp__iskron",
    "---",
    "",
    "Тело.",
    "",
  ].join("\n");
}

function projectWithAgents(files) {
  const project = mkdtempSync(join(tmpdir(), "iskron-doctor-agents-"));
  const agents = join(project, ".claude", "agents");
  mkdirSync(agents, { recursive: true });
  for (const [role, text] of Object.entries(files)) writeFileSync(join(agents, `${role}.md`), text);
  return project;
}

test("doctor: role files sharing one bridge entry name are named, each with its own name to take", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const project = projectWithAgents({
    reader: agentFile("reader", "iskron-sub"),
    worker: agentFile("worker", "iskron-sub"),
    verifier: agentFile("verifier", "iskron-sub-verifier"),
  });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
      { HOME: home, ISKRON_DOCTOR_PLATFORM: "darwin" },
      project,
    );
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /субагенты: проект /, `the section must be there: ${r.out}`);
    assert.match(
      r.out,
      /имя записи «iskron-sub» делят 2 файла/,
      `a shared name must be named: ${r.out}`,
    );
    assert.match(r.out, /переименуй запись в этом файле: iskron-sub-reader/, r.out);
    assert.match(r.out, /переименуй запись в этом файле: iskron-sub-worker/, r.out);
    assert.doesNotMatch(
      r.out,
      /«iskron-sub-verifier» делят/,
      `a file with its own name must not be accused: ${r.out}`,
    );
  } finally {
    await fake.stop();
  }
});

// Прежние формы — sh -c и путь прямо в args — заменяет одна `node -e` без
// машинного пути, на любой ОС.
for (const [form, spec] of [
  ["sh", ["type: stdio", "command: sh", SH_FORM]],
  [
    "path",
    [
      "type: stdio",
      `command: ${JSON.stringify(process.execPath)}`,
      'args: ["C:\\\\Users\\\\a\\\\.iskron-bridge\\\\iskron-bridge.mjs", "--satellite"]',
    ],
  ],
]) {
  test(`doctor: a ${form} satellite entry is named, with the single node -e block`, async () => {
    const fake = await startFakeNks();
    const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
    const project = projectWithAgents({ worker: agentFile("worker", "iskron-sub-worker", spec) });
    try {
      const r = await run(
        ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
        { HOME: home, ISKRON_DOCTOR_PLATFORM: "win32" },
        project,
      );
      assert.equal(r.code, 0, r.err);
      assert.match(
        r.out,
        form === "sh" ? /прежнего контракта \(sh -c\)/ : /машинный путь в общем файле/,
        r.out,
      );
      assert.ok(
        r.out.includes(
          `      mcpServers:\n        - iskron-sub-worker:\n            type: stdio\n            command: node\n            ${SAT_ARGS}\n`,
        ),
        `the ready block must be the single node -e form: ${r.out}`,
      );
      assert.doesNotMatch(r.out, /skip-worktree|info\/exclude/, "no machine file any more");
    } finally {
      await fake.stop();
    }
  });
}

// Форма `node -e` признаётся только целиком: без `--` node примет --satellite за
// свой флаг; без splice мост не увидит его и встанет мостом сессии.
test("doctor: a node -e entry is accepted only whole — with -- and the bridge path in argv", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const noSplice =
    "import(require('path').join(require('os').homedir(), '.iskron-bridge', 'iskron-bridge.mjs'))";
  const project = projectWithAgents({
    reader: agentFile("reader", "iskron-sub-reader", [
      "type: stdio",
      "command: node",
      `args: ${JSON.stringify(["-e", SAT_CODE, "--satellite"])}`,
    ]),
    worker: agentFile("worker", "iskron-sub-worker", [
      "type: stdio",
      "command: node",
      `args: ${JSON.stringify(["-e", noSplice, "--", "--satellite"])}`,
    ]),
  });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
      { HOME: home, ISKRON_DOCTOR_PLATFORM: "darwin" },
      project,
    );
    assert.match(r.out, /«iskron-sub-reader»: --satellite стоит без `--`/, r.out);
    assert.match(r.out, /«iskron-sub-worker»: мост не увидит --satellite.*мостом сессии/, r.out);
  } finally {
    await fake.stop();
  }
});

// Набор тулов спутника (`--tools`, bridge/narrow.ts) — хвост после --satellite:
// эталонная форма с ним остаётся эталонной, а замена прежней формы его переносит.
const TOOLS_TAIL = ["--tools", "iskron_case,iskron_add_vimarsha"];
test("doctor: a node -e entry with a --tools tail is the single form, and a replaced form keeps the tail", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const project = projectWithAgents({
    worker: agentFile("worker", "iskron-sub-worker", [
      "type: stdio",
      "command: node",
      `args: ${JSON.stringify(["-e", SAT_CODE, "--", "--satellite", ...TOOLS_TAIL])}`,
    ]),
    weaver: agentFile("weaver", "iskron-sub-weaver", [
      "type: stdio",
      "command: sh",
      `args: ${JSON.stringify(["-c", `exec node "$HOME/.iskron-bridge/iskron-bridge.mjs" --satellite ${TOOLS_TAIL.join(" ")}`])}`,
    ]),
  });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
      { HOME: home, ISKRON_DOCTOR_PLATFORM: "darwin" },
      project,
    );
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /«iskron-sub-worker»: код `node -e`/, r.out);
    assert.match(r.out, /«iskron-sub-weaver»: форма прежнего контракта/, r.out);
    const tailed = `args: [${["-e", SAT_CODE, "--", "--satellite", ...TOOLS_TAIL].map((a) => JSON.stringify(a)).join(", ")}]`;
    assert.ok(
      r.out.includes(
        `        - iskron-sub-weaver:\n            type: stdio\n            command: node\n            ${tailed}\n`,
      ),
      `the ready block must carry the tool set: ${r.out}`,
    );
  } finally {
    await fake.stop();
  }
});

// Без входа проба спутника лишь начала бы вход, который никто не кончит: её нет,
// в доме ничего не появилось, и doctor говорит, как войти.
test("doctor: with no grant the satellite probe is skipped and the way to log in is named", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const authDir = join(home, ".iskron-bridge");
  mkdirSync(authDir, { recursive: true });
  copyFileSync(FILE, join(authDir, "iskron-bridge.mjs"));
  const project = projectWithAgents({ worker: agentFile("worker", "iskron-sub-worker") });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", authDir],
      { HOME: home, ISKRON_DOCTOR_PLATFORM: "darwin", ISKRON_BRIDGE_URL: fake.mcpUrl },
      project,
    );
    assert.match(r.out, /проба спутника не шла — входа в граф на этой машине нет → войди/, r.out);
    assert.doesNotMatch(r.out, /\/login\?k=/, `no dead login link: ${r.out}`);
    assert.deepEqual(readdirSync(authDir), ["iskron-bridge.mjs"], "the home must stay untouched");
  } finally {
    await fake.stop();
  }
});

// Готовый блок, снятый с вывода doctor и вставленный в файл, на повторе не даёт
// ни одной строки «НАДО:» — на обеих формах, и многострочное описание (`|`)
// не обрывает разбор фронтматтера.
for (const platform of ["darwin", "win32"]) {
  test(`doctor: the ready block pasted back gives no findings on a rerun (${platform})`, async () => {
    const fake = await startFakeNks({ pat: "nks_pat_rt" });
    // Дом с пробелом в пути: путь к мосту читается из args целиком, не склейкой.
    const home = mkdtempSync(join(tmpdir(), "iskron doctor home "));
    const homeBridge = join(home, ".iskron-bridge", "iskron-bridge.mjs");
    mkdirSync(dirname(homeBridge), { recursive: true });
    copyFileSync(FILE, homeBridge);
    const head = ["---", "name: worker", "description: |", "  первая строка", "  вторая строка"];
    const project = projectWithAgents({
      worker: [...head, "model: sonnet", "---", "", "Тело.", ""].join("\n"),
    });
    const env = {
      HOME: home,
      ISKRON_DOCTOR_PLATFORM: platform,
      ISKRON_BRIDGE_TOKEN: "nks_pat_rt",
      ISKRON_BRIDGE_URL: fake.mcpUrl,
    };
    const args = ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")];
    try {
      const first = await run(args, env, project);
      assert.match(first.out, /записи моста-спутника нет/, first.out);
      const lines = first.out.split("\n");
      const at = lines.findIndex((l) => l.includes("записи моста-спутника нет"));
      const block = [];
      for (let k = at + 1; k < lines.length && lines[k].startsWith("      "); k++)
        block.push(lines[k].slice(6));
      assert.ok(block[0] === "mcpServers:", `the block must follow the finding: ${first.out}`);
      writeFileSync(
        join(project, ".claude", "agents", "worker.md"),
        [...head, "model: sonnet", ...block, "---", "", "Тело.", ""].join("\n"),
      );
      const again = await run(args, env, project);
      assert.equal(again.code, 0, again.err);
      assert.doesNotMatch(again.out, /НАДО:/, `the pasted block must be clean: ${again.out}`);
      assert.match(again.out, /проба «iskron-sub-worker»: мост ответил/, again.out);
    } finally {
      await fake.stop();
    }
  });
}

// Мост, не ушедший по закрытому stdin, получает SIGTERM и уходит сам — SIGKILL
// посреди смены токена списал бы грант машины.
test("doctor: a probed bridge that outlives stdin close is sent SIGTERM, not killed", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const dir = mkdtempSync(join(tmpdir(), "iskron-doctor-stub-"));
  // Заглушка лежит домашним мостом: единая форма записи зовёт именно его.
  mkdirSync(join(home, ".iskron-bridge"), { recursive: true });
  const stub = join(home, ".iskron-bridge", "iskron-bridge.mjs");
  const marker = join(dir, "term");
  writeFileSync(
    stub,
    [
      'import { writeFileSync } from "node:fs";',
      'import { createInterface } from "node:readline";',
      "const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
      "createInterface({ input: process.stdin }).on('line', (l) => {",
      "  const m = JSON.parse(l);",
      "  if (m.method === 'initialize') say({ jsonrpc: '2.0', id: m.id, result: { serverInfo: { name: 'stub', version: '1' } } });",
      "  if (m.method === 'tools/list') say({ jsonrpc: '2.0', id: m.id, result: { tools: [] } });",
      "});",
      "process.stdin.on('end', () => setInterval(() => {}, 1000));",
      `process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(marker)}, 'term'); process.exit(0); });`,
    ].join("\n"),
  );
  const project = projectWithAgents({ worker: agentFile("worker", "iskron-sub-worker") });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
      // Личный токен — вход есть, проба идёт; фейк его не знает, но заглушке сервер не нужен.
      { HOME: home, ISKRON_DOCTOR_PLATFORM: "darwin", ISKRON_BRIDGE_TOKEN: "nks_pat_stub" },
      project,
    );
    assert.match(r.out, /проба «iskron-sub-worker»: мост ответил — stub v1/, r.out);
    assert.equal(readFileSync(marker, "utf8"), "term", "the bridge must be asked with SIGTERM");
    assert.doesNotMatch(r.out, /SIGKILL/, r.out);
  } finally {
    await fake.stop();
  }
});

// Провал пробы — находка с действием, и файл тогда не «в порядке»: иначе цикл
// «doctor до раздела без НАДО:» кончался бы при сломанном субагенте. Отказ со
// ссылкой входа — мёртвый грант: совет тот же, что без входа.
for (const [what, stub, expect] of [
  [
    "a silent bridge",
    "process.exit(0);",
    /НАДО: проба «iskron-sub-worker»: мост не ответил на initialize/,
  ],
  [
    "a dead grant",
    [
      'import { createInterface } from "node:readline";',
      "createInterface({ input: process.stdin }).on('line', (l) => {",
      "  const m = JSON.parse(l);",
      "  if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32001, message: 'нужен вход: откройте http://127.0.0.1:1/login?k=dead' } }) + '\\n');",
      "});",
    ].join("\n"),
    /НАДО: проба «iskron-sub-worker»: initialize — спутник не вошёл: грант машины мёртв или отозван → войди: вызови любой тул iskron_\*/,
  ],
]) {
  test(`doctor: ${what} in the satellite probe is a finding, and the file is not in order`, async () => {
    const fake = await startFakeNks();
    const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
    mkdirSync(join(home, ".iskron-bridge"), { recursive: true });
    writeFileSync(join(home, ".iskron-bridge", "iskron-bridge.mjs"), stub);
    const project = projectWithAgents({ worker: agentFile("worker", "iskron-sub-worker") });
    try {
      const r = await run(
        ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
        {
          HOME: home,
          ISKRON_DOCTOR_PLATFORM: "darwin",
          ISKRON_BRIDGE_TOKEN: "nks_pat_stub",
          ISKRON_DOCTOR_PROBE_MS: "5000",
        },
        project,
      );
      assert.match(r.out, expect, r.out);
      assert.doesNotMatch(r.out, /— в порядке/, r.out);
      assert.doesNotMatch(r.out, /сделай, что велит отказ/, r.out);
    } finally {
      await fake.stop();
    }
  });
}

// Субагент наследует и нативную http-запись на сервер графа — её тулы снимаются так же.
test("doctor: an http entry on the graph server counts among the caller's bridges", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        "graph-http": { type: "http", url: "https://mcp.iskron.ru/" },
        "чужой-http": { type: "http", url: "https://example.com/mcp" },
      },
    }),
  );
  const project = projectWithAgents({ worker: agentFile("worker", "iskron-sub-worker") });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
      { HOME: home, ISKRON_DOCTOR_PLATFORM: "darwin" },
      project,
    );
    assert.match(r.out, /мосты позвавшего не сняты \(mcp__graph-http\)/, r.out);
    assert.doesNotMatch(r.out, /mcp__чужой-http/, r.out);
  } finally {
    await fake.stop();
  }
});

test("doctor: a satellite probe names the tool whose schema carries a top-level anyOf", async () => {
  const fake = await startFakeNks({
    pat: "nks_pat_sub",
    tools: [
      { name: "iskron_orient", inputSchema: { type: "object", properties: {} } },
      {
        name: "iskron_add_kriya",
        inputSchema: {
          anyOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { type: "object", properties: { b: { type: "string" } } },
          ],
        },
      },
    ],
  });
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const homeBridge = join(home, ".iskron-bridge", "iskron-bridge.mjs");
  mkdirSync(dirname(homeBridge), { recursive: true });
  copyFileSync(FILE, homeBridge);
  // Проба видит то, что увидит субагент: набор записи (у worker пишущие тулы есть).
  const project = projectWithAgents({
    worker: agentFile("worker", "iskron-sub-worker", [
      "type: stdio",
      "command: node",
      `args: ${JSON.stringify(["-e", SAT_CODE, "--", "--satellite", "--tools", "iskron_orient,iskron_add_kriya"])}`,
    ]),
  });
  try {
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")],
      {
        HOME: home,
        ISKRON_DOCTOR_PLATFORM: "darwin",
        ISKRON_BRIDGE_TOKEN: "nks_pat_sub",
        ISKRON_BRIDGE_URL: fake.mcpUrl,
      },
      project,
    );
    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /проба «iskron-sub-worker»: мост ответил/,
      `the probe must answer: ${r.out}`,
    );
    assert.match(
      r.out,
      /НАДО: тул iskron_add_kriya: схема несёт anyOf на верхнем уровне/,
      `the offending tool must be a finding: ${r.out}`,
    );
    assert.doesNotMatch(r.out, /worker\.md: запись «iskron-sub-worker» — в порядке/, r.out);
    assert.doesNotMatch(r.out, /тул iskron_orient:/, `a clean schema is not a finding: ${r.out}`);
  } finally {
    await fake.stop();
  }
});
