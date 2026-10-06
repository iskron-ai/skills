// Место держит каталог загруженным. OpenCode 2.0.22 (@opencode/LocationActivity)
// выгружает службы каталога через 60 мин без сохраняемых событий его сессий
// (Session.Event.Durable); GET, SSE и открытый TUI срок не продлевают, настройки нет.
// С выгрузкой останавливается плагин, мост отпускает место — и кадры с побудками
// не доходят до первого запроса к каталогу, ночью часами. Пока в экземпляре есть
// занятое место, плагин сам кладёт такое событие.
//
// Срок продлевает только событие с конвертом location: его ставит окружающая Location
// вызова (HTTP с sessionLocationMiddleware, исполнение хода) либо явный {location} в
// publish. Вызовы ctx.session.* плагина идут без окружающей Location — update
// метаданных событие кладёт, а срок не продлевает (живой прогон: событие в 09:53, выгрузка
// в 10:03). Явный {location} из поверхности плагина ставит только session.create. Поэтому
// событие — дочерняя сессия места, созданная и сразу удалённая: её session.created несёт
// location родителя, ход ей не даётся, корневой список её не показывает.
//
// ЦЕНА. Каталог, где занято место, не выгружается никогда — службы каталога живут, пока
// живо место. И выгрузка больше не снимает зависший ход: перед выгрузкой сервер прерывал
// ходы каталога с reason "inactivity", теперь этого не будет — зависший ход снимает человек
// (отмена). Выключатель — ISKRON_KEEPALIVE_MS=0 (SETUP.md, раздел OpenCode).
/* eslint-disable @typescript-eslint/no-explicit-any -- события и ответы SDK без схемы */
import type { Context } from "./plugin.ts";

/** Порог тишины до события; 0 — выключено. Срок каталога — 60 мин. */
const EVERY_MS = (() => {
  const v = process.env.ISKRON_KEEPALIVE_MS;
  return v === undefined || v === "" ? 50 * 60_000 : Number(v) || 0;
})();

// События хода OpenCode 2.0.22 (schema/session-event.ts, durable) — их публикует исполнение
// в Location каталога, и они продлевают срок сами. Слова плагина (synthetic, inbox, правки
// сессии) идут без Location и не продлевают; дельты, прогресс тула, usage.updated не
// сохраняются. Неизвестное не считается: лишнее событие дешевле выгрузки.
const DURABLE =
  /^session\.(execution\.(started|succeeded|failed|interrupted)|(step|text|reasoning|compaction)\.(started|ended|failed)|tool\.(called|success|failed|input\.(started|ended))|shell\.(started|ended)|skill\.activated|instructions\.updated|message\.content\.updated|usage\.recorded|retry\.scheduled)$/;

/** Заголовок дочерней сессии-однодневки: по нему её узнают в событиях и журнале. */
export const KEEPALIVE_TITLE = "iskron: каталог держит место";

export interface KeepAlive {
  /** Событие сервиса: сохраняемое событие сессии этого экземпляра продлевает срок само. */
  onEvent(ev: any): void;
  stop(): void;
}

export interface KeepDoors {
  /** Сессии экземпляра с занятым местом (корень с местом, живой ведущий спутник). */
  holders(): string[];
  /** Сессия этого экземпляра: её события продлевают срок его каталога. */
  owns(session: string): boolean;
  say(text: string, level?: "warning" | "error"): void;
}

/** Сессии держащих слотов, корни первыми: событие ляжет в корень с местом. */
export const holdersOf = (
  slots: Iterable<{ holding: boolean; session?: string | null; child?: boolean }>,
): string[] =>
  [...slots]
    .filter((x) => x.holding && x.session)
    .sort((a, b) => Number(!!a.child) - Number(!!b.child))
    .map((x) => x.session as string);

export function createKeepAlive(ctx: Context, d: KeepDoors): KeepAlive {
  if (EVERY_MS <= 0) return { onEvent() {}, stop() {} };
  let last = Date.now();
  let busy = false;
  const leftover = new Set<string>(); // служебные сессии, которые удалить не вышло
  // remove есть у контекста OpenCode 2.0.22, но не в типах @opencode/plugin 2.0.4.
  const remove = (id: string): Promise<unknown> => (ctx.session as any).remove({ sessionID: id });
  async function touch(session: string): Promise<void> {
    let s: any;
    try {
      s = await ctx.session.create({ parentID: session, title: KEEPALIVE_TITLE } as any);
    } catch (e) {
      return d.say(
        `Искрон: каталог не продлён — служебная сессия не создана: ${(e as Error).message}`,
      );
    }
    // Создана — срок продлён (её session.created несёт location); дальше только уборка.
    const id = s?.id ?? s?.data?.id;
    if (typeof id !== "string")
      return d.say(
        `Искрон: каталог продлён, но id служебной сессии из ответа create не разобран (${JSON.stringify(s ?? null).slice(0, 160)}) — она останется дочерней сессией места «${KEEPALIVE_TITLE}», удали её руками`,
        "error",
      );
    try {
      await remove(id).catch(() => remove(id)); // один повтор
    } catch (e) {
      leftover.add(id);
      d.say(
        `Искрон: каталог продлён, служебная сессия ${id} не удалена (${(e as Error).message}) — повторю на следующем такте`,
      );
    }
  }
  /** Неудалённые служебные сессии — по одной попытке на такт. */
  async function sweep(): Promise<void> {
    for (const id of [...leftover])
      await remove(id).then(
        () => leftover.delete(id),
        () => {},
      );
  }
  const timer = setInterval(
    () => {
      if (busy) return;
      if (leftover.size) {
        busy = true;
        void sweep().finally(() => (busy = false));
        return;
      }
      if (Date.now() - last < EVERY_MS) return;
      const held = d.holders();
      if (!held.length) return; // без места каталог не держим
      busy = true;
      last = Date.now();
      void touch(held[0]).finally(() => (busy = false));
    },
    Math.max(50, Math.min(60_000, EVERY_MS / 5)),
  );
  timer.unref?.();
  return {
    onEvent(ev) {
      const s = ev?.data?.sessionID;
      // Только событие с конвертом location продлевает срок — синтетика плагина его не несёт.
      if (typeof s === "string" && ev?.location && DURABLE.test(String(ev?.type)) && d.owns(s))
        last = Date.now();
    },
    stop: () => clearInterval(timer),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
