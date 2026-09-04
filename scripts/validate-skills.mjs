#!/usr/bin/env node
// Validate the format contract of every skill in skills/<name>/SKILL.md.
//
// Why this exists: a SKILL.md frontmatter that is malformed YAML (e.g. an
// unescaped " inside a double-quoted description) installs silently and
// degrades every agent that loads it — there is no crash, only drift. This
// script is the loud gate the repo otherwise lacks. Run via `make validate`
// or in CI (.github/workflows/ci.yml).
//
// Self-contained: pure Node, no dependencies, no node_modules, no lockfile —
// matching the repo's "prose, no deps" nature. It deliberately does NOT pull a
// full YAML parser; instead it enforces the *narrow* frontmatter contract these
// skills actually use (two flat, single-line keys), which both catches malformed
// YAML and keeps the frontmatter simple.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const ALLOWED_KEYS = new Set(["name", "description", "slash"]);
const REQUIRED_KEYS = ["name", "description", "slash"];

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warnings = [];
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

// Validate a single-line YAML flow scalar (the part after "key: ").
// Returns null if ok, or an error string. This is where the unescaped-quote
// bug is caught: a double-quoted scalar must close at end-of-line, with nothing
// after the closing quote.
function scalarError(value) {
  if (value.length === 0) return "empty value";
  const q = value[0];
  if (q !== '"' && q !== "'") return null; // plain scalar — accepted as-is

  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (q === '"' && ch === "\\") {
      i++; // escaped char — skip it
      continue;
    }
    if (ch === q) {
      // single-quoted YAML escapes a quote by doubling it ('')
      if (q === "'" && value[i + 1] === "'") {
        i++;
        continue;
      }
      const rest = value.slice(i + 1).trim();
      if (rest !== "" && !rest.startsWith("#")) {
        return `unexpected content after closing ${q}: ${JSON.stringify(
          rest.slice(0, 50)
        )} — likely an unescaped ${q} inside the value`;
      }
      return null; // properly closed
    }
  }
  return `unterminated ${q === '"' ? "double" : "single"}-quoted value`;
}

function validateSkill(name) {
  const where = `skills/${name}/SKILL.md`;
  const path = join(skillsDir, name, "SKILL.md");
  if (!existsSync(path)) {
    fail(where, "missing SKILL.md");
    return;
  }
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  if (lines[0] !== "---") {
    fail(where, "must start with a `---` frontmatter delimiter on line 1");
    return;
  }
  const closeIdx = lines.indexOf("---", 1);
  if (closeIdx === -1) {
    fail(where, "frontmatter is not closed with a second `---`");
    return;
  }

  const fm = lines.slice(1, closeIdx);
  const seen = new Set();
  for (let i = 0; i < fm.length; i++) {
    const line = fm[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      fail(where, `frontmatter line ${i + 2} is indented — only flat, single-line keys are allowed: ${JSON.stringify(line)}`);
      continue;
    }
    const m = line.match(/^([A-Za-z][\w-]*):(?:\s+(.*))?$/);
    if (!m) {
      fail(where, `frontmatter line ${i + 2} is not a \`key: value\` pair: ${JSON.stringify(line)}`);
      continue;
    }
    const key = m[1];
    const value = (m[2] ?? "").trimEnd();
    if (!ALLOWED_KEYS.has(key)) {
      fail(where, `unexpected frontmatter key \`${key}\` (allowed: ${[...ALLOWED_KEYS].join(", ")})`);
      continue;
    }
    if (seen.has(key)) fail(where, `duplicate frontmatter key \`${key}\``);
    seen.add(key);

    const err = scalarError(value);
    if (err) {
      fail(where, `\`${key}\` — ${err}`);
      continue;
    }

    if (key === "slash") {
      // Every skill in this distribution is typeable as `/name`, so the key is
      // not a per-skill choice: it is required and it is `true`. OpenCode
      // decodes it as a boolean, and a quoted "true" arrives as a string,
      // fails the decode and takes the skill down with it — so `true` bare.
      if (value !== "true") {
        fail(where, `\`slash\` must be a plain \`true\` (every skill is typeable as /name), got ${JSON.stringify(value)}`);
      }
    }

    if (key === "name") {
      const unquoted = value.replace(/^["']|["']$/g, "");
      if (!/^[a-z][a-z0-9-]*$/.test(unquoted)) {
        fail(where, `\`name\` must be kebab-case (^[a-z][a-z0-9-]*$), got ${JSON.stringify(unquoted)}`);
      } else if (unquoted !== name) {
        fail(where, `\`name\` (${JSON.stringify(unquoted)}) must match the directory name (${JSON.stringify(name)})`);
      }
    }
    if (key === "description") {
      const unquoted = value.replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1");
      if (unquoted.trim().length === 0) fail(where, "`description` must be non-empty");
      // The agentskills spec caps description at 1024 — "characters" per the
      // docs, but byte-counting implementations (OpenCode) truncate or reject
      // at 1024 UTF-8 BYTES, and our descriptions are part-Cyrillic (2
      // bytes/char). Gate on the RENDERED value's bytes (what a YAML parser
      // hands the harness); warn from 900 so there is headroom before the
      // cliff instead of a surprise at it.
      let rendered = unquoted;
      if (value[0] === '"') rendered = unquoted.replace(/\\(["\\])/g, "$1");
      else if (value[0] === "'") rendered = unquoted.replace(/''/g, "'");
      const bytes = Buffer.byteLength(rendered, "utf8");
      if (bytes > 1024) {
        fail(where, `\`description\` is ${bytes} UTF-8 bytes — over the 1024-byte cliff (byte-counting harnesses truncate or reject it)`);
      } else if (bytes > 900) {
        warn(where, `\`description\` is ${bytes} UTF-8 bytes — inside the 1024-byte cliff's blast radius; keep ≤900 for headroom`);
      }
      // The claude.ai plugin loader refuses a description with XML-tag-shaped
      // content ("SKILL.md description cannot contain XML tags") — and the
      // refusal takes down the whole plugin install, not just the one skill.
      // Its exact matcher is unknown (behaviour over prose), and no
      // description needs angle brackets, so ban them outright: write
      // placeholders as @handle/mind, not @<handle>/mind.
      if (/[<>]/.test(rendered)) {
        fail(where, "`description` contains `<` or `>` — the claude.ai plugin loader rejects XML-tag-shaped descriptions and the whole plugin install fails with it; write placeholders without angle brackets (@handle/mind, not @<handle>/mind)");
      }
    }
  }

  for (const k of REQUIRED_KEYS) {
    if (!seen.has(k)) fail(where, `missing required frontmatter key \`${k}\``);
  }
}

// 1. Validate every skill directory.
// --- promised files must ship -----------------------------------------------
// A skill's prose is the only place a consumer learns that a file exists, and a
// pointer is worth exactly as much as the file behind it. Two promises are made
// in shipped prose and both were once broken in the wild: a `references/<file>`
// path that resolves to nothing, and a script named as runnable — "run the file,
// do not retype it" — that was described and never written. Neither is visible
// to a reader of the diff; both are trivial for the gate.
const PROMISE_PATTERNS = [
  // `references/channel.md` — a path relative to the skill directory
  { re: /references\/[A-Za-z0-9._-]+/g, resolve: (m) => m },
  // `watchdog.mjs` — a runnable named on its own; scripts are what get retyped
  { re: /`([A-Za-z0-9._-]+\.mjs)`/g, resolve: (m, g) => g },
];

function checkPromisedFiles(name) {
  const dir = join(skillsDir, name);
  const pages = [join(dir, "SKILL.md")];
  const refs = join(dir, "references");
  if (existsSync(refs)) {
    for (const f of readdirSync(refs)) if (f.endsWith(".md")) pages.push(join(refs, f));
  }
  const shipped = new Set();
  const collect = (d, prefix) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) collect(join(d, e.name), `${prefix}${e.name}/`);
      else { shipped.add(`${prefix}${e.name}`); shipped.add(e.name); }
    }
  };
  collect(dir, "");

  for (const page of pages) {
    const where = page.slice(root.length + 1);
    const text = readFileSync(page, "utf8");
    for (const { re, resolve } of PROMISE_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const wanted = resolve(m[0], m[1]);
        if (/[<>*]/.test(wanted)) continue; // a placeholder, not a promise
        if (!shipped.has(wanted)) {
          fail(where, `promises \`${wanted}\`, but no such file ships in skills/${name}/`
            + " — a pointer is worth what the file behind it is worth");
        }
      }
    }
  }
}

// --- a named skill must resolve, in a form that can be called ---------------
// A skill name is a pointer like any other, but it fails silently: an
// unresolvable name raises no error, only a shrug, and the ritual that aimed at
// the method keeps firing while the method never runs. The tool half of this is
// mechanized by check-surface; the skill half was left to prose in the finalize
// step, which reaches AGENTS.md but not role files or hook bodies. Two offline
// halves, both measured clean on this corpus before being switched on:
//   1. a skill named in shipped prose must exist in this delivery;
//   2. a foreign family's call form (`nks-weaving`) is never ours. The
//      namespace is a property of the HARNESS, not of the delivery — Claude
//      Code's plugin channel namespaces, others do not — so our own bare and
//      namespaced forms are both legitimate and neither is flagged here.
const SKILL_MENTION = /(?:скилл|скилла|скиллом|скиллу|скилле|скиллы|skill)\s+`([A-Za-z0-9._:-]+)`/gu;
const FOREIGN_FORM = /`(nks)[-:]([a-z0-9-]+)`/gu;

function checkSkillNames(name, known) {
  const dir = join(skillsDir, name);
  const pages = [join(dir, "SKILL.md")];
  const refs = join(dir, "references");
  if (existsSync(refs)) {
    for (const f of readdirSync(refs)) if (f.endsWith(".md")) pages.push(join(refs, f));
  }
  for (const page of pages) {
    const where = page.slice(root.length + 1);
    for (const line of readFileSync(page, "utf8").split("\n")) {
      if (/superpowers/i.test(line)) continue; // a foreign suite names its own skills
      for (const m of line.matchAll(SKILL_MENTION)) {
        const wanted = m[1];
        if (/[<>*]/.test(wanted)) continue; // a placeholder, not a name
        const bare = wanted.includes(":") ? wanted.slice(wanted.indexOf(":") + 1) : wanted;
        if (!known.has(bare)) {
          fail(where, `names skill \`${wanted}\`, which does not ship in skills/ — an unresolvable name is a projection defect, not a typo (it shrugs, it does not error)`);
        }
      }
      for (const m of line.matchAll(FOREIGN_FORM)) {
        if (known.has(m[2])) {
          fail(where, `writes \`${m[1]}-${m[2]}\` — a foreign family's call form for our own skill \`${m[2]}\``);
        }
      }
    }
  }
}

const skillNames = readdirSync(skillsDir).filter((n) =>
  statSync(join(skillsDir, n)).isDirectory()
);
if (skillNames.length === 0) fail("skills/", "no skill directories found");
const knownSkills = new Set(skillNames);
for (const name of skillNames.sort()) { validateSkill(name); checkPromisedFiles(name); checkSkillNames(name, knownSkills); }

// 2. Component-list guard: the skill set ships by plugin auto-discovery from
//    skills/ — the tree is the single source of truth. A `skills` (or any
//    component) list in a manifest re-introduces a second copy of that truth:
//    it drifts (a forgotten entry or typo'd path breaks install for every
//    plugin user) and, next to plugin.json, is exactly the "conflicting
//    manifests" plugin error. Fail loudly if a list creeps back in.
const COMPONENT_KEYS = ["skills", "commands", "agents", "hooks", "mcpServers"];
const manifestPath = join(root, ".claude-plugin", "marketplace.json");
try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const plugin of manifest.plugins ?? []) {
    for (const key of COMPONENT_KEYS) {
      if (key in plugin) {
        fail("marketplace.json", `plugin \`${plugin.name}\` carries a \`${key}\` list — components ship by auto-discovery from skills/; remove it (a second copy of the truth drifts)`);
      }
    }
  }
} catch (e) {
  fail(".claude-plugin/marketplace.json", `could not read/parse: ${e.message}`);
}

// 3. Version contract: .claude-plugin/plugin.json is Claude Code's
//    highest-precedence version source — an install refreshes only when this
//    string changes. It must be valid semver, and mirrored in both marketplace
//    copies — `metadata.version` and the plugin entry's own `version` (what a
//    marketplace listing shows before install) — so there is one "iskron
//    version". release-please writes all three from the same release; this gate
//    fails loudly if they ever diverge.
const pluginPath = join(root, ".claude-plugin", "plugin.json");
try {
  const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? "")) {
    fail("plugin.json", `\`version\` must be semver X.Y.Z, got ${JSON.stringify(plugin.version)}`);
  }
  for (const key of COMPONENT_KEYS) {
    if (key in plugin) {
      fail("plugin.json", `carries a \`${key}\` list — components ship by auto-discovery from skills/; keep plugin.json metadata-only`);
    }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!(manifest.plugins ?? []).some((p) => p.name === plugin.name)) {
    fail("plugin.json", `\`name\` (${JSON.stringify(plugin.name)}) matches no plugin in marketplace.json`);
  }
  for (const p of manifest.plugins ?? []) {
    if (p.name !== plugin.name) continue;
    if (p.version !== plugin.version) {
      fail("marketplace.json", `plugin \`${p.name}\` has \`version\` ${JSON.stringify(p.version)} — must mirror plugin.json (${plugin.version}); release-please writes both`);
    }
  }
  if (manifest.metadata?.version !== plugin.version) {
    fail("marketplace.json", `metadata.version (${JSON.stringify(manifest.metadata?.version)}) must mirror plugin.json (${plugin.version})`);
  }
} catch (e) {
  fail(".claude-plugin/plugin.json", `could not read/parse: ${e.message}`);
}

// 4. Shipped-prose guards: the semantic contract of the distribution's
//    user-facing surfaces (skills/**/*.md, README.md, SETUP.md). Each guard
//    freezes a settled rename/brand decision so it cannot silently regress:
//    — «реалм» was renamed to «граф» in Russian prose (the realm= param and
//      Latin literals like "Realm not found" are untouched by design);
//    — tool references must carry this distribution's prefix (iskron_*), a
//      nks_* call in a skill is a dead or foreign pointer downstream;
//    — a foreign brand must not reappear in shipped sources (AGENTS.md's
//      brand-clean rule, mechanized).
const proseGuards = [
  { re: /[Рр]еалм/u, msg: "«реалм» в русской прозе — переименовано в «граф» (параметр realm= и латинские литералы не в счёт)" },
  { re: /\bnks_[a-z_]+/u, msg: "ссылка на тул nks_* — префикс этой поставки iskron_*" },
  { re: new RegExp(["ver", "stak"].join(""), "iu"), msg: "чужой бренд в отгружаемом источнике — репо должно быть brand-clean" },
];
function walkMd(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
// AGENTS.md never ships, so it sat outside these guards — and that is exactly
// where a wrong tool prefix survived unnoticed: the file instructing the agent
// told it to call nks_* tools this delivery does not have. A config that
// misnames the surface is worse than a skill that does, because every session
// reads it first. Guard it on the same terms.
const shippedFiles = [...walkMd(skillsDir), join(root, "README.md"), join(root, "SETUP.md"), join(root, "AGENTS.md")].filter(existsSync);
for (const file of shippedFiles) {
  const rel = file.slice(root.length + 1);
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const g of proseGuards) {
      const m = lines[i].match(g.re);
      if (m) fail(`${rel}:${i + 1}`, `${g.msg} (найдено: ${JSON.stringify(m[0])})`);
    }
  }
}

// 5. Manifest lists must match the tree. Hand-edited inventories beside
//    automation drift silently — so the lists are linted against readdir, not
//    trusted: AGENTS.md's structure line and README.md's skill table are both
//    claims about what skills/ holds, and both are checked against it.
try {
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const m = /по одной директории на скилл \(([^)]*)\)/.exec(agents);
  if (!m) {
    fail("AGENTS.md", "инвентарная строка не найдена (\"по одной директории на скилл (…)\" в разделе «Структура проекта»)");
  } else {
    const listed = new Set([...m[1].matchAll(/`([a-z-]+)`/g)].map((x) => x[1]));
    const onDisk = new Set(skillNames);
    for (const name of onDisk) if (!listed.has(name)) {
      fail("AGENTS.md", `skill \`${name}\` exists in skills/ but is missing from the inventory line`);
    }
    for (const name of listed) if (!onDisk.has(name)) {
      fail("AGENTS.md", `inventory line names \`${name}\` but skills/${name}/ does not exist`);
    }
  }
} catch (e) {
  fail("AGENTS.md", `could not read: ${e.message}`);
}
try {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const rows = new Set([...readme.matchAll(/^\| \*\*([a-z-]+)\*\* \|/gm)].map((x) => x[1]));
  for (const name of skillNames) if (!rows.has(name)) {
    fail("README.md", `skill \`${name}\` has no row in the skill table`);
  }
  for (const name of rows) if (!skillNames.includes(name)) {
    fail("README.md", `table row \`${name}\` matches no directory in skills/`);
  }
} catch (e) {
  fail("README.md", `could not read: ${e.message}`);
}

// 5b. The shipped map of situations. AGENTS.md and README.md are inventories
//     for the human maintaining this repo; neither ships inside the plugin, so
//     an agent that installed the bundle has never read either. What it does
//     read is entry — the one skill every session passes through — and the map
//     there is the only place a skill announces WHEN to reach for it. A skill
//     absent from that map is, for the agent, a skill that does not exist: the
//     harness lists its description, and a description is a routing surface,
//     not a map. So the map is linted like the other inventories, not trusted
//     to memory — a new skill lands in it or CI goes red.
try {
  const entry = readFileSync(join(skillsDir, "entry", "SKILL.md"), "utf8");
  const section = /## Карта положений[\s\S]*?(?=\n## )/.exec(entry);
  if (!section) {
    fail("skills/entry/SKILL.md", "секция «## Карта положений» не найдена — карта скиллов по симптому живёт там");
  } else {
    const mapped = new Set([...section[0].matchAll(/→ \*\*([a-z-]+)\*\*/g)].map((x) => x[1]));
    for (const name of skillNames) {
      if (name === "entry") continue; // the map's own host
      if (!mapped.has(name)) {
        fail("skills/entry/SKILL.md", `skill \`${name}\` has no row in the map of situations — an agent will never learn when to reach for it`);
      }
    }
    for (const name of mapped) if (!skillNames.includes(name)) {
      fail("skills/entry/SKILL.md", `map row \`${name}\` matches no directory in skills/`);
    }
  }
} catch (e) {
  fail("skills/entry/SKILL.md", `could not read: ${e.message}`);
}

// 6. Контракт iskronify живёт в ДВУХ местах, и это нарочно: тело скилла читают
//    после загрузки, а загружает скилл его описание — номер, стоящий только в
//    теле, не может сработать триггером никогда, потому что сравнивать его не с
//    чем, пока не позовут руками. В контексте сессии сходятся ровно описание
//    скилла и штамп в AGENTS.md, так что несущая копия — та, что в описании.
//    Две копии расходятся молча, поэтому их равенство держит гейт, а не память.
try {
  const p = join(skillsDir, "iskronify", "SKILL.md");
  if (existsSync(p)) {
    const t = readFileSync(p, "utf8");
    const inDesc = /КОНТРАКТ AGENTS\.md: (\d+)/.exec(t);
    const inBody = /\*\*Контракт: `(\d+)`\.\*\*/.exec(t);
    if (!inDesc) fail("skills/iskronify/SKILL.md", "описание не называет контракт («КОНТРАКТ AGENTS.md: N») — без числа в описании скилл не сработает на протухший конфиг");
    if (!inBody) fail("skills/iskronify/SKILL.md", "тело не называет контракт («**Контракт: `N`.**»)");
    if (inDesc && inBody && inDesc[1] !== inBody[1]) {
      fail("skills/iskronify/SKILL.md", `контракт разошёлся: описание говорит ${inDesc[1]}, тело — ${inBody[1]}; штампуется тело, а срабатывает описание`);
    }
  }
} catch (e) {
  fail("skills/iskronify/SKILL.md", `не удалось проверить контракт: ${e.message}`);
}

// 7. Отгружаемая MCP-запись обязана целить в КАНОНИЧЕСКИЙ идентификатор
//    ресурса — ту самую строку, что сервер печатает в своём protected-resource
//    (снимок несёт её наблюдением, `make surface`). Совпадение здесь побайтовое
//    не из педантизма: наивный клиент сравнивает строки, и хвостовая косая, —
//    которую пишут по привычке, — разводит идентификаторы. Отказ приходит
//    немым: «сервер недоступен» вместо «идентификаторы разошлись», и цену
//    платит каждый, кто поставил отгружаемую запись. Правило принято по слову
//    держателя поверхности; форму его сервера здесь не нормализуем.
try {
  const snapPath = join(root, "fixtures/surface.json");
  const recPath = join(root, ".mcp.json");
  if (existsSync(snapPath) && existsSync(recPath)) {
    const canonical = JSON.parse(readFileSync(snapPath, "utf8")).resource;
    const servers = JSON.parse(readFileSync(recPath, "utf8")).mcpServers ?? {};
    if (canonical) {
      for (const [name, rec] of Object.entries(servers)) {
        if (rec?.url && rec.url !== canonical) {
          fail(".mcp.json", `запись \`${name}\` целит в ${JSON.stringify(rec.url)}, а канонический идентификатор ресурса — ${JSON.stringify(canonical)}: наивный клиент сравнит строки и откатится на «сервер авторизации = сам ресурс», сказав «сервер недоступен»`);
        }
      }
    }
  }
} catch (e) {
  fail(".mcp.json", `не удалось сверить с каноническим идентификатором: ${e.message}`);
}

// Report.
if (warnings.length > 0) {
  console.warn(`⚠ ${warnings.length} warning${warnings.length === 1 ? "" : "s"} (non-fatal):`);
  for (const w of warnings) console.warn(`  • ${w}`);
  console.warn("");
}
if (errors.length > 0) {
  console.error(`✗ skill validation failed (${errors.length} problem${errors.length === 1 ? "" : "s"}):\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error("");
  process.exit(1);
}
console.log(`✓ ${skillNames.length} skills valid: ${skillNames.sort().join(", ")}`);
