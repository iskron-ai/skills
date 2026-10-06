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
  say(text: string): void;
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
  async function touch(session: string): Promise<void> {
    const s: any = await ctx.session.create({ parentID: session, title: KEEPALIVE_TITLE } as any);
    const id = s?.id ?? s?.data?.id;
    // remove есть у контекста OpenCode 2.0.22, но не в типах @opencode/plugin 2.0.4.
    if (typeof id === "string") await (ctx.session as any).remove({ sessionID: id });
  }
  const timer = setInterval(
    () => {
      if (busy || Date.now() - last < EVERY_MS) return;
      const held = d.holders();
      if (!held.length) return; // без места каталог не держим
      busy = true;
      last = Date.now();
      void touch(held[0])
        .catch((e: Error) => d.say(`Искрон: каталог не продлён событием сессии — ${e.message}`))
        .finally(() => (busy = false));
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
