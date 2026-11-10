import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { names, prepareAutoSet, sha, version } from "./skillcatchup-auto-disk.mjs";
import { autoSource } from "./skillcatchup-auto-source.mjs";
import { entrance, env, NODE, rpc } from "./status-kit.mjs";

export async function autoFixture(mode, fn) {
  const dir = mkdtempSync(join(tmpdir(), "night-skills-auto-"));
  const { root, stateHome, lockPath, bin, bridge, bridgeVersion } = prepareAutoSet(dir, mode);
  const { base, paths, stop } = await autoSource(mode, async () => {
    if (mode === "lookup-gate") {
      for (let i = 0; i < 150 && !existsSync(join(dir, "release-tree")); i++)
        await new Promise((r) => setTimeout(r, 20));
    }
    if (mode === "stop-before") {
      await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  if (mode === "cached-tag") {
    const home = join(dir, ".iskron-bridge");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(home);
    writeFileSync(
      join(home, "release-tag.json"),
      JSON.stringify({
        source: `${base}/repos/iskron-ai/skills/releases/latest`,
        checked_at: Date.now(),
        tag: "v0.1.0",
      }),
    );
  }
  const fake = await startFakeNks({ pat: "status-pat" });
  const child = spawn(NODE, [bridge, "daemon", "--auth-dir", join(dir, "auth")], {
    env: {
      ...env,
      HOME: dir,
      XDG_STATE_HOME: stateHome,
      XDG_CONFIG_HOME: join(dir, "config"),
      PATH: `${bin}:${process.env.PATH}`,
      ISKRON_BRIDGE_NO_UPDATE: "",
      ISKRON_BRIDGE_RELEASES_URL: `${base}/repos/iskron-ai/skills/releases/latest`,
      ISKRON_BRIDGE_UPDATE_DELAY_MS: "99999999",
      ISKRON_SKILLS_UPDATE_TIMEOUT_MS: mode === "timeout" ? "1000" : "20000",
    },
    stdio: "ignore",
  });
  let link, link2, stopWatch;
  const calls = () => {
    try {
      return readFileSync(join(dir, "calls"), "utf8").trim().split("\n").map(JSON.parse);
    } catch {
      return [];
    }
  };
  try {
    (await entrance(join(dir, "auth"))).close();
    const hello = helloFrame({
      build: `v${bridgeVersion}+test`,
      path: bridge,
      argv: [fake.mcpUrl, "--auth-dir", join(dir, "auth")],
      patSha: patShaOf("status-pat"),
    });
    hello.env.ISKRON_SKILLS_ROOT = root;
    hello.env.XDG_STATE_HOME = stateHome;
    hello.env.ISKRON_BRIDGE_LANG = "en";
    link = await connectSeam(seamSocketPath(join(dir, "auth")), hello, 3000);
    await rpc(
      link,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: { experimental: { "iskron/structured": {} } },
        clientInfo: { name: "opencode-iskron", version: "2" },
      },
      1,
    );
    if (mode === "stop-during")
      stopWatch = setInterval(() => {
        try {
          if (readFileSync(join(dir, "calls"), "utf8").includes('"add"')) {
            clearInterval(stopWatch);
            void fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
          }
        } catch {
          /* updater not started */
        }
      }, 20);
    const pending = rpc(
      link,
      "tools/call",
      { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "auto-probe" } },
      2,
    );
    let gateDuringLookup;
    if (mode === "lookup-gate") {
      for (let i = 0; i < 100 && !paths.some((p) => p.includes("/git/trees/")); i++)
        await new Promise((r) => setTimeout(r, 20));
      gateDuringLookup = existsSync(join(root, "..", ".skill-catchup.lock"));
      writeFileSync(join(dir, "release-tree"), "release");
    }
    let secondText;
    if (mode === "concurrent") {
      for (let i = 0; i < 100 && !calls().some((a) => a.includes("add")); i++)
        await new Promise((r) => setTimeout(r, 20));
      link2 = await connectSeam(
        seamSocketPath(join(dir, "auth")),
        { ...hello, session: "catchup-second" },
        3000,
      );
      await rpc(
        link2,
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "opencode-iskron", version: "2" },
        },
        1,
      );
      const second = await rpc(
        link2,
        "tools/call",
        { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "auto-second" } },
        2,
      );
      secondText = (second.result?.content ?? []).map((c) => c.text ?? "").join("\n");
      writeFileSync(join(dir, "release-writer"), "release");
    }
    let result = await pending;
    const connectsBefore = fake.state.placeArgs.filter((a) => a.action === "connect").length;
    if (mode === "resume") {
      writeFileSync(
        join(root, "establish-mcp", "scripts", "iskron.mjs"),
        'const VERSION = "0.1.0";',
      );
      result = await rpc(link, "iskron/resume", { key: result.result.structuredContent.key }, 3);
    }
    const text =
      result.result?.word ?? (result.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    await fn({
      dir,
      root,
      lockPath,
      text,
      calls,
      paths,
      sha,
      names,
      version,
      fake,
      connectsBefore,
      secondText,
      link,
      gateDuringLookup,
    });
  } finally {
    clearInterval(stopWatch);
    try {
      process.kill(-Number(readFileSync(join(dir, "updater-pid"), "utf8")), "SIGKILL");
    } catch {
      /* only this fixture's updater group */
    }
    link?.close();
    link2?.close();
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited;
    await fake.stop();
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
}
