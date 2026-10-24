// Слова POST занятости: нудж обрезки (граф @nks/nks-dev, узлы #6729, #6730) и
// отказы статусного адреса.
import type { Lang } from "../lang.ts";

export interface StatusPostWords {
  /** Слово сервера об обрезке. */
  trimmedBy: (message: string) => string;
  trimmed: () => string;
  noAnswer: (error: string) => string;
  /** body — тело ответа, может быть пустым. */
  gone: (body: string) => string;
  refused: (status: number, body: string) => string;
  /** The channel goes through the dispatcher and no subscription carries it now. */
  notSubscribed: () => string;
}

export const STATUS_POST: Readonly<Record<Lang, StatusPostWords>> = {
  ru: {
    trimmedBy: (message) => `строка обрезана сервером: ${message}`,
    trimmed: () => "сервер обрезал строку; переназови короче",
    noAnswer: (error) => `Отказано (мост): статусный адрес не ответил — ${error}`,
    gone: (body) =>
      `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
    refused: (status, body) => `Отказано (${status}) поверхностью: ${body || "без тела"}`,
    notSubscribed: () =>
      "Отказано (мост): канал идёт через диспетчер, а подписки на него сейчас нет — строка не ушла; старый адрес статуса мост зовёт только при откате на сокет",
  },
  en: {
    trimmedBy: (message) => `the server trimmed the line: ${message}`,
    trimmed: () => "the server trimmed the line; rename it shorter",
    noAnswer: (error) => `Refused (bridge): the status address did not answer — ${error}`,
    gone: (body) =>
      `Refused (404) by the surface: ${body || "no body"} — this seat address no longer addresses: another holder's connect may have turned it, or another instance of the same session's bridge may have held it. Whose it is now, the bridge cannot know from here.`,
    refused: (status, body) => `Refused (${status}) by the surface: ${body || "no body"}`,
    notSubscribed: () =>
      "Refused (bridge): the channel goes through the dispatcher and no subscription carries it now — the line did not go; the old status address is called only after falling back to a socket",
  },
};
