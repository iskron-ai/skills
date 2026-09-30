// Стоящие вызовы половины «тулы» (tools.ts) и дочерняя сессия — спутник места
// корня (граф nks-dev: #6002): держит корень место — мост ребёнка поднимается с
// --satellite, и его iskron_stand встаёт местом «место корня».sub-N в роли,
// которую назвал агент (не назвал — роль корня).

/** Тул моста, которому плагин подставляет директорию сессии (cwd) для вывода имени. */
export const STAND_TOOL = "iskron_stand";

/** Вызов, чей успех означает: сессия стоит (мост держит место либо привязан к нему). */
export function standsBy(name: string, args: Record<string, unknown>): boolean {
  if (name === STAND_TOOL) return true;
  return name === "iskron_channel" && ["connect", "mint", "register"].includes(String(args.action));
}

/**
 * Аргументы iskron_stand, которые мост исполняет одной занятостью (#6509): status
 * без аргументов занятия. Её успех — не держание: после отъёма он успешен при
 * чужом сокете; держание плагин знает по слову моста «held» и hello.
 */
function busyOnly(args: Record<string, unknown>): boolean {
  if (typeof args.status !== "string") return false;
  const set = (v: unknown): boolean => v != null && v !== false && v !== "";
  return !["model", "room", "take", "repeat_knock", "mute_siblings"].some((k) => set(args[k]));
}

/** Место, которое держит мост, — как его называет слово моста «held». */
export type Place = { realm: string; karta: string; name: string };

export interface SatelliteSlot {
  /** Место, которое держит мост, — из «held». */
  place?: Place | null;
  /** Мост дочерней сессии поднят спутником (`--satellite`) этого места корня. */
  satelliteOf?: Place | null;
}

/** Место из данных слова «held»; мост старше #6002 его не называет — null. */
export function heldPlace(data: { place?: Partial<Place> } | undefined): Place | null {
  const p = data?.place;
  if (typeof p?.name !== "string" || !p.name) return null;
  return { realm: String(p.realm), karta: String(p.karta), name: p.name };
}

/**
 * Аргументы iskron_stand спутника: место корня, роль — названная агентом, иначе роль корня.
 * Мост ребёнка уже ведёт место (слово «held»), а вызов — одна занятость (#6509): роль
 * корня не подставляется — спутник в своей роли иначе ушёл бы полным путём занятия.
 * Возвращает, одна ли это занятость: её успех держанием не считается.
 */
export function asSatellite(
  args: Record<string, unknown>,
  of: Place | null | undefined,
  leads = false,
): boolean {
  const busy = busyOnly(args);
  if (!of) return busy;
  args.satellite_of ??= of.name;
  if (!(leads && busy) && (args.karta == null || args.karta === "")) args.karta = of.karta;
  return busy;
}
