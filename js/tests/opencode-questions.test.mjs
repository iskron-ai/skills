// Built OpenCode plugin exclusion of blocking questionnaires (#10397).
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { REPO } from "./built.mjs";
import { plugin, SANDBOX } from "./opencode-kit.mjs";

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

test("OpenCode: removes question on registry replay and denies direct permission checks; graph ask survives", async () => {
  const directory = join(SANDBOX, "own");
  mkdirSync(join(directory, ".git"), { recursive: true });
  writeFileSync(join(directory, "AGENTS.md"), "---\niskron:\n  graph: r5\n---\n");
  const rec = await plugin(
    { ISKRON_ROOT_SEAT: "0" },
    {
      location: { directory },
      initialTools: [{ name: "question" }, { name: "iskron_case" }, { name: "read" }],
    },
  );
  try {
    assert.equal(rec.tools().has("question"), false);
    await rec.ctx.tool.reload();
    assert.equal(rec.tools().has("question"), false);
    assert.equal(rec.tools().has("iskron_case"), true);
    for (const effect of ["allow", "ask"])
      assert.equal(await rec.ask("question", {}, "question", ["*"], effect), "deny");
    assert.equal(await rec.ask("iskron_case", {}, "iskron_case", ["*"], "allow"), "allow");
    rmSync(join(directory, "AGENTS.md"));
    assert.equal(await rec.ask("question", {}, "question", ["*"], "allow"), "allow");
    await rec.ctx.tool.reload();
    assert.equal(rec.tools().has("question"), true);
    assert.equal(await rec.ask("question", {}, "question", ["*"], "allow"), "allow");
    writeFileSync(join(directory, "AGENTS.md"), "---\niskron:\n  graph: r5\n---\n");
    assert.equal(await rec.ask("question", {}, "question", ["*"], "allow"), "deny");
    await rec.ctx.tool.reload();
    assert.equal(rec.tools().has("question"), false);
    assert.equal(await rec.ask("question", {}, "question", ["*"], "allow"), "deny");
  } finally {
    await rec.stop();
  }
});

for (const kind of ["outside", "uncovered", "plain-agents", "foreign", "hooks-only"])
  test(`OpenCode: leaves question and foreign permission untouched in ${kind}`, async () => {
    const directory = join(SANDBOX, kind);
    mkdirSync(directory, { recursive: true });
    if (kind !== "outside") mkdirSync(join(directory, ".git"));
    if (kind === "plain-agents") writeFileSync(join(directory, "AGENTS.md"), "# My instructions\n");
    if (kind === "foreign")
      writeFileSync(join(directory, "AGENTS.md"), "---\nother:\n  graph: r5\n---\n");
    if (kind === "hooks-only") {
      mkdirSync(join(directory, ".opencode/plugins"), { recursive: true });
      writeFileSync(join(directory, ".opencode/plugins/rituals.js"), "// unrelated");
    }
    const rec = await plugin(
      { ISKRON_ROOT_SEAT: "0" },
      {
        location: { directory },
        initialTools: [{ name: "question" }],
      },
    );
    try {
      assert.equal(rec.tools().has("question"), true);
      await rec.ctx.tool.reload();
      assert.equal(rec.tools().has("question"), true);
      for (const effect of ["allow", "ask", "deny"])
        assert.equal(await rec.ask("question", {}, "question", ["*"], effect), effect);
      const event = { action: "question", effect: "ask", message: "foreign policy" };
      for (const cb of rec.hooks["permission.evaluate"] ?? []) await cb(event);
      assert.deepEqual(event, { action: "question", effect: "ask", message: "foreign policy" });
      if (kind === "uncovered") {
        writeFileSync(join(directory, "AGENTS.md"), "---\niskron:\n  graph: r5\n---\n");
        assert.equal(await rec.ask("question", {}, "question", ["*"], "allow"), "deny");
        await rec.ctx.tool.reload();
        assert.equal(rec.tools().has("question"), false);
      }
    } finally {
      await rec.stop();
    }
  });

test("OpenCode: delivery all keeps unconditional removal and denial without a cover", async () => {
  const file = join(SANDBOX, "all-plugin.mjs");
  await build({
    entryPoints: [join(REPO, "js/opencode/plugin.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: file,
    plugins: [
      {
        name: "all-delivery",
        setup(b) {
          b.onLoad({ filter: /delivery\/questions\.ts$/ }, () => ({
            contents: 'export const QUESTION_SCOPE: "all" | "repo" = "all";',
            loader: "ts",
          }));
        },
      },
    ],
  });
  const rec = await plugin(
    { ISKRON_ROOT_SEAT: "0" },
    {
      pluginFile: file,
      location: { directory: join(SANDBOX, "outside") },
      initialTools: [{ name: "question" }],
    },
  );
  try {
    assert.equal(rec.tools().has("question"), false);
    await rec.ctx.tool.reload();
    assert.equal(rec.tools().has("question"), false);
    assert.equal(await rec.ask("question", {}, "question", ["*"], "allow"), "deny");
  } finally {
    await rec.stop();
  }
  const definition = (await import(pathToFileURL(file).href)).default;
  for (const at of ["transform", "permission"])
    await assert.rejects(
      definition.setup({
        tool: {
          transform: async () => {
            if (at === "transform") throw new Error("guard transform failed");
          },
        },
        permission: {
          hook: async () => {
            throw new Error("guard permission failed");
          },
        },
      }),
      new RegExp(`guard ${at} failed`),
    );
});
