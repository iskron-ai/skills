// Policy #9786: exercise the shipped start entries, not a detector substituted for them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { bash, COVER, opencode, repo, start } from "./rites-kit.mjs";

const old = COVER.replace("contract: 39", "contract: 38");
const warning =
  "Контракт 38 больше не поддерживается; старые хуки не удалены. Выполните полный прогон iskronify до 42; ритуалы будут приняты после проверки";

test("Claude startup warns even when the repository holds its own start hook", () => {
  const dir = repo({
    agents: old,
    settings: {
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [{ type: "command", command: "echo 'read the iskron door Start'" }],
          },
        ],
      },
    },
  });
  const file = join(dir, ".claude", "settings.json");
  const before = readFileSync(file);
  assert.equal(start(dir)?.additionalContext, warning);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(bash(dir, "true"), null);
  assert.equal(start(dir, "compact"), null);
});

test("OpenCode warns once despite an old repository rituals plugin, leaving its bytes intact", async () => {
  const dir = repo({ agents: old, rituals: true });
  const file = join(dir, ".opencode", "plugins", "iskron-rituals.js");
  const before = readFileSync(file);
  const { rec } = await opencode(dir);
  try {
    assert.ok((await rec.prompt("root", "hello")).includes(warning));
    assert.ok(!(await rec.prompt("root", "again")).includes(warning));
    assert.deepEqual(readFileSync(file), before);
  } finally {
    await rec.stop();
  }
});

test("supported and future covers are not called obsolete", () => {
  for (const n of [39, 40, 41]) {
    const dir = repo({ agents: COVER.replace("contract: 39", `contract: ${n}`) });
    assert.ok(!start(dir)?.additionalContext.includes("больше не поддерживается"));
  }
});
