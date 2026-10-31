// Every child process the shipped code starts hides its console window on Windows (graph
// @nks/nks-dev, node #9270): without windowsHide a `git` or `ps` call flashes a window per
// seat. The browser opener is the one exception — `detached` cancels the flag, and PowerShell
// hides its own window (bridge/oauth/discovery.ts).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { REPO } from "./built.mjs";

const SHIPPED = [
  "bridge",
  "shared",
  "cli",
  "opencode",
  "extension",
  "watchdog",
  "delivery",
  "roadmap",
];
const EXEMPT = new Set(["js/bridge/oauth/discovery.ts"]);
const CALL = /\b(spawn|spawnSync|execFile|execFileSync)\(/g;

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

test("every child process of the shipped code carries windowsHide (#9270)", () => {
  const missing = [];
  for (const top of SHIPPED)
    for (const file of sources(join(REPO, "js", top))) {
      const rel = relative(REPO, file);
      if (EXEMPT.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (!/node:child_process/.test(text)) continue;
      for (const m of text.matchAll(CALL)) {
        // The call's own text up to its closing parenthesis at depth zero.
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < text.length; end++) {
          if (text[end] === "(") depth++;
          else if (text[end] === ")" && --depth === 0) break;
        }
        const call = text.slice(m.index, end + 1);
        if (!/windowsHide:\s*true/.test(call)) {
          const line = text.slice(0, m.index).split("\n").length;
          missing.push(`${rel}:${line} ${m[1]}`);
        }
      }
    }
  assert.deepEqual(missing, [], `child processes without windowsHide: ${missing.join(", ")}`);
});
