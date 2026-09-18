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
import { frameToText } from "../shared/frame-text.ts";
import type { Context } from "./plugin.ts";
import { type Say } from "./tools.ts";

export interface Channel {
  /**
   * Дверь половины «тулы»: событие моста сессии `session` (null — мост ещё
   * ничей); `child` — мост дочерней сессии, вставшей своим вызовом.
   */
  onEvent(session: string | null, params: unknown, child?: boolean): void;
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
  ): Promise<void> {
    let id = session;
    if (child && (!id || !(await accepting(id)))) {
      // Место дочерней сессии пережило её: корню этот кадр не адресован — там
      // стоит другое стояние (#5167). Громко, и кадр остаётся в истории места.
      say(
        `Искрон: ${frame} на место дочерней сессии ${id ?? "?"}, которой больше нет, — корню не переадресую; ` +
          `кадр остаётся в истории стояния (iskron_channel history); место дочерней сессии — лишнее на канале, где корень стоит дальше: снимать ли его revoke, решай, зная цену (standing) —${text.slice(0, 120)}`,
        "error",
      );
      return;
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
      return;
    }
    try {
      await ctx.session.prompt({ sessionID: id, text, delivery });
      say(`Искрон: ${frame} вложен в сессию ${id}`, "info");
    } catch (e) {
      say(`Искрон: ${frame} не вложился в сессию ${id}: ${(e as Error).message}`, "error");
    }
  }

  function loud(session: string | null, text: string): void {
    say(text, "error");
    void deliver(session, text);
  }

  return {
    onEvent(session, params: any, child = false) {
      const ev = params?.data as ChannelEvent | undefined;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          // Служебные кадры не будят: hello доказывает, что сокет держат, и только.
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          // Стопка слова комнаты (#4957, дешёвая ступень): defer — не прерывать,
          // очередью до конца хода; interrupt и кадр без стопки — вставкой в идущий ход.
          const stack = (frame as Record<string, unknown> | null)?.stack;
          void deliver(
            session,
            frameToText(frame, ev.raw ?? ""),
            `кадр ${frame?.id ?? "без id"}`,
            stack === "defer" ? "queue" : "steer",
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
              "Привязка записей цела; вернуть слух сюда — iskron_stand с take=true.",
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
