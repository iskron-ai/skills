// Доска стояний — проза сервера (граф nks-dev: #4514), разобранная по
// наблюдённой форме: строка места `#N … · @handle:name — …`, за ней `📥 адрес`.
// Управляющие действия идут только по распознанной однозначной форме.
import { NAME_MAX } from "./names.ts";

export interface BoardEntry {
  karta: string;
  address: string;
  rest: string;
  incoming: string | null;
}

/** Строки доски: `#N … · @handle:name — …`, за ними `📥 https://…`. */
export function parseBoard(text: string): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out.push({ karta: m[1], address: m[2], rest: m[3], incoming: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out.length) out[out.length - 1].incoming = inc[1];
  }
  return out;
}

/** Своя половина имени из адреса `@handle:name` — сравнивать её целиком: `endsWith(":proba")` совпало бы и на соседе `x.proba`. */
export const nameOf = (address: string): string => address.slice(address.indexOf(":") + 1);

/** Слушает ли место по доске — признак присутствия, не трафика. */
export const listens = (e: BoardEntry): boolean => /(^|·)\s*слушает/.test(e.rest);

/** Сколько кадров доска называет недоставленными у места; 0 — строка об этом молчит. */
export function undelivered(e: BoardEntry): number {
  const m = /не доставлено\s+(\d+)/.exec(e.rest);
  return m ? Number(m[1]) : 0;
}

/** Номер отдельного места `база.N` (N ≥ 2) либо null, если имя не из этого ряда. */
export function suffixOf(base: string, name: string): number | null {
  if (!name.startsWith(`${base}.`)) return null;
  const tail = name.slice(base.length + 1);
  return /^[2-9]$|^[1-9]\d+$/.test(tail) && Number(tail) >= 2 ? Number(tail) : null;
}

/**
 * Первое свободное отдельное место выведенного имени: `база.2`, `база.3`, … —
 * которого нет на доске, которое никто не слушает или которое держит этот мост.
 * Не укладывается в предел имени — база укорачивается с конца (#5402).
 */
export function freeSuffix(
  entries: BoardEntry[],
  karta: string,
  base: string,
  heldHere: (name: string) => boolean,
): string | null {
  for (let n = 2; n <= 99; n++) {
    const tail = `.${n}`;
    const cand = base.slice(0, NAME_MAX - tail.length).replace(/[-._]+$/, "") + tail;
    const e = entries.find((x) => x.karta === karta && nameOf(x.address) === cand);
    if (!e || !listens(e) || heldHere(cand)) return cand;
  }
  return null;
}
