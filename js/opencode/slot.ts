// Мост одной сессии — слот половины «тулы» (tools.ts); тип отдельно, чтобы его брали
// и модули, которые tools.ts зовёт (twins.ts, half.ts), без круга импортов.
import { type KeptSlot, WATCH_MS } from "./keep.ts";
import type { SatelliteSlot } from "./satellite.ts";

/**
 * Мост сессии, которая давно молчит и ничего не держит, отпускается. Инвариант:
 * IDLE_MS > WATCH_MS — сторож слуха (keep.ts) смотрит за стоявшим слотом чаще,
 * чем жнец его сжимает, иначе мост, потерявший место, ушёл бы прежде возврата.
 */
export const IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 60_000);
if (IDLE_MS <= WATCH_MS)
  process.stderr.write(
    `[iskron/warning] ISKRON_BRIDGE_IDLE_MS (${IDLE_MS}) не длиннее такта сторожа слуха (${WATCH_MS}): слот может быть сжат прежде возврата места\n`,
  );
/** Шаг жнеца простоя; переменная — для проб. */
export const REAP_MS = Number(process.env.ISKRON_BRIDGE_REAP_MS || 60_000);

/** Мост одной сессии. */
export interface Slot extends KeptSlot, SatelliteSlot {
  /** Рукопожатие прошло — можно звать тулы. */
  ready: Promise<unknown>;
  /** Корневая сессия, которой принадлежит мост; null — ещё никому не отдан. */
  session: string | null;
  lastCall: number;
  /** Вызовов в полёте — мост посреди вызова жнецу не отдаётся. */
  busy: number;
  /** Мост остановлен самим плагином — его выход не потеря слуха. */
  ownStop: boolean;
}
