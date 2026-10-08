// Поля кадра комнаты, общие словарю родов (room-kinds.ts) и родам вопроса
// (asks.ts): чтение значений, своё место, своя роль, адресат, поля слов.

export type Rec = Record<string, unknown>;
export const obj = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
export const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

export const after = (key: string, prefix: string): string =>
  key.startsWith(prefix) ? key.slice(prefix.length) : key;

/** Required field of a word: the value, "?" when empty. */
export const need = (v: unknown): string => str(v) || "?";

/** Optional field of a word: separator and value, nothing when empty. */
export const opt = (sep: string, v: unknown): string => {
  const x = str(v);
  return x ? sep + x : "";
};

/** The word of a dictionary for a value the server sends; an unknown value — undefined. */
export const pick = <T extends object>(dict: T, key: string): T[keyof T] | undefined =>
  Object.hasOwn(dict, key) ? dict[key as keyof T] : undefined;

/** Своё стояние кадра для ключа invite — id места и его адрес: формат ключа (#5893 §4.2) ещё не подтверждён. */
export const mineOf = (frame: Rec): string[] =>
  [str(frame.to_standing_id), str(frame.to_standing)].filter(Boolean);

/**
 * Приглашение моей роли (api 0.89.6): ключ несёт id узла роли, поля строки —
 * karta {id, name, seq, realm} (наблюдено на бою), кадр — мой karta_seq. seq
 * принадлежит графу: названные с обеих сторон графы обязаны совпасть.
 */
export function myRole(frame: Rec, fields: Rec): boolean {
  const ka = obj(fields.karta);
  const seq = str(ka.seq);
  if (!seq || seq !== str(frame.karta_seq)) return false;
  const theirs = str(ka.realm);
  const mine = str(frame.realm) || str(obj(frame.room).realm);
  return !theirs || !mine || theirs === mine;
}

/**
 * Адресат слова (api 0.91.3, наблюдено на бою): верхний addressee конверта —
 * строка-адрес места; объект места {standing | handle+name, id, name} тоже
 * принимается. addr — чем сравнивать с моим местом, label — как назвать.
 */
export function addresseeOf(v: unknown): { addr: string[]; label: string } | null {
  if (typeof v === "string") return v ? { addr: [v], label: v } : null;
  const o = obj(v);
  const handle = str(o.handle).replace(/^@/, "");
  const standing =
    str(o.standing) || (handle ? `@${handle}${str(o.name) ? `:${str(o.name)}` : ""}` : "");
  const id = str(o.id);
  const name = str(o.standing) ? str(o.name) : "";
  const label = name && standing ? `${name} (${standing})` : standing || str(o.name) || id;
  const addr = [standing, id].filter(Boolean);
  return addr.length ? { addr, label } : null;
}
