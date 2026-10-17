// Запись держания читают другие процессы — метла соседнего моста (стирает нечитаемую),
// возврат по каталогу, плагин, `iskron stop`. Писатель не оставляет им окна, где файл
// пуст или недописан: запись через переименование, не усечение на месте (№777).
// Писатель — writeHoldRecord в процессе пробы, читатель — дочерний node, крутящий
// readFileSync + JSON.parse по пути записи, пока писатель не скажет «хватит».
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs, setConfig } from "../bridge/config.ts";
import { keyOf, readHoldRecord, writeHoldRecord } from "../bridge/holdrecord.ts";
import { holdFilePathOf, standingsDirOf } from "../shared/standings.ts";

const WRITES = 2_000;

const READER = `
const { existsSync, readFileSync } = require("node:fs");
const [path, stop] = process.argv.slice(1);
const n = { reads: 0, empty: 0, invalid: 0, missing: 0 };
let ready = false;
while (!existsSync(stop)) {
  let b;
  try {
    b = readFileSync(path, "utf8");
  } catch {
    n.missing++;
    continue;
  }
  n.reads++;
  if (!b.length) n.empty++;
  else
    try {
      JSON.parse(b);
    } catch {
      n.invalid++;
    }
  if (!ready) (ready = true), process.stdout.write("ready\\n");
}
process.stdout.write(JSON.stringify(n) + "\\n");
`;

test("hold record rewritten many times is never read empty or torn by another process", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "holdrecord-atomic-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(standingsDirOf(dir), { recursive: true });
  setConfig(parseArgs(["http://holdrecord.test", "--auth-dir", dir]));
  const key = keyOf("@nks/nks-dev", 931, "atomic");
  const rec = (i) => ({
    realm: "@nks/nks-dev",
    karta: 931,
    name: "atomic",
    url: `ws://127.0.0.1:1/channel/ws/ws-${i}`,
    statusUrl: `http://127.0.0.1:1/channel/status/ws-${i}`,
    status: "x".repeat(2048),
    cwd: dir,
    client: "probe",
    key,
  });
  writeHoldRecord(key, rec(0));
  const path = holdFilePathOf(dir, key);
  const stop = join(dir, "stop");
  const reader = spawn(process.execPath, ["-e", READER, path, stop], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => reader.kill());
  let out = "";
  reader.stdout.on("data", (c) => (out += c));
  const exited = new Promise((r) => reader.once("exit", r));
  for (const end = Date.now() + 5_000; !out.includes("ready\n");) {
    assert.ok(Date.now() < end, "reader never read the record");
    await new Promise((r) => setTimeout(r, 10));
  }
  for (let i = 1; i <= WRITES; i++) writeHoldRecord(key, rec(i));
  writeFileSync(stop, "");
  await exited;
  const seen = JSON.parse(out.trim().split("\n").pop());
  assert.ok(seen.reads > 0, `reader read nothing: ${out}`);
  assert.deepEqual(
    { empty: seen.empty, invalid: seen.invalid, missing: seen.missing },
    { empty: 0, invalid: 0, missing: 0 },
    `${WRITES} writes, reader: ${JSON.stringify(seen)}`,
  );
  assert.equal(readHoldRecord(key)?.url, rec(WRITES).url);
});
