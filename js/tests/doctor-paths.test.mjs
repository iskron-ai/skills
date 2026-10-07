// doctor называет то, что «какая сборка работает» и «почему граф пропал» без
// него не ответить (граф nks-dev): демон и сессии запасного пути (#6489),
// исполнимость команды записи моста и ход починки (#6727), второй путь к тому же
// серверу рядом с мостом (#6728), набор скиллов ниже моста (#4509).
//
// ISKRON_BRIDGE_PATH=<старый iskron.mjs> — каждая проба краснеет: старый doctor
// этих строк не печатает.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const FILE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_paths";

function run(args, env, cwd) {
  return new Promise((resolve) => {
    const p = spawn(NODE, [FILE, ...args], {
      cwd,
      env: { ...process.env, ISKRON_BRIDGE_DAEMON: "0", ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", () => {});
    p.on("exit", (code) => resolve({ code, out }));
  });
}

async function withHome(fn) {
  const fake = await startFakeNks({ pat: PAT });
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-paths-"));
  try {
    await fn({ fake, home, authDir: join(home, ".iskron-bridge") });
  } finally {
    await fake.stop();
    rmSync(home, { recursive: true, force: true });
  }
}

/** Плагин Claude Code с записью моста и набором скиллов версии v. */
function claudePlugin(home, command, v) {
  const install = join(home, ".claude", "plugins", "cache", "iskron", "iskron", v);
  mkdirSync(join(install, "skills", "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(
    join(install, "skills", "establish-mcp", "scripts", "iskron.mjs"),
    `const VERSION = "${v}";\n`,
  );
  const args = ["${CLAUDE_PLUGIN_ROOT}/skills/establish-mcp/scripts/iskron.mjs"];
  writeFileSync(
    join(install, ".mcp.json"),
    JSON.stringify({ mcpServers: { iskron: { command, args } } }),
  );
  writeFileSync(
    join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({
      plugins: { "iskron@iskron": [{ scope: "user", installPath: install, version: v }] },
    }),
  );
  return install;
}

test("doctor names the grant directory and a session on the fallback path, by pid and why", async () => {
  await withHome(async ({ fake, home, authDir }) => {
    // Вход не личный — тонкий мост сразу идёт полным в своём процессе.
    mkdirSync(join(authDir, "run"), { recursive: true });
    chmodSync(join(authDir, "run"), 0o755);
    const env = { HOME: home, ISKRON_BRIDGE_TOKEN: PAT, ISKRON_BRIDGE_DAEMON: "" };
    const bridge = (extra) => {
      const p = spawn(NODE, [FILE, fake.mcpUrl, "--no-browser", "--auth-dir", authDir], {
        env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env, ...extra },
        stdio: ["pipe", "pipe", "pipe"],
      });
      p.err = "";
      p.stderr.on("data", (c) => (p.err += c));
      return p;
    };
    const marks = () => {
      try {
        return readdirSync(join(authDir, "fallback")).sort();
      } catch {
        return [];
      }
    };
    const until = async (what, ok) => {
      const deadline = Date.now() + 15_000;
      while (!ok() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      assert.ok(ok(), what);
    };
    const kill = async (p) => {
      p.kill("SIGKILL");
      if (p.exitCode === null && p.signalCode === null) await new Promise((r) => p.once("exit", r));
    };
    const fallback = bridge({});
    const switched = bridge({ ISKRON_BRIDGE_DAEMON: "0" }); // мимо демона по выбору
    try {
      await until("the thin bridge went full", () => /going as the full bridge/.test(fallback.err));
      await until("both sessions marked", () => marks().length === 2);
      const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], env, home);
      assert.ok(r.out.includes(`каталог гранта: ${authDir}`), r.out);
      assert.match(r.out, /мимо демона \(.*\) идут сессий: 2/, r.out);
      assert.match(
        r.out,
        new RegExp(
          `pid ${fallback.pid}, сборка v\\S+, с \\S+, каталог .*: the daemon's entrance is not private`,
        ),
        r.out,
      );
      assert.match(r.out, new RegExp(`pid ${switched.pid}, .*: the daemon switch is off`), r.out);
    } finally {
      await kill(fallback);
      await kill(switched);
    }
    const after = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], env, home);
    assert.match(after.out, /мимо демона .* не идёт ни одна сессия/, after.out);
    // Отметки убитых снимает следующий мост мимо демона: pid, доставшийся другому, сессией не читается.
    const next = bridge({ ISKRON_BRIDGE_DAEMON: "0" });
    try {
      await until("only the live mark stays", () => marks().join() === `${next.pid}.json`);
    } finally {
      await kill(next);
    }
  });
});

test("doctor: the bridge entry's command not in PATH is a finding with the absolute-node fix", async () => {
  await withHome(async ({ fake, home, authDir }) => {
    claudePlugin(home, "node", "9.9.9");
    const codex = join(home, "cxh");
    // Уровень версии под плагином — раскладка кэша Codex у других плагинов машины.
    const manifest = join(codex, "plugins", "cache", "iskron", "iskron", "9.9.9", ".codex-plugin");
    mkdirSync(manifest, { recursive: true });
    writeFileSync(
      join(manifest, "plugin.json"),
      JSON.stringify({
        version: "9.9.9",
        mcpServers: {
          iskron: { command: "node", args: ["./skills/establish-mcp/scripts/iskron.mjs"] },
        },
      }),
    );
    const empty = join(home, "empty-bin");
    mkdirSync(empty);
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", authDir],
      { HOME: home, PATH: empty, CODEX_HOME: codex },
      home,
    );
    // Ход не ставит второго моста (#6728): Codex выключить запись плагина не даёт — второй записи не советуем.
    assert.match(r.out, /НАДО: Codex iskron@iskron: команда «node» не найдена/, r.out);
    assert.match(r.out, /плагинной записи Codex абсолютного пути не вписать/, r.out);
    assert.doesNotMatch(r.out, /codex mcp add/, r.out);
    assert.match(r.out, /выключи запись плагина plugin:iskron:iskron в \/mcp/, r.out);
    assert.match(
      r.out,
      /НАДО: Claude Code iskron@iskron: команда «node» не найдена в PATH этой оболочки .*spawn ENOENT/,
      r.out,
    );
    assert.ok(
      r.out.includes(`claude mcp add --scope user "iskron-bridge" -- ${process.execPath} `),
      r.out,
    );
  });
});

test("doctor: node from a version manager is named as invisible to a harness started outside the shell", async () => {
  await withHome(async ({ fake, home, authDir }) => {
    claudePlugin(home, "node", "9.9.9");
    const bin = join(home, ".nvm", "versions", "node", "v22.0.0", "bin");
    mkdirSync(bin, { recursive: true });
    symlinkSync(process.execPath, join(bin, "node"));
    const env = { HOME: home, PATH: bin, ISKRON_DOCTOR_PLATFORM: "darwin" };
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], env, home);
    assert.match(
      r.out,
      /Claude Code iskron@iskron: «node» → .*\.nvm.*харнесс, запущенный не из оболочки .*Какой PATH у харнесса, отсюда не видно/,
      r.out,
    );
    assert.ok(r.out.includes(`-- ${join(bin, "node")} `), r.out);
  });
});

test("doctor names an http entry to the graph server next to the bridge in Claude Code and Codex, and an Iskron connector", async () => {
  await withHome(async ({ fake, home, authDir }) => {
    const project = join(home, "proj");
    mkdirSync(join(project, ".git"), { recursive: true });
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { прямой: { type: "http", url: "https://mcp.iskron.ru/" } },
        projects: {
          [project]: { mcpServers: { местный: { type: "http", url: "https://mcp.iskron.ai/" } } },
        },
        claudeAiMcpEverConnected: ["claude.ai Iskron", "claude.ai Google Drive"],
      }),
    );
    writeFileSync(
      join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          проектный: { type: "http", url: fake.mcpUrl },
          чужой: { type: "http", url: "https://example.com/mcp" },
        },
      }),
    );
    const codex = join(home, "cxh");
    mkdirSync(codex);
    writeFileSync(
      join(codex, "config.toml"),
      '[mcp_servers.graph]\nurl = "https://mcp.iskron.ru/"\n\n[other]\nurl = "https://mcp.iskron.ru/"\n',
    );
    const r = await run(
      ["doctor", fake.mcpUrl, "--auth-dir", authDir],
      { HOME: home, CODEX_HOME: codex },
      project,
    );
    assert.match(
      r.out,
      /НАДО: Claude Code .*«прямой» ведёт https:\/\/mcp\.iskron\.ru\/ напрямую по http, мимо моста.*claude mcp remove "прямой" --scope user/,
      r.out,
    );
    assert.match(r.out, /«местный».*--scope local/, r.out);
    assert.match(r.out, /«проектный» ведёт/, r.out);
    assert.doesNotMatch(r.out, /«чужой» ведёт/, r.out);
    assert.match(r.out, /НАДО: Codex .*«graph».*codex mcp remove "graph"/, r.out);
    assert.doesNotMatch(r.out, /«other» ведёт/, r.out);
    // История подключений не гаснет после снятия коннектора — строка без «НАДО», иначе doctor не позеленеет.
    assert.match(
      r.out,
      /^Claude Code: коннектор «claude\.ai Iskron» в истории подключений/m,
      r.out,
    );
    assert.doesNotMatch(r.out, /коннектор «claude\.ai Google Drive»/, r.out);
  });
});

test("doctor: a skill set below the bridge is a finding with its path and the update move", async () => {
  await withHome(async ({ fake, home, authDir }) => {
    const install = claudePlugin(home, process.execPath, "0.0.1");
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home }, home);
    assert.ok(
      r.out.includes(`НАДО: скиллы: ${join(install, "skills")} — v0.0.1, НИЖЕ моста v`),
      r.out,
    );
    assert.match(
      r.out,
      /Claude Code — \/plugin marketplace update iskron, затем \/reload-plugins/,
      r.out,
    );
  });
});

// Набор вровень с мостом, а релиз свежее — отстала поставка целиком, а не метод от моста.
test("doctor: a skill set level with the bridge but below the known release names the whole delivery behind", async () => {
  await withHome(async ({ fake, home, authDir }) => {
    const v = /^v(\S+)\+/.exec((await run(["--version"], { HOME: home }, home)).out.trim())[1];
    const install = claudePlugin(home, process.execPath, v);
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "latest.json"),
      JSON.stringify({ version: "999.0.0", checked_at: Date.now(), downloaded: [] }),
    );
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home }, home);
    assert.ok(
      r.out.includes(
        `НАДО: скиллы: ${join(install, "skills")} — v${v}, НИЖЕ релиза v999.0.0, вровень с мостом`,
      ),
      r.out,
    );
    assert.doesNotMatch(r.out, /старше моста/, r.out);
  });
});
