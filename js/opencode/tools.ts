// Половина «тулы» — тулы Искрона через мост, каждый под своим именем,
// и МОСТ НА КАЖДУЮ СЕССИЮ (граф nks-dev: #4283).
//
// Плагин сам говорит с мостом по MCP stdio и регистрирует КАЖДЫЙ тул сервера
// хуком `tool` под его собственным именем. Нативная запись `mcp` в конфиге
// OpenCode для этого не годится: тулы MCP-сервера OpenCode именует
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
// Хук `tool` — карта, отданная один раз при загрузке плагина, поэтому список
// тулов нужен ДО того, как сессия начнётся. Первый мост поднимается тут же и
// отдаёт список (ограниченное ожидание; не успел — список из кэша рядом с
// грантом), а затем достаётся первой сессии, которая позовёт тул.
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { tool, type ToolDefinition } from "@opencode-ai/plugin";

import { Bridge, resultToContent } from "../shared/bridge-client.ts";
import { homeBridgePath } from "../shared/home.ts";
import { type Say } from "./channel.ts";
import { argsFrom } from "./schema.ts";

/** Сколько ждать список тулов, ПРЕЖДЕ чем отпустить загрузку плагина. */
const READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 20000);
/** Потолок самого рукопожатия. Щедрый: первый запуск может увести человека в браузер. */
const HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 600000);
/** Мост сессии, которая давно молчит и ничего не держит, отпускается. */
const IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 60_000);
const PROTOCOL = "2025-06-18";

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
  tools: Record<string, ToolDefinition>;
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

function cachePath(): string {
  const auth = process.env.ISKRON_BRIDGE_AUTH_DIR || join(homedir(), ".iskron-bridge");
  return join(auth, "opencode-tools.json");
}

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

async function handshake(b: Bridge): Promise<void> {
  await b.request(
    "initialize",
    {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "opencode-iskron", version: "1" },
    },
    { timeoutMs: HANDSHAKE_MS },
  );
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
    return { tools: {}, forget() {}, stop() {} };
  }
  const path = found.path;

  const slots = new Map<string, Slot>();
  let spare: Slot | null = null;

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
    slot.ready = handshake(slot.bridge);
    slot.ready.catch(() => {});
    return slot;
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

  // Первый мост — ради списка тулов; загрузка плагина ждёт его ограниченно.
  spare = spawn();
  const first = spare;
  const listing = first.ready
    .then(() => listTools(first.bridge))
    .then((list) => {
      writeCache(list);
      return list;
    });
  listing.catch(() => {});
  let listed: any[] | null = null;
  await Promise.race([
    listing.then(
      (l) => {
        listed = l;
      },
      () => {},
    ),
    new Promise<void>((r) => setTimeout(r, READY_WAIT_MS).unref?.()),
  ]);

  let source = "с сервера";
  if (!listed) {
    listed = readCache();
    source = "из прошлого списка";
    if (!listed) {
      say(
        `Искрон: мост не ответил за ${Math.round(READY_WAIT_MS / 1000)} с и прошлого списка тулов нет — ` +
          "тулов iskron_* не будет до перезапуска OpenCode. Проверь `node ~/.iskron-bridge/iskron-bridge.mjs doctor`.",
        "error",
      );
      first.bridge.stop();
      return { tools: {}, forget() {}, stop() {} };
    }
  }

  // Мост молчащей сессии без стояния не живёт вечно: opencode run плодит сессии.
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || now - slot.lastCall < IDLE_MS) continue;
      slot.bridge.stop();
      slots.delete(session);
    }
  }, 60_000);
  reaper.unref?.();

  const tools: Record<string, ToolDefinition> = {};
  for (const t of listed) {
    const name = String(t.name);
    tools[name] = tool({
      description: String(t.description ?? ""),
      args: argsFrom(t.inputSchema),
      async execute(args, ctx) {
        const slot = await slotFor(ctx.sessionID);
        await slot.ready; // тулы из кэша ждут, пока мост ответит на рукопожатие
        const result = await slot.bridge.request(
          "tools/call",
          { name, arguments: args ?? {} },
          { signal: ctx.abort }, // потолка нет: первый вызов может уйти в браузер к человеку
        );
        // Отказ тула сигналится броском — так OpenCode показывает его отказом.
        if (result?.isError) throw new Error(textOf(result) || `${name}: отказ без текста`);
        return {
          title: name,
          output: textOf(result),
          metadata: result?.structuredContent
            ? { structuredContent: result.structuredContent }
            : {},
        };
      },
    });
  }
  say(`Искрон: мост поднят, тулов в сессии: ${Object.keys(tools).length} (${source}).`, "info");

  return {
    tools,
    forget(session) {
      const slot = slots.get(session);
      if (!slot) return;
      slots.delete(session);
      slot.bridge.stop(); // свёртка моста отпускает стояние: ключ, сокет, занятость
    },
    stop() {
      clearInterval(reaper);
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) slot.bridge.stop();
      slots.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
