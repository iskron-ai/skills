// Слова обновления поставки (граф @nks/nks-dev, узел #4509): перезапуск домашней
// копией, отказ скачивания, строка отставания и ходы обновления скиллов по каналам.
import type { Lang } from "../lang.ts";
import { BRIDGE_NAME, HOME_DIR } from "../product.ts";

export interface UpdateWords {
  reexecNewer: (homeVersion: string, version: string, path: string) => string;
  restartFailed: (error: string) => string;
  versionMismatch: (got: string, version: string) => string;
  /** Что с мостом в доме — первая часть строки отставания. */
  bridgeDownloaded: () => string;
  /** self — путь запущенного моста. */
  downloadFailed: (error: string, self: string) => string;
  homeSymlink: () => string;
  bridgeAlreadyHome: () => string;
  bridgeNotHome: (self: string) => string;
  /** Строка отставания — агент обязан передать её человеку. */
  stale: (
    version: string,
    fresh: string,
    bridgeWord: string,
    claude: string,
    flat: string,
    pi: string,
    codex: string,
    setup: string,
  ) => string;
  /** Ходы обновления набора скиллов по каналу харнеса. */
  moveClaude: () => string;
  moveFlat: () => string;
  movePi: () => string;
  moveCodex: () => string;
}

export const UPDATE: Readonly<Record<Lang, UpdateWords>> = {
  ru: {
    reexecNewer: (homeVersion, version, path) =>
      `домашняя копия новее этой сборки (v${homeVersion} > v${version}) — запускаюсь ею: ${path}`,
    restartFailed: (error) => `перезапуск не удался: ${error}`,
    versionMismatch: (got, version) => `скачанный мост называет v${got}, релиз — v${version}`,
    bridgeDownloaded: () => `Свежий мост уже скачан в ~/${HOME_DIR} и поднимется новой сессией.`,
    downloadFailed: (error, self) =>
      `Скачать свежий мост не вышло (${error}); повтори: node "${self}" update.`,
    homeSymlink: () =>
      "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам.",
    bridgeAlreadyHome: () => `Свежий мост уже лежит в ~/${HOME_DIR} и поднимется новой сессией.`,
    bridgeNotHome: (self) =>
      `Свежий мост в дом не положен; повтори: node "${self}" update (мост, который отвечает, — тот и обновляет дом; в пакетной поставке OpenCode мост живёт в пакете и обновляется с ним).`,
    stale: (version, fresh, bridgeWord, claude, flat, pi, codex, setup) =>
      `[${BRIDGE_NAME}] ПОСТАВКА ОТСТАЛА: этот мост v${version}, свежий релиз v${fresh}. ${bridgeWord} ` +
      `Скиллы обновляет канал харнеса, и об этом надо СКАЗАТЬ ЧЕЛОВЕКУ: Claude Code — ${claude}; ` +
      `плоская установка — ${flat}; pi — ${pi}; Codex — ${codex}. ` +
      `Полный порядок — свежий установщик ${setup} (кладёт update); по слову человека «обнови» исполни его.`,
    moveClaude: () => "/plugin marketplace update iskron, затем /reload-plugins",
    moveFlat: () =>
      "повторный npx skills add iskron-ai/skills --all --global (приносит новые скиллы и освежает стоящие: npx skills update --global ходит только по lock-файлу и новых не приносит, снятое убирается руками — npx skills remove <имя> --global)",
    movePi: () => "pi update git:github.com/iskron-ai/skills",
    moveCodex: () =>
      "codex plugin marketplace upgrade iskron, затем codex plugin remove iskron@iskron и codex plugin add iskron@iskron",
  },
  en: {
    reexecNewer: (homeVersion, version, path) =>
      `the home copy is newer than this build (v${homeVersion} > v${version}) — restarting with it: ${path}`,
    restartFailed: (error) => `restart failed: ${error}`,
    versionMismatch: (got, version) =>
      `the downloaded bridge names v${got}, the release — v${version}`,
    bridgeDownloaded: () =>
      `The fresh bridge is already downloaded into ~/${HOME_DIR} and comes up with a new session.`,
    downloadFailed: (error, self) =>
      `Downloading the fresh bridge failed (${error}); repeat: node "${self}" update.`,
    homeSymlink: () =>
      "The fresh bridge is not put home: home is a symlink to another copy, left alone; update that copy yourself.",
    bridgeAlreadyHome: () =>
      `The fresh bridge already lies in ~/${HOME_DIR} and comes up with a new session.`,
    bridgeNotHome: (self) =>
      `The fresh bridge is not put home; repeat: node "${self}" update (the bridge that answers is the one that updates home; in OpenCode's packaged delivery the bridge lives in the package and updates with it).`,
    stale: (version, fresh, bridgeWord, claude, flat, pi, codex, setup) =>
      `[${BRIDGE_NAME}] DELIVERY BEHIND: this bridge is v${version}, the fresh release is v${fresh}. ${bridgeWord} ` +
      `The harness channel updates the skills, and this must be TOLD TO THE HUMAN: Claude Code — ${claude}; ` +
      `flat install — ${flat}; pi — ${pi}; Codex — ${codex}. ` +
      `The full order — the fresh installer ${setup} (update puts it); on the human's word "update" run it.`,
    moveClaude: () => "/plugin marketplace update iskron, then /reload-plugins",
    moveFlat: () =>
      "repeat npx skills add iskron-ai/skills --all --global (it brings new skills and refreshes standing ones: npx skills update --global walks only the lock file and brings none, a dropped skill is removed by hand — npx skills remove <name> --global)",
    movePi: () => "pi update git:github.com/iskron-ai/skills",
    moveCodex: () =>
      "codex plugin marketplace upgrade iskron, then codex plugin remove iskron@iskron and codex plugin add iskron@iskron",
  },
};
