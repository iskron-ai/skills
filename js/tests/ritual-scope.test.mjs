// Probe for the scope of the OpenCode rituals plugin samples (graph @nks/nks-dev,
// node #6686). ctx.event.subscribe is one stream for the whole OpenCode server of
// a machine: a project plugin sees session.created of every directory, and the
// orientation it writes carries the addresses of its own AGENTS.md. A session of
// another directory that receives them stands under a foreign role.
//
// Every OpenCode plugin sample in the skills' markdown (a ```js block with a
// default export and setup(ctx)) is staged as <own>/.opencode/plugins/*.js and
// loaded against a stand-in ctx with two directories: the session of the other
// directory must receive no write, the session of its own — at least one.
//
// ISKRON_RITUAL_SAMPLES (path-delimited markdown files) points the probe at any
// copy (a past revision) so it can be shown red before a fix.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { delimiter, join, relative } from "node:path";
import { test } from "node:test";

import { pluginSamples, probeScope, stage } from "../../scripts/check-ritual-scope.mjs";
import { REPO } from "./built.mjs";

const skills = join(REPO, "skills");
const sources =
  process.env.ISKRON_RITUAL_SAMPLES?.split(delimiter) ??
  readdirSync(skills, { recursive: true })
    .filter((p) => p.endsWith(".md"))
    .map((p) => join(skills, p));

const samples = sources.flatMap((path) =>
  pluginSamples(readFileSync(path, "utf8")).map((source, i) => ({ path, i, source })),
);

test("opencode plugin samples are found", () => {
  assert.ok(samples.length > 0, `no OpenCode plugin sample in ${sources.length} markdown files`);
});

for (const { path, i, source } of samples) {
  test(`opencode plugin sample writes only into its own directory: ${relative(REPO, path)} #${i}`, async () => {
    const { file, own, foreign } = stage(source);
    const writes = await probeScope(file, { own, foreign });
    assert.equal(writes.theirs, 0, "a session of another directory was written to");
    assert.ok(writes.mine > 0, "the session of its own directory got nothing");
  });
}
