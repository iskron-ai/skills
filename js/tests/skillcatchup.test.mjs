// Built bridge, real daemon/seam, fake API. No updater or live delivery is certified.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc } from "./status-kit.mjs";

const built = readFileSync(BRIDGE, "utf8");
const version = /(?:const|var|let) VERSION = "([^"]+)"/.exec(built)[1];
const [major, minor, patch] = version.split(".").map(Number);
const text = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");

async function fixture(client, installed, source, plugin, fn, target = version) {
  const carrier = source?.home;
  if (carrier) assert.ok(realpathSync(carrier).startsWith(`${realpathSync(tmpdir())}${sep}`));
  const dir = carrier || mkdtempSync(join(tmpdir(), "night-skills-catchup-"));
  // Only the version marker is synthetic here, to exercise patch-only lag even on x.y.0.
  const bridge = target === version ? BRIDGE : join(dir, "probe-bridge.mjs");
  if (bridge !== BRIDGE)
    writeFileSync(bridge, built.replace(`VERSION = "${version}"`, `VERSION = "${target}"`));
  const gitInstall = source && typeof source === "object";
  const packageRoot = join(
    dir,
    ".pi",
    "agent",
    "git",
    "github.com",
    "iskron-ai",
    source?.otherPath ? "other-skills" : "skills",
  );
  const root = gitInstall ? join(packageRoot, "skills") : join(dir, ".agents", "skills");
  const script = join(root, "establish-mcp", "scripts", "iskron.mjs");
  const lock = join(root, "..", ".skill-lock.json");
  if (!carrier) {
    mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
    writeFileSync(script, `const VERSION = "${installed}";`);
  }
  if (gitInstall && !carrier) {
    execFileSync("git", ["init", "--quiet", packageRoot]);
    if (source.git) execFileSync("git", ["-C", packageRoot, "remote", "add", "origin", source.git]);
  } else if (!carrier)
    writeFileSync(lock, JSON.stringify({ skills: { "establish-mcp": { source } } }));
  if (plugin === "sibling-manifests" && !carrier)
    for (const name of [".claude-plugin", ".codex-plugin"]) {
      mkdirSync(join(root, "..", name), { recursive: true });
      writeFileSync(join(root, "..", name, "plugin.json"), "{}");
    }
  if (gitInstall) assert.equal(existsSync(lock), false, "pi git installs have no flat lock");
  const lockBytes = () => (existsSync(lock) ? readFileSync(lock, "utf8") : null);
  const before = [readFileSync(script, "utf8"), lockBytes()];
  const fake = await startFakeNks({ pat: "status-pat" });
  const child = spawn(NODE, [bridge, "daemon", "--auth-dir", join(dir, "auth")], {
    env: { ...env, HOME: dir, XDG_CONFIG_HOME: dir, XDG_STATE_HOME: dir },
    stdio: "ignore",
  });
  let link;
  try {
    (await entrance(join(dir, "auth"))).close();
    const hello = helloFrame({
      build: `v${target}+test`,
      path: bridge,
      argv: [fake.mcpUrl, "--auth-dir", join(dir, "auth")],
      patSha: patShaOf("status-pat"),
    });
    hello.env.ISKRON_SKILLS_ROOT = root;
    hello.env.ISKRON_BRIDGE_LANG = "en";
    hello.env.CLAUDE_PLUGIN_ROOT = plugin === true ? join(root, "..") : "";
    link = await connectSeam(seamSocketPath(join(dir, "auth")), hello, 3000);
    await rpc(
      link,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: { experimental: { "iskron/structured": {} } },
        clientInfo: { name: client, version: "1" },
      },
      1,
    );
    const response = await rpc(
      link,
      "tools/call",
      {
        name: "iskron_stand",
        arguments: { realm: "nks-dev", karta: 931, name: "catchup-probe" },
      },
      2,
    );
    assert.ok(!response.result?.isError, text(response));
    await fn({ response, link });
    assert.deepEqual(
      [readFileSync(script, "utf8"), lockBytes()],
      before,
      "an unproven updater must not change the set or lock",
    );
  } finally {
    link?.close();
    const exit = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exit;
    if (carrier)
      console.log(`pi carrier daemon PID ${child.pid}: observed exit ${child.signalCode}`);
    await fake.stop();
    if (!carrier) rmSync(dir, { recursive: true, force: true });
  }
}

for (const [client, plugin, command] of [
  ["opencode-iskron", false, "npx skills add https://github.com/iskron-ai/skills/tree/"],
  ["pi-iskron", false, "pi update git:github.com/iskron-ai/skills"],
  ["pi-iskron", "sibling-manifests", "pi update git:github.com/iskron-ai/skills"],
  ["claude-code", true, "/plugin marketplace update iskron"],
  ["codex-mcp-client", true, "codex plugin marketplace upgrade iskron"],
])
  test(`skills catchup: first line names stale set and ${client} command (${plugin})`, async () => {
    await fixture(client, "0.1.0", "iskron-ai/skills", plugin, async ({ response, link }) => {
      const first = text(response).split("\n")[0];
      assert.match(first, /SKILLS BEHIND/);
      assert.ok(first.includes("0.1.0") && first.includes(version), first);
      assert.ok(first.includes(command), first);
      if (client === "opencode-iskron") {
        assert.doesNotMatch(first, /--list\b/, "the suggested move must install, not list");
        assert.ok(first.includes("--skill '*' --agent opencode --global"), first);
        assert.doesNotMatch(first, /--all\b/);
      }
      assert.match(first, /not updated/);
      const key = response.result.structuredContent.key;
      const returned = await rpc(link, "iskron/resume", { key }, 3);
      assert.equal(returned.result.resumed, true, JSON.stringify(returned));
      assert.match(returned.result.word.split("\n")[0], /SKILLS BEHIND/);
    });
  });

test("skills catchup: fork refuses canonical updater and names source", async () => {
  await fixture("opencode-iskron", "0.1.0", "someone/fork", false, async ({ response }) => {
    const first = text(response).split("\n")[0];
    assert.match(first, /SKILLS BEHIND.*someone\/fork.*not updated/);
    assert.ok(!first.includes("npx skills add iskron-ai/skills"), first);
  });
});

test("skills catchup: pi git installation without flat lock ignores sibling manifests", async () => {
  await fixture(
    "pi-iskron",
    "0.1.0",
    { git: "https://github.com/iskron-ai/skills", home: process.env.ISKRON_PI_INSTALL_HOME },
    "sibling-manifests",
    async ({ response, link }) => {
      const first = text(response).split("\n")[0];
      assert.match(first, /SKILLS BEHIND.*pi update git:github.com\/iskron-ai\/skills/);
      assert.doesNotMatch(first, /doctor|\/plugin marketplace/);
      assert.match(first, /not updated/);
      const returned = await rpc(
        link,
        "iskron/resume",
        { key: response.result.structuredContent.key },
        3,
      );
      assert.match(
        returned.result.word.split("\n")[0],
        /pi update git:github.com\/iskron-ai\/skills/,
      );
    },
    process.env.ISKRON_PI_INSTALL_HOME ? `${major + 1}.0.0` : version,
  );
});

for (const source of [
  { git: "https://github.com/someone/fork" },
  { git: null },
  { git: "https://github.com/iskron-ai/skills", otherPath: true },
])
  test(`skills catchup: unknown pi git source stays diagnostic (${JSON.stringify(source)})`, async () => {
    await fixture("pi-iskron", "0.1.0", source, "sibling-manifests", async ({ response }) => {
      const first = text(response).split("\n")[0];
      assert.match(first, /source ownership is not proven.*not updated/);
      assert.match(first, /doctor/);
      assert.doesNotMatch(first, /pi update|\/plugin marketplace/);
    });
  });

test("skills catchup: a forked plugin is not told to replace itself with the canonical plugin", async () => {
  await fixture("claude-code", "0.1.0", "someone/fork", true, async ({ response }) => {
    const first = text(response).split("\n")[0];
    assert.match(first, /source ownership is not proven/);
    assert.ok(!first.includes("/plugin marketplace update iskron"), first);
    assert.match(first, /doctor/);
  });
});

test("skills catchup: current set produces no lag notice", async () => {
  await fixture("opencode-iskron", version, "iskron-ai/skills", false, async ({ response }) => {
    assert.doesNotMatch(text(response), /SKILLS BEHIND/);
  });
});

test("skills catchup: patch-only lag is notification only (synthetic version marker)", async () => {
  await fixture(
    "opencode-iskron",
    version,
    "iskron-ai/skills",
    false,
    async ({ response }) => assert.match(text(response).split("\n")[0], /patch-only.*not updated/),
    `${major}.${minor}.${patch + 1}`,
  );
});

for (const installed of ["unknown", `${major + 1}.0.0`])
  test(`skills catchup: ${installed} is not called stale`, async () => {
    await fixture("opencode-iskron", installed, "iskron-ai/skills", false, async ({ response }) => {
      assert.doesNotMatch(text(response), /SKILLS BEHIND/);
    });
  });

test("skills catchup: unknown source ownership refuses a canonical updater", async () => {
  await fixture("opencode-iskron", "0.1.0", null, false, async ({ response }) => {
    const first = text(response).split("\n")[0];
    assert.match(first, /source ownership is not proven.*not updated/);
    assert.ok(!first.includes("npx skills add iskron-ai/skills"), first);
  });
});
