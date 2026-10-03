// Записи маркера потери (marker.ts): локация экземпляра плагина и запись о
// месте, которое держал его мост (граф nks-dev: #5140, #6626, #6625).

/** Локация экземпляра плагина (ctx.location): каталог и рабочее пространство. */
export interface Home {
  directory: string;
  workspace?: string | null;
}

export interface LostEntry {
  session: string;
  dir: string | null;
  key: string | null;
  child?: boolean;
  /** Запись переноса сессии в другую папку (moves.ts), не остановки экземпляра. */
  moved?: boolean;
  of?: { realm: string; karta: string; name: string } | null;
  room?: string | null;
  noted?: boolean;
  /** Имя места ребёнка и его последний текст — итог по концу после перезагрузки. */
  name?: string;
  last?: string;
}

/** Запись маркера: ребёнок несёт место корня, дело поручения, сказанный ход, имя места и последний текст. */
export const entryOf = (e: LostEntry): LostEntry => ({
  session: e.session,
  dir: e.dir ?? null,
  key: e.key ?? null,
  child: !!e.child,
  ...(e.moved ? { moved: true } : {}),
  ...(e.child
    ? {
        of: e.of ?? null,
        room: e.room ?? null,
        ...(e.noted ? { noted: true } : {}),
        ...(e.name ? { name: e.name } : {}),
        ...(e.last ? { last: e.last } : {}),
      }
    : {}),
});
