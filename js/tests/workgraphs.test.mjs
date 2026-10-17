// The negative startup cache is credential-scoped, bounded and contains no credentials.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GLOBAL_PREFIX } from "../delivery/index.ts";
import { knownWorkGraph, rememberWorkGraph } from "../opencode/workgraphs.ts";

function stage(t) {
  const dir = mkdtempSync(join(tmpdir(), "workgraphs-"));
  const keys = ["ISKRON_BRIDGE_AUTH_DIR", "ISKRON_BRIDGE_URL", "ISKRON_BRIDGE_TOKEN"];
  const saved = keys.map((key) => process.env[key]);
  Object.assign(process.env, {
    ISKRON_BRIDGE_AUTH_DIR: dir,
    ISKRON_BRIDGE_URL: "http://127.0.0.1:12345/mcp",
    ISKRON_BRIDGE_TOKEN: "nks_pat_cache_probe_only",
  });
  const clear = () => delete globalThis[`${GLOBAL_PREFIX}WorkGraphs`];
  clear();
  t.after(() => {
    clear();
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    clear,
    file: () =>
      join(
        dir,
        readdirSync(dir).find((f) => f.startsWith("opencode-work-graphs.")),
      ),
  };
}

test("negative startup cache: disk and memory are scoped to server, credential and auth directory", (t) => {
  const s = stage(t);
  assert.equal(knownWorkGraph(), false);
  rememberWorkGraph();
  assert.equal(knownWorkGraph(), true);
  assert.ok(!readFileSync(s.file(), "utf8").includes(process.env.ISKRON_BRIDGE_TOKEN));
  s.clear();
  assert.equal(knownWorkGraph(), true, "disk reload");
  process.env.ISKRON_BRIDGE_TOKEN = "nks_pat_another_account";
  assert.equal(knownWorkGraph(), false);
  process.env.ISKRON_BRIDGE_TOKEN = "nks_pat_cache_probe_only";
  process.env.ISKRON_BRIDGE_URL = "http://127.0.0.1:12346/mcp";
  assert.equal(knownWorkGraph(), false);
  process.env.ISKRON_BRIDGE_URL = "http://127.0.0.1:12345/mcp";
  process.env.ISKRON_BRIDGE_AUTH_DIR = join(s.dir, "other");
  assert.equal(knownWorkGraph(), false);
});

test("negative startup cache: expired, future, malformed and incomplete markers miss", (t) => {
  const s = stage(t);
  rememberWorkGraph();
  const file = s.file();
  const mark = JSON.parse(readFileSync(file, "utf8"));
  for (const body of [
    { ...mark, at: Date.now() - 16 * 60_000 },
    { ...mark, at: Date.now() + 60_000 },
    { at: Date.now(), has_work_graph: true },
    { ...mark, has_work_graph: false },
    "broken",
  ]) {
    s.clear();
    writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
    assert.equal(knownWorkGraph(), false, JSON.stringify(body));
  }
});

test("negative startup cache: OAuth grant changes invalidate; missing credentials cannot mark", (t) => {
  const s = stage(t);
  delete process.env.ISKRON_BRIDGE_TOKEN;
  rememberWorkGraph();
  assert.deepEqual(readdirSync(s.dir), []);
  const server = new URL(process.env.ISKRON_BRIDGE_URL);
  const suffix = createHash("sha256")
    .update(server.origin + server.pathname)
    .digest("base64url")
    .slice(0, 10);
  const store = join(s.dir, `${server.hostname}_${suffix}.json`);
  writeFileSync(store, JSON.stringify({ tokens: { access_token: "first" } }));
  rememberWorkGraph();
  s.clear();
  assert.equal(knownWorkGraph(), true);
  writeFileSync(store, JSON.stringify({ tokens: { access_token: "second" } }));
  assert.equal(knownWorkGraph(), false);
});
