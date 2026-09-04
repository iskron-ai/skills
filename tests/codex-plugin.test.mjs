// Probe for the Codex delivery — .codex-plugin/plugin.json and the repo
// marketplace at .agents/plugins/marketplace.json. Neither had any cover: they
// are read by a consumer that is not in this repo, so a manifest that drifts is
// discovered by a person whose install failed, not by us.
//
// The cheap and valuable half is that Codex ships its OWN ingestion validator on
// disk (plugin-creator/scripts/validate_plugin.py). Running it beats restating
// its rules here: it is the actual acceptance contract, it moves when Codex
// moves, and it also reads every skills/<name>/SKILL.md frontmatter through
// Codex's own YAML — a second reader beside `make validate`, which reads them
// through Claude Code's contract.
//
// So this file only adds what that validator does NOT do: the marketplace (which
// it never sees, being a plugin-root validator) and the on-disk existence of what
// the manifest promises. Version mirroring is not here — `make validate` holds it.
//
// ISKRON_PLUGIN_ROOT points the probe at any copy, so a defect can be shown red.
// Offline; reads ~/.codex only to run the validator, and writes nothing there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ISKRON_PLUGIN_ROOT || join(HERE, "..");
const VALIDATOR = join(homedir(), ".codex", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Codex's own name rules, copied from identifier_validation.py because the rules
// are the thing being held — a marketplace whose name Codex rejects never loads.
const PLUGIN_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const MARKETPLACE_NAME = /^[A-Za-z0-9_-]+$/;

test("Codex's own ingestion validator accepts the plugin root", (t) => {
  if (!existsSync(VALIDATOR)) return t.skip(`валидатора Codex нет на этой машине: ${VALIDATOR}`);
  const py = spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" });
  if (py.error || py.status !== 0) return t.skip("python3 с модулем yaml недоступен — валидатор Codex не запустить");

  const run = spawnSync("python3", [VALIDATOR, ROOT], { encoding: "utf8" });
  // The validator prints every error it found; a bare exit code would hide which.
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /Plugin validation passed/);
});

// The marketplace is what Codex reads first, and the validator never looks at it.
// Its one job is to point at a plugin — an entry that names something not on
// disk, or names it differently from the manifest, installs nothing and says
// little.
test("the marketplace names a plugin that is really here", () => {
  const marketplace = readJson(join(ROOT, ".agents", "plugins", "marketplace.json"));

  assert.match(marketplace.name, MARKETPLACE_NAME, "имя маркетплейса Codex не примет");
  assert.equal(typeof marketplace.interface, "object");
  assert.ok(marketplace.interface, "у маркетплейса нет interface");
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length, "маркетплейс не называет ни одного плагина");

  for (const entry of marketplace.plugins) {
    assert.match(entry.name, PLUGIN_NAME, `имя плагина Codex не примет: ${entry.name}`);
    assert.equal(entry.source?.source, "local");
    assert.equal(typeof entry.source?.path, "string");
    assert.equal(typeof entry.policy?.installation, "string");
    assert.equal(typeof entry.policy?.authentication, "string");

    // source.path is relative to the marketplace ROOT — the directory handed to
    // `codex plugin marketplace add`, which for a repo marketplace is the repo
    // itself, not the .agents/plugins/ directory the file sits in.
    const pluginRoot = resolve(ROOT, entry.source.path);
    const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
    assert.ok(existsSync(manifestPath), `запись «${entry.name}» указывает туда, где нет плагина: ${manifestPath}`);
    assert.equal(readJson(manifestPath).name, entry.name, "имя в записи маркетплейса и в манифесте разошлись");
  }
});

// What the validator checks in shape but not on disk: it requires `skills` to
// spell `skills`, and then skips the tree entirely if it is absent. A manifest
// promising a skills directory that is not shipped passes it in silence.
test("what the manifest promises is on disk", () => {
  const manifest = readJson(join(ROOT, ".codex-plugin", "plugin.json"));

  const skillsDir = resolve(ROOT, manifest.skills);
  assert.ok(existsSync(skillsDir), `манифест обещает ${manifest.skills}, а директории нет`);
  assert.ok(statSync(skillsDir).isDirectory(), `${manifest.skills} — не директория`);
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."));
  assert.ok(skills.length, "обещанная директория скиллов пуста");
  for (const s of skills) {
    assert.ok(existsSync(join(skillsDir, s.name, "SKILL.md")), `у скилла ${s.name} нет SKILL.md`);
  }

  assert.equal(typeof manifest.mcpServers, "string", "запись MCP-серверов должна быть путём к .mcp.json");
  assert.ok(existsSync(resolve(ROOT, manifest.mcpServers)), `манифест обещает ${manifest.mcpServers}, а файла нет`);
});
