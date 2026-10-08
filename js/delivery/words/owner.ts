// Отказ занять роль владельца (主) без слова человека (граф @nks/nks-dev, узел #6550).
import type { Lang } from "../lang.ts";

export interface OwnerWords {
  /** what — чья это роль; env — переменная слова человека. */
  refused: (what: string, env: string) => string;
  /** karta "me" или "realm-owner". */
  human: (karta: string) => string;
  /** why — причина, уже укороченная ядром. */
  unread: (seq: string, why: string) => string;
  incomplete: () => string;
}

export const OWNER: Readonly<Record<Lang, OwnerWords>> = {
  ru: {
    refused: (what, env) =>
      `Отказано (мост): ${what} — роль владельца (主). Агент не занимает её без слова человека; ` +
      `слово человека — настройка ${env}=1 в окружении моста, которую ставит он сам. ` +
      "Встань своей ролью (karta) — той, что назвал тебе человек или AGENTS.md как роль агента.",
    human: (karta) => `karta="${karta}" — роль самого человека`,
    unread: (seq, why) =>
      `Отказано (мост): тип роли #${seq} не прочитался (${why}) — роль владельца без проверки не занимается; повтори.`,
    incomplete: () => "список ролей владельца неполон",
  },
  en: {
    refused: (what, env) =>
      `Refused (bridge): ${what} is the owner's role (主). An agent does not take it without the human's word; ` +
      `the human's word is the setting ${env}=1 in the bridge's environment, set by the human. ` +
      "Stand in your own role (karta) — the one the human or AGENTS.md named as the agent's.",
    human: (karta) => `karta="${karta}" is the human's own role`,
    unread: (seq, why) =>
      `Refused (bridge): the type of role #${seq} could not be read (${why}) — the owner's role is not taken unchecked; retry.`,
    incomplete: () => "the list of the owner's roles is incomplete",
  },
};
