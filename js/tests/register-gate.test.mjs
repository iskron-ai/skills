// The register gate is the only door of the bridge's own register (graph nks-dev: #7439,
// #10801, #11030): js/bridge/registergate.ts asks the move's stop watch and the journal of
// ended seats before every send. A register built anywhere else — the literal of its arguments,
// `action: "register"` — is a path past the gate: this probe fails on it. The bridge's answer to
// the harness that merely names the move it made (standanswer.ts, structuredContent) sends
// nothing and is the one exemption.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const BRIDGE = resolve(process.env.ISKRON_REFRESH_SOURCE || "js", "bridge");
const GATE = "registergate.ts";
const ANSWERS = new Set(["standanswer.ts"]); // describe a register to the harness, send none
const SEND = /action\s*:\s*["'`]register["'`]/;

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}

test("a register is built only inside the register gate", () => {
  const past = [];
  for (const file of sources(BRIDGE)) {
    const name = file.slice(BRIDGE.length + 1);
    if (name === GATE || ANSWERS.has(name)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (SEND.test(line) && !/^\s*(\/\/|\*)/.test(line))
          past.push(`${name}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(past, [], `register sent past the gate (${GATE}):\n${past.join("\n")}`);
});

// A register retried past the gate: the seat-open race (409, no rule) is told only by the gate,
// and the generic tool call sends once — a second send inside call.ts is a retry nobody asks.
test("the 409 retry of a register lives only in the gate; the tool call sends once", () => {
  const RACE = /\b(racedOpening|openedConcurrently)\b/;
  const past = [];
  for (const file of sources(BRIDGE)) {
    const name = file.slice(BRIDGE.length + 1);
    if (name === GATE || name === "refusal.ts") continue; // the gate; the definition
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (RACE.test(line) && !/^\s*(\/\/|\*)/.test(line))
          past.push(`${name}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(past, [], `a seat-open race retried past the gate:\n${past.join("\n")}`);
  const sends = readFileSync(join(BRIDGE, "call.ts"), "utf8").match(/\bawait ask\(/g) ?? [];
  assert.equal(sends.length, 1, "call.ts sends a tool call once, no retry of its own");
});

test("the gate itself builds the register: the probe would see a path moved away from it", () => {
  const gate = readFileSync(join(BRIDGE, GATE), "utf8");
  assert.match(gate, SEND, "the gate holds the register's arguments");
  assert.match(gate, /gateShut\(move, seat\)/, "every send of the gate asks the move first");
});
