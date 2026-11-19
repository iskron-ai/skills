import { registerHooks } from "node:module";

const names = [
  "orchestra-tree.ts",
  "orchestra-tree-check.ts",
  "orchestra-tree-clean.ts",
  "orchestra-tree-path.ts",
];
const fsShim = new URL("./tree-win-fs.mjs", import.meta.url).href;
const pathShim = new URL("./tree-win-path.mjs", import.meta.url).href;
const mutation = process.env.TREE_WIN_MUTATION;

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    const name = names.find((n) => url.endsWith(`/bridge/${n}`));
    if (!name) return loaded;
    let source = String(loaded.source);
    if (name === "orchestra-tree-check.ts" && mutation === "inspect-common") {
      source = source.replace(
        'const common = treePath(\n    await gitText(tree.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], execute),\n  );',
        'const common = await gitText(tree.path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], execute);',
      );
      source = source.replace("!sameTreePath(common, tree.commonDir)", "common !== tree.commonDir");
    }
    if (name === "orchestra-tree-check.ts" && mutation === "gitdir")
      source = source.replace(
        '!sameTreePath(readFileSync(back, "utf8").trim(), join(tree.path, ".git"))',
        'readFileSync(back, "utf8").trim() !== join(tree.path, ".git")',
      );
    if (name === "orchestra-tree.ts" && mutation === "prepare-top")
      source = source.replace(
        '!sameTreePath(await gitText(source, ["rev-parse", "--show-toplevel"], execute), source)',
        '(await gitText(source, ["rev-parse", "--show-toplevel"], execute)) !== source',
      );
    if (name === "orchestra-tree-check.ts" && mutation === "ready-common")
      source = source.replace(
        'sameTreePath(\n        await gitText(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"], execute),\n        t.commonDir,\n      )',
        '(await gitText(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"], execute)) === t.commonDir',
      );
    if (name === "orchestra-tree-clean.ts" && mutation === "cleanup-common")
      source = source.replace("!sameTreePath(common, t.commonDir)", "common !== t.commonDir");
    if (name === "orchestra-tree-clean.ts" && mutation === "cleanup-path")
      source = source.replace("!sameTreePath(t.path, r.worktree)", "t.path !== r.worktree");
    if (name === "orchestra-tree-check.ts" && mutation === "worktrees")
      source = source
        .replace(
          "!treeMetadataPath(common, gitDir)",
          "!/^worktrees\\/[^/]+$/.test(relative(common, gitDir))",
        )
        .replace("import { isAbsolute, join }", "import { isAbsolute, join, relative }");
    source = source
      .replaceAll('"node:fs"', JSON.stringify(fsShim))
      .replaceAll('"node:path"', JSON.stringify(pathShim));
    return { ...loaded, source };
  },
});
