// Подкоманда prepare (граф @nks/nks-dev, #9319 — подготовка репо шагом моста, #9316 — форма
// обложки): одним вызовом, без модели и сети — обложка iskron:, заготовки AGENTS.md, REALITY.md,
// указатель CLAUDE.md, хуки старта и memory-guard рядом с чужими записями; повтор ничего не
// меняет; код выхода и --json говорят iskronify, что сделано и что осталось модели.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию: у моста без подкоманды prepare аргумент уходит
// мосту — ни файлов, ни ответа JSON.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { coverBlock } from "../shared/coverblock.ts";
import { REPO } from "./built.mjs";
import { BRIDGE, NODE } from "./status-kit.mjs";

const scratch = mkdtempSync(join(tmpdir(), "prepare-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const env = { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_LANG: "ru" };
let n = 0;

function repo(origin = "https://github.com/acme/widget.git") {
  const dir = join(scratch, `r${n++}`);
  mkdirSync(dir);
  spawnSync("git", ["init", "-q", dir]);
  if (origin) spawnSync("git", ["-C", dir, "remote", "add", "origin", origin]);
  return dir;
}

const prepare = (dir, args = []) => {
  const r = spawnSync(NODE, [BRIDGE, "prepare", "--dir", dir, "--json", ...args], {
    env,
    encoding: "utf8",
    timeout: 10000,
    input: "",
  });
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    /* not this subcommand */
  }
  return { status: r.status, out, stderr: r.stderr };
};

const read = (dir, f) => readFileSync(join(dir, f), "utf8");
const settings = (dir) => JSON.parse(read(dir, ".claude/settings.json"));
const commands = (s, event) =>
  (s.hooks?.[event] ?? []).flatMap((e) => e.hooks.map((h) => h.command));
const items = (list) => list.map((x) => (typeof x === "string" ? x : x.item));
const ADDR = ["--graph", "r7", "--holon", "12", "--agent-role", "34"];

test("чистый репо: обложка разбирается, файлы и хуки легли, модели — контракт, пуш и мерж", () => {
  const dir = repo();
  const { status, out, stderr } = prepare(dir, ADDR);
  assert.ok(out, `не JSON: ${stderr}`);
  assert.equal(status, 3);
  assert.equal(out.repository, "github.com/acme/widget");
  const block = coverBlock(read(dir, "AGENTS.md"), "iskron");
  assert.deepEqual(Object.fromEntries(block), { graph: "r7", holon: "12", agent_role: "34" });
  assert.ok(read(dir, "REALITY.md").startsWith("# Reality"));
  if (process.platform !== "win32") assert.equal(readlinkSync(join(dir, "CLAUDE.md")), "AGENTS.md");
  for (const f of ["AGENTS.md", "REALITY.md", "CLAUDE.md", "hook.start", "hook.guard"])
    assert.ok(out.done.includes(f), f);
  assert.deepEqual(items(out.left).sort(), ["cover.contract", "hook.merge", "hook.push"]);
  const start = commands(settings(dir), "SessionStart");
  assert.equal(start.length, 1);
  const said = spawnSync("/bin/sh", ["-c", start[0]], { encoding: "utf8", input: "{}" });
  const ctx = JSON.parse(said.stdout).hookSpecificOutput.additionalContext;
  for (const s of ["r7", "#12", "#34", "iskron_stand"]) assert.ok(ctx.includes(s), s);
});

test("повтор ничего не меняет: всё на месте — kept", () => {
  const dir = repo();
  prepare(dir, ADDR);
  const files = ["AGENTS.md", "REALITY.md", ".claude/settings.json"].map((f) => read(dir, f));
  const { out } = prepare(dir, ADDR);
  assert.deepEqual(out.done, []);
  assert.deepEqual(
    ["AGENTS.md", "REALITY.md", ".claude/settings.json"].map((f) => read(dir, f)),
    files,
  );
  for (const f of ["AGENTS.md", "REALITY.md", "CLAUDE.md", "hook.start", "hook.guard"])
    assert.ok(out.kept.includes(f), f);
});

test("memory-guard — образец hooks.md байт в байт, кроме слотов сообщения", () => {
  const dir = repo();
  prepare(dir, ADDR);
  const md = read(REPO, "skills/iskronify/references/hooks.md");
  const sample = [...md.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => JSON.parse(m[1]))
    .find((j) => j.matcher?.startsWith("Write|Edit|MultiEdit")).hooks[0].command;
  const guard = commands(settings(dir), "PreToolUse")[0];
  const bare = (c) => c.replace(/echo '[^']*' >&2/, "echo MSG >&2");
  assert.equal(bare(guard), bare(sample));
  assert.match(guard, /граф r7/);
  assert.doesNotMatch(guard, /[<>]Граф|<Раздел/);
});

test("чужие записи хуков и прочие ключи settings.json остаются", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude"));
  const own = { type: "command", command: "echo other" };
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({
      permissions: { allow: ["Bash(make:*)"] },
      hooks: { SessionStart: [{ hooks: [own] }], PreToolUse: [{ matcher: "Bash", hooks: [own] }] },
    }),
  );
  prepare(dir, ADDR);
  const s = settings(dir);
  assert.deepEqual(s.permissions, { allow: ["Bash(make:*)"] });
  assert.deepEqual(commands(s, "SessionStart")[0], "echo other");
  assert.equal(commands(s, "SessionStart").length, 2);
  assert.deepEqual(commands(s, "PreToolUse")[0], "echo other");
  assert.equal(commands(s, "PreToolUse").length, 2);
});

test("записанный моделью хук старта и пуша узнаётся и не перезаписывается", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude"));
  const start = `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"read Start of the iskron door"}}'`;
  const push = "jq -e 'git(?: -C [^ ]+)* push' && echo x || true";
  const merge = "jq -e 'gh pr merge' && echo y || true";
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: start }] }],
        PostToolUse: [{ matcher: "Bash", hooks: [push, merge].map((command) => ({ command })) }],
      },
    }),
  );
  const { status, out } = prepare(dir, [...ADDR, "--contract", "38"]);
  assert.equal(status, 0, JSON.stringify(out.left));
  assert.deepEqual(commands(settings(dir), "SessionStart"), [start]);
  for (const f of ["hook.start", "hook.push", "hook.merge"]) assert.ok(out.kept.includes(f), f);
});

test("адреса сменились — свои хуки переписаны на месте, чужая запись цела", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude"));
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "echo other" }] };
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({ hooks: { PreToolUse: [other] } }),
  );
  prepare(dir, ADDR);
  const { out } = prepare(dir, ["--graph", "r8", "--holon", "13", "--agent-role", "35"]);
  for (const f of ["hook.start", "hook.guard"]) assert.ok(out.done.includes(f), f);
  const s = settings(dir);
  const start = commands(s, "SessionStart");
  assert.equal(start.length, 1);
  for (const a of ["r8", "#13", "#35"]) assert.ok(start[0].includes(a), a);
  assert.doesNotMatch(start[0], /r7|#12|#34/);
  assert.deepEqual(s.hooks.PreToolUse[0], other);
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.match(commands(s, "PreToolUse")[1], /граф r8/);
  assert.deepEqual(
    prepare(dir, ["--graph", "r8", "--holon", "13", "--agent-role", "35"]).out.done,
    [],
  );
});

test("корень обложки с комментарием — тот же блок, второго корня нет", () => {
  const dir = repo();
  const before =
    "---\niskron: # repo addresses\n  graph: r7\n  holon: 12\n  agent_role: 34\n---\n# body\n";
  writeFileSync(join(dir, "AGENTS.md"), before);
  const { out } = prepare(dir, ADDR);
  assert.equal(read(dir, "AGENTS.md"), before);
  assert.ok(out.kept.includes("AGENTS.md"));
  prepare(dir, [...ADDR, "--contract", "38"]);
  const text = read(dir, "AGENTS.md");
  assert.equal(text.match(/^iskron:/gm).length, 1, text);
  assert.equal(coverBlock(text, "iskron").get("contract"), "38");
});

test("повтор ключа в обложке — файл не тронут, модели код 3 с названным ключом (#9314)", () => {
  for (const [before, key] of [
    ["---\n'Граф': '@a/b (r5)'\nNature: x\n'Граф': '@a/c (r6)'\n---\n# body\n", "Граф"],
    ["---\niskron:\n  graph: r7\n  holon: 12\n  graph: r8\n---\n# body\n", "iskron.graph"],
    ["---\niskron: here\n---\n# body\n", "iskron"],
  ]) {
    const dir = repo();
    writeFileSync(join(dir, "AGENTS.md"), before);
    const { status, out, stderr } = prepare(dir, ["--holon", "12", "--agent-role", "34"]);
    assert.ok(out, `не JSON: ${stderr}`);
    assert.equal(read(dir, "AGENTS.md"), before, key);
    assert.equal(status, 3, key);
    assert.ok(!out.done.includes("AGENTS.md") && !out.kept.includes("AGENTS.md"), key);
    const left = out.left.find((x) => x.item === "cover.repeat");
    assert.ok(left?.why.includes(key), `${key}: ${JSON.stringify(out.left)}`);
    const hooks = existsSync(join(dir, ".claude/settings.json"));
    assert.ok(!hooks || !commands(settings(dir), "SessionStart").some((c) => /r[78]/.test(c)), key);
  }
});

test("есть AGENTS.md: тело и чужие ключи целы; --contract ставит штамп сегодняшним днём", () => {
  const dir = repo();
  writeFileSync(join(dir, "AGENTS.md"), "---\npaths: x\n---\n# body\ntext\n");
  prepare(dir, [...ADDR, "--contract", "38"]);
  const text = read(dir, "AGENTS.md");
  assert.ok(text.endsWith("paths: x\n---\n# body\ntext\n"), text);
  const block = coverBlock(text, "iskron");
  assert.equal(block.get("contract"), "38");
  assert.equal(block.get("stamp"), new Date().toISOString().slice(0, 10));
});

test("адреса не названы и в обложке их нет — остаются модели, код 3", () => {
  const dir = repo("git@github.com:acme/gadget.git");
  const { status, out } = prepare(dir);
  assert.equal(status, 3);
  assert.equal(out.repository, "github.com/acme/gadget");
  for (const f of ["cover.graph", "cover.holon", "cover.agent_role", "hook.guard", "hook.start"])
    assert.ok(items(out.left).includes(f), f);
  const graphOnly = prepare(dir, ["--graph", "r7"]);
  assert.ok(graphOnly.out.done.includes("hook.guard"));
  assert.ok(
    items(graphOnly.out.left).includes("hook.start"),
    "старт без контура и роли не пишется",
  );
  const again = prepare(dir, [...ADDR, "--case", "77"]);
  assert.ok(again.out.done.includes("hook.start"));
  assert.match(read(dir, "REALITY.md"), /№77/, "голая заготовка узнаёт дело");
  writeFileSync(join(dir, "REALITY.md"), "# mine\n");
  prepare(dir, [...ADDR, "--case", "78"]);
  assert.equal(read(dir, "REALITY.md"), "# mine\n", "свой файл не трогается");
  assert.ok(again.out.kept.includes("hook.guard"));
  assert.equal(coverBlock(read(dir, "AGENTS.md"), "iskron").get("holon"), "12");
});

test("свой CLAUDE.md с содержимым не трогается — остаётся модели", () => {
  const dir = repo();
  writeFileSync(join(dir, "CLAUDE.md"), "# notes\n");
  const { out } = prepare(dir, ADDR);
  assert.equal(read(dir, "CLAUDE.md"), "# notes\n");
  assert.ok(lstatSync(join(dir, "CLAUDE.md")).isFile());
  assert.ok(items(out.left).includes("CLAUDE.md"));
});

test("не репозиторий или чужая обложка — отказ, код 1, ничего не записано", () => {
  const bare = join(scratch, "plain");
  mkdirSync(bare);
  const r = prepare(bare, ADDR);
  assert.equal(r.status, 1);
  assert.ok(r.out?.refused);
  assert.ok(!existsSync(join(bare, "AGENTS.md")));
  const dir = repo();
  const foreign = "---\nother:\n  graph: r1\n  contract: 9\n---\n";
  writeFileSync(join(dir, "AGENTS.md"), foreign);
  const f = prepare(dir, ADDR);
  assert.equal(f.status, 1);
  assert.equal(read(dir, "AGENTS.md"), foreign);
  assert.ok(!existsSync(join(dir, "REALITY.md")));
});

test("кривой аргумент — код 2", () => {
  const dir = repo();
  for (const args of [
    ["--graph", "@acme/x"],
    ["--holon", "#12"],
    ["--stamp", "2.11.2026"],
  ]) {
    const r = prepare(dir, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.ok(r.out?.refused, args.join(" "));
  }
  assert.ok(!existsSync(join(dir, "AGENTS.md")));
});
