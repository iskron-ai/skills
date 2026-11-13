// Слова механического запрета опросников и проверки его слоёв (#10397).
import type { Lang } from "../lang.ts";

export interface QuestionWords {
  guard: string;
  permissions: string;
  denyArray: string;
  manual: (file: string, reason: "both" | "parse" | "shape" | "missing") => string;
  fileBasis: string;
  pluginBasis: string;
  instructions: string;
  claudeProject: string;
  claudePlugin: string;
  claudeFile: string;
  opencodeFile: string;
  opencodeMissing: string;
  opencodeGuard: string;
}

export const QUESTIONS: Readonly<Record<Lang, QuestionWords>> = {
  ru: {
    guard: "Задай вопрос карточкой ask в деле, не блокирующим инструментом question.",
    permissions: "permissions должен быть объектом",
    denyArray: "permissions.deny должен быть массивом строк",
    manual: (file, reason) =>
      `${file}: ${
        {
          both: "одновременно стоят JSON и JSONC — устрани неоднозначность вручную",
          parse: "конфиг не разбирается — исправь вручную",
          shape: "неподдержанная форма конфига — исправь вручную",
          missing: "нет политики tool.use/question:*/deny — добавь вручную",
        }[reason]
      }`,
    fileBasis: "содержимое файлов, не живой харнес",
    pluginBasis: "манифест / подставной контекст, не живой харнес",
    instructions:
      "Нет явного запрета question / AskUserQuestion и пути через ask в деле (проверено только содержимое)",
    claudeProject: "Нет проектного permissions.deny AskUserQuestion",
    claudePlugin: "Нет отказа плагина Claude (проверка манифеста, не живого исполнения)",
    claudeFile: "Плагин Claude hooks/hooks.json",
    opencodeFile: "Плагин OpenCode",
    opencodeMissing: "Плагин OpenCode недоступен",
    opencodeGuard:
      "Плагин OpenCode не удалил/запретил question либо запретил действие дела (подставной контекст)",
  },
  en: {
    guard: "Use a case ask card, not the blocking question tool.",
    permissions: "permissions must be an object",
    denyArray: "permissions.deny must be a string array",
    manual: (file, reason) =>
      `${file}: ${
        {
          both: "both JSON and JSONC exist — resolve the ambiguity manually",
          parse: "cannot parse configuration — repair manually",
          shape: "unsupported configuration shape — repair manually",
          missing: "missing tool.use/question:*/deny policy — add manually",
        }[reason]
      }`,
    fileBasis: "file contents, not live harness",
    pluginBasis: "manifest / stand-in context, not live harness",
    instructions:
      "Missing explicit question / AskUserQuestion prohibition and case ask route (content check only)",
    claudeProject: "Missing project permissions.deny AskUserQuestion",
    claudePlugin: "Claude plugin denial unavailable (manifest check, not live harness enforcement)",
    claudeFile: "Claude plugin hooks/hooks.json",
    opencodeFile: "OpenCode plugin",
    opencodeMissing: "OpenCode plugin unavailable",
    opencodeGuard:
      "OpenCode plugin did not remove/deny question or denied unrelated case action (stand-in context)",
  },
};
