import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";

import { readRuns, runKey, writeRuns } from "../bridge/orchestra-runs.ts";
import { BUILT_BRIDGE } from "./built.mjs";
import { execTestEnvironment } from "./exec-test-env.mjs";

export async function execFixture(t) {
  const { root, auth, restore } = execTestEnvironment();
  let control = {};
  const set = (v) => {
    control = { ...control, ...v };
    writeFileSync(join(root, "control.json"), JSON.stringify(control));
  };
  set({});
  const key = runKey("@x/one", "room", 1);
  const runs = {
    [key]: {
      realm: "@x/one",
      room: "room",
      invite: 1,
      karta: 3,
      launcher: "own",
      harness: "opencode",
      model: "opaque/token#high",
      repository: "example.test/org/repo",
      worktree: `${root}/checkout`,
      at: "2026-11-12T09:00:00Z",
      state: "launched",
    },
  };
  writeRuns(auth, runs);
  const calls = [],
    orders = [];
  let stopSeen;
  const stopped = new Promise((resolve) => {
    stopSeen = resolve;
  });
  let session;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    const payload = body ? JSON.parse(body) : undefined;
    const row = readRuns(auth)[key];
    const phase = row.exec ? JSON.parse(readFileSync(row.exec.receipt)).phase : undefined;
    calls.push({ method: req.method, path: req.url, payload, phase });
    let answer;
    if (req.url === "/api/info") answer = { version: "2.2.7", hostname: hostname() };
    else if (req.url === "/api/session" && req.method === "POST") {
      session = { id: "ses_fake", model: payload.model, location: payload.location };
      if (control.createApiUnknown) {
        req.socket.destroy();
        return;
      }
      answer = { data: session };
    } else if (req.url === "/api/session/ses_fake") answer = { data: session };
    else if (req.url === "/api/session/ses_fake/context") answer = { data: [] };
    else if (req.url === "/api/session/ses_fake/prompt") {
      if (control.promptUnknown) {
        req.socket.destroy();
        return;
      }
      answer = { data: { sessionID: "ses_fake", id: "msg_fake" } };
    } else if (req.url.includes("/raised?"))
      answer = {
        cursor: "exec-page-1",
        items: [
          { spawned_for: { room: "room", invite: 1 }, standing_id: "seat", n: 1, rooms: ["room"] },
        ],
      };
    else if (req.url.startsWith("/me/orders")) {
      const since = new URL(req.url, "http://fake").searchParams.get("since");
      answer = {
        items:
          orders.length && !control.gone && since === "0"
            ? [{ id: "order", standing_id: "seat", state: control.stopped ? "stopped" : "issued" }]
            : [],
        next_since: 1,
      };
    } else if (req.url === "/standings/seat/stop") {
      orders.push({ payload, row: structuredClone(row) });
      stopSeen();
      if (control.gone) {
        res.writeHead(410);
        res.end("{}");
        return;
      }
      answer = { id: "order" };
    } else {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    restore();
  });
  return {
    root,
    auth,
    key,
    runs,
    url,
    set,
    calls,
    orders,
    stopped,
    bridge: BUILT_BRIDGE,
    host: hostname(),
    spec: {
      server: url,
      modelRefs: { "opaque/token#high": { providerID: "fake", id: "model/id", variant: "high" } },
    },
    orcaCalls: () =>
      readFileSync(join(root, "orca-calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse),
  };
}
