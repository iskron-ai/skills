// Ворота возврата машины (граф @nks/nks-dev, #11375) и обновление навыков после самообновления:
// каждая сессия демона перерегистрирует свои места — тем же порядком, что возврат сессии: первая —
// проба, остальные ждут её исхода и идут не больше двух разом. Стоп, пришедший, пока register ждёт
// у ворот, его отменяет: после стопа register не уходит (#7439). Сессии демона — области одного
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
const { H } = await import(join(source, "bridge/holdstate.ts"));
const { noteSkills } = await import(join(source, "bridge/skillwatch.ts"));
const { refreshSkills } = await import(join(source, "bridge/skillrefresh.ts"));

const N = 4;
const REG_MS = 300; // каждый register идёт столько: видно, сколько их в полёте
const peak = (at) =>
  Math.max(0, ...at.map((t) => at.filter((u) => u <= t && u > t - REG_MS).length));

/** N сессий демона с местом и устаревшей отметкой навыков; `at` — сессии и мгновения register. */
async function sessions(t, n) {
  const dir = mkdtempSync(join(tmpdir(), "refresh-gate-"));
  const root = join(dir, "skills");
  mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
  writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after the update");
  const saved = globalThis.fetch;
  const at = [];
  globalThis.fetch = async (_url, options) => {
    const msg = JSON.parse(options.body);
    const a = msg.params?.arguments;
    if (a?.action === "register") at.push({ name: a.name, t: Date.now() });
    await new Promise((r) => setTimeout(r, REG_MS));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [] } }), {
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  const scopes = Array.from({ length: n }, (_, i) =>
    newScope(
      `refresh-${t.name.length}-${i}`,
      { env: { ISKRON_SKILLS_ROOT: root }, path: "", cwd: dir, pid: 1 },
      () => true,
    ),
  );
  for (const [i, scope] of scopes.entries())
    await runIn(scope, async () => {
      setConfig({
        pat: "test",
        timeoutMs: 5000,
        serverUrl: `https://fake.invalid/mcp/${t.name.length}`, // a gate of its own per probe
        authDir: dir,
      });
      state.sessionId = `s-${i}`;
      state.standingSession = `s-${i}`;
      state.standing = { realm: "r5", karta: "931", name: `seat-${i}` };
      noteSkills(state.standing, { name: "iskron-ai/skills", version: "7.9.0", stamp: "before" });
    });
  return { scopes, at };
}

test("skills refreshed after a self-update on N sessions: one register first, then at most two at once", async (t) => {
  const { scopes, at } = await sessions(t, N);
  await Promise.all(scopes.map((scope) => runIn(scope, () => refreshSkills())));
  assert.equal(at.length, N, `one register per session: ${at.length}`);
  const times = at.map((x) => x.t).sort((a, b) => a - b);
  const [first, ...rest] = times;
  assert.ok(
    rest.every((x) => x - first >= REG_MS),
    `the probe's register answered before any other went: ${times.map((x) => x - first)}`,
  );
  assert.ok(peak(rest) <= 2, `at most two at once: ${times.map((x) => x - first)}`);
});

test("a stop while a register waits at the return gate: that register never leaves", async (t) => {
  const { scopes, at } = await sessions(t, 3);
  const all = scopes.map((scope) => runIn(scope, () => refreshSkills()));
  await new Promise((r) => setTimeout(r, REG_MS / 3)); // the probe is out, the others wait
  for (const scope of scopes.slice(1))
    runIn(scope, () => {
      H.stopped = { n: H.stopped.n + 1, key: H.currentKey ?? "", text: "the owner stopped it" };
    });
  await Promise.all(all);
  assert.deepEqual(
    at.map((x) => x.name),
    ["seat-0"],
    "the stopped sessions sent no register — only the probe's, gone before the stop",
  );
});
