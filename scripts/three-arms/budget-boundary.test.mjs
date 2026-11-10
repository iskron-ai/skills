import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget } from "./guard.mjs";

const synthetic = (inputUpper, outputUpper) => ({ inputUpper, outputUpper, basis: "synthetic-byte-contract" });

test("default and explicit 3M/80k/30M caps accept exact boundary and refuse plus one", () => {
  for (const cap of [undefined, { input: 3_000_000, output: 80_000, totalInput: 30_000_000 }]) {
    for (const dimension of ["input", "output", "totalInput"]) {
      const b = new Budget(cap);
      if (dimension === "totalInput") {
        for (let n = 0; n < 10; n++) b.before(`p${n}`, synthetic(3_000_000, 0));
        assert.equal(b.totalInput, 30_000_000);
        assert.throws(() => b.before("next", synthetic(1, 0)), /budget limit/);
      } else {
        b.before("p", synthetic(dimension === "input" ? 2_999_999 : 0,
          dimension === "output" ? 79_999 : 0));
        b.before("p", synthetic(dimension === "input" ? 1 : 0, dimension === "output" ? 1 : 0));
        assert.throws(() => b.before("p", synthetic(dimension === "input" ? 1 : 0,
          dimension === "output" ? 1 : 0)), /budget limit/);
      }
    }
  }
});

test("carrier and cap are copied; conflicting carriers and unconfirmed real route refuse", () => {
  const cap = { input: 100, output: 10, totalInput: 100 };
  const w = { route: "fixture", model: "pinned", inputWindow: 100, evidence: "fixture only" };
  const b = new Budget(cap, { confirmedWindows: [w] });
  cap.input = 1000;
  w.inputWindow = 1;
  b.before("p", { attemptId: "a", route: "fixture", model: "pinned", max_tokens: 10,
    basis: "confirmed-route-window" });
  assert.equal(b.totalInput, 100);
  assert.throws(() => b.before("p", synthetic(1, 0)), /budget limit/);
  assert.throws(() => new Budget(cap, { confirmedWindows: [w, w] }), /ambiguous/);
  const real = new Budget();
  let posts = 0;
  assert.throws(() => {
    real.before("subject", { attemptId: "a", route: "unconfirmed-anthropic-route",
      model: "claude-opus-5-5", max_tokens: 8192, basis: "confirmed-route-window" });
    posts++;
  }, /no upper-bound basis/);
  assert.equal(posts, 0);
});

test("valid inclusive usage at bound succeeds, repeated overrun settlement is still failure", () => {
  const b = new Budget();
  const id = b.before("p", synthetic(6, 2));
  const raw = { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 2 };
  assert.equal(b.settle(id, raw, { success: true }), "usage-settled");
  const bad = b.before("p", synthetic(6, 2));
  assert.throws(() => b.settle(bad, { ...raw, output_tokens: 3 }, { success: true }), /upper bound exceeded/);
  assert.throws(() => b.settle(bad, raw), /upper bound exceeded/);
});

test("omitted success is not a successful response", () => {
  const b = new Budget();
  const id = b.before("p", synthetic(10, 10));
  const raw = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  assert.equal(b.settle(id, raw), "reserve-spent");
  assert.equal(b.totalInput, 10);
  assert.equal(b.settle(id, raw, { success: true }), "reserve-spent");
});
