// Pure-helper tests of the pi runner (scripts/stand-run-pi.mjs → scripts/stand-pi-evidence.mjs):
// the launch line as the installed extension reads it (observed on pi 1.2.0, installed extension
// 7.19.0 — the word lands after the line's first line), the bash-command launch detection, and
// the isolated home's auth gate. No pi, no model, no graph on import.
import test from "node:test";
import assert from "node:assert/strict";
import { isolatedPiAuth, parseLaunchLine, piLaunchCommands, piToolCalls, toBrotherCall, looksCall } from "./stand-pi-evidence.mjs";

const session = (messages) => ({
  header: { id: "ses_test", cwd: "/t" },
  entries: [{ type: "session", version: 3, id: "ses_test", cwd: "/t" }, ...messages.map((message, i) => ({ type: "message", id: `e${i}`, parentId: `e${i - 1}`, timestamp: `2026-10-31T00:00:0${i % 10}Z`, message }))],
});
const user = (content) => ({ role: "user", content, timestamp: 1 });
const assistant = (blocks, provider = "zai", modelId = "glm-5.3") => ({ role: "assistant", content: blocks, provider, model: modelId, usage: { input: 1, output: 2, cacheRead: 0, cost: { total: 0 } }, timestamp: 2 });
const bashCall = (id, command) => ({ type: "toolCall", id, name: "bash", arguments: { command } });
const toolResult = (id, text) => ({ role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }], isError: false, timestamp: 3 });

test("the launch line parses on the prompt's first line, with and without the from-tail", () => {
  const l = parseLaunchLine("start @r5/x #99 дело №7 от @a:root\n\nБриф — остальное промпта.");
  assert.deepEqual(l, { realm: "@r5/x", karta: "#99", no: "7", of: "@a:root" });
  assert.equal(parseLaunchLine("start @r5/x #99 case #8").of, null);
  assert.equal(parseLaunchLine("Сначала обычное слово, потом start @x #1 дело №2"), null, "mid-text is not the prompt's launch line");
  // What the installed extension actually writes back (observed): the word goes after the line.
  const observed = "start @r5/x #99 дело №7 от @a:root\nИскрон: строка запуска — мост не поднят, в дело №7 не вошёл.\n\nРазведай контур.";
  assert.deepEqual(parseLaunchLine(observed), { realm: "@r5/x", karta: "#99", no: "7", of: "@a:root" });
});

test("a bash command launching a child pi process is told apart from ordinary bash", () => {
  const s = session([
    user("Разведай."),
    assistant([bashCall("c1", "ls -la")]),
    toolResult("c1", "total 0"),
    assistant([bashCall("c2", "pi -p 'start @r5/x #99 дело №7 от @a:root\n\nБриф целиком.'")]),
    toolResult("c2", "…итог ребёнка…"),
    assistant([bashCall("c3", "echo hi")]),
    toolResult("c3", "hi"),
  ]);
  const launches = piLaunchCommands(s);
  assert.equal(launches.length, 1);
  assert.deepEqual(launches[0].launch, { realm: "@r5/x", karta: "#99", no: "7", of: "@a:root" });
  // The same command with the line quoted mid-text still carries the inline shape.
  const s2 = session([user("x"), assistant([bashCall("c1", 'pi -p "Разведай. start @r5/x #99 дело №7 от @a:root"')]), toolResult("c1", "")]);
  assert.equal(piLaunchCommands(s2).length, 1);
  assert.ok(piLaunchCommands(s2)[0].inline);
  assert.equal(piLaunchCommands(s2)[0].launch, null, "verbatim form needs the line at a quote's edge");
});

test("pi tool calls pair with results and their call families are judged by name and args", () => {
  const s = session([
    user("Работай"),
    assistant([bashCall("c1", "pwd"), { type: "toolCall", id: "k1", name: "iskron_look", arguments: { node_id: "#42" } }]),
    toolResult("c1", "/t"),
    { role: "toolResult", toolCallId: "k1", toolName: "iskron_look", content: [{ type: "text", text: "(#42, …)" }], isError: false, timestamp: 3 },
  ]);
  const calls = piToolCalls(s);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, "bash");
  assert.ok(looksCall(calls[1], "42"));
  assert.ok(!looksCall(calls[1], "43"));
  assert.ok(toBrotherCall({ name: "iskron_case", args: { action: "talk", with: "#5" } }, "4"));
  assert.ok(!toBrotherCall({ name: "iskron_case", args: { action: "talk", with: "#4" } }, "4"));
  assert.ok(!toBrotherCall({ name: "iskron_case", args: { action: "join", room: "#7" } }, "4"), "entering the launch case is not a word to a brother");
});

test("the isolated home's auth gate: keys as they lie, OAuth without refresh, expired access refused", () => {
  const machineAuth = { zai: { type: "api_key", key: "k" }, openai: { type: "oauth", access: "a", refresh: "r", expires: 10_000_000, accountId: "u" } };
  const now = 1_000_000;
  const isolated = isolatedPiAuth({ machineAuth, needed: ["zai", "openai"], now });
  assert.deepEqual(isolated.zai, machineAuth.zai, "a static key is copied as it lies");
  assert.equal(isolated.openai.refresh, undefined, "the refresh token never travels to the isolated home");
  assert.equal(isolated.openai.access, "a");
  assert.throws(() => isolatedPiAuth({ machineAuth, needed: ["anthropic"], now }), /no key or OAuth login of anthropic/);
  const expired = { openai: { ...machineAuth.openai, expires: now + 3600_000 } };
  assert.throws(() => isolatedPiAuth({ machineAuth: expired, needed: ["openai"], now }), /refresh the person's real pi login/);
  assert.throws(() => isolatedPiAuth({ machineAuth: { openai: { type: "device", code: "x" } }, needed: ["openai"], now }), /no key or OAuth login of openai/);
});
