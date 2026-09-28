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

/** Аргументы iskron_stand спутника: место корня, роль — названная агентом, иначе роль корня. */
export function asSatellite(args: Record<string, unknown>, of: Place | null | undefined): void {
  if (!of) return;
  args.satellite_of ??= of.name;
  if (args.karta == null || args.karta === "") args.karta = of.karta;
}
