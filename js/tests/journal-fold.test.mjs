// A storm does not crowd a machine journal out (graph @nks/nks-dev, #10782): a seat taken and
// released every 4 s under a fresh name, a refused frame for a fresh seat id — one shape each,
// written once a minute with its count; another place's line in between is written whole.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createFold, shapeOf } from "../bridge/journal-fold.ts";

const held = (hex) =>
  `held 16-m3.nks-mcp.opus-5-5.root-${hex}--163--_nks_nks-dev cwd=/Users/x/orchestra-a338dad7-8a79-49be-8dec-52ad203c7b42`;
// Every storm turn comes through a fresh thin bridge: a fresh daemon session tag and pid.
let turn = 0;
const refused = (uuid) =>
  `[s${5583 + turn++}-89738] dispatcher: ${uuid} refused a frame: not_subscribed`;
const hex = (i) => i.toString(16).padStart(12, "0");
const uuid = (i) => `9abd68e8-a58e-43f0-9157-${hex(i)}`;

test("a storm of one shape is one line a minute with its count; other lines go whole", () => {
  let now = 0;
  const fold = createFold(() => now);
  const written = [];
  for (let i = 0; i < 30; i++) {
    now = i * 4_000; // two minutes of a 4 s storm
    written.push(...fold(held(hex(i))), ...fold(refused(uuid(i))));
    if (i === 7) written.push(...fold("held 16-m3.homelab.opus-5-5--8422--_nks_nks-dev cwd=/h"));
  }
  now = 200_000;
  written.push(...fold("listening /run/daemon.sock"));
  assert.ok(written.length <= 10, written.join("\n"));
  assert.ok(written.includes(held(hex(0))), "the first line of the storm is whole, its id kept");
  assert.ok(written.includes("held 16-m3.homelab.opus-5-5--8422--_nks_nks-dev cwd=/h"));
  const counts = written.filter((l) => l.startsWith("repeated "));
  const total = counts.reduce((n, l) => n + Number(/^repeated (\d+)/.exec(l)[1]), 0);
  const whole = written.filter((l) => !l.startsWith("repeated ") && !l.startsWith("listening"));
  assert.equal(total + whole.length - 1, 60, written.join("\n")); // every storm line is accounted for
  assert.equal(written.at(-1), "listening /run/daemon.sock");
});

test("the shape masks only what the storm renews", () => {
  assert.equal(shapeOf(held("dbc29b60e9df")), shapeOf(held("16edd6511882")));
  assert.notEqual(shapeOf("held a--1--g cwd=/x"), shapeOf("held b--1--g cwd=/x"));
  const opened = (n, pid) => `session s${n}-89738 for pid ${pid} (v8.4.0, /b.mjs) argv=[]`;
  assert.equal(shapeOf(opened(5683, 97728)), shapeOf(opened(5684, 97732)));
  assert.notEqual(shapeOf(refused(uuid(1))), shapeOf(`${refused(uuid(1))} at 2`));
});
