#!/usr/bin/env node
// Lint the skills corpus against fixtures/surface.json — the committed snapshot
// of the live nks-mcp tool surface (refresh: node scripts/export-surface.mjs).
//
// Two drift classes are caught offline, before merge:
//   1. A tool name written in a skill that the surface does not carry
//      (rename/drop on the server side — the loud half of skill↔tool sync).
//   2. An enum value assigned in a skill (the modes, genre, given_as,
//      manifested_as, arrow_type, node_type, lens) that the surface vocabulary
//      does not contain. The checked list lives in ENUM_KEYS below and nowhere
//      else — do not restate it here, that is the drift this file already had.
//
// Pure Node, no deps, offline — CI-safe.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const surface = JSON.parse(readFileSync(join(root, "fixtures/surface.json"), "utf8"));
const tools = new Set(surface.tools);

// iskron_-prefixed tokens that are NOT tool names (credential/hook prefixes shown
// in examples). Extend deliberately; every entry is a claim that the token is
// not meant to resolve as a tool.
const NON_TOOL_TOKENS = new Set([]);

// Vocabularies that mean the same thing wherever they appear. Deliberately NOT
// every dictionary the surface publishes: `action`, `direction`, `role` and their
// kin are per-tool, so `direction` is from/to on an arrow and forward/backward on
// orient. Checking those globally would fail correct prose, so the gate declines
// them and says so rather than pretending to cover them.
const ENUM_KEYS = [
  "epistemic_mode", "ontic_mode", "volitive_mode",
  "genre", "given_as", "manifested_as", "arrow_type", "node_type",
  "lens",
];
// One truth, one place: the scan pattern is built from the list above, so adding a
// vocabulary here is enough. Kept apart once, the two drifted — the list grew and
// the pattern did not, and the extra names were checked nowhere.
const ENUM_RE = new RegExp(
  String.raw`\b(${ENUM_KEYS.join("|")})\s*[=:]\s*["']?([a-z][a-z_,\- ]*)`,
  "g",
);

const errors = [];
const mdFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".md")) mdFiles.push(p);
  }
})(join(root, "skills"));

for (const file of mdFiles) {
  const rel = file.slice(root.length + 1);
  const text = readFileSync(file, "utf8");

  // 1. Tool names. A trailing "_" (from iskron_add_* globs) makes it a family
  //    prefix: valid if at least one real tool starts with it.
  for (const m of text.matchAll(/\biskron_[a-z_]+/g)) {
    const tok = m[0];
    const bare = tok.replace(/_+$/, "");
    if (tools.has(bare)) continue;
    if ([...tools].some((t) => t.startsWith(tok.endsWith("_") ? tok : tok + "_"))) continue; // family shorthand (iskron_add, iskron_add_*)
    if (NON_TOOL_TOKENS.has(bare)) continue;
    errors.push(`${rel}: tool name "${tok}" not in the surface snapshot`);
  }

  // 2. Enum assignments in code-ish spans: key="value" / key=value / key: value.
  for (const m of text.matchAll(ENUM_RE)) {
    const [, key, raw] = m;
    const vocab = surface.enums[key];
    if (!vocab) continue;
    // The value class accepts commas (multi-value fields), so a comma-separated
    // ARGUMENT LIST — `given_as=grundsatz, epistemic=pramanita` — lets the match
    // run on into the next key's name. If an `=`/`:` follows the match, that
    // trailing bareword is a key, not a value: drop it.
    const values = raw.split(",").map((x) => x.trim()).filter(Boolean);
    // Only a COMMA can have carried the match into a neighbouring key, so
    // require one before dropping anything: with a single value, a following
    // ":" is ordinary prose ("given_as=sinn: ...") and popping it would
    // silently stop checking a real assignment.
    if (values.length > 1 && /^\s*[=:]/.test(text.slice(m.index + m[0].length))) values.pop();
    for (const v of values) {
      if (!/^[a-z][a-z_-]*$/.test(v)) continue; // placeholder / prose, not a value
      if (!vocab.includes(v)) {
        errors.push(`${rel}: ${key}="${v}" not in the surface vocabulary [${vocab.join(", ")}]`);
      }
    }
  }
}

if (errors.length) {
  console.error(`check-surface: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
// Say what was actually checked, not what the snapshot happens to carry: the
// line used to print all 17 vocabularies while nine were compared, claiming
// three times the coverage it had.
console.log(
  `✓ corpus consistent with the surface snapshot (${tools.size} tools, ` +
  `${ENUM_KEYS.length} of ${Object.keys(surface.enums).length} vocabularies — ` +
  `the rest are per-tool)`,
);
