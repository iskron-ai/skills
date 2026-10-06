// Мост одной сессии — слот половины «тулы» (tools.ts); тип отдельно, чтобы его брали
// и модули, которые tools.ts зовёт (twins.ts, half.ts), без круга импортов.
import type { KeptSlot } from "./keep.ts";
import type { SatelliteSlot } from "./satellite.ts";

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
