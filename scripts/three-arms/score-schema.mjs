// Offline evidence envelope only; this does not collect or authenticate journals.
const fail = (where) => { throw new Error(`invalid ${where}`); };
function shape(value, keys, where) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== keys.split(" ").sort().join()) fail(where);
}
const text = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const version = (v) => Number.isSafeInteger(v) && v > 0;
function reference(ref, sources, extra = "") {
  shape(ref, `source entry version${extra}`, "evidence fields");
  if (!sources.includes(ref.source) || !text(ref.entry) || !version(ref.version)) fail("evidence");
}
const ids = Array.from({ length: 12 }, (_, i) => `D${String(i + 1).padStart(2, "0")}`);
export function validate(packet) {
  shape(packet, "schema arms", "packet fields (not agent report)");
  if (packet.schema !== 1 || !Array.isArray(packet.arms) || packet.arms.length !== 3) fail("three arms");
  const labels = new Set(), runs = new Set();
  for (const arm of packet.arms) {
    shape(arm, "label runs", "arm fields");
    if (!text(arm.label) || labels.has(arm.label)) fail("neutral label");
    labels.add(arm.label);
    if (!Array.isArray(arm.runs) || arm.runs.length !== 3) throw new Error("exactly three slots per arm, no retries");
    for (const run of arm.runs) {
      shape(run, "id status decisions calls traversals", "run fields");
      if (!text(run.id) || runs.has(run.id)) fail("run id");
      runs.add(run.id);
      if (!["completed", "guard-stopped", "infrastructure-invalid"].includes(run.status)) fail("run status");
      if (!Array.isArray(run.decisions) || run.decisions.length !== 12) throw new Error("exactly twelve decisions");
      const seen = new Set();
      for (const d of run.decisions) {
        shape(d, "id occurrence judgement", "decision fields");
        if (!ids.includes(d.id) || seen.has(d.id)) fail("decision id");
        seen.add(d.id);
        if (d.occurrence !== null) reference(d.occurrence, ["case-journal"]);
        if (d.judgement === null && (d.occurrence === null || run.status !== "completed")) continue;
        shape(d.judgement, "label evidence node", "judgement fields");
        if (!["found-with-node", "found-without-node", "not-found"].includes(d.judgement.label)) fail("judgement label");
        reference(d.judgement.evidence, ["cold-judgement"]);
        if (d.judgement.label === "found-with-node") {
          shape(d.judgement.node, "id version", "node fields");
          if (!text(d.judgement.node.id) || !version(d.judgement.node.version)) fail("node version");
        } else if (d.judgement.node !== null) fail("unexpected node");
      }
      for (const [key, extra] of [["calls", " decision"], ["traversals", ""]]) {
        if (!Array.isArray(run[key])) fail(key);
        const entries = new Set();
        for (const event of run[key]) {
          reference(event, ["server", "bridge"], extra);
          if (extra && !ids.includes(event.decision)) fail("call decision");
          const identity = `${event.source}:${event.entry}`;
          if (entries.has(identity)) fail(`duplicate ${key} event`);
          entries.add(identity);
        }
      }
    }
  }
}
