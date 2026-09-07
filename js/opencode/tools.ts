// Половина «тулы» — тулы Искрона через мост, каждый под своим именем.
//
// Плагин сам говорит с мостом по MCP stdio и регистрирует КАЖДЫЙ тул сервера
// хуком `tool` под его собственным именем. Нативная запись `mcp` в конфиге
// OpenCode для этого не годится: тулы MCP-сервера OpenCode именует
// <сервер>_<тул>, и весь корпус, зовущий iskron_orient, получил бы
// iskron_iskron_orient — каждая фраза скилла стала бы ложной.
//
// Хук `tool` — карта, отданная один раз при загрузке плагина, поэтому список
// тулов нужен ДО того, как сессия начнётся. Мост поднимается тут же, список
// ждётся ограниченно; не успел — тулы встают из прошлого списка (кэш рядом с
// грантом), а вызов дожидается моста. Без кэша и без моста тулов нет до
// перезапуска — и об этом сказано вслух, не в лог.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { accessSync, constants } from "node:fs";
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
const PROTOCOL = "2025-06-18";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

export interface ToolsHalf {
  tools: Record<string, ToolDefinition>;
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

async function listTools(b: Bridge): Promise<any[]> {
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
  onChannel: (params: any) => void,
  noteCall: (tool: string, sessionID: string | undefined) => void,
): Promise<ToolsHalf> {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " +
        found.tried.join(", ") +
        ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error",
    );
    return { tools: {}, stop() {} };
  }

  const bridge = new Bridge(
    found.path,
    (line) => say(`Искрон/мост: ${line}`, "info"),
    (method, params) => {
      if (method === "notifications/message" && params?.logger === "iskron-channel")
        onChannel(params);
    },
  );
  bridge.start();

  // Список идёт своим ходом; загрузка плагина ждёт его ограниченно.
  const listing = listTools(bridge).then((list) => {
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
          "тулов iskron_* не будет до перезапуска OpenCode. Мост доподнимется сам; проверь `node ~/.iskron-bridge/iskron-bridge.mjs doctor`.",
        "error",
      );
      return { tools: {}, stop: () => bridge.stop() };
    }
  }

  const tools: Record<string, ToolDefinition> = {};
  for (const t of listed) {
    const name = String(t.name);
    tools[name] = tool({
      description: String(t.description ?? ""),
      args: argsFrom(t.inputSchema),
      async execute(args, ctx) {
        noteCall(name, ctx.sessionID);
        // Тулы из кэша ждут, пока мост ответит на рукопожатие.
        await listing;
        const result = await bridge.request(
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
  return { tools, stop: () => bridge.stop() };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
