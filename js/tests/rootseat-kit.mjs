// Корень OpenCode под пробой автопосадки (rootseat.test.mjs): НАСТОЯЩИЙ плагин dev-сборки
// против подставного контекста OpenCode 2, его НАСТОЯЩИЕ мосты против подставного сервера
// ownseat-kit — и сценарный провайдер: место, где OpenCode отпускает модельный запрос.
//
// Ход сессии (turn) идёт порядком хуков @opencode/plugin 2.0.x (dist/effect/session.d.ts,
// SessionHooks): prompt → context → model.request, каждый дожидается своих колбэков; только
// за ними — провайдер. Провайдер снимает доску подставного сервера В МИГ запроса: какие места
// этой роли слушают открытым сокетом. Сценарий провайдера может попросить вызов тула — кит
// исполняет его зарегистрированным execute, как OpenCode исполняет tool-call модели.
//
// Холодная загрузка — сессия есть на диске (session.get её читает), но session.created ушло
// до setup экземпляра: кит его просто не шлёт (create(..., {emit: false})).
//
// Предел: порядок хуков взят из типов SDK, не наблюдён на живом OpenCode; провайдер — не сеть.
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { BUILT_BRIDGE, BUILT_PLUGIN } from "./built.mjs";
import { PAT } from "./ownseat-kit.mjs";

/** The bridge under probe, fixed at load: a probe that names another (none) does not leak into the next. */
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
/** Variables a probe may set for one instance; every instance starts without them. */
const PER_PROBE = ["ISKRON_ROOT_SEAT_MS"];
const SANDBOX = mkdtempSync(join(tmpdir(), "iskron-rootseat-"));
const COPY = join(SANDBOX, "iskron.js");
copyFileSync(process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, COPY);
process.on("exit", () => rmSync(SANDBOX, { recursive: true, force: true }));
let seq = 0;

/** Обложка AGENTS.md: плоский YAML-фронтматтер (skills/iskronify/references/agents-template.md). */
export const frontmatter = (pairs) =>
  `---\n${Object.entries(pairs)
    .map(([k, v]) => `'${k}': '${String(v).replace(/'/g, "''")}'`)
    .join("\n")}\n---\n# проба\n`;
/** Ключи графа и роли — как в живом AGENTS.md iskron/skills и в шаблоне iskronify. */
export const GRAPH_KEY = "Граф";
export const ROLE_KEY = "Роль агента";
/** Значения дословно из живого AGENTS.md: в роли кроме #931 названы контур #1506 и соседнее репо #844. */
export const COVER = {
  Nature: "library",
  [GRAPH_KEY]: "@nks/nks-dev (r5)",
  [`${GRAPH_KEY} — источник`]: "согласовано: владелец",
  [ROLE_KEY]:
    '`#931 «👨‍💻 Разработчик скилл-репозиториев агента»` — adhikarin, стюард #1506 (и соседнего скилл-репо #844); инбокс `iskron_orient(realm="@nks/nks-dev", focus="931")`',
  [`${ROLE_KEY} — источник`]: "согласовано: владелец",
};
export const writeAgents = (dir, pairs = COVER) =>
  writeFileSync(join(dir, "AGENTS.md"), frontmatter(pairs));

const SAME_GRAPH = new Set(["@nks/nks-dev", "nks-dev", "r5"]);
/** Места роли karta в графе nks-dev, которые слушают открытым сокетом сейчас; karta=null — любые. */
export function heardSeats(fake, karta = "931") {
  const open = new Set([...fake.state.ws].map((s) => fake.state.wsNames.get(s)));
  return [...fake.state.places.values()]
    .filter((p) => open.has(p.name))
    .filter((p) => karta === null || String(p.karta) === karta)
    .filter(
      (p) => karta === null || p.realm === undefined || SAME_GRAPH.has(String(p.realm).trim()),
    )
    .map((p) => p.name)
    .sort();
}

/** Имена мест из записей держания каталога гранта dir, которые стояла сессия session. */
export function heldBy(dir, session) {
  let files;
  try {
    files = readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".hold"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, "standings", f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.session === session && !r.left)
    .map((r) => r.name)
    .sort();
}

/**
 * Экземпляр плагина в project для учётки подставного сервера ownseat-kit (fake, dir — каталог
 * гранта); мосты плагина — настоящие, из этой рабочей копии. env — переменные этого экземпляра
 * (другой мост, срок посадки).
 */
export async function rootPlugin({ fake, dir }, project, env = {}) {
  for (const k of PER_PROBE) delete process.env[k];
  Object.assign(process.env, {
    ISKRON_BRIDGE_PATH: BRIDGE,
    ISKRON_BRIDGE_URL: fake.mcpUrl,
    ISKRON_BRIDGE_TOKEN: PAT,
    ISKRON_BRIDGE_NO_BROWSER: "1",
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_DAEMON: "0",
    ISKRON_BRIDGE_AUTH_DIR: dir,
    HOME: SANDBOX,
    ...env,
  });
  const def = (await import(`${pathToFileURL(COPY).href}?n=${++seq}`)).default;
  const sessions = new Map(); // id → { id, parentID?, location }
  const hooks = {};
  const prompts = []; // ctx.session.prompt и synthetic — слова плагина в сессию
  const tools = { list: new Map(), transforms: [] };
  const replay = () => {
    const m = new Map();
    const editor = {
      add: (d) => m.set(d.name, d),
      remove: (id) => m.delete(id),
      get: (id) => m.get(id),
      list: () => [...m.values()],
      update() {},
      namespace() {},
    };
    for (const t of tools.transforms) t(editor);
    tools.list = m;
  };
  const queue = [];
  let wake = null;
  const hook = (prefix) => async (name, cb) => {
    (hooks[`${prefix}${name}`] ??= []).push(cb);
    return { dispose: async () => {} };
  };
  const said = (o) => void prompts.push({ sessionID: o?.sessionID, text: String(o?.text ?? "") });
  const ctx = {
    app: { name: "opencode", version: "2.0.24-rootseat", channel: "latest" },
    location: { directory: project },
    tool: {
      transform: async (cb) => {
        tools.transforms.push(cb);
        replay();
        return { dispose: async () => {} };
      },
      reload: async () => replay(),
      hook: hook("tool."),
    },
    permission: { hook: hook("permission.") },
    command: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
    session: {
      get: async ({ sessionID }) => {
        const s = sessions.get(sessionID);
        if (!s) throw new Error(`Session not found: ${sessionID}`);
        return s;
      },
      prompt: async (o) => (said(o), {}),
      synthetic: async (o) => (said(o), { id: `syn-${prompts.length}`, type: "synthetic" }),
      create: async (o) => ({ id: `ka-${++seq}`, parentID: o?.parentID }),
      remove: async () => {},
      move: async () => {},
      interrupt: async () => ({ interrupted: true }),
      hook: hook(""),
    },
    skill: { list: async () => ({ location: { directory: SANDBOX }, data: [] }) },
    model: { list: async () => [{ id: "m1", providerID: "p", limit: { context: 200000 } }] },
    event: {
      subscribe: async function* ({ signal } = {}) {
        while (!signal?.aborted) {
          if (queue.length) {
            yield queue.shift();
            continue;
          }
          await new Promise((r) => {
            wake = r;
            signal?.addEventListener("abort", r, { once: true });
          });
        }
      },
    },
  };
  const stderr = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => (stderr.push(String(chunk)), write(chunk, ...rest));
  let cleanup = null;
  try {
    cleanup = await def.setup(ctx);
  } catch (e) {
    process.stderr.write = write;
    throw e;
  }
  const emit = (ev) => {
    queue.push(ev);
    wake?.();
  };

  return {
    tools: () => tools.list,
    said: () => stderr.join(""),
    /** Слова плагина в сессию мимо промпта (prompt/synthetic). */
    wordsTo: (id) => prompts.filter((p) => p.sessionID === id).map((p) => p.text),
    /** Сессия есть в project; emit=false — её session.created ушло до загрузки экземпляра. */
    create(id, { parentID, emit: send = true } = {}) {
      const s = { id, location: { directory: project }, ...(parentID ? { parentID } : {}) };
      sessions.set(id, s);
      const data = { sessionID: id, projectID: "prj", location: s.location, title: "проба" };
      if (parentID) data.parentID = parentID;
      if (send) emit({ type: "session.created", location: s.location, data });
    },
    /** Сессию удалили (session.deleted). */
    remove(id) {
      const s = sessions.get(id);
      sessions.delete(id);
      emit({ type: "session.deleted", location: s?.location, data: { sessionID: id } });
    },
    /**
     * Ход сессии: prompt-хуки, context-хуки, model.request-хуки — и провайдер. scenario(req)
     * отвечает [{tool, input}] — вызовы тулов модели, по порядку; иначе текстом.
     * Возвращает доску в миг запроса и то, что модель прочла.
     */
    async turn(sessionID, text, scenario = () => []) {
      const t0 = Date.now();
      const p = { sessionID, messageID: `msg-${++seq}`, prompt: { text }, delivery: "queue" };
      for (const cb of hooks.prompt ?? []) await cb(p);
      const model = { id: "m1", providerID: "p" };
      const req = {
        sessionID,
        agent: "build",
        model,
        system: [],
        messages: [{ role: "user", content: p.prompt.text }],
        options: {},
        tools: {},
      };
      for (const cb of hooks.context ?? []) await cb(req);
      const mr = { sessionID, agent: "build", model, kind: "primary", headers: {} };
      for (const cb of hooks["model.request"] ?? []) await cb(mr);
      // ── провайдер: запрос ушёл ──
      const atRequest = {
        ms: Date.now() - t0, // сколько хуки держали запрос
        seats: heardSeats(fake),
        connects: fake.state.placeArgs.filter((a) => a.action === "connect").map((a) => a.name),
        words: prompts.filter((w) => w.sessionID === sessionID).map((w) => w.text),
      };
      const calls = [];
      for (const c of scenario(req) ?? []) {
        // Список тулов сервера приходит в фоне: модель зовёт тул, когда OpenCode его уже показал.
        for (const end = Date.now() + 15_000; !tools.list.has(c.tool) && Date.now() < end;)
          await new Promise((r) => setTimeout(r, 50));
        const t = tools.list.get(c.tool);
        if (!t) {
          calls.push({ ...c, error: `tool ${c.tool} is not registered` });
          continue;
        }
        try {
          const out = await t.execute(c.input, {
            sessionID,
            agent: "build",
            messageID: p.messageID,
            id: `call-${++seq}`,
          });
          calls.push({ ...c, content: out?.content });
        } catch (e) {
          calls.push({ ...c, error: e.message });
        }
      }
      const system = req.system.map((s) => s.text ?? "").join("\n");
      const added = p.prompt.text === text ? "" : p.prompt.text.replace(text, "");
      return {
        atRequest,
        calls,
        prompt: p.prompt.text,
        system,
        told: [added, system, ...atRequest.words].join("\n").trim(),
      };
    },
    async stop() {
      try {
        await cleanup?.();
      } finally {
        process.stderr.write = write;
      }
    },
  };
}
