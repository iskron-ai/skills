// Кто рукопожался с мостом — имя харнесса из clientInfo.name (граф nks-dev:
// #5047, #4895): по нему мост знает, доходят ли кадры уведомлением (pi,
// OpenCode) или только локальным сторожем (Claude Code, Codex), и чью запись
// держания считать своей.
import { NOTIFIED_CLIENTS } from "../shared/clients.ts";
import { state } from "./transport.ts";

/** Имя харнесса из рукопожатия; пусто, пока рукопожатия не было. */
export function harnessName(): string {
  const info = (state.initParams as { clientInfo?: { name?: unknown } } | null)?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}

/** Кадр этому харнесу доходит уведомлением MCP, а не локальным сторожем. */
export const notifiedClient = (): boolean => NOTIFIED_CLIENTS.has(harnessName());
