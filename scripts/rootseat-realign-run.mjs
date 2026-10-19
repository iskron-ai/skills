// The --realign mode of rootseat-run-opencode.mjs: a git repository with an alignment sign
// (a Claude Code start hook, as --onboarding=partial) and AGENTS.md without front matter; one
// human prompt. The scripted provider's first primary reply is a tool call that writes the cover
// (write, or bash `cat > AGENTS.md <<…`), the next one plain text: the turn ends.
// Asserts: (1) no seat, connect or hold record before the cover is written, and the first model
// request carries the alignment word, not "by the human's word"; (2) after the tool — exactly one
// seating of the same session; (3) "seated" rides a provider request of the same turn after the
// tool, with no second human prompt; (4) no second seating till the end of the run.
// --negative (a plugin without the realignment, ISKRON_OPENCODE_PLUGIN): the human's word is in the
// first request, no seat in the turn after the tool.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { COVER, frontmatter, heardSeats, heldBy } from "../js/tests/rootseat-kit.mjs";
import { ALIGN, HUMAN, stood } from "../js/tests/rootseat-realign-kit.mjs";

const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const BEFORE = "# проект\n\nОбложки ещё нет.\n";
export const AFTER = frontmatter(COVER);
export const PROMPT = "REALIGN_PROBE: выровняй репозиторий.";

export async function realignProject(cwd) {
  await exec("git", ["init", "-q", cwd]);
  mkdirSync(join(cwd, ".claude"));
  const command = "echo 'read the iskron door Start section first'";
  writeFileSync(join(cwd, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } }));
  writeFileSync(join(cwd, "AGENTS.md"), BEFORE);
}

/** The tool call of the first primary reply, shaped by the tool's own schema in the request. */
export function toolCall(mode, tools, cwd) {
  const names = tools.map((t) => t.function?.name ?? t.name);
  const name = mode === "write" ? "write" : ["bash", "shell"].find((n) => names.includes(n));
  assert.ok(name && names.includes(name), `no ${mode} tool among ${names.join(", ")}`);
  const schema = tools.find((t) => (t.function?.name ?? t.name) === name);
  const props = Object.keys((schema.function ?? schema).parameters?.properties ?? {});
  const file = join(cwd, "AGENTS.md");
  const args = mode === "write"
    ? { [props.find((p) => /path/i.test(p)) ?? "filePath"]: file, content: AFTER }
    : { command: `cat > AGENTS.md <<'EOF'\n${AFTER}EOF`, ...(props.includes("description") ? { description: "Write the AGENTS.md cover" } : {}) };
  return { name, args };
}

/** SSE of one reply: a tool call or plain text. */
export function sse(reply) {
  const chunk = (delta, finish_reason = null) => ({
    id: "chatcmpl-probe", object: "chat.completion.chunk", created: 1, model: "probe",
    choices: [{ index: 0, delta, finish_reason }],
  });
  const parts = reply.tool
    ? [chunk({ role: "assistant", tool_calls: [{ index: 0, id: "call_realign_1", type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }), chunk({}, "tool_calls")]
    : [chunk({ role: "assistant", content: "OK" }), chunk({}, "stop")];
  return parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n";
}

const connects = (fake) => fake.state.placeArgs.filter((p) => p.action === "connect").length;
const users = (w) => JSON.stringify((w.body.messages ?? []).filter((m) => m.role === "user"));
/** Every message of a request: the seating word may ride a synthetic part, whatever its role. */
const all = (w) => JSON.stringify(w.body.messages ?? []);
const SAID = "Искрон: сессия стоит";

export async function realignCheck({ fake, auth, wire, session, cwd, out, negative, idle }) {
  const primaries = () => wire.filter((w) => w.body.tools?.length);
  // (1) before the cover: the board at the first primary request.
  for (let i = 0; i < 160 && !primaries().length; i++) await sleep(250);
  const first = primaries()[0];
  assert.ok(first, "no primary provider request");
  assert.deepEqual(first.seats, [], "(1) no seat at the first request");
  assert.equal(first.connects, 0, "(1) no connect before the cover");
  assert.deepEqual(first.held, [], "(1) no hold record before the cover");
  if (negative) assert.ok(users(first).includes(HUMAN), "(neg) the old plugin's word: by the human's word");
  else {
    assert.ok(users(first).includes(ALIGN) && users(first).includes("iskronify"), "(1) the alignment word in the first request");
    assert.ok(!users(first).includes(HUMAN), "(1) not «словом человека»");
  }
  // The tool result request of the same turn, then the turn's end.
  const after = () => primaries().find((w) => JSON.stringify(w.body.messages).includes("call_realign_1") && (w.body.messages ?? []).some((m) => m.role === "tool"));
  for (let i = 0; i < 160 && !after(); i++) await sleep(250);
  const next = after();
  assert.ok(next, "no provider request after the tool");
  for (let i = 0; i < 160 && !idle(); i++) await sleep(250);
  assert.ok(idle(), "the turn did not end");
  await sleep(4000); // (4) the tail: a late second seating would show here
  const written = readFileSync(join(cwd, "AGENTS.md"), "utf8");
  assert.equal(written, AFTER, "the tool wrote the cover");
  const humanPrompts = primaries().map((w) => users(w).split("REALIGN_PROBE").length - 1);
  assert.ok(humanPrompts.every((n) => n === 1), `one human prompt in every request: ${humanPrompts}`);
  const res = {
    requests: wire.map((w) => ({ i: w.i, at: w.at, tools: w.body.tools?.length ?? 0, seats: w.seats, connects: w.connects, held: w.held, seated: all(w).split(SAID).length - 1, human: users(w).includes(HUMAN), align: users(w).includes(ALIGN) })),
    afterTool: next.i, end: { seats: heardSeats(fake), connects: connects(fake), held: heldBy(auth, session) },
  };
  writeFileSync(join(out, "observations.json"), JSON.stringify(res, null, 2) + "\n");
  if (negative) {
    assert.deepEqual(next.seats, [], "(neg) no seat in the request after the tool");
    assert.ok(!stood(all(next)), "(neg) no «встал» after the tool");
  } else {
    assert.equal(next.seats.length, 1, "(2) one seat at the request after the tool");
    assert.deepEqual(next.held, next.seats, "(2) the same session holds it");
    assert.ok(stood(all(next)), "(3) «встал» in the request after the tool, same turn");
    assert.equal(res.end.connects, 1, "(2)(4) exactly one connect");
    assert.deepEqual(res.end.held, next.seats, "(4) the same single seat at the end");
    const last = primaries().at(-1);
    assert.equal(all(last).split(SAID).length - 1, 1, "(4) one «встал» in the turn");
  }
  return res;
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The run's carrier into out: input, versions and hashes, bridge calls, the cover's diff, outcome. */
export async function realignCarrier({ out, fake, auth, cwd, wire, failure, opencode, env, plugin, mode, negative }) {
  const replies = wire.length ? readFileSync(join(out, "wire.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.reply) : [];
  writeFileSync(join(out, "input.json"), JSON.stringify({ prompt: PROMPT, mode, negative, agentsBefore: BEFORE, scenario: replies }, null, 2) + "\n");
  const version = await exec(opencode, ["--version"], { env }).then((r) => r.stdout.trim(), (e) => `error: ${e.message}`);
  writeFileSync(join(out, "versions.json"), JSON.stringify({ opencode: version, node: process.version, plugin: { path: plugin, sha256: sha256(plugin) }, bridge: { path: env.ISKRON_BRIDGE_PATH, sha256: sha256(env.ISKRON_BRIDGE_PATH) } }, null, 2) + "\n");
  writeFileSync(join(out, "bridge.jsonl"), [
    ...fake.state.calls.map((c) => JSON.stringify({ kind: "tools/call", ...c })),
    ...fake.state.placeArgs.map((p) => JSON.stringify({ kind: "place", ...p })),
    JSON.stringify({ kind: "counts", ...fake.state.counts, writes: fake.state.writes.length }),
  ].join("\n") + "\n");
  for (const name of readdirSync(auth, { recursive: true }))
    if (/\.(log|hold)$/.test(name)) copyFileSync(join(auth, name), join(out, `auth-${String(name).replace(/\//g, "_")}`));
  writeFileSync(join(out, "agents-before.md"), BEFORE);
  let after = "";
  try { after = readFileSync(join(cwd, "AGENTS.md"), "utf8"); } catch {}
  writeFileSync(join(out, "agents-after.md"), after);
  const diff = await exec("diff", ["-u", join(out, "agents-before.md"), join(out, "agents-after.md")]).then((r) => r.stdout, (e) => e.stdout);
  writeFileSync(join(out, "agents.diff"), diff);
  writeFileSync(join(out, "outcome.json"), JSON.stringify({ verdict: failure ? "FAIL" : "PASS", exitCode: failure ? 1 : 0, error: failure ? String(failure.stack ?? failure) : null }, null, 2) + "\n");
}
