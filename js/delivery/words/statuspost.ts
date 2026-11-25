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
  /** 404 no_live_standing: канал жив, живого места на нём нет — адрес не повернут. */
  noLiveStanding: (body: string) => string;
  /** Строка НЕ поставлена: повтор тоже отказан; why — последнее слово поверхности или register. */
  notSet: (why: string) => string;
  refused: (status: number, body: string) => string;
  /** The channel goes through the dispatcher and no subscription carries it now. */
  notSubscribed: () => string;
  /** A live subscription carries the channel, but the line names no seat of it. */
  seatUnnamed: () => string;
  /** Why the line did not go: its time limit passed while it waited its turn. */
  late: () => string;
  /** status_trimmed диспетчера: предел строки назван (#11337). */
  trimmedTo: (max: number, message: string) => string;
  /** status_rejected диспетчера: строка НЕ поставлена, reason — его слово. */
  rejected: (reason: string) => string;
  /** Кадр status не ушёл: соединение диспетчера не открыто в этот миг. */
  linkClosed: () => string;
  /**
   * Не отказано, но и не известно как поставлено: silent — ответа не было за 3 с; earlier —
   * ответ без ref мог быть прежней строки; held — строка ждёт hello подписки.
   */
  unconfirmed: (kind: "silent" | "earlier" | "held") => string;
}

export const STATUS_POST: Readonly<Record<Lang, StatusPostWords>> = {
  ru: {
    trimmedBy: (message) => `строка обрезана сервером: ${message}`,
    trimmed: () => "сервер обрезал строку; переназови короче",
    noAnswer: (error) => `Отказано (мост): статусный адрес не ответил — ${error}`,
    gone: (body) =>
      `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
    noLiveStanding: (body) =>
      `Отказано (404) поверхностью: ${body || "без тела"} — канал жив, но живого места на нём нет`,
    notSet: (why) =>
      `Отказано (мост): строка занятости НЕ поставлена${why ? ` — ${why}` : ""}; перезайми место явным stand и скажи строку снова`,
    refused: (status, body) => `Отказано (${status}) поверхностью: ${body || "без тела"}`,
    notSubscribed: () =>
      "Отказано (мост): канал идёт через диспетчер, а подписки на него сейчас нет — строка не ушла; старый адрес статуса мост зовёт только при откате на сокет",
    seatUnnamed: () =>
      "Отказано (мост): подписка на канал жива, но место строки не названо — на канале несколько мест, а id своего мост не знает; строка не ушла",
    late: () => "предел вышел, пока строка ждала очереди",
    trimmedTo: (max, message) =>
      `сервер обрезал строку до ${max} знаков${message ? ` (${message})` : ""}; переназови короче`,
    rejected: (reason) =>
      `Отказано поверхностью: строка занятости НЕ поставлена — ${reason || "без причины"}`,
    linkClosed: () => "соединение диспетчера сейчас не открыто, кадр не ушёл",
    unconfirmed: (kind) =>
      ({
        silent:
          "отправлена; сервер пока не подтверждает строку — не отказано, исход ещё не известен",
        earlier:
          "отправлена; исход не известен — ответ мог быть ещё прежней строки, его подтверждение в пути",
        held: "ждёт подписки на канал через диспетчер и уйдёт, когда она оживёт",
      })[kind],
  },
  en: {
    trimmedBy: (message) => `the server trimmed the line: ${message}`,
    trimmed: () => "the server trimmed the line; rename it shorter",
    noAnswer: (error) => `Refused (bridge): the status address did not answer — ${error}`,
    gone: (body) =>
      `Refused (404) by the surface: ${body || "no body"} — this seat address no longer addresses: another holder's connect may have turned it, or another instance of the same session's bridge may have held it. Whose it is now, the bridge cannot know from here.`,
    noLiveStanding: (body) =>
      `Refused (404) by the surface: ${body || "no body"} — the channel is alive but carries no live seat`,
    notSet: (why) =>
      `Refused (bridge): the busy line was NOT set${why ? ` — ${why}` : ""}; take the seat again with an explicit stand and say the line once more`,
    refused: (status, body) => `Refused (${status}) by the surface: ${body || "no body"}`,
    notSubscribed: () =>
      "Refused (bridge): the channel goes through the dispatcher and no subscription carries it now — the line did not go; the old status address is called only after falling back to a socket",
    seatUnnamed: () =>
      "Refused (bridge): the channel's subscription lives, but the line names no seat — the channel carries several and the bridge does not know its own id; the line did not go",
    late: () => "its limit passed in the turn",
    trimmedTo: (max, message) =>
      `the server trimmed the line to ${max} characters${message ? ` (${message})` : ""}; rename it shorter`,
    rejected: (reason) =>
      `Refused by the surface: the busy line was NOT set — ${reason || "no reason given"}`,
    linkClosed: () => "the dispatcher connection is not open right now, the frame did not go",
    unconfirmed: (kind) =>
      ({
        silent:
          "sent; the server does not confirm the line yet — not refused, outcome not known yet",
        earlier: "sent; outcome not known — an earlier line's answer may still be in flight",
        held: "waits for the dispatcher subscription of the channel and goes once it is live",
      })[kind],
  },
};
