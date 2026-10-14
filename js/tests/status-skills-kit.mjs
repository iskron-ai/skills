import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc } from "./status-kit.mjs";

export const wait = (ms = 1100) => new Promise((r) => setTimeout(r, ms));
export const registers = (fake) => fake.state.placeArgs.filter((a) => a.action === "register");
export async function skillsDaemon(client, fn) {
  const dir = mkdtempSync(join(tmpdir(), "status-skills-"));
  const root = join(dir, "set", "skills");
  mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
  const change = (hash) =>
    writeFileSync(
      join(root, "..", ".skill-lock.json"),
      JSON.stringify({
        skills: { "establish-mcp": { source: "iskron-ai/skills", skillFolderHash: hash } },
      }),
    );
  change("before");
  const fake = await startFakeNks({ pat: "status-pat" });
  const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: { ...env, ISKRON_USAGE_GAP_MS: "1000", ISKRON_SKILLS_GAP_MS: "1000" },
    stdio: "ignore",
  });
  let link;
  try {
    (await entrance(dir)).close();
    const hello = helloFrame({
      build: "v7.9.0+test",
      path: BRIDGE,
      argv: [fake.mcpUrl, "--auth-dir", dir],
      patSha: patShaOf("status-pat"),
    });
    hello.env.ISKRON_SKILLS_ROOT = root;
    link = await connectSeam(seamSocketPath(dir), hello, 3000);
    await rpc(
      link,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: client, version: "2.1" },
      },
      1,
    );
    await rpc(
      link,
      "tools/call",
      { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "skills-place" } },
      2,
    );
    // Background refresh from taking the place has settled before the fixture is handed over.
    await wait(50);
    await fn({ dir, fake, link, change });
  } finally {
    link?.close();
    const exited = new Promise((r) => d.once("exit", r));
    d.kill("SIGKILL");
    await exited;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function settled(fake, count) {
  for (let i = 0; i < 100 && registers(fake).length < count; i++) await wait(20);
  // placeArgs is observed at request time; allow the response to update the declaration too.
  await wait(50);
}
