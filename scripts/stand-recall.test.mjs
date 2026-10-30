import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { has45, turnMinutes, locationPath, actualModels, sessionTree, secretScrubber, seatID } from "./stand-recall-evidence.mjs";
import { intakeEvidence, intakePrompts } from "./stand-recall-intake.mjs";
import { createLedger } from "./stand-mcp-ledger.mjs";
import { runCleanup, removeRawLogs } from "./stand-recall-cleanup.mjs";

test("keep removes raw secret-bearing logs without deleting retained evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-cleanup-test-"));
  try {
    for (const name of ["bridge.jsonl", "api.out", "serve.log", "report.txt"])
      writeFileSync(join(dir, name), "synthetic secret");
    removeRawLogs(dir);
    for (const name of ["bridge.jsonl", "api.out", "serve.log"]) assert.ok(!existsSync(join(dir, name)));
    assert.ok(existsSync(join(dir, "report.txt")));
    removeRawLogs(dir); // partial setup and repeat cleanup are safe
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("45 judge preserves main's unit and node-id distinction", () => {
  for (const s of ["45s", "45 с", "45 секунд", "timeout: 45"]) assert.ok(has45(s));
  for (const s of ["#45", "145", "450", "#450"]) assert.ok(!has45(s));
});
test("bounded turn option and observed deepObject query", () => {
  assert.equal(turnMinutes(), 15);
  assert.equal(turnMinutes("60"), 60);
  for (const v of ["0", "61", "NaN", "Infinity"]) assert.throws(() => turnMinutes(v));
  assert.equal(locationPath("/api/skill", "/a b"), "/api/skill?location[directory]=%2Fa%20b");
  assert.equal(locationPath("/api/session/active", "/a"), "/api/session/active");
});
const launch = (role, id, input = {}) => ({ type: "tool", name: "task", state: { input: { agent: role, ...input }, metadata: { sessionID: id } } });
const assistant = (content = []) => ({ type: "assistant", model: { providerID: "test", id: "observed" }, content });
test("child traversal follows observed IDs, cycles bounded, unknown models not guessed", () => {
  const root = [assistant([launch("ingester", "ses_child")])];
  const tree = sessionTree("ses_root", root, () => [assistant([launch("recaller", "ses_root")])]);
  assert.equal(tree.sessions.length, 2);
  assert.equal(tree.sessions[1].role, "ingester");
  assert.equal(actualModels(root).length, 1);
  assert.deepEqual(actualModels([{ type: "assistant" }]), []);
  assert.equal(sessionTree("ses_root", [assistant([launch("ingester")])], () => []).blockers.length, 1);
});
test("intake rejection checks full text and negative ingester launch", () => {
  const prompts = intakePrompts({ own: "1", foreign: "2" });
  const root = [assistant([launch("ingester", "ses_child", { prompt: prompts.f[0] })])];
  const tree = sessionTree("ses_root", root, () => [assistant()]);
  assert.deepEqual(intakeEvidence("f", tree, prompts.f[0]).errors, []);
  assert.ok(intakeEvidence("g", tree, prompts.f[0]).errors.includes("short intake launched ingester"));
  root[0].content[0].state.input.prompt = "truncated";
  assert.ok(intakeEvidence("f", tree, prompts.f[0]).errors.some((s) => s.includes("seven")));
});
test("intake rejects foreign writes, owner actor, and missing child products/root reads", () => {
  const scene = { own: "1", foreign: "2", steward: "3", human: "4" };
  const full = intakePrompts(scene).f[0];
  const tree = sessionTree("ses_root", [assistant([launch("ingester", "ses_child", { prompt: full })])], () => [assistant()]);
  const calls = [
    { name: "iskron_update", args: { node_id: "#2" }, text: "" },
    { name: "iskron_add_kriya", by: "sub:ingester", args: { arrows: [{ arrow_type: "actor", target: "#4" }] }, text: "(#10, kriya)" },
  ];
  const e = intakeEvidence("f", tree, full, { scene, calls, fact: "5" });
  assert.ok(e.errors.includes("foreign contour mutation"));
  assert.ok(e.errors.includes("owner encoded as actor"));
  assert.ok(e.errors.includes("missing multiple child transitions/phenomena or root reads"));
});
test("secret scrubbing and exact seat parsing", () => {
  const { remember, scrub } = secretScrubber("PAT-secret");
  remember({ apiKey: "provider-secret" });
  assert.equal(scrub('PAT-secret provider-secret Bearer other'), '<secret> <secret> Bearer <secret>');
  assert.equal(scrub('channel credential: nks_chh_synthetic-credential_123'), 'channel credential: <secret>');
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(seatID(`role:mine — live\n  id ${id}\nrole:other — live`, "mine"), id);
  assert.equal(seatID(`role:other — live\n  id ${id}`, "mine"), null);
});
test("seat cleanup is exact across roles, retries founding seat after satellite, surfaces failures", async () => {
  const report = [], problems = [], revoked = [];
  const cleanup = runCleanup({ run: "unused", auth: "unused", report, scrub: String, problem: (s) => problems.push(s) });
  const root = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const satellite = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
  const P = { call: async (_name, args) => ({ text: args.karta === "#1"
    ? `role:mine — live\n  id ${root}\nrole:unrelated — live\n  id cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee`
    : `role:child — live\n  id ${satellite}` }) };
  const person = { revoke: async (_realm, id) => {
    if (id === root && !revoked.includes(satellite)) return { error: true, text: "satellite still present" };
    revoked.push(id); return {};
  } };
  await cleanup.revoke([{ realm: "test", karta: "1", name: "mine" }, { realm: "test", karta: "#2", name: "child" }], P, person);
  assert.deepEqual(revoked, [satellite, root]);
  assert.deepEqual(problems, []);
  await cleanup.revoke([{ realm: "test", karta: "1", name: "mine" }], { call: async () => ({ error: true }) }, person);
  assert.equal(problems.length, 1);
});

test("transparent relay with local injected upstream, no credential/body logging", async (t) => {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, headers: req.headers, body });
    if (req.method === "DELETE") res.writeHead(req.headers["mcp-session-id"] === "expired-id" ? 404 : 204).end();
    else res.writeHead(200, { "mcp-session-id": "real-upstream-id", "content-type": "application/json" }).end(JSON.stringify({ body, large: "x".repeat(100000) }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const records = [];
  const ledger = createLedger({ record: (e) => records.push(e), fetchImpl: (url, opts) => {
    assert.equal(url, "https://nks.lab.mirari.ru/mcp-iskron");
    return fetch(`http://127.0.0.1:${upstream.address().port}`, opts);
  } });
  t.after(async () => { await ledger.close(); await new Promise((r) => upstream.close(r)); });
  ledger.server.listen(0, "127.0.0.1");
  await once(ledger.server, "listening");
  const url = `http://127.0.0.1:${ledger.server.address().port}/mcp-iskron`;
  const body = JSON.stringify({ method: "initialize", params: { secret: "body-secret" } });
  const r = await fetch(url, { method: "POST", headers: { authorization: "Bearer test-secret" }, body });
  assert.equal(r.headers.get("mcp-session-id"), "real-upstream-id");
  assert.equal((await r.json()).large.length, 100000);
  assert.equal(seen[0].body, body);
  assert.equal(seen[0].headers.authorization, "Bearer test-secret");
  assert.equal((await fetch(url, { method: "DELETE", headers: { "mcp-session-id": "real-upstream-id" } })).status, 204);
  assert.deepEqual(records.map(({ kind, session_id, status }) => ({ kind, session_id, status })), [
    { kind: "initialize", session_id: "real-upstream-id", status: 200 }, { kind: "delete", session_id: "real-upstream-id", status: 204 },
  ]);
  assert.ok(!JSON.stringify(records).includes("secret"));
  await (await fetch(url, { method: "POST", body: JSON.stringify({ method: "tools/list" }) })).text();
  assert.equal(records.length, 2, "ordinary tool requests are not logged");
  assert.equal((await fetch(url, { method: "DELETE", headers: { "mcp-session-id": "expired-id" } })).status, 404);
  assert.equal(records.at(-1).status, 404, "a failed DELETE is not disguised as success");
  assert.equal((await fetch(url + "/other")).status, 404);
});
test("relay failure returns 502 without logging error secrets; shutdown is idempotent", async () => {
  const records = [];
  const ledger = createLedger({ record: (x) => records.push(x), fetchImpl: async () => { throw new Error("Bearer confidential"); } });
  ledger.server.listen(0, "127.0.0.1");
  await once(ledger.server, "listening");
  assert.equal((await fetch(`http://127.0.0.1:${ledger.server.address().port}/mcp-iskron`)).status, 502);
  assert.deepEqual(records, []);
  await ledger.close();
  await ledger.close();
});
test("relay shutdown aborts an in-flight upstream operation", async () => {
  let started;
  const ready = new Promise((r) => { started = r; });
  let signal;
  const ledger = createLedger({ record: () => {}, fetchImpl: async (_url, opts) => {
    signal = opts.signal;
    started();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  ledger.server.listen(0, "127.0.0.1");
  await once(ledger.server, "listening");
  const response = fetch(`http://127.0.0.1:${ledger.server.address().port}/mcp-iskron`).catch(() => null);
  await ready;
  await ledger.close();
  assert.equal(signal.aborted, true);
  await response;
});
test("ledger journal write failure is loud, sanitized and returns 502", async () => {
  const ledger = createLedger({ record: () => { throw new Error("secret path"); }, fetchImpl: async () => new Response(null, { status: 204 }) });
  const errors = [];
  ledger.server.on("error", (e) => errors.push(e.message));
  ledger.server.listen(0, "127.0.0.1");
  await once(ledger.server, "listening");
  try {
    const r = await fetch(`http://127.0.0.1:${ledger.server.address().port}/mcp-iskron`, { method: "DELETE" });
    assert.equal(r.status, 502);
    assert.deepEqual(errors, ["LAB ledger journal write failed"]);
  } finally { await ledger.close(); }
});
