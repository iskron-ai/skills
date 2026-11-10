// Preparation only (graph @nks/nks-dev #10139). No model launcher or credentials.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const limits = Object.freeze({ runsPerArm: 3, runs: 9, input: 3_000_000, output: 80_000, totalInput: 30_000_000 });
export const arms = Object.freeze({
  current: { NKS_ROOM_OUTCOME_NODE: "off", NKS_ROOM_HEARD_WRITES: "off" },
  door: { NKS_ROOM_OUTCOME_NODE: "enforce", NKS_ROOM_HEARD_WRITES: "off" },
  audibility: { NKS_ROOM_OUTCOME_NODE: "shadow", NKS_ROOM_HEARD_WRITES: "enforce" },
});
export const readTools = new Set(["iskron_look", "iskron_orient", "iskron_search", "iskron_semantic_search"]);

// Enforced at an RPC boundary, not in the reader's prompt. Does NOT fence alternate network/file access.
export function readerCall(request, realm) {
  const p = request?.params;
  return request?.method === "tools/call" && readTools.has(p?.name) && p.arguments?.realm === realm &&
    !Object.hasOwn(p.arguments, "action");
}

export function digest(parts) {
  const hash = createHash("sha256");
  for (const [name, bytes] of parts) {
    hash.update(`${Buffer.byteLength(name)}:${name}:${Buffer.byteLength(bytes)}:`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function loadPackage() {
  const names = ["scene.json", "oracle.json", "protocol.mjs", "guard.mjs", "reader.mjs", "controls.json",
    "preflight.mjs", "stub-child.mjs", "instrument.test.mjs", "README.md", "../stand-mcp-ledger.mjs"];
  const parts = names.map((name) => [name, readFileSync(new URL(name, import.meta.url))]);
  const scene = JSON.parse(parts[0][1]);
  const oracle = JSON.parse(parts[1][1]);
  if (scene.events.length !== 12 || oracle.decisions.length !== 12) throw new Error("exactly 12 decisions required");
  if (new Set(oracle.decisions.map((d) => d.id)).size !== 12) throw new Error("duplicate decisions");
  for (const [i, decision] of oracle.decisions.entries()) {
    if (decision.id !== scene.events[i].id || !decision.question || !decision.expected) throw new Error("scene/oracle mismatch");
  }
  for (const kind of ["satellite-born", "foreign-verdict"]) {
    if (oracle.decisions.filter((d) => d.kind === kind).length < 2) throw new Error(`need two ${kind}`);
  }
  return { scene, oracle, sha256: digest(parts), files: names, limits, arms, liveReady: false };
}

// Observe the server's /schema rooms.arms first; never infer a flag from a client's report.
export function verifyModes(observed, arm) {
  const expected = arms[arm];
  if (!expected || !observed || Object.keys(expected).some((key) => observed[key] !== expected[key])) {
    throw new Error("arm mode missing or mismatched");
  }
}
