// Behavioural probe for the start word of the dsh plugin (graph @nks/nks-dev, node #10921): on
// the session's first agent/created the cover of the session's repository puts the start word
// into the agent's system prompt — a section of payload.agent.ctx.systemPrompt, the path observed
// live on dsh 0.2.2-rc.1. A resumed session hears why it stands again; no cover and another
// delivery's cover — silence. The stand-in agent records the sections registered on it.
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision) so it can be shown red
// before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CONTRACT_SUPPORT, CONTRACT_WORDS, DSH } from "../delivery/index.ts";
import { BUILT } from "./built.mjs";

const SOURCE =
  process.env.ISKRON_DSH_PLUGIN ||
  join(BUILT, "skills", "establish-mcp", "references", "dsh-plugin", "index.js");
const PLUGIN = (await import(`${SOURCE}?start`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";

const OWN =
  "---\niskron:\n  graph: '@probe/start'\n  holon: 4057\n  agent_role: 931\n---\n# probe\n";
const FOREIGN =
  "---\nother:\n  graph: '@probe/start'\n  holon: 4057\n  agent_role: 931\n  contract: 16\n---\n# probe\n";

/** A repository with the given AGENTS.md (none — no file), the process standing in it. */
function repo(t, cover) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-dsh-start-")));
  mkdirSync(join(dir, ".git"));
  mkdirSync(join(dir, "auth", "standings"), { recursive: true });
  if (cover) writeFileSync(join(dir, "AGENTS.md"), cover);
  const was = { cwd: process.cwd(), auth: process.env.ISKRON_BRIDGE_AUTH_DIR };
  process.env.ISKRON_BRIDGE_AUTH_DIR = join(dir, "auth");
  process.chdir(dir);
  t.after(() => {
    process.chdir(was.cwd);
    if (was.auth === undefined) delete process.env.ISKRON_BRIDGE_AUTH_DIR;
    else process.env.ISKRON_BRIDGE_AUTH_DIR = was.auth;
    rmSync(dir, { recursive: true, force: true });
  });
}

/** The stand-in dsh: listeners, and agents whose prompt registry records sections. */
function dsh(t) {
  const handlers = new Map();
  const agent = () => {
    const sections = [];
    return {
      sections,
      session: { id: "session-dsh-start" },
      followup: () => undefined,
      ctx: { systemPrompt: { section: (s) => void sections.push(s) } },
    };
  };
  PLUGIN({ on: (name, fn) => handlers.set(name, fn), logger: { info: () => {} } });
  t.after(() => handlers.get("session/disposed")?.());
  return {
    agent,
    created: (a, source) => handlers.get("agent/created")?.({ agent: a, source }),
    disposed: () => handlers.get("session/disposed")?.(),
  };
}

const textOf = (a) => {
  assert.equal(a.sections.length, 1, "exactly one section");
  return String(a.sections[0].text);
};

test("an own cover puts the start word with the graph and role into the system prompt", (t) => {
  repo(t, OWN);
  const d = dsh(t);
  const a = d.agent();
  d.created(a, "startup");
  const text = textOf(a);
  assert.match(text, /двери iskron/);
  assert.match(text, /@probe\/start/);
  assert.match(text, /#931/);
  assert.ok(text.includes(DSH.ru.startListen()));
  assert.ok(!text.includes(DSH.ru.startResumed()));
  // Headless dsh shows no skills catalog and owes the case its line's outcome (#10921):
  // the word says to load the iskron skill by name and to close the line, not to linger in the case.
  assert.match(text, /загрузи скилл iskron тулом skill/);
  assert.match(text, /закрой строку исходом/);
  // A later agent of the process is a subagent: no second word.
  const sub = d.agent();
  d.created(sub, "startup");
  assert.equal(sub.sections.length, 0);
});

test("a long process: the next session after a disposed one gets its own start word", (t) => {
  repo(t, OWN);
  const d = dsh(t);
  const first = d.agent();
  d.created(first, "startup");
  textOf(first);
  d.disposed();
  const next = d.agent();
  d.created(next, "startup");
  assert.ok(
    textOf(next).includes(DSH.ru.startListen()),
    "the second session's root hears the word",
  );
});

test("a resumed session hears why it stands again", (t) => {
  repo(t, OWN);
  const d = dsh(t);
  const a = d.agent();
  d.created(a, "resume");
  const text = textOf(a);
  assert.match(text, /#931/);
  assert.ok(text.includes(DSH.ru.startResumed()));
  assert.ok(!text.includes(DSH.ru.startListen()));
  // The same two duties reach a resumed session (#10921): load the skill, close the line.
  assert.match(text, /загрузи скилл iskron тулом skill/);
  assert.match(text, /закрой строку исходом/);
});

test("no cover — silence", (t) => {
  repo(t, null);
  const d = dsh(t);
  const a = d.agent();
  d.created(a, "startup");
  assert.equal(a.sections.length, 0);
});

test("another delivery's cover — silence", (t) => {
  repo(t, FOREIGN);
  const d = dsh(t);
  const a = d.agent();
  d.created(a, "startup");
  assert.equal(a.sections.length, 0);
});

// The cover's contract below the supported minimum is warned of in the same section, before the
// start word — as OpenCode's first prompt (opencode/rites.ts) and Claude Code's SessionStart
// (cli/rituals-hook.ts) do (#11071).
const withContract = (n) =>
  OWN.replace("  agent_role: 931\n", `  agent_role: 931\n  contract: ${n}\n`);

test("an unsupported cover contract is warned of before the start word", (t) => {
  repo(t, withContract(16));
  const d = dsh(t);
  const a = d.agent();
  d.created(a, "startup");
  const text = textOf(a);
  const warning = CONTRACT_WORDS.ru.unsupported(16, CONTRACT_SUPPORT.target);
  assert.ok(text.startsWith(warning), text);
  assert.match(text, /#931/);
});

test("a supported cover contract — no warning", (t) => {
  repo(t, withContract(CONTRACT_SUPPORT.target));
  const d = dsh(t);
  const a = d.agent();
  d.created(a, "startup");
  assert.doesNotMatch(textOf(a), /больше не поддерживается/);
});
