// Кто рукопожался с мостом — имя харнесса из clientInfo.name (граф nks-dev:
// #5047, #4895): по нему мост знает, доходят ли кадры уведомлением (pi,
// OpenCode) или только локальным сторожем (Claude Code, Codex), и чью запись
// держания считать своей.
import { HARNESS_VERSION_ENV, HOSTED_CLIENTS, NOTIFIED_CLIENTS } from "../shared/clients.ts";
import { state } from "./transport.ts";

const clientInfo = (): { name?: unknown; version?: unknown } | undefined =>
  (state.initParams as { clientInfo?: { name?: unknown; version?: unknown } } | null)?.clientInfo;

/** Имя харнесса из рукопожатия; пусто, пока рукопожатия не было. */
export function harnessName(): string {
  const info = clientInfo();
  return typeof info?.name === "string" ? info.name : "";
}

/**
 * Версия хоста его же словами (#6226): Claude Code и Codex — clientInfo.version
 * рукопожатия; плагин OpenCode и расширение pi — окружением от них. Не узнал — "unknown".
 */
export function harnessVersion(): string {
  const v = HOSTED_CLIENTS.has(harnessName())
    ? process.env[HARNESS_VERSION_ENV]
    : clientInfo()?.version;
  return typeof v === "string" && v.trim() ? v.trim() : "unknown";
}

/** Кадр этому харнесу доходит уведомлением MCP, а не локальным сторожем. */
export const notifiedClient = (): boolean => NOTIFIED_CLIENTS.has(harnessName());
