// Whether a tree's commits past its base are already kept by a trunk (graph @nks/nks-dev, #11189):
// then removing the tree loses nothing. Read locally, never fetched; a Git refusal is "not kept".
import type { Git } from "./orchestra-tree-check.ts";
import type { RunTree } from "./orchestra-tree-types.ts";

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
/** The trunk refs a tree's commits may already live in. */
const TRUNKS = ["refs/remotes/origin/main", "refs/heads/main"];

/** HEAD is an ancestor of a trunk, or every commit past the base has its patch there already
 * (`git cherry` marks it "-": a squash of that commit, a cherry-pick, a rebase). */
export async function savedInTrunk(tree: RunTree, head: string, execute: Git): Promise<boolean> {
  for (const trunk of TRUNKS) {
    const found = await execute(tree.path, ["rev-parse", "--verify", "-q", `${trunk}^{commit}`]);
    if (found.code !== 0 || !OID.test(found.out.trim())) continue;
    const kept = await execute(tree.path, ["merge-base", "--is-ancestor", head, trunk]);
    if (kept.code === 0) return true;
    const cherry = await execute(tree.path, ["cherry", trunk, head, tree.baseOID], 30_000);
    const lines = cherry.out.split("\n").filter(Boolean);
    if (cherry.code === 0 && lines.length && lines.every((l) => /^- [a-f0-9]+$/.test(l)))
      return true;
  }
  return false;
}
