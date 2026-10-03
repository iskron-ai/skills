// Имя места-спутника (граф nks-dev: #6002) — одно правило для моста, который его
// выбирает (bridge/satellite.ts), и плагина OpenCode, который узнаёт спутника
// ребёнка по имени его места (opencode/satellite.ts): база — имя места позвавшего,
// укороченная с конца под предел сервера, затем `.sub-<N>`.

/** Правило имени стояния у сервера (наблюдено отказом 400). */
export const NAME_MAX = 48;

export const SUB_RE = /\.sub-([1-9]\d*)$/;

/** Имя спутника номер n; не укладывается в предел — база укорачивается с конца. */
export const satelliteName = (base: string, n: number): string =>
  base.slice(0, NAME_MAX - `.sub-${n}`.length).replace(/[-._]+$/, "") + `.sub-${n}`;

/** Своё ли имя-спутник для этой базы (любой номер). */
export function isSatelliteOf(base: string, name: string): boolean {
  const m = SUB_RE.exec(name);
  return !!m && satelliteName(base, Number(m[1])) === name;
}
