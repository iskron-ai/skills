// The lock of a flat install (`npx skills add`): which source each skill of a root came
// from (graph nks-dev: #6226). It lies beside the root, and the root is shared by every
// set installed so — the lock is what tells them apart.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SkillLock = Record<string, { source?: unknown; skillFolderHash?: unknown } | undefined>;

/** The lock's skills for root; no lock, or one that does not parse — null. */
export function skillLock(root: string): SkillLock | null {
  try {
    const lock = JSON.parse(readFileSync(join(dirname(root), ".skill-lock.json"), "utf8")) as {
      skills?: SkillLock;
    };
    return lock.skills ?? {};
  } catch {
    return null;
  }
}
