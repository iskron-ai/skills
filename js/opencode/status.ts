// Текст тула iskron_bridge — что знает плагин о своём мосте: сборки, вход,
// список тулов и сколько мостов живо. Отдельно от плагина: чистая сборка строк.
import { elsewhere } from "./login.ts";

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
