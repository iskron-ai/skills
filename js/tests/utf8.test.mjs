// Black-box wire probes (граф @nks/nks-dev, узел #7567): both stdio routes,
// raw buffers at the harness boundary, not reserialized parsed answers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FIELDS_CAPABILITIES } from "../shared/fields.ts";
import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import { callResult, listedTools, rawUtf8, tools, wireModes } from "./utf8-fixture.mjs";

const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_utf8";
function harness(url, dir, daemon, args) {
  const proc = spawn(
    process.env.ISKRON_NODE || process.execPath,
    [BRIDGE, url, "--no-browser", "--auth-dir", dir, ...args],
    {
      env: {
        ...process.env,
        ISKRON_BRIDGE_TOKEN: PAT,
        ISKRON_BRIDGE_NO_UPDATE: "1",
        ISKRON_BRIDGE_LANG: "ru",
        ISKRON_BRIDGE_DAEMON: daemon ? "1" : "0",
        ISKRON_BRIDGE_DAEMON_TRACE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let pending = Buffer.alloc(0);
  let stderr = "";
  const waits = new Map();
  proc.stderr.on("data", (c) => (stderr += c));
  proc.stdout.on("data", (c) => {
    pending = Buffer.concat([pending, c]);
    let nl;
    while ((nl = pending.indexOf(10)) >= 0) {
      const raw = pending.subarray(0, nl);
      pending = pending.subarray(nl + 1);
      if (!raw.length) continue;
      // Parse only for correlation; assertions receive the ORIGINAL stdout bytes.
      const id = JSON.parse(raw.toString("utf8")).id;
      const w = waits.get(id);
      if (w) {
        waits.delete(id);
        clearTimeout(w.timer);
        w.resolve(raw);
      }
    }
  });
  let id = 0;
  return {
    proc,
    stderr: () => stderr,
    call(method, params = {}) {
      const next = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`silent ${method}: ${stderr}`)), 20000);
        waits.set(next, { resolve, timer });
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: next, method, params }) + "\n");
      });
    },
    async stop() {
      for (const w of waits.values()) clearTimeout(w.timer);
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      await new Promise((r) => {
        proc.once("exit", r);
        proc.kill("SIGKILL");
      });
    },
  };
}

const routes = [
  { name: "session", args: [] },
  { name: "satellite", args: ["--satellite"] },
  {
    name: "satellite --tools (omits iskron_batch)",
    args: ["--satellite", "--tools", "iskron_orient,iskron_add_vimarsha,iskron_channel"],
    selected: ["iskron_orient", "iskron_add_vimarsha", "iskron_channel"],
  },
];
for (const route of routes) {
  for (const daemon of [false, true]) {
    for (const { fields, sse } of wireModes) {
      const path = daemon ? "thin bridge → real daemon" : "full stdio bridge";
      test(`raw Cyrillic UTF-8: ${route.name}, ${path}, fields=${fields}, SSE=${sse}`, async () => {
        const fake = await startFakeNks({
          pat: PAT,
          tools,
          sse,
          callResults: { iskron_orient: callResult },
        });
        const dir = mkdtempSync(join(tmpdir(), "iskron-utf8-"));
        const b = harness(fake.mcpUrl, dir, daemon, route.args);
        try {
          const init = JSON.parse(
            (
              await b.call("initialize", {
                protocolVersion: "2025-06-18",
                capabilities: fields ? FIELDS_CAPABILITIES : {},
                clientInfo: { name: "utf8-probe", version: "0" },
              })
            ).toString("utf8"),
          );
          assert.ok(init.result && !init.error);
          b.proc.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
          listedTools(await b.call("tools/list"), fields, route.selected);
          const raw = await b.call("tools/call", { name: "iskron_orient", arguments: {} });
          rawUtf8(raw, fields ? ["Ответ: кириллица", "Русский язык", "Ёж"] : ["Ответ: кириллица"]);
          const expected = structuredClone(callResult);
          // forHarness strips structuredContent unless the harness declared fields.
          if (!fields) delete expected.structuredContent;
          assert.deepEqual(JSON.parse(raw.toString("utf8")).result, expected);
          if (daemon) {
            assert.match(b.stderr(), /through the machine's bridge daemon/);
            assert.match(
              readFileSync(join(dir, "run", "daemon.log"), "utf8"),
              /\] rpc tools\/call 3$/m,
            );
          }
        } finally {
          await b.stop();
          if (daemon) {
            let journal = "";
            try {
              journal = readFileSync(join(dir, "run", "daemon.log"), "utf8");
            } catch {}
            for (const m of journal.matchAll(/ pid=(\d+) \S+ listening /g)) {
              try {
                process.kill(+m[1], "SIGKILL");
              } catch {}
            }
          }
          await fake.stop();
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
}

test("the raw-byte assertion rejects escaped Cyrillic even when JSON.parse preserves its value", () => {
  const escaped = Buffer.from('{"text":"\\u0415\\u0436"}', "ascii");
  assert.equal(JSON.parse(escaped.toString()).text, "Еж");
  assert.throws(() => rawUtf8(escaped, []), /no Cyrillic JSON escapes/);
  assert.throws(() => rawUtf8(Buffer.from("Ёж", "latin1"), ["Ёж"]), /raw UTF-8 bytes/);
});
