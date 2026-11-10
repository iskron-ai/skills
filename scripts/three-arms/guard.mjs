// graph @nks/nks-dev #10139, #7685. Accounting only: never sends a model request.
import { limits } from "./protocol.mjs";

const number = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (s) => typeof s === "string" && s.trim().length > 0;
export class Budget {
  #cap;
  #windows;
  #runs = new Map();
  #attempts = new Map();
  #totalInput = 0;
  #stopped = false;
  constructor(cap = limits, { confirmedWindows = [] } = {}) {
    for (const key of ["input", "output", "totalInput"]) if (!number(cap[key])) throw new Error("invalid cap");
    this.#cap = { ...cap };
    // Trusted supervisor input, NOT provider discovery or verification. Evidence must be
    // checked without inference outside this class; fixture evidence grants no live access.
    this.#windows = confirmedWindows.map((w) => {
      if (!w || !text(w.route) || !text(w.model) || !text(w.evidence) ||
          !number(w.inputWindow) || w.inputWindow === 0) throw new Error("invalid window carrier");
      return { ...w };
    });
    const keys = this.#windows.map((w) => JSON.stringify([w.route, w.model]));
    if (new Set(keys).size !== keys.length) throw new Error("ambiguous window carrier");
  }
  get cap() { return { ...this.#cap }; }
  get runs() { return new Map([...this.#runs].map(([k, v]) => [k, { ...v }])); }
  get totalInput() { return this.#totalInput; }
  get stopped() { return this.#stopped; }
  #stop(message) { this.#stopped = true; throw new Error(message); }
  // inputUpper includes cache read + creation; reserve is never released on failure/missing usage.
  before(run, request = {}) {
    if (this.#stopped) throw new Error("guard already stopped");
    let { inputUpper, outputUpper, basis, attemptId } = request;
    if (!text(run)) this.#stop("invalid process id");
    if (basis === "confirmed-route-window") {
      const window = this.#windows.find((w) => w.route === request.route && w.model === request.model);
      if (!window || !number(request.max_tokens) || request.max_tokens === 0 || !text(attemptId)) {
        this.#stop("no upper-bound basis: confirmed route/model window and max_tokens required");
      }
      inputUpper = window.inputWindow;
      outputUpper = request.max_tokens;
    } else if (basis === "synthetic-byte-contract") {
      attemptId ??= Symbol("synthetic-attempt");
    } else {
      this.#stop("no upper-bound basis");
    }
    if (!number(inputUpper) || !number(outputUpper)) this.#stop("no upper-bound basis");
    if (this.#attempts.has(attemptId)) this.#stop("duplicate attempt id: no new POST permit");
    const used = this.#runs.get(run) ?? { input: 0, output: 0 };
    // Subtraction, not addition: spent+inflight must not overflow before comparison.
    if (inputUpper > this.#cap.input - used.input || outputUpper > this.#cap.output - used.output ||
        inputUpper > this.#cap.totalInput - this.#totalInput) {
      this.#stop("budget limit: terminate own process before POST");
    }
    this.#runs.set(run, { input: used.input + inputUpper, output: used.output + outputUpper });
    this.#totalInput += inputUpper;
    this.#attempts.set(attemptId, { run, inputUpper, outputUpper, settled: false });
    return attemptId;
  }
  // Call once per HTTP attempt, only with its final successful raw provider usage.
  // On HTTP failure or missing/malformed usage call without usage: reserve stays spent.
  settle(attemptId, usage, { success = false } = {}) {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt) this.#stop("unknown attempt id");
    if (attempt.settled) {
      if (attempt.result === "upper-bound-exceeded") this.#stop("upper bound exceeded: attempt unsuccessful");
      return attempt.result;
    }
    attempt.settled = true;
    attempt.result = "reserve-spent";
    let input, output;
    try {
      if (success !== true) throw new Error("unsuccessful HTTP attempt");
      input = inclusiveInput(usage);
      output = usage.output_tokens;
      if (!number(output)) throw new Error("unknown output usage");
    } catch {
      return attempt.result;
    }
    const used = this.#runs.get(attempt.run);
    const nextInput = used.input - attempt.inputUpper + input;
    const nextOutput = used.output - attempt.outputUpper + output;
    const total = this.#totalInput - attempt.inputUpper + input;
    if (![nextInput, nextOutput, total].every(number)) this.#stop("usage accounting overflow");
    this.#runs.set(attempt.run, { input: nextInput, output: nextOutput });
    this.#totalInput = total;
    if (input > attempt.inputUpper || output > attempt.outputUpper) {
      attempt.result = "upper-bound-exceeded";
      this.#stop("upper bound exceeded: terminate own process; attempt unsuccessful");
    }
    attempt.result = "usage-settled";
    return attempt.result;
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
