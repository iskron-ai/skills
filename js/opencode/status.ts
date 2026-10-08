// Текст тула iskron_bridge — что знает плагин о своём мосте: сборки, вход,
// список тулов и сколько мостов живо. Отдельно от плагина: чистая сборка строк.
import { tool } from "../delivery/index.ts";
import { elsewhere } from "./login.ts";

/** Служебный тул плагина: состояние моста, когда тулов iskron_* ещё нет. */
export const STATUS_TOOL = tool("bridge");

/** Определение служебного тула для ctx.tool.transform: текст — в миг вызова. */
export const statusTool = (text: () => string) => ({
  name: STATUS_TOOL,
  description:
    "Состояние моста Искрона в этой сессии OpenCode: выполнен ли вход, адрес авторизации, сколько тулов iskron_* поднято. " +
    "Зови, когда тулов iskron_* нет или они отвечают отказом входа.",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- схема входа SDK без типа
  input: { type: "object", properties: {}, additionalProperties: false } as any,
  async execute() {
    return { content: text() };
  },
});

export function statusLines(
  path: string,
  builds: string,
  login: { loginPending: boolean; loginUrl: string | null; loginDevice: string | null },
  state: { serverSeen: boolean; listed: unknown[]; source: string },
  sessions: number,
  spare: number,
): string {
  return [
    `мост: ${path}`,
    builds,
    login.loginPending
      ? `вход: НЕ ВЫПОЛНЕН — ${login.loginUrl ? `открой в браузере ${login.loginUrl}` : "заверши вход в браузере"}. ` +
        `Адрес локальный: ${elsewhere(login.loginDevice)} (скилл establish-mcp).`
      : state.serverSeen
        ? "вход: есть, сервер отвечает"
        : "вход: мост ещё не ответил (рукопожатие идёт)",
    `тулов iskron_*: ${state.listed.length} (${state.source})`,
    `мостов живых: ${sessions + spare}, сессий с мостом: ${sessions}`,
  ].join("\n");
}
