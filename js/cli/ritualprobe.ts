// Прогон области плагина ритуалов OpenCode (граф nks-dev, узлы #6686, #5048).
// Поток ctx.event.subscribe один на сервер OpenCode машины: экземпляр видит
// session.created всех каталогов — его область и проверяется. Хуки ctx.tool.hook
// будит только вызов в каталоге экземпляра (наблюдено на 2.0.24): они гоняются в
// своей сессии и судятся лишь на поломку. Каталог экземпляра даётся через
// символическую ссылку, а события несут настоящий путь: так же /tmp и
// /private/tmp расходятся живьём, и сырое сравнение строк теряет свою сессию.
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { type Fn, runHooks, type Who } from "./ritualcalls.ts";

const SETTLE_MS = 200;
const SETUP_MS = 5000;

/** Чем плагин задел сессии: записи на событиях потока и поломки хуков тулов. */
export interface Scope {
  /** Записи в сессию на session.created. */
  writes: Record<Who, number>;
  /** Хук тула сломан в своей сессии: ошибка кода (ReferenceError…), бросок на обычной записи или после вызова. */
  broken: string[];
  /** В своей сессии guard бросил на записи в путь памяти. */
  ownBefore: boolean;
  /** Хук после пуша в своей сессии дописал результат. */
  ownAfter: boolean;
}

// Член ctx, которого прогон не задал, — вызываемый no-op; `then` пуст, чтобы
// `await ctx.x` не принял заглушку за промис.
const loose = (fields: object = {}): object =>
  new Proxy(fields, {
    get: (t, k) =>
      k in t || typeof k === "symbol" || k === "then"
        ? (t as Record<PropertyKey, unknown>)[k]
        : loose(async () => undefined),
  });

// Образец может держать «сказано однажды» на globalThis — общим для всех экземпляров
// процесса, как на живом сервере. Ревизор гоняет плагины и прогоны одним процессом:
// перед каждым прогоном добавленное плагинами снимается, id сессий — свои у прогона.
const baseline = new Set(Reflect.ownKeys(globalThis));
const dropPluginGlobals = (): void => {
  const g = globalThis as Record<PropertyKey, unknown>;
  for (const k of Reflect.ownKeys(globalThis)) if (!baseline.has(k)) delete g[k];
};
let probes = 0;

const created = (sessionID: string, directory: string) => {
  const location = { directory };
  return {
    type: "session.created",
    location,
    data: { sessionID, projectID: `prj-${sessionID}`, location },
  };
};

const settle = (ms = SETTLE_MS) => new Promise((r) => setTimeout(r, ms));

/** Грузит плагин из файла с ctx.location — ссылкой на own — и проверяет его против сессий own и foreign. */
export async function probeScope(file: string, own: string, foreign: string): Promise<Scope> {
  dropPluginGlobals();
  const tag = ++probes;
  const id: Record<Who, string> = { mine: `mine@${tag}`, theirs: `theirs@${tag}` };
  const whoOf = (sessionID?: string): Who | undefined =>
    sessionID === id.mine ? "mine" : sessionID === id.theirs ? "theirs" : undefined;
  const dirs: Record<Who, string> = { mine: own, theirs: foreign };
  const writes: Record<Who, number> = { mine: 0, theirs: 0 };
  const hooks: Record<string, Fn[]> = {};
  const reads = new Set(["get", "list", "messages", "children", "status"]);
  const session = new Proxy(
    {},
    {
      get: (_, k) => {
        if (typeof k === "symbol" || k === "then") return undefined;
        if (k === "get")
          return async ({ sessionID }: { sessionID?: string } = {}) => {
            const who = whoOf(sessionID);
            return who ? { id: sessionID, location: { directory: dirs[who] } } : null;
          };
        if (reads.has(k)) return async () => [];
        return async (arg?: { sessionID?: string }) => {
          const who = whoOf(arg?.sessionID);
          if (who) writes[who] += 1;
        };
      },
    },
  );
  const alias = join(mkdtempSync(join(tmpdir(), "ritual-scope-alias-")), "own");
  symlinkSync(own, alias, "dir");
  const ctx = loose({
    location: { directory: alias },
    session,
    tool: loose({ hook: async (name: string, fn: Fn) => void (hooks[name] ??= []).push(fn) }),
    event: loose({
      subscribe: ({ signal }: { signal?: AbortSignal } = {}) =>
        (async function* () {
          yield created(id.mine, own);
          yield created(id.theirs, foreign);
          if (signal) await new Promise((r) => signal.addEventListener("abort", r));
        })(),
    }),
  });
  const mod = (await import(`${pathToFileURL(file).href}?scope=${Date.now()}`)) as Record<
    string,
    unknown
  >;
  const plugin = (mod.default ??
    Object.values(mod).find((v) => typeof (v as { setup?: unknown })?.setup === "function")) as
    { setup?: (c: object) => unknown } | undefined;
  if (typeof plugin?.setup !== "function") throw new Error("no default export { setup }");
  let timer: NodeJS.Timeout | undefined;
  const cleanup = await Promise.race([
    plugin.setup(ctx),
    new Promise(
      (_, no) =>
        (timer = setTimeout(
          () => no(new Error(`setup did not return in ${SETUP_MS} ms`)),
          SETUP_MS,
        )),
    ),
  ]).finally(() => clearTimeout(timer));
  await settle();
  const onEvents = { ...writes };
  const mine = await runHooks(hooks, id.mine);
  await settle(50);
  if (typeof cleanup === "function") await cleanup();
  return {
    writes: onEvents,
    broken: mine.broken,
    ownBefore: mine.hit.some(
      (h) => h.startsWith("execute.before write: throw") && !mine.broken.includes(h),
    ),
    ownAfter: mine.hit.includes("execute.after bash: changed"),
  };
}
