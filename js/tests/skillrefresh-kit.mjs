import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = process.env.ISKRON_REFRESH_SOURCE || resolve("js");
const { newScope, runIn } = await import(join(source, "shared/scope.ts"));
const { setConfig } = await import(join(source, "bridge/config.ts"));
export const { state } = await import(join(source, "bridge/transport.ts"));
const { noteSkills } = await import(join(source, "bridge/skillwatch.ts"));
export const { serialized } = await import(join(source, "bridge/call.ts"));
export const { refreshSkills } = await import(join(source, "bridge/skillrefresh.ts"));
export const { skillsAttr, skillsRoot } = await import(join(source, "bridge/skillset.ts"));
export const { runUsage } = await import(join(source, "bridge/usage.ts"));
export const { withPlaceFields } = await import(join(source, "bridge/placefields.ts"));

export async function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "refresh-review-"));
  const root = join(dir, "skills");
  mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
  writeFileSync(join(root, "establish-mcp", "SKILL.md"), "before");
  const scope = newScope(
    "refresh",
    { env: { ISKRON_SKILLS_ROOT: root }, path: "", cwd: dir, pid: 1 },
    () => true,
  );
  const saved = globalThis.fetch;
  const calls = [];
  try {
    await runIn(scope, async () => {
      setConfig({
        pat: "test",
        timeoutMs: 2000,
        serverUrl: "https://fake.invalid/mcp",
        authDir: dir,
      });
      state.sessionId = "test";
      state.standingSession = "test";
      state.standing = { realm: "r5", karta: "931", name: "old" };
      noteSkills(state.standing, { name: "iskron-ai/skills", version: "7.9.0", stamp: "before" });
      globalThis.fetch = async (_url, options) => {
        const msg = JSON.parse(options.body);
        calls.push(msg.params.arguments);
        const result = await kit.answer(msg);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), {
          headers: { "content-type": "application/json" },
        });
      };
      const kit = { dir, root, scope, calls, answer: async () => ({ content: [] }) };
      await fn(kit);
    });
  } finally {
    globalThis.fetch = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}
