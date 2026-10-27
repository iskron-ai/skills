// Probe for the published hook samples of iskronify (references/hooks.md):
// every JSON block there that carries a `command` is a sample a projection may
// copy word for word, so each command is run as the harness runs it — /bin/sh
// with a hook payload on stdin — and what it prints on stdout must parse as
// JSON. `sh -n` is not enough: a quote closed inside `echo '…'` is legal syntax
// and prints a broken envelope, and `|| true` hides it (graph @nks/nks-dev,
// node #8969).
//
// ISKRON_HOOKS_TEMPLATE points the probe at any copy (a past revision) so it
// can be shown red before a fix.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatePath =
  process.env.ISKRON_HOOKS_TEMPLATE ?? join(root, "skills", "iskronify", "references", "hooks.md");

const cwd = mkdtempSync(join(tmpdir(), "hook-samples-"));
after(() => rmSync(cwd, { recursive: true, force: true }));

// one payload wakes every sample that prints: a Write of a design draft
const payload = JSON.stringify({
  hook_event_name: "PostToolUse",
  tool_name: "Write",
  tool_input: { file_path: "specs/x.md", command: "true" },
  tool_response: { stdout: "", stderr: "" },
});

const commandsOf = (node) =>
  node === null || typeof node !== "object"
    ? []
    : Object.entries(node).flatMap(([k, v]) =>
        k === "command" && typeof v === "string" ? [v] : commandsOf(v),
      );

const samplesOf = (md) =>
  [...md.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => commandsOf(JSON.parse(m[1])));

// throws when the command fails on this payload or its stdout is not a JSON
// envelope (empty — silent — is fine)
function judge(command) {
  const r = spawnSync("/bin/sh", ["-c", command], { input: payload, encoding: "utf8", cwd });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim();
  if (out) JSON.parse(out);
  return out;
}

const samples = samplesOf(readFileSync(templatePath, "utf8"));

test("hooks.md publishes command samples", () => {
  assert.ok(samples.length >= 3, `samples found: ${samples.length}`);
});

for (const command of samples) {
  test(`hooks.md sample prints JSON: ${command.slice(0, 60)}`, () => {
    assert.doesNotThrow(() => judge(command), command.slice(0, 120));
  });
}

test("hooks.md: the SessionStart sample prints its envelope", () => {
  const start = samples.find(
    (c) => c.includes('\\"SessionStart\\"') || c.includes('"SessionStart"'),
  );
  assert.ok(start, "a SessionStart sample is published");
  assert.match(judge(start), /"hookEventName":"SessionStart"/);
});

// negative control: the same probe on a sample with an apostrophe in its text is red
test("hooks.md probe: an apostrophe inside echo '…' is caught", () => {
  for (const bad of [
    `echo '{"hookSpecificOutput":{"additionalContext":"read the door's Start"}}'`,
    `echo '{"hookSpecificOutput":{"additionalContext":"the door's Start; the caller's bridge"}}'`,
  ])
    assert.throws(() => judge(bad), bad);
});
