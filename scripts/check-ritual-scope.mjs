#!/usr/bin/env node
// Ревизор области плагина ритуалов OpenCode (граф @nks/nks-dev, узел #6686).
// Поток ctx.event.subscribe один на сервер OpenCode машины: подписчик видит
// создание сессий всех каталогов, а плагин проекта пишет только в сессии своего.
// Плагин грузится против подставного контекста с двумя каталогами, получает
// session.created своей и чужой сессии; считается, во что он написал.
//
//   node scripts/check-ritual-scope.mjs <репо>...
//
// Строка на плагин из <репо>/.opencode/plugins; код 1 — плагин пишет в чужую
// сессию или не загрузился. Плагин исполняется: setup с подставным ctx, без хуков тулов.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SETTLE_MS = 200;

// Любой член подставного ctx, которого тест не задал, — вызываемый no-op; `then`
// пуст, чтобы `await ctx.x` не принял заглушку за промис.
const loose = (fields = {}) =>
  new Proxy(fields, {
    get: (t, k) =>
      k in t || typeof k === "symbol" || k === "then" ? t[k] : loose(async () => undefined),
  });

const created = (sessionID, directory) => {
  const location = { directory, workspaceID: undefined };
  return {
    type: "session.created",
    location,
    data: { sessionID, projectID: `prj-${sessionID}`, location },
  };
};

/**
 * Грузит плагин из файла (каталог его модуля — <own>/.opencode/plugins) с ctx.location
 * = own и отдаёт по session.created на сессию в own и в foreign. Возвращает число
 * записей в каждую: всякий вызов ctx.session.*, кроме чтений, с этим sessionID.
 */
export async function probeScope(file, { own, foreign }) {
  const dirs = { mine: own, theirs: foreign };
  const writes = { mine: 0, theirs: 0 };
  const reads = new Set(["get", "list", "messages", "children", "status"]);
  const session = new Proxy(
    {},
    {
      get: (_, k) => {
        if (typeof k === "symbol" || k === "then") return undefined;
        if (k === "get")
          return async ({ sessionID } = {}) =>
            dirs[sessionID] ? { id: sessionID, location: { directory: dirs[sessionID] } } : null;
        if (reads.has(k)) return async () => [];
        return async (arg) => {
          if (arg?.sessionID in writes) writes[arg.sessionID] += 1;
        };
      },
    },
  );
  const ctx = loose({
    location: { directory: own, workspaceID: undefined },
    session,
    tool: loose({ hook: async () => undefined }),
    event: loose({
      subscribe: ({ signal } = {}) =>
        (async function* () {
          yield created("mine", own);
          yield created("theirs", foreign);
          if (signal) await new Promise((r) => signal.addEventListener("abort", r));
        })(),
    }),
  });
  const mod = await import(`${pathToFileURL(file).href}?scope=${Date.now()}`);
  const plugin = mod.default ?? Object.values(mod).find((v) => typeof v?.setup === "function");
  if (typeof plugin?.setup !== "function") throw new Error("нет default-экспорта { setup }");
  const cleanup = await plugin.setup(ctx);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  if (typeof cleanup === "function") await cleanup();
  return writes;
}

/** Блоки ```js из markdown, похожие на плагин OpenCode 2: default-экспорт с setup(ctx). */
export const pluginSamples = (md) =>
  [...md.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((b) => /export default/.test(b) && /setup\s*\(\s*ctx\s*\)/.test(b));

/** Кладёт образец в <own>/.opencode/plugins под временным корнем; foreign — соседний каталог. */
export function stage(source, name = "iskron-rituals.js") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ritual-scope-")));
  const own = join(root, "own");
  const foreign = join(root, "foreign");
  const plugins = join(own, ".opencode", "plugins");
  mkdirSync(plugins, { recursive: true });
  mkdirSync(foreign);
  const file = join(plugins, name);
  writeFileSync(file, source);
  return { file, own, foreign };
}

async function audit(repo) {
  const own = realpathSync(repo);
  const dir = join(own, ".opencode", "plugins");
  let names;
  try {
    names = readdirSync(dir).filter((n) => /\.(m?js|ts)$/.test(n));
  } catch {
    return [];
  }
  const foreign = realpathSync(mkdtempSync(join(tmpdir(), "ritual-scope-foreign-")));
  const rows = [];
  for (const name of names) {
    const file = join(dir, name);
    try {
      const w = await probeScope(file, { own, foreign });
      const verdict = w.theirs > 0 ? "ДЫРА" : "ok";
      const note = w.mine > 0 ? "" : " (в свою сессию не пишет)";
      rows.push({
        bad: w.theirs > 0,
        line: `${verdict}  ${file}  чужая ${w.theirs}, своя ${w.mine}${note}`,
      });
    } catch (e) {
      rows.push({ bad: true, line: `не проверен  ${file}  ${e?.message ?? e}` });
    }
  }
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repos = process.argv.slice(2);
  if (repos.length === 0) {
    console.error("usage: check-ritual-scope.mjs <репо>...");
    process.exit(2);
  }
  let bad = false;
  for (const repo of repos) {
    for (const row of await audit(repo)) {
      bad ||= row.bad;
      process.stdout.write(`${row.line}\n`);
    }
  }
  process.exit(bad ? 1 : 0);
}
