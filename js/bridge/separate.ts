// Чьё место под именем и куда встать (граф nks-dev: #5402, #5407, решение
// владельца #6706): чужим местом не подписываются и его не перехватывают.
// Место, которое держит прежний мост ЭТОЙ ЖЕ сессии харнесса (перезапуск,
// компакшн), — своё: мост возвращает его сам. Место, которое держит другая
// сессия, — её: встают рядом на `имя.N` со слухом. «Держит» читается
// положительно — живой локальный сокет места, который держит не этот мост,
// либо доска «слушает», а запись держания этой сессии этого не опровергает
// (держатель вне каталога гранта или своё не доказано); чья сессия — по записи
// держания, которую пишет держатель.
import { sameDir } from "../shared/canon.ts";
import { harnessName } from "./client.ts";
import { holdsStanding, isParked, ledKey, localSocketPathOf, wasEvicted } from "./hold.ts";
import { keyOf, readHoldRecord, seatBaseOf, sessionOfBridge } from "./holdrecord.ts";
import { NAME_MAX } from "./names.ts";
import { resumeFromDisk } from "./resume.ts";
import { SEP } from "./separatewords.ts";
import { localSocketAlive } from "./sweep.ts";

/**
 * Основа места: та, от которой его выбрал мост (запись держания, #6706); не
 * знает — место считается основным: по виду имени основу не угадать.
 */
export const baseOf = (realm: string, karta: string | number, name: string): string =>
  seatBaseOf(keyOf(realm, karta, name)) ?? name;

/** Имя отдельного места номер n; не укладывается в предел — база укорачивается с конца. */
export const suffixed = (base: string, n: number): string =>
  base.slice(0, NAME_MAX - `.${n}`.length).replace(/[-._]+$/, "") + `.${n}`;

/**
 * Своё по записи держания: на ней стояла та же сессия харнесса, что у этого
 * моста (харнесс, не называющий сессий, — без сессии с обеих сторон, и запись
 * этого харнесса из этого каталога `cwd`: мёртвый предшественник здесь — всё,
 * что о нём известно; дом моста общий у всех каталогов и харнессов), а
 * локальный сокет места не отвечает. Доска может ещё читать его слушающим —
 * место возвращается по записи со слухом, не подписью без него (#6706).
 */
export async function ownByRecord(
  realm: string,
  karta: string | number,
  name: string,
  cwd: string,
): Promise<boolean> {
  const key = keyOf(realm, karta, name);
  const rec = readHoldRecord(key);
  const me = sessionOfBridge();
  if (!rec || (rec.session ?? null) !== me) return false;
  if (!me && (rec.client !== harnessName() || !sameDir(rec.cwd, cwd))) return false;
  return !(await localSocketAlive(localSocketPathOf(key)));
}

/** Кто держит место: этот мост, прежний мост этой сессии, кто-то другой — или никто. */
type Holder = "mine" | "session" | "taken" | "free";

async function holderOf(
  realm: string,
  karta: string,
  name: string,
  listensOnBoard: (name: string) => boolean,
  cwd: string,
): Promise<Holder> {
  // Ушёл с места словом — своё, пока адрес жив: взявшая его сессия повернула бы адрес,
  // и возврат это докажет отказом сокета (stand.ts); доска в окне после ухода ещё читает «слушает».
  if (holdsStanding(realm, karta, name) || isParked(realm, karta, name)) return "mine";
  if (wasEvicted(realm, karta, name)) return "taken"; // отнял другой держатель (4000)
  const key = keyOf(realm, karta, name);
  if (ledKey() === key) return "mine"; // своё место в окне переоткрытия сокета
  if (await localSocketAlive(localSocketPathOf(key))) {
    const me = sessionOfBridge();
    return me && readHoldRecord(key, true)?.session === me ? "session" : "taken";
  }
  // Запись другой названной сессии — её место, хоть доска и не читает его слушающим:
  // её мост вернёт его сам (перезапуск сервиса харнесса), возврат с диска не наш.
  if (theirsByRecord(key)) return "taken";
  // Доска «слушает», а живого локального держателя нет: своё доказывает только
  // запись этой сессии (возврат по ней); иначе слушающий — не наш, встаём рядом.
  return listensOnBoard(name) && !(await ownByRecord(realm, karta, name, cwd)) ? "taken" : "free";
}

/**
 * На месте по записи держания стояла другая названная сессия (запись свежая и не
 * отпущена словом): место её, и мост этой сессии с диска его не возвращает (#6706, #6702 В).
 */
export function theirsByRecord(key: string): boolean {
  const rec = readHoldRecord(key);
  return !!rec?.session && !rec.left && rec.session !== sessionOfBridge();
}

export type PlaceChoice = { name: string; own: boolean; note: string | null } | { refusal: string };

/**
 * Куда встать под именем base: на него самого (своё, свободное либо прежнего
 * моста этой сессии — `own`, его мост возвращает сам), иначе на первое `root.N`,
 * которое свободно или своё. `root` — основа, от которой выбрано base (место
 * рядом, названное своим именем, — его основа, не proba.2.2); у основного — оно
 * само. Все сто заняты — отказ: подписи без слуха нет.
 * `taken` — имена, занятые наверняка (возврат по записи не дал слуха).
 */
export async function placeFor(
  realm: string,
  karta: string,
  base: string,
  listensOnBoard: (name: string) => boolean,
  cwd: string,
  taken: ReadonlySet<string> = new Set(),
  root = base,
): Promise<PlaceChoice> {
  const holder = async (name: string): Promise<Holder> =>
    taken.has(name) ? "taken" : await holderOf(realm, karta, name, listensOnBoard, cwd);
  const first = await holder(base);
  if (first !== "taken") {
    const own = first === "session";
    return { name: base, own, note: own ? SEP.ownSession(base) : null };
  }
  for (let n = 2; n <= 99; n++) {
    const cand = suffixed(root, n);
    if (cand === base) continue;
    const h = await holder(cand);
    if (h === "taken") continue;
    const own = h === "session";
    return { name: cand, own, note: SEP.beside(base, cand, own) };
  }
  return { refusal: SEP.noFree(base) };
}

export type Resumed = { word: string; pending: number };

/**
 * Выбор места с возвратом по записи (#6706): доска читает выбранное место —
 * само имя или своё место рядом `имя.N` — слушающим, а своё доказывает запись
 * держания — место возвращается с диска со слухом сразу; возврат не дал слуха —
 * место считается занятым, встаём на следующее.
 * Место другого графа рядом (`besideRealm`) с диска не возвращается — его
 * слух даёт register на канале этого моста.
 */
export async function seatFor(
  realm: string,
  karta: string,
  base: string,
  listensOnBoard: (name: string) => boolean,
  besideRealm: boolean,
  cwd: string,
  root = base,
): Promise<{ choice: PlaceChoice; resumed: Resumed | null }> {
  const taken = new Set<string>();
  for (;;) {
    const choice = await placeFor(realm, karta, base, listensOnBoard, cwd, taken, root);
    if ("refusal" in choice || choice.own || besideRealm) return { choice, resumed: null };
    const at = choice.name;
    if (!listensOnBoard(at) || !(await ownByRecord(realm, karta, at, cwd)))
      return { choice, resumed: null };
    const resumed = await resumeFromDisk(realm, karta, at);
    if (resumed)
      return {
        choice: at === base ? choice : { ...choice, note: SEP.beside(base, at, true) },
        resumed,
      };
    taken.add(at);
  }
}
