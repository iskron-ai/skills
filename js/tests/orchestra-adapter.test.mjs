// The launcher's adapter (graph @nks/nks-dev, #10096, #10777): "bridge" — the bridge raises dsh
// itself, no Orca on the machine needed; "orca" — Orca raises opencode; a harness of the other
// adapter is refused by code, and two descriptions side by side answer each its own launcher.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLauncher } from "../bridge/orchestra-launchers.ts";
import { invite, leadingDsh } from "./dsh-kit.mjs";

const OPENCODE = "probe/opencode-model";

test("adapter: a description takes orca or bridge, one adapter; the other's harness stays a bare offer", () => {
  const body = (adapter) =>
    JSON.stringify({
      launcher: "l",
      adapter,
      limit: 1,
      harnesses: { dsh: { models: ["p/m"], bin: "/x/dsh" }, opencode: { models: ["p/m"] } },
    });
  const bridge = parseLauncher(body("bridge"));
  assert.equal(bridge.adapter, "bridge");
  assert.deepEqual(bridge.harnesses.dsh.dsh, { bin: "/x/dsh", patch: null });
  const orca = parseLauncher(body("orca"));
  assert.equal(orca.adapter, "orca");
  assert.equal(orca.harnesses.dsh.dsh, undefined, "dsh under orca is no bridge process");
  for (const a of [undefined, "terminal", ["orca", "bridge"]])
    assert.equal(parseLauncher(body(a)).code, "adapter_unsupported");
});
const launches = (o) => o.orcaCalls().filter((a) => a[0] === "agent" && a[1] === "launch");

test("adapter bridge: dsh is raised without a single orca call, with no orca on the machine", async (t) => {
  const o = await leadingDsh(t, { orca: false });
  await o.queue([invite(20)]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 20: launched/, r.out);
  assert.equal(o.dshCalls().length, 1);
  assert.equal(o.orcaCalls().length, 0);
});

test("adapter orca: the harness dsh is harness_adapter_mismatch, in the tact line and in status", async (t) => {
  const o = await leadingDsh(t, { adapter: "orca" });
  await o.queue([invite(21)]);
  const r = await o.step();
  assert.match(r.out, /invite 21: harness_adapter_mismatch/, r.out);
  assert.match((await o.status()).out, /invite 21: harness_adapter_mismatch/);
  assert.equal(o.dshCalls().length, 0);
  assert.equal(launches(o).length, 0);
});

test("adapter bridge: opencode is harness_adapter_mismatch, an unknown harness harness_unsupported", async (t) => {
  const o = await leadingDsh(t, {
    harnesses: () => ({ opencode: { models: [OPENCODE] }, codex: { models: [OPENCODE] } }),
  });
  await o.queue([
    invite(22, { harness: "opencode", model: OPENCODE }),
    invite(23, { harness: "codex", model: OPENCODE }),
  ]);
  const r = await o.step();
  assert.match(r.out, /invite 22: harness_adapter_mismatch/, r.out);
  assert.match(r.out, /invite 23: harness_unsupported/, r.out);
  assert.equal(o.dshCalls().length, 0);
  assert.equal(o.orcaCalls().length, 0);
});

test("two descriptions side by side: the call's launcher picks bridge for dsh and Orca for opencode", async (t) => {
  const o = await leadingDsh(t, {
    beside: [
      () => ({
        launcher: "probe-orca",
        adapter: "orca",
        limit: 1,
        harnesses: { opencode: { models: [OPENCODE] } },
      }),
    ],
  });
  await o.queue([
    invite(24),
    invite(25, { launcher: "probe-orca", harness: "opencode", model: OPENCODE }),
  ]);
  const r = await o.step();
  assert.match(r.out, /invite 24: launched/, r.out);
  assert.doesNotMatch(r.out, /invite 25: (harness_adapter_mismatch|launcher_\w+)/, r.out);
  assert.equal(o.dshCalls().length, 1, "only the dsh call is the bridge's process");
  assert.equal(launches(o).length, 1, "the opencode call goes to Orca");
  assert.equal(o.run(24).launcher, "probe-mac");
  assert.equal(o.run(25).launcher, "probe-orca");
  assert.equal(o.run(25).model, OPENCODE);
});
