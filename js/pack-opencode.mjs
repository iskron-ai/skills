#!/usr/bin/env node
// Pack tracked paths from the working tree, including local test changes.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1) throw new Error("Usage: node js/pack-opencode.mjs [prerelease-version]");
const release = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8")).version;
const version = args[0] || release;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version))
  throw new Error("Expected a semver version");
if (args[0] && (!version.startsWith(`${release}-`) || !version.includes("-")))
  throw new Error(`Test version must be a prerelease of ${release}`);
if (!args[0]) {
  const tag = execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (tag !== `v${release}`)
    throw new Error(`Stable package ${release} must be built from tag v${release}, found ${tag}`);
  const changes = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (changes) throw new Error("Stable package must be built from a clean worktree");
}

execFileSync(process.execPath, [join(root, "js/build.mjs"), "--check"], { stdio: "inherit" });
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const stage = mkdtempSync(join(dist, "opencode-package-"));
try {
  // Ship tracked skill files only, never local credentials or scratch files.
  const files = execFileSync("git", ["ls-files", "-z", "--", "skills/"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    mkdirSync(dirname(join(stage, file)), { recursive: true });
    try {
      cpSync(join(root, file), join(stage, file));
    } catch (cause) {
      throw new Error(
        `Cannot package tracked path ${file}: restore it or record its removal in git`,
        { cause },
      );
    }
  }
  cpSync(join(root, "SETUP.md"), join(stage, "SETUP.md"));
  cpSync(join(root, "scripts/opencode-npm.md"), join(stage, "README.md"));
  const dev = JSON.parse(readFileSync(join(root, "js/package.json"), "utf8"));
  const sdk = dev.devDependencies["@opencode-ai/plugin"];
  if (!/^\d+\.\d+\.\d+$/.test(sdk))
    throw new Error("@opencode-ai/plugin must have an exact version");
  const manifest = {
    name: "@iskron/opencode",
    version,
    description: "Iskron tools, channel bridge and skills for OpenCode",
    type: "module",
    engines: { node: ">=22" },
    main: "./skills/establish-mcp/scripts/opencode-plugin.js",
    exports: { ".": "./skills/establish-mcp/scripts/opencode-plugin.js" },
    files: ["skills/", "SETUP.md", "README.md"],
    repository: { type: "git", url: "https://github.com/iskron-ai/skills.git" },
    dependencies: { "@opencode-ai/plugin": sdk },
  };
  writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dist], {
      cwd: stage,
      encoding: "utf8",
    }),
  );
  process.stdout.write(`${join(dist, packed.filename)}\nsha512 integrity: ${packed.integrity}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
