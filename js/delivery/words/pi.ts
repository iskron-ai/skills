// Слова расширения pi (граф @nks/nks-dev, узел #6806 п.7): дверь, половина «тулы»,
// домашняя копия моста; слова канала — общие с плагином OpenCode (words/plugin.ts).
import type { Lang } from "../lang.ts";

export interface PiWords {
  /** list — сорвавшиеся половины через «; ». */
  broken: (list: string) => string;
  channelPart: (message: string) => string;
  toolsPart: (message: string) => string;
  needLogin: (message: string) => string;
  notUp: (name: string) => string;
  calling: (name: string) => string;
  stillWaiting: (name: string, seconds: number) => string;
  serverChanged: (n: number) => string;
  server: () => string;
  raised: (server: string, version: string, n: number) => string;
  raisedSignedIn: (server: string, version: string, n: number) => string;
  launchNoBridge: (no: string) => string;
  stillRaising: () => string;
  versionUnreadable: () => string;
  homeNewer: (home: string, packaged: string) => string;
  noVersion: () => string;
  replacedSame: (version: string) => string;
  updated: (was: string, version: string) => string;
  replaceFailed: (was: string, version: string, message: string) => string;
}

export const PI: Readonly<Record<Lang, PiWords>> = {
  ru: {
    broken: (list) => `Искрон: не встало — ${list}`,
    channelPart: (message) => `канал: ${message}`,
    toolsPart: (message) => `тулы: ${message}`,
    needLogin: (message) => `Искрон: нужен вход — ${message}`,
    notUp: (name) => `${name}: мост не поднят в этой сессии`,
    calling: (name) => `Искрон: ${name}…`,
    stillWaiting: (name, seconds) => `Искрон: ${name} — ещё жду, ${seconds} с`,
    serverChanged: (n) => `Искрон: сервер сменил тулы — в сессии зарегистрировано ${n}.`,
    server: () => "сервер",
    raised: (server, version, n) =>
      `Искрон: мост поднят (${server} ${version}), тулов в сессии: ${n}.`,
    raisedSignedIn: (server, version, n) =>
      `Искрон: мост поднят (${server} ${version}), тулов в сессии: ${n} — вход состоялся.`,
    launchNoBridge: (no) => `Искрон: строка запуска — мост не поднят, в дело №${no} не вошёл.`,
    stillRaising: () =>
      "Искрон: мост ещё поднимается — тулы iskron_* появятся, как только ответит.",
    versionUnreadable: () =>
      "Искрон: в поставке мост есть, но его версия не читается — домашнюю копию не трогаю.",
    homeNewer: (home, packaged) =>
      `Искрон: дома мост ${home}, в поставке ${packaged} — домашний новее, не трогаю.`,
    noVersion: () => "версия не читается",
    replacedSame: (version) =>
      `Искрон: мост дома заменён на привезённый поставкой — версия та же (${version}), байты другие. Грант не тронут.`,
    updated: (was, version) =>
      `Искрон: мост дома обновлён ${was} → ${version}. Грант не тронут, он лежит рядом отдельными файлами.`,
    replaceFailed: (was, version, message) =>
      `Искрон: мост дома ${was}, в поставке ${version}, заменить не вышло (${message}). Работаю тем, что есть.`,
  },
  en: {
    broken: (list) => `Iskron: did not come up — ${list}`,
    channelPart: (message) => `channel: ${message}`,
    toolsPart: (message) => `tools: ${message}`,
    needLogin: (message) => `Iskron: sign-in needed — ${message}`,
    notUp: (name) => `${name}: the bridge is not up in this session`,
    calling: (name) => `Iskron: ${name}…`,
    stillWaiting: (name, seconds) => `Iskron: ${name} — still waiting, ${seconds} s`,
    serverChanged: (n) => `Iskron: the server changed its tools — ${n} registered in the session.`,
    server: () => "server",
    raised: (server, version, n) =>
      `Iskron: the bridge is up (${server} ${version}), tools in the session: ${n}.`,
    raisedSignedIn: (server, version, n) =>
      `Iskron: the bridge is up (${server} ${version}), tools in the session: ${n} — sign-in done.`,
    launchNoBridge: (no) =>
      `Iskron: launch line — the bridge is not up, did not enter case №${no}.`,
    stillRaising: () =>
      "Iskron: the bridge is still coming up — the iskron_* tools appear as soon as it answers.",
    versionUnreadable: () =>
      "Iskron: the delivery carries a bridge, but its version is unreadable — leaving the home copy alone.",
    homeNewer: (home, packaged) =>
      `Iskron: the home bridge is ${home}, the delivery's is ${packaged} — the home one is newer, leaving it alone.`,
    noVersion: () => "version unreadable",
    replacedSame: (version) =>
      `Iskron: the home bridge was replaced with the one the delivery brought — same version (${version}), different bytes. The grant is untouched.`,
    updated: (was, version) =>
      `Iskron: the home bridge was updated ${was} → ${version}. The grant is untouched, it lies beside it in separate files.`,
    replaceFailed: (was, version, message) =>
      `Iskron: the home bridge is ${was}, the delivery's is ${version}, replacing it failed (${message}). Working with what there is.`,
  },
};
