// Слова блока моста в ответе connect и iskron_stand: строка слушания своего
// харнеса (граф @nks/nks-dev, узел #5047).
import type { Lang } from "../lang.ts";

export interface ListenWords {
  /** listen — строка слушания (line ниже). */
  block: (listen: string) => string;
  unheard: (listen: string) => string;
  /** where — флаги сторожа (--auth-dir, --lang), уже строкой с ведущим пробелом. */
  monitor: (self: string, key: string, where: string) => string;
  exit: (self: string, key: string, where: string) => string;
  codex: (self: string, key: string, where: string) => string;
  /** Харнес слушает сам: pi — расширение, иначе плагин OpenCode. */
  self: (pi: boolean) => string;
  claude: (monitor: string, exit: string) => string;
  codexLine: (codex: string, exit: string) => string;
  /**
   * Antigravity CLI (agy): его уведомления MCP спящую сессию не будят — будит фоновый
   * run_command с watchdog-exit (граф @nks/nks-dev, узел #11439).
   */
  agy: (self: string, key: string, where: string) => string;
  agyLine: (agy: string) => string;
  any: (monitor: string, exit: string, codex: string, agy: string) => string;
}

export const LISTEN: Readonly<Record<Lang, ListenWords>> = {
  ru: {
    block: (listen) =>
      `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно` +
      ` (строка выше о том, что никто не слушает, описывает миг до этого держания).` +
      `\n${listen}` +
      `\nЗанятость: iskron_stand(realm, status) на этом месте — пустой status снимает.` +
      `\nКадры приходят и уведомлениями MCP (logger iskron-channel).`,
    unheard: (listen) =>
      `[iskron-bridge] Сторож к этому месту не прицеплен — кадры копятся. ${listen}`,
    monitor: (self, key, where) =>
      `под Monitor — node "${self}" watchdog ${key}${where} с наибольшим timeout_ms, перевзводить по истечении (Claude Code)`,
    exit: (self, key, where) =>
      `фоновой задачей — node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении)`,
    codex: (self, key, where) =>
      `в Codex внутри одной длинной команды своей оболочки — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (кадр входит в идущий тред через app-server; отдельной командой с nohup сторож умирает вместе с ней)`,
    self: (pi) =>
      `Слушает ${pi ? "расширение pi" : "плагин OpenCode"} само — сторож не нужен, кадры входят в ход.`,
    claude: (monitor, exit) => `Слушать: ${monitor}; без Monitor — ${exit}.`,
    codexLine: (codex, exit) => `Слушать: ${codex}; без двери app-server — ${exit}.`,
    agy: (self, key, where) =>
      `в Antigravity CLI (agy) уведомления MCP спящую сессию не будят — держи фоновой run_command (WaitMsBeforeAsync=500, IsDaemon=false, NotificationTimeoutSeconds большой или пустой): node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении, его концом agy и просыпается); перевзводи после каждого выхода`,
    agyLine: (agy) => `Слушать: ${agy}.`,
    any: (monitor, exit, codex, agy) => `Слушать: ${monitor}; ${exit}; ${codex}; ${agy}.`,
  },
  en: {
    block: (listen) =>
      `[iskron-bridge] The bridge holds this standing's socket — there is no one to hand it to` +
      ` (a line above saying no one listens describes the moment before this holding).` +
      `\n${listen}` +
      `\nBusy line: iskron_stand(realm, status) on this seat — an empty status clears it.` +
      `\nFrames also come as MCP notifications (logger iskron-channel).`,
    unheard: (listen) =>
      `[iskron-bridge] No watchdog is attached to this seat — frames pile up. ${listen}`,
    monitor: (self, key, where) =>
      `under Monitor — node "${self}" watchdog ${key}${where} with the largest timeout_ms, re-armed when it runs out (Claude Code)`,
    exit: (self, key, where) =>
      `as a background task — node "${self}" watchdog-exit ${key}${where} (exits zero on the first message)`,
    codex: (self, key, where) =>
      `in Codex inside one long command of your shell — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (a frame enters the running thread through app-server; as a separate nohup command the watchdog dies with it)`,
    self: (pi) =>
      `The ${pi ? "pi extension" : "OpenCode plugin"} listens itself — no watchdog needed, frames enter the turn.`,
    claude: (monitor, exit) => `Listen: ${monitor}; without Monitor — ${exit}.`,
    codexLine: (codex, exit) => `Listen: ${codex}; without the app-server door — ${exit}.`,
    agy: (self, key, where) =>
      `in Antigravity CLI (agy) MCP notifications do not wake a sleeping session — keep a background run_command (WaitMsBeforeAsync=500, IsDaemon=false, NotificationTimeoutSeconds large or empty): node "${self}" watchdog-exit ${key}${where} (it exits zero on the first message, and by that exit agy wakes); re-arm it after every exit`,
    agyLine: (agy) => `Listen: ${agy}.`,
    any: (monitor, exit, codex, agy) => `Listen: ${monitor}; ${exit}; ${codex}; ${agy}.`,
  },
};
