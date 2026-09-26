// Блок `[iskron-bridge]` в ответе connect и iskron_stand: одна строка слушания
// своего харнеса (граф nks-dev: #5047) — агент pi, получивший три команды,
// запускал сторож Claude Code.
import { fileURLToPath } from "node:url";

import { NOTIFIED_CLIENTS, PI_CLIENT } from "../shared/clients.ts";
import { L } from "../shared/lang.ts";
import { defaultAuthDir } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { heldKey } from "./hold.ts";
import { state } from "./transport.ts";

/** Имя клиента рукопожатия — по нему мост знает харнес (граф nks-dev: #5047). */
function clientName(): string {
  const info = (state.initParams as { clientInfo?: { name?: unknown } } | null)?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}

/**
 * Блок `[iskron-bridge]` с командой слушания — для ответа connect и для
 * iskron_stand. Строка слушания — одна, своего харнеса: агент pi, получивший
 * три команды, запускал сторож Claude Code (#5047); незнакомому клиенту — все.
 */
export function listenBlock(realm?: string): string | null {
  const key = heldKey(realm); // место этого графа на канале (#5838); без графа — основное
  if (!key) return null;
  const self = fileURLToPath(import.meta.url);
  // Сторож выводит каталог сокетов так же, как мост: не по умолчанию — скажи ему где.
  const where = CFG.authDir === defaultAuthDir() ? "" : ` --auth-dir "${CFG.authDir}"`;
  const client = clientName();
  const monitor = L(
    `под Monitor — node "${self}" watchdog ${key}${where} с наибольшим timeout_ms, перевзводить по истечении (Claude Code)`,
    `under Monitor — node "${self}" watchdog ${key}${where} with the largest timeout_ms, re-armed when it runs out (Claude Code)`,
  );
  const exit = L(
    `фоновой задачей — node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении)`,
    `as a background task — node "${self}" watchdog-exit ${key}${where} (exits zero on the first message)`,
  );
  const codex = L(
    `в Codex внутри одной длинной команды своей оболочки — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (кадр входит в идущий тред через app-server; отдельной командой с nohup сторож умирает вместе с ней)`,
    `in Codex inside one long command of your shell — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (a frame enters the running thread through app-server; as a separate nohup command the watchdog dies with it)`,
  );
  // Имена: claude-code снято с рукопожатия Claude Code; pi и OpenCode — свои
  // константы; Codex — по подстроке, его рукопожатие в поле не снималось.
  const listen = NOTIFIED_CLIENTS.has(client)
    ? L(
        `Слушает ${client === PI_CLIENT ? "расширение pi" : "плагин OpenCode"} само — сторож не нужен, кадры входят в ход.`,
        `The ${client === PI_CLIENT ? "pi extension" : "OpenCode plugin"} listens itself — no watchdog needed, frames enter the turn.`,
      )
    : client === "claude-code"
      ? L(
          `Слушать: ${monitor}; без Monitor — ${exit}.`,
          `Listen: ${monitor}; without Monitor — ${exit}.`,
        )
      : /codex/i.test(client)
        ? L(
            `Слушать: ${codex}; без двери app-server — ${exit}.`,
            `Listen: ${codex}; without the app-server door — ${exit}.`,
          )
        : L(`Слушать: ${monitor}; ${exit}; ${codex}.`, `Listen: ${monitor}; ${exit}; ${codex}.`);
  return L(
    `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно` +
      ` (строка выше о том, что никто не слушает, описывает миг до этого держания).` +
      `\n${listen}` +
      `\nЗанятость: iskron_channel(action="status", realm, text) — пустой text снимает.` +
      `\nКадры приходят и уведомлениями MCP (logger iskron-channel).`,
    `[iskron-bridge] The bridge holds this standing's socket — there is no one to hand it to` +
      ` (a line above saying no one listens describes the moment before this holding).` +
      `\n${listen}` +
      `\nBusy line: iskron_channel(action="status", realm, text) — an empty text clears it.` +
      `\nFrames also come as MCP notifications (logger iskron-channel).`,
  );
}
