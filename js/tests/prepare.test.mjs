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

import { PREPARE } from "../delivery/words/prepare.ts";
import { coverBlock } from "../shared/coverblock.ts";
import { REPO } from "./built.mjs";
import { BRIDGE, NODE } from "./status-kit.mjs";

const scratch = mkdtempSync(join(tmpdir(), "prepare-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// No key of the bridge under the probe: the graph is never asked (prepare-graph.test.mjs asks it).
const env = {
  ...process.env,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_LANG: "ru",
  ISKRON_BRIDGE_AUTH_DIR: join(scratch, "auth"),
  ISKRON_BRIDGE_TOKEN: "",
};
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

test("чистый репо: обложка разбирается, файлы и guard легли, ритуалы несёт поставка — модели контракт", () => {
  const dir = repo();
  const { status, out, stderr } = prepare(dir, ADDR);
  assert.ok(out, `не JSON: ${stderr}`);
  assert.equal(status, 3);
  assert.equal(out.repository, "github.com/acme/widget");
  const block = coverBlock(read(dir, "AGENTS.md"), "iskron");
  assert.deepEqual(Object.fromEntries(block), { graph: "r7", holon: "12", agent_role: "34" });
  assert.ok(read(dir, "REALITY.md").startsWith("# Reality"));
  if (process.platform !== "win32") assert.equal(readlinkSync(join(dir, "CLAUDE.md")), "AGENTS.md");
  for (const f of ["AGENTS.md", "REALITY.md", "CLAUDE.md", "hook.guard"])
    assert.ok(out.done.includes(f), f);
  assert.deepEqual(items(out.left), ["cover.contract"]);
  const s = settings(dir);
  assert.deepEqual(Object.keys(s.hooks), ["PreToolUse"], "старт, пуш и мерж в репо не пишутся");
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
  for (const f of ["AGENTS.md", "REALITY.md", "CLAUDE.md", "hook.guard"])
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

// Отказ guard — маршрут (#9317: свойства кода живут в AGENTS.md, в граф — смысл кода; #7910:
// стаба MEMORY.md нет — директорию держит сам guard); образцы справок несут те же слова.
test("отказ guard: свойства кода → AGENTS.md, смысл кода → граф, стаба не обещает; образцы справок — те же слова", () => {
  const dir = repo();
  prepare(dir, ADDR);
  const message = (c) => /echo '([^']*)' >&2/.exec(c)?.[1] ?? "";
  const msg = message(commands(settings(dir), "PreToolUse")[0]);
  assert.match(msg, /свойства кода[^;]*→ AGENTS\.md/);
  assert.match(msg, /смысл кода[^;]*→ граф r7/);
  assert.doesNotMatch(msg, /факты о коде|стаб/);
  for (const lang of ["ru", "en"]) {
    const w = PREPARE[lang].guard("r7");
    assert.doesNotMatch(w, /стаб|stub/i, lang);
    assert.match(w, lang === "ru" ? /директорию памяти не меняй/ : /memory-guard/, lang);
    assert.doesNotMatch(w, /'/, `${lang}: апостроф ломает echo '…' хука`);
  }
  const hooks = read(REPO, "skills/iskronify/references/hooks.md");
  const sample = [...hooks.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => JSON.parse(m[1]))
    .find((j) => j.matcher?.startsWith("Write|Edit|MultiEdit")).hooks[0].command;
  const slots = ["<Граф>", "<Раздел персистентности>"];
  assert.equal(message(sample), PREPARE.ru.guard(...slots), "образец hooks.md — слова prepare");
  assert.ok(
    hooks.includes(PREPARE.en.guard(...slots)),
    "английский текст hooks.md — слова prepare",
  );
  const surfaces = read(REPO, "skills/iskronify/references/harness-surfaces.md");
  assert.match(surfaces, /свойства кода[^;]*→ AGENTS\.md/);
  assert.doesNotMatch(surfaces, /факты о коде|стабе-запрете/);
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
  assert.deepEqual(commands(s, "SessionStart"), ["echo other"]);
  assert.deepEqual(commands(s, "PreToolUse")[0], "echo other");
  assert.equal(commands(s, "PreToolUse").length, 2);
});

test("свои хуки старта, пуша и мержа узнаются, не трогаются и названы модели на снятие", () => {
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
  const { status, out } = prepare(dir, [...ADDR, "--contract", "39"]);
  assert.equal(status, 3);
  assert.deepEqual(commands(settings(dir), "SessionStart"), [start]);
  assert.deepEqual(commands(settings(dir), "PostToolUse"), [push, merge]);
  for (const f of ["hook.start", "hook.push", "hook.merge"]) {
    const left = out.left.find((x) => x.item === f);
    assert.match(left?.why ?? "", /несёт поставка.*сними/, f);
  }
});

test("свой хук на matcher, которого поставка не несёт, на снятие не назван", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude"));
  const hook = (matcher, command) => ({ matcher, hooks: [{ type: "command", command }] });
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [hook("compact", "echo 'iskron: re-read the cover'")],
        PostToolUse: [hook("Write", "jq -e 'git(?: -C [^ ]+)* push' || true")],
      },
    }),
  );
  const left = items(prepare(dir, [...ADDR, "--contract", "39"]).out.left);
  for (const f of ["hook.start", "hook.push"]) assert.ok(!left.includes(f), f);
});

test("свой плагин ритуалов OpenCode назван на снятие; OpenCode без него — ничего", () => {
  const own = repo();
  mkdirSync(join(own, ".opencode/plugins"), { recursive: true });
  writeFileSync(join(own, ".opencode/plugins/iskron-rituals.js"), "export default {};\n");
  const left = prepare(own, ADDR).out.left.find((x) => x.item === "opencode.rituals");
  assert.match(left?.why ?? "", /иных родов.*сними в нём лишь.*остальное оставь.*без «ritual»/);
  const bare = repo();
  mkdirSync(join(bare, ".opencode/plugins"), { recursive: true });
  writeFileSync(join(bare, ".opencode/plugins/merge-gate.js"), "export default {};\n");
  assert.ok(!items(prepare(bare, ADDR).out.left).includes("opencode.rituals"), "гейт остаётся");
});

// Guard прежней поставки — те же адреса, старые слова: признак устаревания — нынешний текст,
// а не форма старого; переписывается на месте, не остаётся «kept» и не дублируется.
test("guard старыми словами при тех же адресах — устаревший: переписан на месте", () => {
  const dir = repo();
  prepare(dir, ADDR);
  const s = settings(dir);
  const fresh = commands(s, "PreToolUse")[0];
  const old = fresh.replace(
    /echo '[^']*' >&2/,
    "echo 'BLOCKED: локальная память запрещена (AGENTS.md). Факты о коде → граф r7. Директория заморожена на стабе-запрете.' >&2",
  );
  assert.notEqual(old, fresh);
  s.hooks.PreToolUse[0].hooks[0].command = old;
  writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify(s));
  const { out } = prepare(dir, ADDR);
  assert.ok(out.done.includes("hook.guard"), JSON.stringify(out));
  assert.deepEqual(commands(settings(dir), "PreToolUse"), [fresh]);
});

// Устаревший — только guard, написанный prepare: свой inline-хук человека о той же директории
// (с проверками и аудитом сверх guard) prepare не переписывает.
test("свой inline-хук памяти, не написанный prepare, — kept, не переписан", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude"));
  const own =
    'case "$(jq -r .tool_input.file_path)" in *.claude/projects/*/memory*) logger audit; echo no >&2; exit 2 ;; esac';
  const s = {
    hooks: { PreToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: own }] }] },
  };
  writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify(s));
  const { out } = prepare(dir, ADDR);
  assert.ok(out.kept.includes("hook.guard"), JSON.stringify(out));
  assert.deepEqual(commands(settings(dir), "PreToolUse"), [own]);
});

test("адреса сменились — свой guard переписан на месте, чужая запись цела", () => {
  const dir = repo();
  mkdirSync(join(dir, ".claude"));
  const other = { matcher: "Bash", hooks: [{ type: "command", command: "echo other" }] };
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify({ hooks: { PreToolUse: [other] } }),
  );
  prepare(dir, ADDR);
  const { out } = prepare(dir, ["--graph", "r8", "--holon", "13", "--agent-role", "35"]);
  assert.ok(out.done.includes("hook.guard"));
  const s = settings(dir);
  assert.equal(commands(s, "SessionStart").length, 0);
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
  for (const f of ["cover.graph", "cover.holon", "cover.agent_role", "hook.guard"])
    assert.ok(items(out.left).includes(f), f);
  assert.ok(!items(out.left).includes("hook.start"), "старт несёт поставка");
  const graphOnly = prepare(dir, ["--graph", "r7"]);
  assert.ok(graphOnly.out.done.includes("hook.guard"));
  assert.deepEqual(graphOnly.out.derived, {}, "ключа нет — граф не спрошен");
  const again = prepare(dir, [...ADDR, "--case", "77"]);
  assert.ok(!again.out.done.includes("hook.start"));
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

test("поле rituals: стоит как стояло; guard выключен — не пишется; чужое имя — модели", () => {
  const dir = repo();
  const cover = "---\niskron:\n  graph: r7\n  rituals: start mege\n---\n# x\n";
  writeFileSync(join(dir, "AGENTS.md"), cover);
  const { out } = prepare(dir, [...ADDR, "--contract", "39", "--stamp", "2026-11-03"]);
  assert.match(read(dir, "AGENTS.md"), /^ {2}rituals: start mege$/m);
  assert.equal(coverBlock(read(dir, "AGENTS.md"), "iskron").get("contract"), "39");
  assert.ok(!existsSync(join(dir, ".claude/settings.json")), "guard выключен — не пишется");
  const why = out.left.find((x) => x.item === "cover.rituals")?.why ?? "";
  assert.match(why, /'mege'/);
  assert.doesNotMatch(why, /'start'/);
  const on = repo();
  writeFileSync(join(on, "AGENTS.md"), "---\niskron:\n  rituals: guard\n---\n");
  const r = prepare(on, ADDR);
  assert.ok(r.out.done.includes("hook.guard"));
  assert.ok(!items(r.out.left).includes("cover.rituals"));
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
