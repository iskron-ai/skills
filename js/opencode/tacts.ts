// Такт внимания в сессии OpenCode (граф nks-dev: #6569; правило — shared/seen.ts foldedTacts).
// Голове кадр в час, каждый со своим id, и ход в несколько часов копил их в очереди
// OpenCode подряд. Пока ход сессии занят, такт в очередь не встаёт — ждёт конца хода,
// новый вытесняет ждущий: освободившись, агент видит один, последний. Занят — сессия
// сказала busy и ещё не встала, либо промпт такта ждёт в её очереди невзятым (взятие
// начинает ход — занят и дальше).
import { type ChannelEvent } from "../bridge/hold.ts";
import { isTact, onlyTacts } from "../shared/seen.ts";
import { type Say } from "./tools.ts";

/**
 * Такт ждёт конца занятого хода не дольше этого, считая от первого задержанного: о
 * конце хода OpenCode может молчать. Тот же предел снимает «занят» по промпту такта,
 * о взятии которого OpenCode молчит.
 */
const WAKE_HOLD_MS = Number(process.env.ISKRON_OPENCODE_WAKE_HOLD_MS) || 6 * 3_600_000;

/** Промпт очередью в сессию; null — не вложился, inbox null — без id взятия. */
type Send = (
  session: string | null,
  text: string,
  what: string,
  child: boolean,
) => Promise<{ session: string; inbox: string | null } | null>;

export interface Tacts {
  /** Пачка лежалых или побудки с тактом — взята здесь (true): вложена или ждёт конца хода. */
  offer(session: string | null, child: boolean, ev: ChannelEvent, what: string): boolean;
  /** Ход сессии занят (session.status busy). */
  busy(session: string): void;
  /** Промпт взят (`inbox`) или сессия встала (без id): вставшей — ждущий такт сейчас. */
  taken(session: string, inbox?: string): void;
  /** Плагин останавливают: ждущие такты уходят сейчас. */
  stop(): void;
}

/** `takenEarly` — id взятых раньше ответа на prompt (общий с пачками дела channel.ts). */
export function setupTacts(
  send: Send,
  takenEarly: Set<string>,
  freshestRoot: () => string | null,
  say: Say,
): Tacts {
  const busy = new Set<string>();
  const queued = new Map<string, { session: string; at: number }>(); // inbox → сессия
  const held = new Map<
    string,
    {
      session: string | null;
      child: boolean;
      ev: ChannelEvent;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const occupied = (id: string): boolean => {
    for (const [k, q] of queued) if (q.at + WAKE_HOLD_MS <= Date.now()) queued.delete(k);
    return busy.has(id) || [...queued.values()].some((q) => q.session === id);
  };

  function put(session: string | null, child: boolean, ev: ChannelEvent, what: string): void {
    void send(session, ev.text ?? "", what, child).then((got) => {
      if (!got?.inbox || takenEarly.delete(got.inbox)) return; // без id взятия не увидеть
      queued.set(got.inbox, { session: got.session, at: Date.now() });
      for (const k of queued.keys()) if (queued.size > 100) queued.delete(k);
    });
  }

  function release(id: string): void {
    const t = held.get(id);
    if (!t) return;
    held.delete(id);
    clearTimeout(t.timer);
    put(t.session, t.child, t.ev, "такт внимания");
  }

  return {
    offer(session, child, ev, what) {
      const id = session ?? freshestRoot();
      if (!id || !ev.frames?.some(isTact)) return false;
      const prev = held.get(id);
      if (!onlyTacts(ev.frames) || !occupied(id)) {
        if (prev) clearTimeout(prev.timer);
        held.delete(id); // такт новее ждущего входит сейчас
        put(session, child, ev, what);
        return true;
      }
      const timer = prev?.timer ?? setTimeout(() => release(id), WAKE_HOLD_MS);
      (timer as { unref?: () => void }).unref?.();
      held.set(id, { session, child, ev, timer });
      say("Искрон: такт внимания ждёт конца хода сессии — прежний ждущий свёрнут", "info");
      return true;
    },
    busy(session) {
      busy.add(session);
    },
    taken(session, inbox) {
      if (inbox) return void queued.delete(inbox);
      busy.delete(session);
      for (const [k, q] of queued) if (q.session === session) queued.delete(k);
      release(session);
    },
    stop() {
      for (const id of [...held.keys()]) release(id);
    },
  };
}
