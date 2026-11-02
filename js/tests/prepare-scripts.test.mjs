// prepare и хуки, вынесенные в скрипт (граф @nks/nks-dev, #9331; подготовка — #9319): стоящий
// хук старта или memory-guard того же рода в любой форме — inline, скрипт, общий скрипт ритуалов —
// prepare не дублирует; узнать не может — своего не пишет и отдаёт модели, назвав стоящий хук.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { BRIDGE, NODE } from "./status-kit.mjs";

const scratch = mkdtempSync(join(tmpdir(), "prepare-scripts-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const env = { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_LANG: "ru" };
const ADDR = ["--graph", "r7", "--holon", "12", "--agent-role", "34"];
let n = 0;

/** A repository whose .claude/settings.json carries these hooks and these files. */
function repo(hooks, files) {
  const dir = join(scratch, `r${n++}`);
  mkdirSync(join(dir, ".claude/hooks"), { recursive: true });
  spawnSync("git", ["init", "-q", dir]);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({ hooks }));
  return dir;
}

function prepare(dir, args = ADDR) {
  const r = spawnSync(NODE, [BRIDGE, "prepare", "--dir", dir, "--json", ...args], {
    env,
    encoding: "utf8",
    timeout: 10000,
    input: "",
  });
  return { status: r.status, out: JSON.parse(r.stdout || "null"), stderr: r.stderr };
}

const settings = (dir) => JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
const commands = (dir, event) =>
  (settings(dir).hooks?.[event] ?? []).flatMap((e) => e.hooks.map((h) => h.command));
const entry = (command, matcher) => ({
  ...(matcher ? { matcher } : {}),
  hooks: [{ type: "command", command }],
});

const START_SH = `#!/bin/sh\necho '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Прочти раздел «Старт» двери iskron до действий"}}'\n`;
const RITUALS = `// rituals of the repo, shared with the OpenCode plugin\nconst start = "Read the Start section of the iskron door";\nconst memory = (p) => /\\/\\.claude\\/projects\\/[^/]+\\/memory(\\/|$)/i.test(p);\nmodule.exports = { start, memory };\n`;

test("старт в скрипте (случай nks/bot): второго SessionStart нет, и повтор с --contract тоже", () => {
  const start = 'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"';
  const dir = repo(
    { SessionStart: [entry(start)] },
    { ".claude/hooks/session-start.sh": START_SH },
  );
  const first = prepare(dir);
  assert.ok(first.out, first.stderr);
  assert.ok(first.out.kept.includes("hook.start"), JSON.stringify(first.out));
  assert.deepEqual(commands(dir, "SessionStart"), [start]);
  prepare(dir, [...ADDR, "--contract", "38"]);
  assert.deepEqual(commands(dir, "SessionStart"), [start]);
});

test("старт и guard в общем скрипте ритуалов (случай nks/methodology): второй пары нет", () => {
  const start = "node .claude/rituals.cjs start";
  const guard = 'node "$CLAUDE_PROJECT_DIR"/.claude/rituals.cjs guard';
  const dir = repo(
    {
      SessionStart: [entry(start)],
      PreToolUse: [entry(guard, "Write|Edit|MultiEdit|NotebookEdit")],
    },
    { ".claude/rituals.cjs": RITUALS },
  );
  const { out, stderr } = prepare(dir);
  assert.ok(out, stderr);
  for (const f of ["hook.start", "hook.guard"]) assert.ok(out.kept.includes(f), f);
  assert.deepEqual(commands(dir, "SessionStart"), [start]);
  assert.deepEqual(commands(dir, "PreToolUse"), [guard]);
  prepare(dir, [...ADDR, "--contract", "38"]);
  assert.deepEqual(commands(dir, "SessionStart"), [start]);
  assert.deepEqual(commands(dir, "PreToolUse"), [guard]);
});

test("скрипт не узнан — своего не пишет, модели код 3 с названным хуком", () => {
  const start = "bash .claude/hooks/boot.sh";
  const guard = "python3 .claude/hooks/missing.py";
  const dir = repo(
    { SessionStart: [entry(start)], PreToolUse: [entry(guard, "Write|Edit")] },
    { ".claude/hooks/boot.sh": "#!/bin/sh\n. ./.env.sh\n" },
  );
  const { status, out } = prepare(dir, [...ADDR, "--contract", "38"]);
  assert.equal(status, 3);
  assert.deepEqual(commands(dir, "SessionStart"), [start]);
  assert.deepEqual(commands(dir, "PreToolUse"), [guard]);
  for (const [item, cmd] of [
    ["hook.start", start],
    ["hook.guard", guard],
  ]) {
    const left = out.left.find((x) => x.item === item);
    assert.ok(left?.why.includes(cmd), `${item}: ${JSON.stringify(out.left)}`);
  }
});

test("скрипт на чужом матчере PreToolUse и чужой inline-старт guard и старт не держат", () => {
  const dir = repo(
    {
      SessionStart: [entry("echo hello")],
      PreToolUse: [entry("sh .claude/hooks/lint.sh", "Bash")],
    },
    { ".claude/hooks/lint.sh": "#!/bin/sh\nexit 0\n" },
  );
  const { out } = prepare(dir);
  for (const f of ["hook.start", "hook.guard"]) assert.ok(out.done.includes(f), f);
  assert.equal(commands(dir, "SessionStart").length, 2);
  assert.equal(commands(dir, "PreToolUse").length, 2);
});

test("guard на матчере, не покрывающем Write и Edit, guard не держит — prepare ставит свой", () => {
  for (const matcher of ["Bash", "Write"]) {
    const guard = "node .claude/rituals.cjs guard";
    const dir = repo({ PreToolUse: [entry(guard, matcher)] }, { ".claude/rituals.cjs": RITUALS });
    const { out, stderr } = prepare(dir);
    assert.ok(out, stderr);
    assert.ok(out.done.includes("hook.guard"), `${matcher}: ${JSON.stringify(out)}`);
    const pre = settings(dir).hooks.PreToolUse;
    assert.equal(pre.length, 2, matcher);
    assert.equal(pre[1].matcher, "Write|Edit|MultiEdit|NotebookEdit");
  }
});

test("скрипт без расширения: узнанный держит старт, неузнанный и отсутствующий — непрозрачны", () => {
  const known = "sh .claude/hooks/session-start";
  const dir = repo({ SessionStart: [entry(known)] }, { ".claude/hooks/session-start": START_SH });
  const first = prepare(dir, [...ADDR, "--contract", "38"]);
  assert.ok(first.out?.kept.includes("hook.start"), JSON.stringify(first.out));
  assert.deepEqual(commands(dir, "SessionStart"), [known]);
  for (const [start, files] of [
    [".claude/hooks/boot", { ".claude/hooks/boot": "#!/bin/sh\n. ./.env.sh\n" }],
    ["bash .claude/hooks/gone", {}],
  ]) {
    const d = repo({ SessionStart: [entry(start)] }, files);
    const { status, out } = prepare(d, [...ADDR, "--contract", "38"]);
    assert.equal(status, 3, start);
    assert.deepEqual(commands(d, "SessionStart"), [start]);
    assert.ok(out.left.find((x) => x.item === "hook.start")?.why.includes(start), start);
  }
});
