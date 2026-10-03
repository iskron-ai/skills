// Дела, где сидит ведущий субагент (leads.ts; граф nks-dev: #6625, #6550 правило 4) —
// по его успешным вызовам своим мостом, не по тексту ответов: join и in_room называют
// номер, talk и open_room заводят дело, чей номер вызов не несёт, — тогда «сидит»
// без номера, и его конец держит лишь уход из дел целиком или потолок простоя.

export interface Seat {
  room?: string; // дело поручения — первое, куда вошёл; номер без знака
  rooms?: Set<string>;
  blind?: boolean; // сидит в деле без известного номера
}

export const roomNo = (room: unknown): string =>
  String(room ?? "").replace(/^\s*[#№]\s*|\s+$/g, "");

/** Ведущий сидит хоть в одном деле — конец хода не конец, ему есть чьих кадров ждать. */
export const sits = (s: Seat): boolean => !!s.blind || !!s.rooms?.size;

/** Учесть успешный вызов ребёнка; уход по исходу — его причина, иначе null. */
export function seatCall(s: Seat, name: string, args: Record<string, unknown>): string | null {
  const room = name === "iskron_case" || name === "iskron_room" ? roomNo(args.room) : null;
  const inRoom = roomNo(args.in_room);
  if (inRoom) (s.rooms ??= new Set()).add(inRoom);
  if (args.open_room || (room !== null && args.action === "talk")) s.blind = true;
  if (args.action === "join" && room) {
    s.room ??= room;
    (s.rooms ??= new Set()).add(room);
  }
  if (args.action !== "leave") return null;
  if (name === "iskron_channel") return "ушёл с места по исходу";
  if (room === "") {
    s.rooms?.clear();
    s.blind = false;
    return "ушёл из дел по исходу";
  }
  if (room) s.rooms?.delete(room);
  return room && room === s.room ? `вышел из дела №${s.room} по исходу` : null;
}
