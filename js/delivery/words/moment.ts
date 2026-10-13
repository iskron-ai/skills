// Строки моста на поверхности вызова (граф @nks/nks-dev, узел #4238): статус и уход
// у тула канала. Момента скилла writing мост не приписывает — его несёт строка сервера (#7557).
import type { Lang } from "../lang.ts";

export interface MomentWords {
  /** Занятость — ход моста (#6509). */
  status: () => string;
  /** Уход с места — ход моста. */
  leave: () => string;
}

export const MOMENT: Readonly<Record<Lang, MomentWords>> = {
  ru: {
    status: () =>
      '[мост] Занятость ставит iskron_stand(realm, status) на месте, которое мост уже держит, — основной ход; action="status" (realm, text до 64 символов) — прежний, оставлен для совместимости: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.',
    leave: () =>
      '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). У места-спутника субагента уход полный: место отпущено целиком, почта не копится, возврата нет — встать снова можно только iskron_stand с satellite_of. Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.',
  },
  en: {
    status: () =>
      '[bridge] Busyness is set by iskron_stand(realm, status) on a seat the bridge already holds — the main move; action="status" (realm, text up to 64 characters) is the former one, kept for compatibility: the bridge, the socket holder, executes it, the call does not go to the server; an empty text clears; a surface refusal comes whole.',
    leave: () =>
      '[bridge] action="leave" (realm) — leave the seat: the bridge executes it — the socket is closed, busyness cleared, address, queue and hooks intact; mail piles up and arrives on return (the watchdog or iskron_stand). For a subagent\'s satellite seat the leave is total: the seat is released whole, mail does not pile up, there is no return — standing again is only iskron_stand with satellite_of. The bridge itself leaves only where a frame reaches only through a watchdog (Claude Code, Codex) and the watchdog has not been armed for 15 minutes; in pi and OpenCode a frame comes as a notification, and the bridge does not abandon the seat. Busyness clears at the end of the session.',
  },
};
