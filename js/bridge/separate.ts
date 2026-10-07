// Чьё место под именем и куда встать (граф nks-dev: #5402, #5407, решение
// владельца #6706): чужим местом не подписываются и его не перехватывают.
// Место, которое держит прежний мост ЭТОЙ ЖЕ сессии харнесса (перезапуск,
// компакшн), — своё: мост возвращает его сам. Место, которое держит другая
// сессия, — её: встают рядом на `имя.N` со слухом. «Держит» читается
// положительно — живой локальный сокет места, который держит не этот мост,
// либо доска «слушает» без своей записи держания (держатель вне этого каталога
// гранта); чья сессия — по записи держания, которую пишет живой держатель.
import { L } from "../shared/lang.ts";
import { holdsStanding, isParked, ledKey, localSocketPathOf, wasEvicted } from "./hold.ts";
import { keyOf, readHoldRecord, sessionOfBridge } from "./holdrecord.ts";
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

/** Слушающим доска читает прежний мост этого каталога, а он мёртв: запись держания цела, локальный сокет не отвечает. */
export async function deadPredecessor(
  realm: string,
  karta: string | number,
  name: string,
): Promise<boolean> {
  const key = keyOf(realm, karta, name);
  if (!readHoldRecord(key)) return false;
  return !(await localSocketAlive(localSocketPathOf(key)));
}

/** Кто держит место: этот мост, прежний мост этой сессии, кто-то другой — или никто. */
type Holder = "mine" | "session" | "taken" | "free";

async function holderOf(
  realm: string,
  karta: string,
  name: string,
  listensOnBoard: (name: string) => boolean,
): Promise<Holder> {
  if (holdsStanding(realm, karta, name) || isParked(realm, karta, name)) return "mine";
  if (wasEvicted(realm, karta, name)) return "taken"; // отнял другой держатель (4000)
  const key = keyOf(realm, karta, name);
  if (ledKey() === key) return "mine"; // своё место в окне переоткрытия сокета
  if (await localSocketAlive(localSocketPathOf(key))) {
    const me = sessionOfBridge();
    return me && readHoldRecord(key, true)?.session === me ? "session" : "taken";
  }
  // Доска «слушает», а живого локального держателя нет: запись цела — мёртвый
  // предшественник этого каталога (возврат с диска); записи нет — держатель вне его.
  return listensOnBoard(name) && !readHoldRecord(key) ? "taken" : "free";
}

export type PlaceChoice = { name: string; own: boolean; note: string | null } | { refusal: string };

/**
 * Куда встать под именем base: на него самого (своё, свободное либо прежнего
 * моста этой сессии — `own`, его мост возвращает сам), иначе на первое `base.N`,
 * которое свободно или своё. Все сто заняты — отказ: подписи без слуха нет.
 */
export async function placeFor(
  realm: string,
  karta: string,
  base: string,
  listensOnBoard: (name: string) => boolean,
): Promise<PlaceChoice> {
  const first = await holderOf(realm, karta, base, listensOnBoard);
  if (first !== "taken") {
    const own = first === "session";
    return { name: base, own, note: own ? SEP.ownSession(base) : null };
  }
  for (let n = 2; n <= 99; n++) {
    const cand = suffixed(base, n);
    const h = await holderOf(realm, karta, cand, listensOnBoard);
    if (h === "taken") continue;
    const own = h === "session";
    return { name: cand, own, note: SEP.beside(base, cand, own) };
  }
  return { refusal: SEP.noFree(base) };
}

const SEP = {
  ownSession: (base: string): string =>
    L(
      `место ${base} держал прежний мост этой же сессии харнесса (перезапуск или компакшн) — своё место этой сессии, мост вернул его сам`,
      `the seat ${base} was held by a former bridge of this same harness session (a restart or a compaction) — this session's own seat, the bridge took it back itself`,
    ),
  beside: (base: string, name: string, own: boolean): string =>
    L(
      `место ${base} держит другая сессия — её место не трогаю и им не подписываюсь; встаю рядом на ${name} со слухом${own ? " (его держал прежний мост этой же сессии — вернул сам)" : ""}: это своё место, кадры по нему идут сюда; вытеснить ту сессию (take=true) — только словом человека`,
      `another session holds the seat ${base} — leaving its seat alone and not signing with it; standing beside as ${name} with hearing${own ? " (a former bridge of this same session held it — taken back)" : ""}: it is this session's own seat, its frames come here; evicting that session (take=true) — only on the human's word`,
    ),
  noFree: (base: string): string =>
    L(
      `Отказано (мост): место ${base} держит другая сессия, и все места рядом ${base}.2…99 заняты — подписываться чужим местом без слуха мост не станет; прибери погасшие места либо назови другое name.`,
      `Refused (bridge): another session holds the seat ${base}, and every seat beside ${base}.2…99 is taken — the bridge will not sign with another's seat without hearing; clear the dead seats or pass another name.`,
    ),
};
