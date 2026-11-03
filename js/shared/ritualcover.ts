// What switches the delivery's rituals on in a repository (graph @nks/nks-dev, node #9319,
// section RITUALS; the cover — #9316): the delivery's block of the cover file at the repository
// root, read locally. The graph switches on the memory guard and the push and merge words; the
// start word needs the holon and the agent role too. A rituals plugin of the repository's own
// keeps the delivery's silent in OpenCode until the transition takes it off.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { COVER } from "../delivery/index.ts";
import { type CoverKeys, stampOf } from "./cover.ts";
import { coverBlock } from "./coverblock.ts";
import { repoRoot } from "./reposigns.ts";

export interface RitualCover {
  root: string;
  graph: string;
  holon?: string;
  role?: string;
}

/** The addresses of the cover of the repository holding dir; none, foreign or no graph — null. */
export function ritualCover(dir: string, cover: CoverKeys = COVER): RitualCover | null {
  const root = repoRoot(dir);
  if (!root) return null;
  let text: string;
  try {
    text = readFileSync(join(root, cover.file), "utf8");
  } catch {
    return null;
  }
  if (stampOf(text, cover) === "foreign") return null;
  const block = coverBlock(text, cover.root);
  const graph = block?.get("graph");
  if (!block || !graph) return null;
  const holon = block.get("holon") || undefined;
  const role = block.get("agent_role") || undefined;
  return { root, graph, ...(holon ? { holon } : {}), ...(role ? { role } : {}) };
}

/** Whether the cover carries the start word: graph, holon and agent role all named. */
export const startCarried = (c: RitualCover | null): boolean => !!(c?.holon && c.role);

/** A rituals plugin of the repository's own in its OpenCode plugins folder. */
export function ownRitualsPlugin(root: string): boolean {
  try {
    return readdirSync(join(root, ".opencode", "plugins")).some((f) => /ritual/i.test(f));
  } catch {
    return false;
  }
}
