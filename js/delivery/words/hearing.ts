// Слова о том, слушает ли место другая сессия (граф @nks/nks-dev, узел #6706): отказы
// сырого connect, mint, register и «agent», не разрешённого в число.
import type { Lang } from "../lang.ts";

export interface HearingWords {
  /** what — действие, которое могло бы встать вторым местом или взять чужое. */
  unresolvedAgent: (what: string) => string;
  otherListens: (seat: string) => string;
  unknownListens: (seat: string) => string;
  /** who — otherListens или unknownListens; action — connect, mint или register. */
  rawSeatRefusal: (who: string, action: string) => string;
}

export const HEARING: Readonly<Record<Lang, HearingWords>> = {
  ru: {
    unresolvedAgent: (what) =>
      `Отказано (мост): karta="agent" — мост не ведёт места в этом графе и не знает, какой роли это имя у этой сессии, а место под сентинелом не сличить ни с доской, ни с прежним держанием (${what} мог бы встать вторым местом или взять чужое). Назови роль числом — роль агента из AGENTS.md.`,
    otherListens: (seat) => `место ${seat} слушает другая сессия`,
    unknownListens: (seat) =>
      `слушает ли место ${seat} другая сессия, мост не знает (доска не прочлась или разобрана не целиком)`,
    rawSeatRefusal: (who, action) =>
      `Отказано (мост): ${who} — ${action} ${action === "register" ? "подписал бы записи чужим местом" : "отнял бы его"}; вызов не отправлен. Встань iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`,
  },
  en: {
    unresolvedAgent: (what) =>
      `Refused (bridge): karta="agent" — the bridge leads no seat in this graph and does not know which role this session held the name under, and a seat under the sentinel matches neither the board nor a former hold (${what} could make a second seat or take another's). Name the role by number — the agent's role from AGENTS.md.`,
    otherListens: (seat) => `another session listens on the seat ${seat}`,
    unknownListens: (seat) =>
      `the bridge does not know whether another session listens on the seat ${seat} (the board did not read, or not all of it)`,
    rawSeatRefusal: (who, action) =>
      `Refused (bridge): ${who} — ${action} ${action === "register" ? "would sign writes with another's seat" : "would take it"}; the call was not sent. Stand with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`,
  },
};
