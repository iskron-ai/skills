// Mechanical denial, not an instruction to the model (#10397).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { BUILT_BRIDGE, REPO } from "./built.mjs";

const scratch = mkdtempSync(join(tmpdir(), "blocking-question-"));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});
const bridge = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const run = (args) =>
  spawnSync(process.execPath, [bridge, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 15000,
    env: {
      ...process.env,
      HOME: scratch,
      ISKRON_BRIDGE_AUTH_DIR: join(scratch, "auth"),
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_TOKEN: "",
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
