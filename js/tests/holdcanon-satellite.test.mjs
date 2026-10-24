// Перенос записей держания прежней сборки на ключ @owner/slug (граф @nks/nks-dev: решение
// #8200, вопрос #8677) один на процесс, а спутник своё место с диска не возвращает: две сессии
// демона, спутник зовёт перенос первым — основная всё равно получает свой перенос, а не пустой
// ход спутника (полное ревью кандидата 7.22.0, дело №1622). Окно гонки — микрозадачи одного
// хода: сессии демона снаружи туда не попадают, поэтому обе сессии — области движка в процессе
// пробы, из исходника (как work.test.mjs).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs, setConfig } from "../bridge/config.ts";
import { canonHoldRecords } from "../bridge/holdcanon.ts";
import { learnRealm } from "../bridge/realms.ts";
import { newScope, runIn } from "../shared/scope.ts";
import { holdFilePathOf, standingsDirOf } from "../shared/standings.ts";

const OLD_KEY = "proba--931--nks-dev";
const CANON_KEY = "proba--931--_nks_nks-dev";

const session = (id, argv) => {
  const scope = newScope(id, { env: {}, cwd: tmpdir(), pid: process.pid, path: "" }, () => false);
  runIn(scope, () => setConfig(parseArgs(argv)));
  return scope;
};

test("a satellite session asks for the move of hold records first: the daemon's own session still moves its bare-slug record to @owner/slug", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-holdcanon-sat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(standingsDirOf(dir), { recursive: true });
  writeFileSync(
    holdFilePathOf(dir, OLD_KEY),
    JSON.stringify({
      url: "ws://127.0.0.1:9/api/channel/ws/s",
      realm: "nks-dev",
      karta: 931,
      name: "proba",
      key: OLD_KEY,
      at: Date.now(),
    }) + "\n",
  );
  const url = "http://127.0.0.1:9/mcp";
  const sat = session("sat", [url, "--no-browser", "--auth-dir", dir, "--satellite"]);
  const own = session("own", [url, "--no-browser", "--auth-dir", dir]);
  runIn(own, () => learnRealm("nks-dev", "@nks/nks-dev")); // the graph list's answer, no server
  await Promise.all([runIn(sat, () => canonHoldRecords()), runIn(own, () => canonHoldRecords())]);
  const recs = readdirSync(standingsDirOf(dir))
    .filter((f) => f.endsWith(".hold"))
    .map((f) => JSON.parse(readFileSync(join(standingsDirOf(dir), f), "utf8")));
  assert.deepEqual(
    recs.map((r) => [r.key, r.realm]),
    [[CANON_KEY, "@nks/nks-dev"]],
    "the own session's record moved in this very move",
  );
  assert.equal(recs[0].formerKey, OLD_KEY);
});
