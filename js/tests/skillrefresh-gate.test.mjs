// Ворота возврата машины (граф @nks/nks-dev, #11375) и обновление навыков после самообновления:
// каждая сессия демона перерегистрирует свои места — тем же порядком, что возврат сессии: первая —
// проба, остальные ждут её исхода и идут не больше двух разом. Сессии демона — области одного
// процесса над подставным fetch. ISKRON_REFRESH_SOURCE — на исходники прежней сборки.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const source = process.env.ISKRON_REFRESH_SOURCE || resolve("js");
const { newScope, runIn } = await import(join(source, "shared/scope.ts"));
const { setConfig } = await import(join(source, "bridge/config.ts"));
const { state } = await import(join(source, "bridge/transport.ts"));
const { noteSkills } = await import(join(source, "bridge/skillwatch.ts"));
const { refreshSkills } = await import(join(source, "bridge/skillrefresh.ts"));

const N = 4;
const REG_MS = 300; // каждый register идёт столько: видно, сколько их в полёте
const peak = (at) =>
  Math.max(0, ...at.map((t) => at.filter((u) => u <= t && u > t - REG_MS).length));

test("skills refreshed after a self-update on N sessions: one register first, then at most two at once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "refresh-gate-"));
  const root = join(dir, "skills");
  mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
  writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after the update");
  const saved = globalThis.fetch;
  const at = [];
  globalThis.fetch = async (_url, options) => {
    const msg = JSON.parse(options.body);
    if (msg.params?.arguments?.action === "register") at.push(Date.now());
    await new Promise((r) => setTimeout(r, REG_MS));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [] } }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const scopes = Array.from({ length: N }, (_, i) =>
      newScope(
        `refresh-${i}`,
        { env: { ISKRON_SKILLS_ROOT: root }, path: "", cwd: dir, pid: 1 },
        () => true,
      ),
    );
    for (const [i, scope] of scopes.entries())
      await runIn(scope, async () => {
        setConfig({
          pat: "test",
          timeoutMs: 5000,
          serverUrl: "https://fake.invalid/mcp",
          authDir: dir,
        });
        state.sessionId = `s-${i}`;
        state.standingSession = `s-${i}`;
        state.standing = { realm: "r5", karta: "931", name: `seat-${i}` };
        noteSkills(state.standing, { name: "iskron-ai/skills", version: "7.9.0", stamp: "before" });
      });
    await Promise.all(scopes.map((scope) => runIn(scope, () => refreshSkills())));
    assert.equal(at.length, N, `one register per session: ${at.length}`);
    const [first, ...rest] = at.sort((a, b) => a - b);
    assert.ok(
      rest.every((t) => t - first >= REG_MS),
      `the probe's register answered before any other went: ${at.map((t) => t - first)}`,
    );
    assert.ok(peak(rest) <= 2, `at most two at once: ${at.map((t) => t - first)}`);
  } finally {
    globalThis.fetch = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
