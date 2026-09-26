// Половина «канал» — кадры стояния внутри сессии OpenCode (граф nks-dev: #4266).
//
// Сокет стояния держит мост сессии (дочерний процесс плагина, свой у каждой
// корневой сессии): переоткрывает, различает мёртвый токен, публикует
// занятость. Плагину остаётся то, чего у моста нет, — вложить кадр в сессию
// агента промптом (ctx.session.prompt). У промпта OpenCode 2 два способа
// вложения (поверхность харнеса: «Enter steers the active session, Alt+Enter
// queues the prompt for later»): steer входит в идущий ход следующим шагом,
// queue ждёт конца хода — и очередь харнес отдаёт по одному промпту на ход.
// Живой кадр и громкое слово о слухе идут steer: с queue у делателя с длинными
// ходами кадры всплывали по одному за ход и отставали часами (граф nks-dev:
// #5233). Пачка побудки и лежалых — queue: она не срочна и ход не режет.
// Кадры дела «в пачку» — тоже queue, но одним промптом на пачку, как у сторожа:
// шапка с указателем на history и по строке на кадр. Пока прежний промпт пачки
// не взят ходом, новые кадры копятся здесь (дописать неотданный промпт
// контекст плагина не даёт) и уходят одним, когда OpenCode скажет, что взял.
// Прямое слово и слово человека в пачку не ложатся — steer, целиком.
// Доставка есть возврат управления агенту; кадр, ушедший в лог, — глушитель
// (урок контура opencode-плагина канала: делатель стоит глухим, считая себя
// слушающим).
//
// Адресат — сессия, чей мост принёс кадр: адрес приходит вместе с событием,
// угадывать нечего. Кадр от моста, ещё никому не отданного, идёт в свежайшую
// корневую сессию, которую плагин видел (списка сессий у контекста OpenCode 2
// нет); дочерняя сессия (субагент) — адресат только своего моста, поднятого её
// собственным стоянием (#5154), угадыванием она не выбирается.
import { type ChannelEvent } from "../bridge/hold.ts";
import { classifyOrigin, type Frame, isDirectWord } from "../shared/channel.ts";
import { batchHead, batchLines, frameToText } from "../shared/frame-text.ts";
import { roomKind, stackOf } from "../shared/room-kinds.ts";
import type { Context } from "./plugin.ts";
import { type Say } from "./tools.ts";

export interface Channel {
  /**
   * Дверь половины «тулы»: событие моста сессии `session` (null — мост ещё
   * ничей); `child` — мост дочерней сессии, вставшей своим вызовом.
   */
  onEvent(session: string | null, params: unknown, child?: boolean): void;
  /** OpenCode взял промпт из очереди сессии (`inbox` — его id) или сессия встала (без id). */
  taken(session: string, inbox?: string): void;
  /** Плагин останавливают: накопленное уходит сейчас, не умирает с ним. */
  stop(): void;
}

/** Окно пачки дела; переменная — шов для проб, не ручка человека. */
const CASE_BATCH_MS = Number(process.env.ISKRON_OPENCODE_BATCH_MS) || 5_000;
/** Полная пачка уходит, не дожидаясь окна. */
const CASE_BATCH_CAP = 20;
/** Промпт пачки, о взятии которого OpenCode молчит дольше, считается взятым: кадры не ждут вечно. */
const PENDING_MAX_MS = Number(process.env.ISKRON_OPENCODE_PENDING_MS) || 120_000;

/**
 * Кадр дела в пачку: стопка batch, не прямое слово и не слово человека (его
 * полёт и обрыв — в пачку, как и его адресное слово не мне, #6081).
 */
function toPile(frame: Frame | null): boolean {
  if (!frame || frame.type !== "message" || stackOf(frame) !== "batch" || isDirectWord(frame))
    return false;
  const rk = roomKind(frame);
  return (frame.origin ?? classifyOrigin(frame)) !== "human" || !!rk?.phase || !!rk?.aside;
}

interface Pile {
  session: string | null;
  child: boolean;
  held: Frame[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Промпт пачки в очереди сессии, ещё не взятый ходом; inbox null — ещё в полёте. */
  pending: { session: string; inbox: string | null; at: number } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- уведомления моста без схемы */

export function setupChannel(ctx: Context, say: Say, freshestRoot: () => string | null): Channel {
  /** Сессия ещё принимает слово: существует и не в архиве. */
  async function accepting(id: string): Promise<boolean> {
    try {
      const info: any = await ctx.session.get({ sessionID: id } as any);
      return !(info?.time?.archived ?? info?.data?.time?.archived);
    } catch {
      return false;
    }
  }

  // Каждое вложение — строкой в лог с адресом и кадром, отказ — громко: кадр,
  // прочитанный мостом и не дошедший до хода, снаружи неотличим от глухоты,
  // а доска при этом говорит «слушает» (граф nks-dev: #4355).
  async function deliver(
    session: string | null,
    text: string,
    frame = "кадр",
    delivery: "steer" | "queue" = "steer",
    child = false,
  ): Promise<{ session: string; inbox: string | null } | null> {
    let id = session;
    if (child && (!id || !(await accepting(id)))) {
      // Место дочерней сессии пережило её: корню этот кадр не адресован — там
      // стоит другое стояние (#5167). Громко, и кадр остаётся в истории места.
      say(
        `Искрон: ${frame} на место дочерней сессии ${id ?? "?"}, которой больше нет, — корню не переадресую; ` +
          `кадр остаётся в истории стояния (iskron_channel history); место дочерней сессии — лишнее на канале, где корень стоит дальше: снимать ли его revoke, решай, зная цену (standing) —${text.slice(0, 120)}`,
        "error",
      );
      return null;
    }
    if (id && !(await accepting(id))) {
      say(
        `Искрон: сессия ${id} закрыта или в архиве — ${frame} идёт в свежайшую виденную`,
        "warning",
      );
      id = null;
    }
    id ??= freshestRoot();
    if (id && id !== session && !(await accepting(id))) id = null;
    if (!id) {
      say(
        `Искрон: ${frame} ВЛОЖИТЬ НЕКУДА — плагин не видел живой корневой сессии; кадр остаётся в истории стояния — ` +
          text.slice(0, 120),
        "error",
      );
      return null;
    }
    try {
      const r: any = await ctx.session.prompt({ sessionID: id, text, delivery });
      say(`Искрон: ${frame} вложен в сессию ${id}`, "info");
      const inbox = r?.id ?? r?.data?.id;
      return { session: id, inbox: typeof inbox === "string" ? inbox : null };
    } catch (e) {
      say(`Искрон: ${frame} не вложился в сессию ${id}: ${(e as Error).message}`, "error");
      return null;
    }
  }

  // Пачки дела — по мосту-адресату: копятся окном, а пока прежний промпт пачки
  // ждёт в очереди сессии — до его взятия. Кадр покидает пачку, только войдя в
  // отданный промпт.
  const piles = new Map<string, Pile>();
  const takenEarly = new Set<string>();

  function schedule(p: Pile): void {
    if (p.timer) clearTimeout(p.timer);
    const wait = p.pending
      ? Math.max(0, p.pending.at + PENDING_MAX_MS - Date.now())
      : CASE_BATCH_MS;
    p.timer = setTimeout(() => {
      p.timer = null;
      p.pending = null; // окно вышло либо OpenCode молчит о взятии дольше предела
      flush(p);
    }, wait);
    (p.timer as { unref?: () => void }).unref?.();
  }

  function flush(p: Pile): void {
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (!p.held.length) return;
    const frames = p.held.splice(0);
    const at = Date.now();
    p.pending = { session: "", inbox: null, at };
    const text = [batchHead(frames), ...batchLines(frames)].join("\n");
    void deliver(p.session, text, `пачка дела (${frames.length})`, "queue", p.child).then((got) => {
      // Без id взятия не увидеть: следующая пачка — по окну, не по взятию.
      const inbox = got?.inbox && !takenEarly.delete(got.inbox) ? got.inbox : null;
      p.pending = got && inbox ? { session: got.session, inbox, at } : null;
      if (p.held.length) schedule(p);
    });
  }

  function pile(session: string | null, child: boolean, frame: Frame): void {
    const key = `${child ? "child" : "root"}:${session ?? ""}`;
    let p = piles.get(key);
    if (!p) piles.set(key, (p = { session, child, held: [], timer: null, pending: null }));
    if (frame.id && p.held.some((f) => f.id === frame.id)) return; // повтор ждущего
    p.held.push(frame);
    if (!p.pending && p.held.length >= CASE_BATCH_CAP) return flush(p);
    if (!p.timer) schedule(p);
  }

  function loud(session: string | null, text: string): void {
    say(text, "error");
    void deliver(session, text);
  }

  return {
    taken(session, inbox) {
      let matched = false;
      for (const p of piles.values()) {
        if (!p.pending || (inbox ? p.pending.inbox !== inbox : p.pending.session !== session))
          continue;
        matched = true;
        p.pending = null;
        flush(p); // накопленное за ходом уже подождало — уходит сейчас
      }
      // Взятие обогнало ответ на prompt: id запоминается, пачка сверит его по ответу.
      if (inbox && !matched) {
        takenEarly.add(inbox);
        for (const old of takenEarly) if (takenEarly.size > 100) takenEarly.delete(old);
      }
    },
    stop() {
      for (const p of piles.values()) {
        p.pending = null;
        flush(p);
      }
    },
    onEvent(session, params: any, child = false) {
      const ev = params?.data as ChannelEvent | undefined;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          // Путь кадра (#5851): с event_kind — правило рода, без него — своя стопка
          // кадра, как прежде (#4957); пачка — одним промптом очередью, прочее — вставкой.
          if (frame && toPile(frame)) return pile(session, child, frame);
          void deliver(
            session,
            frameToText(frame, ev.raw ?? ""),
            `кадр ${frame?.id ?? "без id"}`,
            "steer",
            child,
          );
          return;
        }
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` +
              (ev.code === 4001 ? ' или action="mint"' : "") +
              ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.",
          );
          return;
        case "stale":
          if (ev.text) void deliver(session, ev.text, "пачка лежалых кадров", "queue"); // одна пачка — один промпт
          return;
        case "backlog":
          // Побудка с накопленным — один промпт на пачку, не ход на кадр (#5140).
          // Очередью — сознательная развилка: пачка в полтора десятка кадров,
          // вставленная посреди хода, режет работу делателя; одним промптом она
          // по одному за ход не всплывёт, а ждёт лишь конца текущего хода.
          if (ev.text)
            void deliver(session, ev.text, `пачка побудки (${ev.frames?.length ?? 0})`, "queue");
          return;
        case "lost":
          // Держащий мост вышел или прежний плагин остановили: громко, в сессию.
          if (ev.text) loud(session, ev.text);
          return;
        case "resumed":
          // Мост вернул место сам (#5366): занятое имя — в сессию, как и потеря слуха.
          if (ev.text) {
            say(ev.text, "warning");
            void deliver(session, ev.text, "слово о возвращённом месте");
          }
          return;
        case "held":
          say(`Искрон: мост держит стояние ${ev.key ?? ""}`, "info");
          return;
        case "released":
          say(`Искрон: мост отпустил стояние ${ev.key ?? ""} — ${ev.text ?? ""}`, "warning");
          return;
        case "evicted":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. ` +
              "Привязка записей цела; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека.",
          );
          return;
        case "alive":
          loud(
            session,
            `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; ` +
              "не пройдёт — спроси о токене.",
          );
          return;
        case "note":
          if (ev.text) say(`Искрон: ${ev.text}`, "warning");
          return;
        default:
          return;
      }
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
