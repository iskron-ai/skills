// The recall scene shared by the runners (OpenCode scripts/stand-run-recall.mjs, pi
// scripts/stand-run-pi.mjs): the scene bridge of the same account, the fixture laid in the
// graph and taken off at the end, the tee journal readers (per bridge pid), the prompt texts —
// h is scene (д) of case №2302 word for word, f the multi-actor intake with its --fixed-brief
// wrapper — and the report/verdict machinery. Nothing here touches a harness: sessions and
// turns are the runners' business.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intakePrompts } from "./stand-recall-intake.mjs";

/** Modes of every scene node: observed, running, held without a stance. */
export const SCENE_MODES = { epistemic_mode: "pratyakshita", ontic_mode: "vartamana", volitive_mode: "upeksha" };

/** The fact the probes turn on, in both wordings (case №2302): with and without the question's word. */
export const SCENE_FACTS = {
  word: {
    name: "⏱️ Таймаут очереди импорта — 45 секунд",
    description: "Таймаут очереди импорта — 45 секунд: дольше задача ждёт воркера и уходит в повтор. Решено 45 с; вариант 30 с отвергнут — крупные каталоги поставщиков не успевали.",
  },
  plain: {
    name: "⏱️ Сколько очередь импорта ждёт воркера: 45 секунд",
    description: "Очередь импорта ждёт ответа воркера не дольше 45 секунд, затем задача уходит в повтор. Решено 45 с; вариант 30 с отвергнут — крупные каталоги поставщиков не успевали.",
  },
};

/** The node id a tool's answer names; null when it names none. */
export const idOf = (text) => (text.match(/\(#(\d+)[,)]/) || [])[1];
/** `#42`, `42` and whitespace variants → `42`. */
export const nodeOf = (v) => String(v ?? "").replace(/^#/, "").trim();

/**
 * The seatless bridge of the same account: lays and takes off the scene, holds the brother seat.
 * `token` — the run's PAT (it goes into the bridge's own auth dir, mode 0600); `name` — the
 * clientInfo the bridge sees. `problem` records a shutdown that needed force.
 */
export function stdioBridge({ run, bridge, env, token, name = "stand-run-recall", problem }) {
  const dir = join(run, "auth-person");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "token"), token + "\n", { mode: 0o600 });
  const child = spawn(process.execPath, [bridge], { env: { ...env, ISKRON_BRIDGE_AUTH_DIR: dir }, stdio: ["pipe", "pipe", "ignore"] });
  let childError;
  child.on("error", (e) => { childError = e; });
  child.stdin.on("error", (e) => { childError = e; });
  const rep = new Map();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const msg = JSON.parse(l);
        if (msg.id !== undefined && !msg.method) rep.set(msg.id, msg);
      } catch {}
    }
  });
  let id = 1;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const req = async (method, params) => {
    const my = id++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n");
    for (let t = 0; t < 900; t++) {
      if (childError || child.exitCode !== null || child.signalCode !== null) throw new Error(`scene bridge stopped: ${childError?.code ?? child.exitCode ?? child.signalCode}`);
      if (rep.has(my)) { const value = rep.get(my); rep.delete(my); return value; }
      await sleep(100);
    }
    throw new Error(`scene bridge: no reply to ${method}`);
  };
  return {
    dir,
    async init() {
      await req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "0" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    },
    async call(name2, args) {
      const r = await req("tools/call", { name: name2, arguments: args });
      return { text: (r.result?.content ?? []).map((c) => c.text ?? "").join("\n") || (r.error?.message ?? ""), error: !!(r.error || r.result?.isError) };
    },
    async close() {
      if (childError || child.exitCode !== null || child.signalCode !== null) return;
      const done = new Promise((r) => child.once("exit", r));
      child.stdin.end();
      await Promise.race([done, sleep(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await Promise.race([done, sleep(5000)]);
      }
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); problem("scene bridge required SIGKILL"); await Promise.race([done, sleep(5000)]); }
    },
  };
}

/** The tee's journal lines, parsed; empty when the journal does not exist yet. */
export function teeLines(teeLog) {
  return existsSync(teeLog) ? readFileSync(teeLog, "utf8").split("\n").filter(Boolean) : [];
}

/**
 * The tee's tools/call requests with their answers — from line `mark` on. Each entry:
 * { t, pid, key, name, args, text, error }. Service calls (the extension's own, e.g. the launch
 * line's stand/join) are journaled like any other tools/call — attribution to a process is by
 * `pid`: one tee per bridge, one bridge per process.
 */
export function teeCalls(teeLog, mark = 0) {
  const reqs = [];
  const answers = new Map();
  for (const l of teeLines(teeLog).slice(mark)) {
    let e, m;
    try {
      e = JSON.parse(l);
      m = JSON.parse(e.line);
    } catch {
      continue;
    }
    const key = `${e.pid}:${m.id}`;
    if (e.dir === "plugin→bridge" && m.method === "tools/call" && !String(m.id).startsWith("iskron-service-"))
      reqs.push({ t: e.t, pid: e.pid, key, name: m.params?.name, args: m.params?.arguments ?? {} });
    else if (e.dir === "bridge→plugin" && m.id !== undefined && !m.method) answers.set(key, m);
  }
  return reqs.map((r) => {
    const a = answers.get(r.key);
    return { ...r, text: (a?.result?.content ?? []).map((c) => c.text ?? "").join("\n"), error: !a || !!(a.error || a.result?.isError) };
  });
}

/**
 * The bridges the tee saw, one entry per pid: when it was born (first journaled line), when it
 * said initialize, when it went quiet, how many lines. A child process's bridges are born inside
 * its parent's bash tool window; the first bridge of the run belongs to the root process.
 */
export function teeBridges(teeLog, mark = 0) {
  const byPid = new Map();
  for (const l of teeLines(teeLog).slice(mark)) {
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    const b = byPid.get(e.pid) ?? { pid: e.pid, firstAt: e.t, initializeAt: null, lastAt: e.t, lines: 0 };
    b.lines++;
    b.lastAt = e.t;
    if (!b.initializeAt) {
      try {
        if (JSON.parse(e.line).method === "initialize") b.initializeAt = e.t;
      } catch {}
    }
    byPid.set(e.pid, b);
  }
  return [...byPid.values()].sort((x, y) => Date.parse(x.firstAt) - Date.parse(y.firstAt));
}

/** The report, the verdicts and the failure count; `problem` records a blocker and fails the run. */
export function makeReporters() {
  const verdicts = [];
  const report = [];
  let failed = 0;
  const problem = (text) => { verdicts.push(`BLOCKER ${text}`); report.push(`BLOCKER ${text}`); failed++; };
  const verdict = (ok, what, seen) => {
    verdicts.push(`${ok ? "PASS" : "FAIL"} ${what}${seen ? ` — ${String(seen).slice(0, 300)}` : ""}`);
    if (!ok) failed++;
  };
  /** A verdict that is not the runner's to give (semantic acceptance stays with the human). */
  const provisional = (text) => { verdicts.push(text); failed++; };
  /** An interrupted run: the error is the outcome, the setup phase names whose refusal it was. */
  const error = (text, setupPhase) => { verdicts.push(`ERROR${setupPhase ? " (setup)" : ""} ${text}`); failed++; };
  return { verdicts, report, problem, verdict, provisional, error, count: () => failed };
}

/**
 * Lay the scene into the graph through the scene bridge. The caller owns `scene` and `laid`
 * (both passed in and mutated in place): a failure mid-layout leaves every node laid so far in
 * `laid` for the runner's cleanup to take off in reverse. Returns { factOn, take } — `factOn`
 * swaps the fact's wording (word/plain) and waits the search index in; `take` takes one node
 * off, keeping `laid` in step. The scene: kartas (agent, human, steward of the foreign contour),
 * the own and the foreign holon, the file phenomenon, the loading kriya, the brother seat of the
 * agent's role, and the project AGENTS.md in `cwd` naming the graph and the roles.
 */
export async function layScene(P, { realm, stamp, cwd, report, problem, requireEmpty = false, sleep, scene = {}, laid = [] }) {
  const add = async (tool, args) => {
    const r = await P.call(tool, { realm, ...args });
    const id = idOf(r.text);
    if (r.error || !id) throw new Error(`${tool} ${args.name}: ${r.text.slice(0, 300)}`);
    laid.push(id);
    return id;
  };
  const take = async (id) => {
    const v = ((await P.call("iskron_look", { realm, node_id: `#${id}` })).text.match(/\(#\d+, [^,)]+, v(\d+)\)/) || [])[1];
    const r = v ? await P.call("iskron_delete_node", { realm, node_id: `#${id}`, basis_version: v, reasoning: "stand-run-recall: the scene is taken off" }) : { error: true, text: "no version" };
    if (r.error) problem(`scene: #${id} not taken off — ${r.text.slice(0, 160)}`);
    else laid.splice(laid.indexOf(id), 1);
  };
  if (requireEmpty) {
    const empty = await P.call("iskron_search", { realm, q: "", limit: 1 });
    report.push(`pre-fixture empty graph check: ${empty.text}`);
    if (empty.error || /#\d+/.test(empty.text)) throw new Error("--require-empty: graph is not demonstrably empty before fixture creation");
  }
  const M = SCENE_MODES;
  scene.variant = null;
  scene.fact = null;
  scene.agent = await add("iskron_add_karta", {
    name: "🧪 Разработчик импорта каталогов",
    motivation: "Ведёт импорт каталогов поставщиков: правит загрузку и её настройки, отвечает за то, чтобы каталоги доходили целиком.",
    manifested_as: "adhikarin",
    ...M,
  });
  scene.human = await add("iskron_add_karta", {
    name: "🧪 Владелец продукта каталогов",
    motivation: "Решает, что входит в выпуск и какие фичи берутся, отвечает за продукт каталогов перед клиентами.",
    manifested_as: "svatantra",
    ...M,
  });
  scene.steward = await add("iskron_add_karta", {
    name: "🧪 Разработчик фоновых очередей",
    motivation: "Держит фоновые очереди задач: их ожидание, повторы и пропускную способность для всех, кто ставит туда задачи.",
    manifested_as: "adhikarin",
    ...M,
  });
  const steward = (k) => [{ arrow_type: "steward", target: `#${k}`, direction: "from", volitive_mode: "upeksha", sense: "кто держит границу" }];
  scene.own = await add("iskron_add_holon", {
    name: "📦 Импорт каталогов поставщиков",
    description: "Что внутри: загрузка каталогов поставщиков и её настройки; снаружи — очереди, в которые она ставит задачи, и витрина, читающая итог.",
    ...M,
    arrows: steward(scene.agent),
  });
  scene.foreign = await add("iskron_add_holon", {
    name: "🧵 Фоновые очереди задач",
    description: "Что внутри: очереди фоновых задач, их ожидание, повторы и пропускную способность; снаружи — те, кто ставит задачи и читает итог.",
    ...M,
    arrows: steward(scene.steward),
  });
  scene.file = await add("iskron_add_phenomenon", {
    name: "📄 Файл каталога поставщика",
    description: "Файл каталога, который поставщик выкладывает на загрузку: позиции, цены, остатки.",
    given_as: "ding",
    ...M,
    arrows: [{ arrow_type: "context", target: `#${scene.own}`, volitive_mode: "upeksha", sense: "вход импорта" }],
  });
  scene.kriya = await add("iskron_add_kriya", {
    name: "📥 Загрузка каталога поставщика в очередь импорта",
    description: "Файл каталога лежит у поставщика → позиции каталога стоят задачами в очереди импорта с выставленным временем ожидания ответа воркера.",
    ...M,
    arrows: [
      { arrow_type: "ahara", target: `#${scene.file}`, volitive_mode: "upeksha", sense: "что загрузка съедает" },
      { arrow_type: "actor", target: `#${scene.agent}`, volitive_mode: "upeksha", sense: "кто загружает" },
    ],
  });
  // The brother: another seat of the agent's role, held by the scene bridge.
  scene.brother = `recall-${stamp}.brother`;
  const b = await P.call("iskron_stand", { realm, karta: `#${scene.agent}`, name: scene.brother, model: "stand-run" });
  if (b.error) throw new Error(`brother seat: ${b.text.slice(0, 300)}`);
  writeFileSync(join(cwd, "AGENTS.md"), sceneAgentsMd(scene, realm));
  report.push(`scene: agent #${scene.agent} · human #${scene.human} · foreign steward #${scene.steward} · own #${scene.own} · foreign #${scene.foreign} · kriya #${scene.kriya} · brother ${scene.brother}`);
  const state = { variant: null, fact: null };
  const factOn = async (variant) => {
    if (state.variant === variant) return state.fact;
    if (state.fact) await take(state.fact);
    state.fact = await add("iskron_add_phenomenon", {
      ...SCENE_FACTS[variant],
      given_as: "grundsatz",
      ...M,
      volitive_mode: "adhimoksha",
      arrows: [{ arrow_type: "context", target: `#${scene.foreign}`, volitive_mode: "upeksha", sense: "решение границы очередей" }],
    });
    state.variant = variant;
    scene.variant = variant;
    scene.fact = state.fact;
    await sleep(20_000); // the search index takes the fresh node in
    return state.fact;
  };
  return { factOn, take, add };
}

/** The project AGENTS.md of the scene: the cover the root agent reads before its first move. */
export function sceneAgentsMd(scene, realm) {
  return `---\n'Граф': '${realm}'\n'Граф — источник': 'согласовано: владелец'\n'Фокус-контур': '\`#${scene.own} «📦 Импорт каталогов поставщиков»\`'\n'Роль агента': '\`#${scene.agent} «🧪 Разработчик импорта каталогов»\` — adhikarin, стюард #${scene.own}'\n'Роль агента — источник': 'согласовано: владелец'\n'Роль владельца': '\`#${scene.human} «🧪 Владелец продукта каталогов»\` (svatantra)'\n---\n# Импорт каталогов поставщиков\n\nСервис загрузки каталогов поставщиков.\n\n*(iskronify: контракт 36, штамп 2026-10-29)*\n`;
}

/** The f and g intake prompts of the scene (stand-recall-intake.mjs). */
export const fPrompts = intakePrompts;

/**
 * The f prompt with a fixed brief (case №2394 [18]): the ingester's brief, the same for every
 * model compared; the root lays it word for word, filling only the four placeholders.
 */
export function fixedBriefPrompt(full, scene, fixedBrief) {
  return `${full}\n\nНабросок и постановка ingester уже готовы — свой набросок не пиши и граф до запуска не правь, кроме шагов ниже. (1) Запиши исток ding-феноменом «🗣️ Рассказ о повторяемом импорте каталогов» (source_kind=shabda, context #${scene.own}) с полным текстом рассказа. (2) Открой дочернее дело на впуск. (3) Запусти ingester с постановкой ДОСЛОВНО из текста ниже, подставив только {REALM} — адрес графа, {SEAT} — твоё место, {CASE} — номер дочернего дела, {SOURCE} — номер истока. (4) По отчёту сам прочти полученные узлы и сравни их с рассказом.\n\nПОСТАНОВКА:\n${fixedBrief}`;
}

/** Scene (д) of case №2302 word for word — the recaller probe, run as run on 7.26.0 (case №2394 [14]). */
export const H_PROMPT =
  "Нужно узнать записанный таймаут очереди импорта. Делегируй поиск настоящему recaller через инструмент запуска субагента. В постановке укажи, что ищем, по чему признаем ответ найденным и где ты уже искал (если ещё нигде — так и напиши). Пусть ищет в графе, не спрашивая брата или человека через дело или канал. Перед тем как опереться на ответ recaller, сам открой найденный узел. Какой таймаут ставить и почему?";
