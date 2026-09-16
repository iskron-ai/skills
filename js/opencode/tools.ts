// Половина «тулы» — тулы Искрона через мост, каждый под своим именем,
// и МОСТ НА КАЖДУЮ СЕССИЮ (граф nks-dev: #4283).
//
// Плагин сам говорит с мостом по MCP stdio и регистрирует КАЖДЫЙ тул сервера
// через ctx.tool.transform под его собственным именем. Нативная запись `mcp`
// в конфиге OpenCode для этого не годится: тулы MCP-сервера OpenCode именует
// <сервер>_<тул>, и весь корпус, зовущий iskron_orient, получил бы
// iskron_iskron_orient — каждая фраза скилла стала бы ложной.
//
// Сервер OpenCode держит много сессий, и каждая — отдельный агент со своим
// стоянием; мост же держит одно стояние и одну MCP-сессию к графу. Поэтому
// у каждой корневой сессии свой процесс моста: её connect держит её сокет, её
// register привязывает её MCP-сессию, её кадры приходят ей. Дочерние сессии
// (субагенты) идут через мост родителя — как в Claude Code, где субагент
// делит MCP-сервер с сессией, что его породила.
//
// Список тулов — состояние трансформа, а не карта, отданная раз при загрузке:
// setup входа не ждёт (тулы из прошлого списка сразу, служебный iskron_bridge
// всегда), а список с сервера приходит фоном и подменяется через
// ctx.tool.reload() — сколько бы ни длился вход человека.
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { Bridge, resultToContent, toParameters } from "../shared/bridge-client.ts";
import { OPENCODE_CLIENT } from "../shared/clients.ts";
import { homeBridgePath } from "../shared/home.ts";
import type { Context } from "./plugin.ts";

export type Say = (text: string, level: "info" | "warning" | "error") => void;

/** Потолок самого рукопожатия; истёк — рукопожатие повторяется, не сдаётся. */
const HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 600000);
/** Как часто переспрашивать мост, пока человек входит в браузере. */
const AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 2000);
/**
 * Отказ моста без гранта. Это не поломка, а вход в процессе: мост открыл
 * браузер и слушает колбэк на loopback, погасить его — убить вход человека
 * (граф nks-dev: #4712).
 */
const AUTH_PENDING = /authorization required/i;
/** Мост сессии, которая давно молчит и ничего не держит, отпускается. */
const IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 60_000);
/** Шаг жнеца простоя; переменная — для проб. */
const REAP_MS = Number(process.env.ISKRON_BRIDGE_REAP_MS || 60_000);
const PROTOCOL = "2025-06-18";
/** Служебный тул плагина: состояние моста, когда тулов iskron_* ещё нет. */
export const STATUS_TOOL = "iskron_bridge";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

/** Мост одной сессии. */
export interface Slot {
  bridge: Bridge;
  /** Рукопожатие прошло — можно звать тулы. */
  ready: Promise<unknown>;
  /** Корневая сессия, которой принадлежит мост; null — ещё никому не отдан. */
  session: string | null;
  /** Мост держит стояние (attached без released) — такой не отпускают по простою. */
  holding: boolean;
  lastCall: number;
}

export interface ToolsHalf {
  /** Сессия умерла — её мост отпускается вместе со стоянием. */
  forget(session: string): void;
  stop(): void;
}

/**
 * Где мост: переменная, затем домашняя копия. Привезённой поставкой рядом нет —
 * плагин лежит копией в каталоге плагинов OpenCode, а не в пакете.
 */
export function findBridge(): { path: string | null; tried: string[] } {
  const tried: string[] = [];
  const env = process.env.ISKRON_BRIDGE_PATH?.trim();
  if (env) tried.push(resolve(env));
  tried.push(homeBridgePath());
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
      /* следующий */
    }
  }
  return { path: null, tried };
}

function authDir(): string {
  return process.env.ISKRON_BRIDGE_AUTH_DIR || join(homedir(), ".iskron-bridge");
}

function cachePath(): string {
  return join(authDir(), "opencode-tools.json");
}

/**
 * Отпечаток гранта — хранилища моста рядом с кэшем тулов. Сменился — человек
 * вошёл, и рукопожатие стоит повторить. Раньше не повторяется: вопрос к мосту
 * без гранта после конца его входа открыл бы человеку браузер заново.
 */
function grantStamp(): string {
  const dir = authDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "opencode-tools.json")
      .map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`)
      .sort()
      .join("|");
  } catch {
    return "";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readCache(): any[] | null {
  try {
    const list = JSON.parse(readFileSync(cachePath(), "utf8"));
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}

function writeCache(tools: any[]): void {
  try {
    mkdirSync(join(cachePath(), ".."), { recursive: true, mode: 0o700 });
    writeFileSync(cachePath(), JSON.stringify(tools), { mode: 0o600 });
  } catch {
    /* кэш — удобство, не обязательство */
  }
}

/** Ссылка входа из отказа моста, если он её назвал. */
function loginUrlOf(message: string): string | null {
  return /open in a browser: (\S+)/.exec(message)?.[1] ?? null;
}

/**
 * Рукопожатие. На отказ «нужен вход» мост отвечает сразу, а вход ждёт фоном;
 * рукопожатие повторяется, когда грант ляжет в хранилище. Потолок — HANDSHAKE_MS.
 * Успех снимает флаг входа всегда: грант мог лечь извне (токен в
 * ~/.iskron-bridge/token, вход из другого моста), не через этот слот.
 */
async function handshake(
  b: Bridge,
  onLogin: (url: string | null) => void,
  onReady: () => void,
): Promise<void> {
  const deadline = Date.now() + HANDSHAKE_MS;
  for (;;) {
    const stamp = grantStamp();
    try {
      await b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: OPENCODE_CLIENT, version: "1" },
        },
        { timeoutMs: Math.max(1, deadline - Date.now()) },
      );
      break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!AUTH_PENDING.test(message)) throw e;
      onLogin(loginUrlOf(message));
      while (grantStamp() === stamp) {
        if (Date.now() + AUTH_POLL_MS > deadline) throw e;
        await sleep(AUTH_POLL_MS);
      }
    }
  }
  onReady();
  b.notify("notifications/initialized");
}

async function listTools(b: Bridge): Promise<any[]> {
  const tools: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await b.request("tools/list", cursor ? { cursor } : {}, {
      timeoutMs: HANDSHAKE_MS,
    });
    for (const t of page?.tools ?? []) tools.push(t);
    cursor = page?.nextCursor;
  } while (cursor);
  return tools;
}

function textOf(result: any): string {
  return resultToContent(result)
    .map((c) => (c.type === "text" ? c.text : "[image]"))
    .join("\n");
}

export async function setupTools(
  ctx: Context,
  say: Say,
  onChannel: (session: string | null, params: any) => void,
  rootOf: (sessionID: string) => Promise<string>,
): Promise<ToolsHalf> {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " +
        found.tried.join(", ") +
        ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error",
    );
    return { forget() {}, stop() {} };
  }
  const path = found.path;

  const slots = new Map<string, Slot>();
  let spare: Slot | null = null;
  let stopped = false;

  // Человек в браузере: сказать один раз на вход. Вход кончился или мост
  // открыл новый (другая ссылка) — скажется снова.
  let loginPending = false;
  let loginUrl: string | null = null;
  // Вызов, ждущий рукопожатия, отпускается в миг, когда мост запросил вход:
  // человека внутри вызова не ждут, адрес уходит ответом.
  const loginWaiters = new Set<() => void>();
  /** Обещание входа и его снятие — вызов, кончившийся иначе, ждуна за собой не оставляет. */
  function loginStarted(): { promise: Promise<void>; cancel: () => void } {
    if (loginPending) return { promise: Promise.resolve(), cancel() {} };
    let waiter: () => void = () => {};
    const promise = new Promise<void>((r) => (waiter = r));
    loginWaiters.add(waiter);
    return { promise, cancel: () => loginWaiters.delete(waiter) };
  }
  function onLogin(url: string | null): void {
    for (const w of loginWaiters) w();
    loginWaiters.clear();
    if (loginPending && url === loginUrl) return;
    loginPending = true;
    loginUrl = url;
    say(
      `Искрон: нужен вход — ${url ? `открой ${url} и заверши его` : "заверши его в браузере"}; ` +
        "адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token. " +
        "Тулы iskron_* поднимутся после входа сами.",
      "warning",
    );
  }
  function loginError(): Error {
    return new Error(
      `Искрон: нужен вход в граф — ${loginUrl ? `открой в браузере ${loginUrl}` : "заверши вход в браузере"} и повтори вызов. ` +
        "Адрес локальный для машины OpenCode: с другой — ssh -L <порт>:127.0.0.1:<порт>; " +
        "на безголовой машине положи личный токен в ~/.iskron-bridge/token (скилл establish-mcp).",
    );
  }

  function spawn(): Slot {
    const slot: Slot = {
      bridge: null as unknown as Bridge,
      ready: Promise.resolve(),
      session: null,
      holding: false,
      lastCall: Date.now(),
    };
    slot.bridge = new Bridge(
      path,
      (line) => say(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method !== "notifications/message" || params?.logger !== "iskron-channel") return;
        const kind = params?.data?.kind;
        if (kind === "attached") slot.holding = true;
        if (kind === "released" || kind === "dead") slot.holding = false;
        onChannel(slot.session, params);
      },
    );
    slot.bridge.start();
    shake(slot);
    return slot;
  }

  function shake(slot: Slot): void {
    slot.ready = handshake(slot.bridge, onLogin, () => {
      loginPending = false;
      loginUrl = null;
    });
    slot.ready.catch(() => {});
  }

  /** Рукопожатие слота; упавшее повторяется тут же, один раз. */
  async function readyFor(slot: Slot): Promise<void> {
    try {
      await slot.ready;
    } catch {
      shake(slot);
      await slot.ready;
    }
  }

  /** Мост корневой сессии: первый раз — запасной с загрузки, дальше свой. */
  async function slotFor(sessionID: string): Promise<Slot> {
    const root = await rootOf(sessionID);
    let slot = slots.get(root);
    if (!slot) {
      slot = spare ?? spawn();
      spare = null;
      slot.session = root;
      slots.set(root, slot);
    }
    slot.lastCall = Date.now();
    return slot;
  }

  // Мост молчащей сессии без стояния не живёт вечно: opencode run плодит
  // сессии, а запас без сессии — каждая локация сервиса.
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || now - slot.lastCall < IDLE_MS) continue;
      slot.bridge.stop();
      slots.delete(session);
    }
    if (spare && !spare.holding && now - spare.lastCall >= IDLE_MS && state.serverSeen) {
      spare.bridge.stop();
      spare = null;
    }
  }, REAP_MS);
  reaper.unref?.();

  const state = {
    listed: readCache() ?? ([] as any[]),
    source: "из прошлого списка",
    serverSeen: false,
  };

  function statusText(): string {
    return [
      `мост: ${path}`,
      loginPending
        ? `вход: НЕ ВЫПОЛНЕН — ${loginUrl ? `открой в браузере ${loginUrl}` : "заверши вход в браузере"}. ` +
          "Адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token (скилл establish-mcp)."
        : state.serverSeen
          ? "вход: есть, сервер отвечает"
          : "вход: мост ещё не ответил (рукопожатие идёт)",
      `тулов iskron_*: ${state.listed.length} (${state.source})`,
      `мостов живых: ${slots.size + (spare ? 1 : 0)}, сессий с мостом: ${slots.size}`,
    ].join("\n");
  }

  await ctx.tool.transform((editor) => {
    editor.add({
      name: STATUS_TOOL,
      description:
        "Состояние моста Искрона в этой сессии OpenCode: выполнен ли вход, адрес авторизации, сколько тулов iskron_* поднято. " +
        "Зови, когда тулов iskron_* нет или они отвечают отказом входа.",
      input: { type: "object", properties: {}, additionalProperties: false } as any,
      async execute() {
        return { content: statusText() };
      },
    });
    for (const t of state.listed) {
      const name = String(t.name);
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
          const slot = await slotFor(String(tool.sessionID));
          // Без гранта человека внутри вызова не ждут: адрес входа уходит ответом.
          if (loginPending) throw loginError();
          const login = loginStarted();
          try {
            await Promise.race([
              readyFor(slot),
              login.promise.then(() => {
                throw loginError();
              }),
            ]);
          } finally {
            login.cancel();
          }
          // Потолка нет: контекст execute в v2 сигнала отмены не несёт.
          const result = await slot.bridge.request("tools/call", {
            name,
            arguments: input ?? {},
          });
          // Отказ тула сигналится броском — так OpenCode показывает его отказом.
          if (result?.isError) throw new Error(textOf(result) || `${name}: отказ без текста`);
          return { content: textOf(result) };
        },
      });
    }
  });
  if (state.listed.length)
    say(`Искрон: тулов из прошлого списка: ${state.listed.length}; сверю с сервером.`, "info");

  // Первый мост — ради списка тулов, фоном и без потолка: истёкшее ожидание
  // входа или умерший мост — новое рукопожатие или новый мост, пока плагин жив.
  spare = spawn();
  let first = spare;
  void (async () => {
    for (;;) {
      if (stopped) return;
      try {
        await first.ready;
        const list = await listTools(first.bridge);
        state.serverSeen = true;
        const same = JSON.stringify(list) === JSON.stringify(state.listed);
        state.listed = list;
        state.source = "с сервера";
        writeCache(list);
        if (!same) await ctx.tool.reload();
        say(`Искрон: мост поднят, тулов в сессии: ${list.length} (с сервера).`, "info");
        return;
      } catch (e) {
        if (stopped) return;
        if (first.bridge.failure) {
          // Мост списка умер — или был отдан сессии и отпущен ею (тогда молча):
          // список берёт новый запас.
          if (first.session === null)
            say(`Искрон: мост умер (${(e as Error).message}) — поднимаю новый.`, "warning");
          if (spare === first) spare = null;
          first = spare ?? spawn();
          spare = first;
        } else {
          shake(first);
        }
        await sleep(AUTH_POLL_MS);
      }
    }
  })();

  return {
    forget(session) {
      const slot = slots.get(session);
      if (!slot) return;
      slots.delete(session);
      slot.bridge.stop(); // свёртка моста отпускает стояние: ключ, сокет, занятость
    },
    stop() {
      stopped = true;
      clearInterval(reaper);
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) slot.bridge.stop();
      slots.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
