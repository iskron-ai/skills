// Место держит каталог загруженным. OpenCode 2.0.22 (@opencode/LocationActivity)
// выгружает службы каталога через 60 мин без сохраняемых событий его сессий
// (Session.Event.Durable); GET, SSE и открытый TUI срок не продлевают, настройки нет.
// С выгрузкой останавливается плагин, мост отпускает место — и кадры с побудками
// не доходят до первого запроса к каталогу, ночью часами. Пока в экземпляре есть
// занятое место, плагин сам кладёт сохраняемое событие: метаданные сессии с местом
// перезаписываются теми же (update → session.metadata.updated). Хода оно не будит
// (core: message-updater его пропускает), но двигает time.updated сессии.
/* eslint-disable @typescript-eslint/no-explicit-any -- события и ответы SDK без схемы */
import type { Context } from "./plugin.ts";

/** Порог тишины до события; 0 — выключено. Срок каталога — 60 мин. */
const EVERY_MS = (() => {
  const v = process.env.ISKRON_KEEPALIVE_MS;
  return v === undefined || v === "" ? 50 * 60_000 : Number(v) || 0;
})();

// Сохраняемые события сессий OpenCode 2.0.22 (schema/session-event.ts, durable): только
// они продлевают срок. Дельты, прогресс тула и usage.updated — нет; неизвестное — тоже не
// считается: лишнее событие дешевле выгрузки.
const DURABLE =
  /^session\.(created|renamed|moved|forked|deleted|metadata\.updated|agent\.selected|model\.selected|permissions|viewed|synthetic|execution\.(started|succeeded|failed|interrupted)|inbox\.(enqueued|delivered|cancelled|delivery\.changed)|(step|text|reasoning|compaction)\.(started|ended|failed)|tool\.(called|success|failed|input\.(started|ended))|shell\.(started|ended)|skill\.activated|instructions\.updated|message\.content\.updated|usage\.recorded|retry\.scheduled|revert\.(staged|cleared|committed))$/;

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
    const s: any = await ctx.session.get({ sessionID: session } as any);
    const metadata = s?.metadata ?? s?.data?.metadata ?? {};
    await (ctx.session as any).update({ sessionID: session, metadata });
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
      if (typeof s === "string" && DURABLE.test(String(ev?.type)) && d.owns(s)) last = Date.now();
    },
    stop: () => clearInterval(timer),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
