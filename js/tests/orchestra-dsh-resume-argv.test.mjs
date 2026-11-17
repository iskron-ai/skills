import assert from "node:assert/strict";
import { test } from "node:test";

import { dshArgv } from "../bridge/orchestra-dsh.ts";

test("dsh continuation keeps the session and launcher patches before json", () => {
  assert.deepEqual(dshArgv("profile.yml", "model.yml", "continue", "session-123"), [
    "headless",
    "--patch",
    "profile.yml",
    "--patch",
    "model.yml",
    "--session-id",
    "session-123",
    "--json",
    "continue",
  ]);
});
