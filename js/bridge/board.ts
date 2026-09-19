// Доска стояний — проза сервера (граф nks-dev: #4514), разобранная по
// наблюдённой форме: строка места `#N … · @handle:name — …`, за ней `📥 адрес`.
// Управляющие действия идут только по распознанной однозначной форме.

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
