// Mechanical denial, not an instruction to the model (#10397).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { BUILT_BRIDGE, BUILT_PLUGIN, REPO } from "./built.mjs";

const scratch = mkdtempSync(join(tmpdir(), "blocking-question-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});
const bridge = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const run = (args, env = {}) =>
  spawnSync(process.execPath, [bridge, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 15000,
    env: {
      ...process.env,
      HOME: scratch,
      ISKRON_BRIDGE_AUTH_DIR: join(scratch, "auth"),
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: "",
      ...env,
    },
  });

test("Claude plugin: AskUserQuestion has an unconditional PreToolUse denial", () => {
  const hooks = JSON.parse(readFileSync(join(REPO, "hooks/hooks.json"), "utf8"));
  const entry = hooks.hooks.PreToolUse?.find((e) => e.matcher === "AskUserQuestion");
  assert.ok(entry, "plugin must carry its own denial");
  const r = spawnSync(entry.hooks[0].command, {
    shell: true,
    encoding: "utf8",
    input: JSON.stringify({ tool_name: "AskUserQuestion" }),
  });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("prepare: project-only denial preserves foreign settings and is idempotent", () => {
  const dir = join(scratch, "repo");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  spawnSync("git", ["init", "-q", dir]);
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Read"], deny: ["Bash(rm *)"] }, extra: 42 }),
  );
  writeFileSync(
    join(dir, "opencode.json"),
    JSON.stringify({
      model: "p/m",
      policies: [{ action: "tool.use", resource: "shell:sudo *", effect: "deny" }],
    }),
  );
  const args = [
    "prepare",
    "--dir",
    dir,
    "--graph",
    "r7",
    "--holon",
    "12",
    "--agent-role",
    "34",
    "--json",
  ];
  assert.equal(run(args).status, 3);
  const claude = JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
  assert.deepEqual(claude.permissions, {
    allow: ["Read"],
    deny: ["Bash(rm *)", "AskUserQuestion"],
  });
  assert.equal(claude.extra, 42);
  const path = join(dir, ".opencode/opencode.json");
  const oc = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(oc.policies, [{ action: "tool.use", resource: "question:*", effect: "deny" }]);
  const before = readFileSync(path, "utf8");
  run(args);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(JSON.parse(readFileSync(join(dir, "opencode.json"), "utf8")).model, "p/m");
});

test("check-rituals: aligned repository reports absent question layers instead of clean", () => {
  const dir = join(scratch, "missing");
  mkdirSync(dir);
  spawnSync("git", ["init", "-q", dir]);
  writeFileSync(
    join(dir, "AGENTS.md"),
    "---\niskron:\n  graph: r5\n  holon: 1506\n  agent_role: 931\n---\n# Example\n",
  );
  const r = run(["check-rituals", "--json", dir]);
  assert.equal(r.status, 1);
  const verdicts = JSON.parse(r.stdout);
  for (const layer of ["question.instructions", "question.project", "question.plugin"])
    assert.ok(
      verdicts.some((v) => v.layer === layer),
      layer,
    );
});

test("check-rituals: prepared layers pass, removing either project guard fails", () => {
  const dir = join(scratch, "complete");
  mkdirSync(dir);
  spawnSync("git", ["init", "-q", dir]);
  run(["prepare", "--dir", dir, "--graph", "r7", "--holon", "12", "--agent-role", "34", "--json"]);
  writeFileSync(
    join(dir, "AGENTS.md"),
    readFileSync(join(dir, "AGENTS.md"), "utf8") +
      "\nBlocking question / AskUserQuestion tools are forbidden; use a case ask card.\n",
  );
  const check = () => run(["check-rituals", "--json", dir]);
  const complete = check();
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`);
  const cc = join(dir, ".claude/settings.json");
  const before = readFileSync(cc, "utf8");
  const cfg = JSON.parse(before);
  cfg.permissions.deny = [];
  writeFileSync(cc, JSON.stringify(cfg));
  assert.equal(check().status, 1);
  writeFileSync(cc, before);
  writeFileSync(join(dir, ".opencode/opencode.json"), "{}");
  assert.equal(check().status, 1);
});

test("question audit never starts the plugin's adjacent bridge", () => {
  const dir = join(scratch, "adjacent-audit");
  const config = join(scratch, "adjacent-config");
  const plugins = join(config, "plugins");
  const marker = join(scratch, "adjacent-started");
  mkdirSync(dir);
  mkdirSync(plugins, { recursive: true });
  spawnSync("git", ["init", "-q", dir]);
  run(["prepare", "--dir", dir, "--graph", "r7", "--holon", "12", "--agent-role", "34", "--json"]);
  writeFileSync(
    join(dir, "AGENTS.md"),
    readFileSync(join(dir, "AGENTS.md"), "utf8") +
      "\nBlocking question / AskUserQuestion tools are forbidden; use a case ask card.\n",
  );
  copyFileSync(process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, join(plugins, "iskron.js"));
  writeFileSync(
    join(plugins, "iskron.mjs"),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`,
  );
  const result = run(["check-rituals", "--json", dir], { OPENCODE_CONFIG_DIR: config });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(marker), false, "auditing hooks must not start a colocated bridge");
});

test("prepare: JSONC at the target layer is named, never overwritten or partly applied", () => {
  const dir = join(scratch, "jsonc");
  mkdirSync(join(dir, ".opencode"), { recursive: true });
  spawnSync("git", ["init", "-q", dir]);
  const path = join(dir, ".opencode/opencode.jsonc");
  const original = '{\n// keep my policy\n"policies": []\n}\n';
  writeFileSync(path, original);
  const r = run(["prepare", "--dir", dir, "--graph", "r7", "--json"]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(path, "utf8"), original);
  assert.throws(() => readFileSync(join(dir, ".claude/settings.json")), /ENOENT/);
  assert.throws(() => readFileSync(join(dir, "AGENTS.md")), /ENOENT/);
});

for (const kind of ["deny", "missing", "malformed", "shape", "both"])
  test(`prepare/audit: JSONC ${kind} is read without edits or a sibling JSON`, () => {
    const dir = join(scratch, `jsonc-${kind}`);
    mkdirSync(join(dir, ".opencode"), { recursive: true });
    spawnSync("git", ["init", "-q", dir]);
    const args = [
      "prepare",
      "--dir",
      dir,
      "--graph",
      "r7",
      "--holon",
      "12",
      "--agent-role",
      "34",
      "--json",
    ];
    run(args);
    const json = join(dir, ".opencode/opencode.json");
    const jsonBefore = readFileSync(json, "utf8");
    if (kind !== "both") rmSync(json);
    const path = join(dir, ".opencode/opencode.jsonc");
    const original =
      kind === "malformed"
        ? "{ broken"
        : kind === "shape"
          ? '{"policies":{}}'
          : `{\n// preserve https://example.org and trailing commas\n"url":"https://example.org/*x*/",\n"policies":[${kind === "missing" ? "" : '{"action":"tool.use","resource":"question:*","effect":"deny",},'}],\n}\n`;
    writeFileSync(path, original);
    writeFileSync(
      join(dir, "AGENTS.md"),
      readFileSync(join(dir, "AGENTS.md"), "utf8") +
        "\nquestion / AskUserQuestion forbidden; case ask\n",
    );
    const audit = run(["check-rituals", "--json", dir]);
    const result = run(args);
    assert.equal(result.status, kind === "deny" ? 3 : 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(path, "utf8"), original);
    if (kind === "both") assert.equal(readFileSync(json, "utf8"), jsonBefore);
    else assert.throws(() => readFileSync(json), /ENOENT/);
    assert.equal(audit.status, kind === "deny" ? 0 : 1, `${audit.stdout}\n${audit.stderr}`);
    const rows = JSON.parse(audit.stdout).filter(
      (r) => r.layer === "question.project" && r.file.includes("opencode.json"),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hole, kind !== "deny");
    assert.equal(readFileSync(path, "utf8"), original);
  });

test("check-rituals: accepts an existing JSONC deny without prepare rewriting it", () => {
  const dir = join(scratch, "jsonc-audit-only");
  mkdirSync(dir);
  spawnSync("git", ["init", "-q", dir]);
  run(["prepare", "--dir", dir, "--graph", "r7", "--holon", "12", "--agent-role", "34", "--json"]);
  writeFileSync(
    join(dir, "AGENTS.md"),
    readFileSync(join(dir, "AGENTS.md"), "utf8") +
      "\nquestion / AskUserQuestion forbidden; case ask\n",
  );
  const path = join(dir, ".opencode/opencode.jsonc");
  const text =
    '{/*keep*/"policies":[{"action":"tool.use","resource":"question:*","effect":"deny",},],}\n';
  rmSync(join(dir, ".opencode/opencode.json"));
  writeFileSync(path, text);
  const result = run(["check-rituals", "--json", dir]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(path, "utf8"), text);
});
