// Строки моста на поверхности вызова (граф @nks/nks-dev, узел #4238): момент скилла
// writing у пишущих тулов, статус и уход у тула канала. Та же строка момента стоит
// в двери iskron (карта моментов).
import type { Lang } from "../lang.ts";

export interface MomentWords {
  /** Строка момента скилла writing — в начало описания пишущего тула. */
  moment: () => string;
  /** Занятость — ход моста (#6509). */
  status: () => string;
  /** Уход с места — ход моста. */
  leave: () => string;
}

export const MOMENT: Readonly<Record<Lang, MomentWords>> = {
  ru: {
    moment: () =>
      "[мост] " +
      "Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; вопрос по сути или обязательство — вимаршей `posed_to` отвечающей роли с «Отвечено, когда»; разовая задача или вопрос — в деле, кончается исходом; отказ доставки рода не меняет; строки CHECKS в ответе — работа этого такта.",
    status: () =>
      '[мост] Занятость ставит iskron_stand(realm, status) на месте, которое мост уже держит, — основной ход; action="status" (realm, text до 64 символов) — прежний, оставлен для совместимости: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.',
    leave: () =>
      '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). У места-спутника субагента уход полный: место отпущено целиком, почта не копится, возврата нет — встать снова можно только iskron_stand с satellite_of. Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.',
  },
  en: {
    moment: () =>
      "[bridge] " +
      "The writing skill's moment: before each node, name the reader, what will change retrieval and what is new here; type and given_as, the three modes as claims, a thesis name, arrows with sense; the body is present knowledge, never provenance: who said it, when, by whose hand — lives in the node's history and in the case, a node is rewritten, not appended with a section; hint is a transformation's seed: only what matters after the session, not a log; a substantive question or obligation is a vimarsha with `posed_to` to the answering role and an answer criterion; a one-off task or question belongs in a case and ends with its outcome; delivery refusal does not change its kind; the CHECKS lines in the reply are this beat's work.",
    status: () =>
      '[bridge] Busyness is set by iskron_stand(realm, status) on a seat the bridge already holds — the main move; action="status" (realm, text up to 64 characters) is the former one, kept for compatibility: the bridge, the socket holder, executes it, the call does not go to the server; an empty text clears; a surface refusal comes whole.',
    leave: () =>
      '[bridge] action="leave" (realm) — leave the seat: the bridge executes it — the socket is closed, busyness cleared, address, queue and hooks intact; mail piles up and arrives on return (the watchdog or iskron_stand). For a subagent\'s satellite seat the leave is total: the seat is released whole, mail does not pile up, there is no return — standing again is only iskron_stand with satellite_of. The bridge itself leaves only where a frame reaches only through a watchdog (Claude Code, Codex) and the watchdog has not been armed for 15 minutes; in pi and OpenCode a frame comes as a notification, and the bridge does not abandon the seat. Busyness clears at the end of the session.',
  },
};
