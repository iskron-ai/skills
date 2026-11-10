// Первое слово об отставшем установленном наборе (#10122, @nks/nks-dev).
import type { Lang } from "../lang.ts";

type Reason = "patch" | "plugin" | "ownership" | "manifest";
interface SkillCatchupWords {
  notice: (
    root: string,
    source: string,
    installed: string,
    target: string,
    reason: Reason,
    command: string,
  ) => string;
}

export const SKILL_CATCHUP: Readonly<Record<Lang, SkillCatchupWords>> = {
  en: {
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
