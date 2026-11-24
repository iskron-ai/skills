import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

for (const kind of ["read", "write"])
  test(`${kind} whose SSE stream closes during session turnover receives a reply`, async () => {
    const fake = await startFakeNks({ pat: "nks_pat_probe" });
    const dir = mkdtempSync(join(process.cwd(), ".inflight-test-"));
    let held,
      oldSession,
      deleted = false,
      attempts = 0,
      repeatedSession;
    let sawHeld, sawDelete;
    const heldStarted = new Promise((resolve) => (sawHeld = resolve));
    const deletedSession = new Promise((resolve) => (sawDelete = resolve));
    const proxy = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const msg = body.length ? JSON.parse(body.toString()) : {};
      if (msg.id === 10) {
        attempts++;
        if (attempts > 1) repeatedSession = req.headers["mcp-session-id"];
      }
      if (msg.id === 10 && attempts === 1) {
        oldSession = req.headers["mcp-session-id"];
        held = res;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": heartbeat\n\n");
        sawHeld();
        return;
      }
      if (req.method === "DELETE" && req.headers["mcp-session-id"] === oldSession) {
        deleted = true;
        held.end(); // Server silently closes the in-flight stream on session deletion.
        sawDelete();
      }
      const upstream = request(fake.mcpUrl, { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      upstream.on("error", () => res.destroy());
      upstream.end(body);
    });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${proxy.address().port}/mcp`;
    const bridge = spawn(
      process.env.ISKRON_NODE || process.execPath,
      [process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE, url, "--no-browser", "--auth-dir", dir],
      {
        env: {
          ...process.env,
          ISKRON_BRIDGE_DAEMON: "0",
          ISKRON_BRIDGE_TOKEN: "nks_pat_probe",
          ISKRON_BRIDGE_TIMEOUT: "1200",
          ISKRON_BRIDGE_NET_BACKOFF_MS: "20,20,20",
        },
      },
    );
    const waiters = new Map();
    let out = "";
    bridge.stdout.on("data", (chunk) => {
      out += chunk;
      let nl;
      while ((nl = out.indexOf("\n")) >= 0) {
        const msg = JSON.parse(out.slice(0, nl));
        out = out.slice(nl + 1);
        waiters.get(msg.id)?.(msg);
      }
    });
    bridge.stderr.resume();
    const call = (id, method, params) => {
      const reply = new Promise((resolve) => waiters.set(id, resolve));
      bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return reply;
    };
    const bounded = (promise) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("no JSON-RPC reply within 5 seconds")), 5000).unref(),
        ),
      ]);
    try {
      const init = {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-harness", version: "0" },
      };
      assert.ok((await bounded(call(1, "initialize", init))).result);
      const a = call(
        10,
        "tools/call",
        kind === "read"
          ? { name: "iskron_orient", arguments: { realm: "r5" } }
          : { name: "iskron_update", arguments: { realm: "r5", node_id: "1" } },
      );
      await bounded(heldStarted);
      const b = await bounded(call(11, "initialize", init));
      assert.ok(b.result || b.error);
      await bounded(deletedSession);
      assert.ok(oldSession && deleted, "the held session must actually be deleted");
      const answer = await bounded(a);
      if (kind === "read") {
        assert.ok(answer.result && !answer.error && !answer.result.isError, JSON.stringify(answer));
        assert.equal(attempts, 2);
        assert.ok(repeatedSession && repeatedSession !== oldSession);
      } else {
        assert.ok(answer.error, JSON.stringify(answer));
        assert.match(JSON.stringify(answer.error), /outcome is unknown/i);
        assert.equal(attempts, 1, "a write with unknown outcome must not be repeated");
      }
    } finally {
      bridge.kill("SIGKILL");
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
      await fake.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
