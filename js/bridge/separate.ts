// Отдельное место для второй живой сессии под тем же выведенным именем —
// другой сессии или субагента (граф nks-dev: #5402, решение владельца в
// #5407): живого слушателя не вытесняют, а встают рядом на `имя.N`. «Занято»
// читается положительно — живой локальный сокет места, который держит не этот
// мост; отсутствие записи или «не слушает» на доске занятости не доказывают.
import { holdsStanding, isParked, localSocketPathOf } from "./hold.ts";
import { keyOf } from "./holdrecord.ts";
import { NAME_MAX } from "./names.ts";
import { localSocketAlive } from "./sweep.ts";

/** Номер отдельного места `база.N` (N ≥ 2) либо null, если имя не из этого ряда. */
export function suffixOf(base: string, name: string): number | null {
  if (!name.startsWith(`${base}.`)) return null;
  const tail = name.slice(base.length + 1);
  return /^[1-9]\d*$/.test(tail) && Number(tail) >= 2 ? Number(tail) : null;
}

/** Имя отдельного места номер n; не укладывается в предел — база укорачивается с конца. */
export const suffixed = (base: string, n: number): string =>
  base.slice(0, NAME_MAX - `.${n}`.length).replace(/[-._]+$/, "") + `.${n}`;

/** Первое `база.N`, которое свободно по слову `free` (своё или без живого чужого моста). */
export async function freeSuffix(
  base: string,
  free: (name: string) => Promise<boolean>,
): Promise<string | null> {
  for (let n = 2; n <= 99; n++) {
    const cand = suffixed(base, n);
    if (await free(cand)) return cand;
  }
  return null;
}

/**
 * Держит ли выведенное имя живой мост ДРУГОЙ сессии (его локальный сокет жив, а
 * место не этого моста — не держит и не запарковал); если да — первое свободное
 * имя.N и слово для ответа, иначе null.
 */
export async function separatePlace(
  realm: string,
  karta: string,
  derived: string,
): Promise<{ name: string; note: string } | null> {
  const mineHere = (n: string): boolean =>
    holdsStanding(realm, karta, n) || isParked(realm, karta, n);
  const liveElsewhere = async (n: string): Promise<boolean> =>
    !mineHere(n) && (await localSocketAlive(localSocketPathOf(keyOf(realm, karta, n))));
  if (!(await liveElsewhere(derived))) return null;
  const name = await freeSuffix(derived, async (n) => !(await liveElsewhere(n)));
  if (!name) return null;
  return {
    name,
    note: `место ${derived} держит живая сессия другого моста — встаю рядом на ${name}, её не трогаю; если ${derived} — твоё место по памяти этой сессии (её мост перезапущен; субагенту основное место не своё), вернись: iskron_stand(name="${derived}", take=true); вытеснять чужую сессию — только словом человека`,
  };
}
