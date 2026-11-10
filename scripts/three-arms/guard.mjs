// Synthetic contract only: no inference that bytes bound a real model's tokens (#7685).
import { limits } from "./protocol.mjs";

const number = (n) => Number.isSafeInteger(n) && n >= 0;
export class Budget {
  constructor(cap = limits) {
    for (const key of ["input", "output", "totalInput"]) if (!number(cap[key])) throw new Error("invalid cap");
    this.cap = cap;
    this.runs = new Map();
    this.totalInput = 0;
    this.stopped = false;
  }
  // inputUpper includes cache read + creation; reserve is never released on failure/missing usage.
  before(run, { inputUpper, outputUpper, basis }) {
    if (this.stopped) throw new Error("guard already stopped");
    if (basis !== "synthetic-byte-contract" || !number(inputUpper) || !number(outputUpper)) {
      this.stopped = true;
      throw new Error("no upper-bound basis");
    }
    const used = this.runs.get(run) ?? { input: 0, output: 0 };
    if (used.input + inputUpper > this.cap.input || used.output + outputUpper > this.cap.output ||
        this.totalInput + inputUpper > this.cap.totalInput) {
      this.stopped = true;
      throw new Error("budget limit: terminate own process before POST");
    }
    this.runs.set(run, { input: used.input + inputUpper, output: used.output + outputUpper });
    this.totalInput += inputUpper;
  }
}

// Explicit components from raw provider usage; absent or ambiguous values are not zero.
export function inclusiveInput({ input_tokens, cache_read_input_tokens, cache_creation_input_tokens }) {
  const components = [input_tokens, cache_read_input_tokens, cache_creation_input_tokens];
  if (!components.every(number)) throw new Error("unknown raw usage");
  const sum = components.reduce((a, b) => a + b, 0);
  if (!number(sum)) throw new Error("usage overflow");
  return sum;
}
