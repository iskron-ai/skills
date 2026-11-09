// The human's launcher descriptions (graph @nks/nks-dev, nodes #5042, #4920; decision of case
// №4050): which orchestrator answers which `launcher` value of a role invite, with what harnesses
// and models, how many raised at once and where each repository's checkout lies. They live in
// the human's own graph "mind" as nodes with attribute slice:orchestra, body — one JSON object;
// the daemon reads them under its own key. A description of another machine is someone else's;
// a broken one raises nothing and is said aloud.
import { hostname } from "node:os";
import { isAbsolute } from "node:path";

import { tool } from "../delivery/index.ts";
import { mcpSession } from "../shared/mcpsession.ts";

export interface HarnessOffer {
  /** The adapter's own name of the harness (Orca's --agent). */
  agent: string;
  models: string[];
}
export interface Launcher {
  launcher: string;
  host: string;
  adapter: "orca";
  limit: number;
  harnesses: Record<string, HarnessOffer>;
  checkouts: Record<string, string>;
}
export interface Launchers {
  /** This machine's launchers by their selector. */
  own: Map<string, Launcher>;
  /** Every selector some description names — another machine's included. */
  known: Set<string>;
  /** Descriptions that raise nothing: the selector (or node) and the code. */
  refused: { what: string; code: string }[];
}

const SLICE = "slice:orchestra";
const LIMIT = 50;

const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** One body as the human wrote it; a code when it cannot stand. */
export function parseLauncher(raw: string): Launcher | { code: string; launcher?: string } {
  let v: unknown;
  try {
    const at = raw.indexOf("{");
    v = JSON.parse(raw.slice(at, raw.lastIndexOf("}") + 1));
  } catch {
    return { code: "description_not_json" };
  }
  const d = (v ?? {}) as Record<string, unknown>;
  if (!str(d.launcher) || d.launcher.length > 64) return { code: "launcher_missing" };
  const launcher = d.launcher.trim();
  if (!str(d.host)) return { code: "host_missing", launcher };
  if (d.adapter !== "orca") return { code: "adapter_unsupported", launcher };
  if (!Number.isSafeInteger(d.limit) || (d.limit as number) < 0)
    return { code: "limit_missing", launcher };
  const harnesses: Record<string, HarnessOffer> = {};
  const h = d.harnesses;
  if (!h || typeof h !== "object" || Array.isArray(h))
    return { code: "harnesses_missing", launcher };
  for (const [name, o] of Object.entries(h as Record<string, unknown>)) {
    const x = (o ?? {}) as Record<string, unknown>;
    if (!str(x.agent) || !Array.isArray(x.models) || !x.models.every(str))
      return { code: "harness_invalid", launcher };
    harnesses[name] = {
      agent: x.agent.trim(),
      models: (x.models as string[]).map((m) => m.trim()),
    };
  }
  const checkouts: Record<string, string> = {};
  const c = d.checkouts ?? {};
  if (typeof c !== "object" || Array.isArray(c)) return { code: "checkouts_invalid", launcher };
  for (const [repo, path] of Object.entries(c as Record<string, unknown>)) {
    if (!str(path) || !isAbsolute(path)) return { code: "checkouts_invalid", launcher };
    checkouts[repo] = path;
  }
  return {
    launcher,
    host: d.host.trim(),
    adapter: "orca",
    limit: d.limit as number,
    harnesses,
    checkouts,
  };
}

/** The descriptions as they lie in mind; a failed read throws — the tact raises nothing. */
export async function readLaunchers(serverUrl: string, token: string): Promise<Launchers> {
  const s = mcpSession(serverUrl, token, "orchestra");
  const out: Launchers = { own: new Map(), known: new Set(), refused: [] };
  try {
    await s.open();
    const found = await s.call(tool("search"), {
      realm: "mind",
      q: "",
      attrs_filter: SLICE,
      limit: LIMIT,
    });
    const seqs = [...new Set([...found.matchAll(/\(#(\d+), /g)].map((m) => m[1]))];
    const mine: Launcher[] = [];
    for (const seq of seqs) {
      const body = await s.call(tool("look"), { realm: "mind", node_id: `#${seq}`, raw: true });
      const l = parseLauncher(body);
      if ("code" in l) {
        if (l.launcher) out.known.add(l.launcher);
        out.refused.push({ what: l.launcher ?? `#${seq}`, code: l.code });
        continue;
      }
      out.known.add(l.launcher);
      if (l.host === hostname()) mine.push(l);
    }
    for (const l of mine) {
      if (mine.filter((x) => x.launcher === l.launcher).length > 1) {
        if (!out.refused.some((r) => r.what === l.launcher))
          out.refused.push({ what: l.launcher, code: "launcher_duplicate" });
        continue;
      }
      out.own.set(l.launcher, l);
    }
    return out;
  } finally {
    await s.close();
  }
}
