// Чистые помощники половины «тулы» (tools.ts): где мост, кэш списка тулов
// рядом с грантом, рукопожатие, ждущее вход человека, страничный tools/list.
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

import { type Bridge, resultToContent } from "../shared/bridge-client.ts";
import { OPENCODE_CLIENT } from "../shared/clients.ts";
import { homeBridgePath } from "../shared/home.ts";

/** Потолок самого рукопожатия; истёк — рукопожатие повторяется, не сдаётся. */
export const HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 600000);
/** Как часто переспрашивать мост, пока человек входит в браузере. */
export const AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 2000);
/**
 * Отказ моста без гранта. Это не поломка, а вход в процессе: мост открыл
 * браузер и слушает колбэк на loopback, погасить его — убить вход человека
 * (граф nks-dev: #4712).
 */
const AUTH_PENDING = /authorization required/i;
const PROTOCOL = "2025-06-18";

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

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

export function authDir(): string {
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

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function readCache(): any[] | null {
  try {
    const list = JSON.parse(readFileSync(cachePath(), "utf8"));
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}

export function writeCache(tools: any[]): void {
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
export async function handshake(
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

export async function listTools(b: Bridge): Promise<any[]> {
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

export function textOf(result: any): string {
  return resultToContent(result)
    .map((c) => (c.type === "text" ? c.text : "[image]"))
    .join("\n");
}

/* eslint-enable @typescript-eslint/no-explicit-any */
