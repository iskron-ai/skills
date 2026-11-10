// Первое слово об отставшем установленном наборе (#10122, @nks/nks-dev).
import type { Lang } from "../lang.ts";

type Reason = "patch" | "plugin" | "ownership" | "manifest";
interface SkillCatchupWords {
  gate: (root: string, installed: string, target: string, path: string, reason?: string) => string;
  notice: (
    root: string,
    source: string,
    installed: string,
    target: string,
    reason: Reason,
    command: string,
  ) => string;
  failed: (
    root: string,
    installed: string,
    target: string,
    error: string,
    command: string,
  ) => string;
  updated: (
    root: string,
    installed: string,
    target: string,
    sha: string,
    stamp: string,
    removed: string[],
  ) => string;
}

export const SKILL_CATCHUP: Readonly<Record<Lang, SkillCatchupWords>> = {
  en: {
    gate: (root, installed, target, path, reason) =>
      `SKILLS DELIVERY BLOCKED: ${JSON.stringify(root)} installed v${installed}, bridge v${target}; writer gate exists: ${JSON.stringify(path)}; ${reason ? `${JSON.stringify(reason)}; ` : ""}not updated successfully (completion is unconfirmed). First confirm that the updater process group for this HOME has stopped and that the gate belongs to this catch-up. Release the gate only after a complete pinned post-read (ref/source/stamp and every blob), never merely a fresh bridge version or exit 0. npx may outlive a SIGKILLed bridge daemon; repeating stand does not repair this gate. Automatic deletion and bypass are forbidden.`,
    failed: (root, installed, target, error, command) =>
      `SKILLS BEHIND: ${JSON.stringify(root)} v${installed} < bridge v${target}; ${JSON.stringify(error)}; not updated successfully (partial own files may remain). Next command: ${command}.`,
    updated: (root, installed, target, sha, stamp, removed) =>
      `SKILLS UPDATED: ${JSON.stringify(root)} v${installed} → v${target}, source SHA ${sha}, stamp ${stamp}; reread the entry and role skills now. Names absent from this release (left installed): ${JSON.stringify(removed)}. Disk installation is not loaded context.`,
    notice: (root, source, installed, target, reason, command) =>
      `SKILLS BEHIND: ${JSON.stringify(root)} (${JSON.stringify(source)}) v${installed} < bridge v${target}; ` +
      `${
        {
          patch: "patch-only lag: notification only",
          plugin: "the harness owns plugin delivery",
          ownership: "source ownership is not proven",
          manifest: "a complete pinned manifest and destination ownership are not proven",
        }[reason]
      }; ` +
      `not updated. Next command: ${command}. After updating, reread the entry and role skills; disk installation is not loaded context.`,
  },
  ru: {
    gate: (root, installed, target, path, reason) =>
      `ДОСТАВКА СКИЛЛОВ ЗАБЛОКИРОВАНА: ${JSON.stringify(root)} установлен v${installed}, мост v${target}; найдена блокировка записи: ${JSON.stringify(path)}; ${reason ? `${JSON.stringify(reason)}; ` : ""}обновление не подтверждено. Сначала подтверди, что группа процессов updater для этого HOME остановлена и что блокировка относится к этому догону. Снять её можно лишь после полного повторного чтения закреплённого набора (ref/source/stamp и байты всех файлов), не по свежей версии моста или exit 0. npx может пережить SIGKILL демона моста; повтор стояния не снимает блокировку. Автоматическое удаление и обход запрещены.`,
    failed: (root, installed, target, error, command) =>
      `СКИЛЛЫ ОТСТАЛИ: ${JSON.stringify(root)} v${installed} < мост v${target}; ${JSON.stringify(error)}; обновление не подтверждено (свои файлы могли измениться частично). Следующая команда: ${command}.`,
    updated: (root, installed, target, sha, stamp, removed) =>
      `СКИЛЛЫ ОБНОВЛЕНЫ: ${JSON.stringify(root)} v${installed} → v${target}, SHA источника ${sha}, штамп ${stamp}; перечитай дверь и скилл роли сейчас. Снятые из выпуска имена (оставлены на диске): ${JSON.stringify(removed)}. Установка на диске не означает загрузку в контекст.`,
    notice: (root, source, installed, target, reason, command) =>
      `СКИЛЛЫ ОТСТАЛИ: ${JSON.stringify(root)} (${JSON.stringify(source)}) v${installed} < мост v${target}; ` +
      `${
        {
          patch: "отставание только на правку: лишь уведомление",
          plugin: "плагин доставляет сам харнес",
          ownership: "владение источником не доказано",
          manifest: "полный закреплённый список и владение путями назначения не доказаны",
        }[reason]
      }; ` +
      `не обновлено. Следующая команда: ${command}. После обновления перечитай дверь и скилл роли; установка на диске не означает загрузку в контекст.`,
  },
};
