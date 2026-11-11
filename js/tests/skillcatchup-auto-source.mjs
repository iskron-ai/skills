// Complete pinned-tree stand-in; source faults never fall back to public GitHub.
import { createServer } from "node:http";

import { blob, hash, names, sha, version } from "./skillcatchup-auto-disk.mjs";

export async function autoSource(mode, beforeTree) {
  const paths = [];
  const server = createServer(async (req, res) => {
    paths.push(req.url);
    res.setHeader("content-type", "application/json");
    if (req.url.includes("releases/latest"))
      return res.end(JSON.stringify({ tag_name: `v${version}` }));
    if (req.url.includes("/commits/")) return res.end(JSON.stringify({ sha }));
    if (mode === "network") {
      res.statusCode = 503;
      return res.end("{}");
    }
    await beforeTree();
    const tree = names.flatMap((name) => [
      { path: `skills/${name}`, type: "tree", mode: "040000", sha: hash(name) },
      { path: `skills/${name}/SKILL.md`, type: "blob", mode: "100644", sha: blob("after:" + name) },
    ]);
    tree.push({
      path: "skills/establish-mcp/scripts/iskron.mjs",
      type: "blob",
      mode: "100644",
      sha: blob(`const VERSION = "${version}";`),
    });
    if (mode === "unsafe")
      tree.push({ path: "skills/../SKILL.md", type: "blob", mode: "100644", sha });
    if (mode === "duplicate") tree.push(tree[1]);
    if (mode === "outside-skills")
      for (const path of ["SKILL.md", "home/example/SKILL.md"])
        tree.push({ path, type: "blob", mode: "100644", sha: blob("outside delivery") });
    res.end(JSON.stringify({ sha, truncated: mode === "truncated", tree }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    paths,
    base: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise((r) => server.close(r)),
  };
}
