// Доска стояний — проза сервера (граф nks-dev: #4514), разобранная по
// наблюдённой форме: строка места `#N … · @handle:name — …`, за ней `📥 адрес`.
// Управляющие действия идут только по распознанной однозначной форме.

export interface BoardEntry {
  karta: string;
  address: string;
  rest: string;
  incoming: string | null;
  /** Собственный id места — строка `id <uuid>` под строкой места; доска без неё — null. */
  id: string | null;
}

/** Строки доски: `#N … · @handle:name — …`, за ними `📥 https://…` и `id <uuid>`. */
export function parseBoard(text: string): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out.push({ karta: m[1], address: m[2], rest: m[3], incoming: null, id: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out.length) out[out.length - 1].incoming = inc[1];
    const id = /^\s*id\s+([0-9a-f][0-9a-f-]{7,})\s*$/i.exec(line);
    if (id && out.length) out[out.length - 1].id = id[1];
  }
  return out;
}

/** Своя половина имени из адреса `@handle:name` — сравнивать её целиком: `endsWith(":proba")` совпало бы и на соседе `x.proba`. */
export const nameOf = (address: string): string => address.slice(address.indexOf(":") + 1);

/**
 * Слова доски и списка хуков на обоих языках сервера: мост на английской
 * поверхности просит accept-language: en. Машинных полей у ответов нет (#6632 п.2);
 * русские формы наблюдены (#4514), английские — предположены, не наблюдены.
 */
export const FORM = {
  boardHeader: /^\s*(?:Каналы|Channels)(?:\s*\((\d+)\))?(?:\s|:|$)/m,
  boardEmpty:
    /^\s*(?:Ни одна роль этого графа (?:не держит канала|нигде не стоит)|No role (?:of|in) this graph (?:holds a channel|stands anywhere))/m,
  listens: /(^|·)\s*(?:слушает|listening)/,
  alive: /живой|слушает|\blive\b|listening/,
  undelivered: /(?:не доставлено|undelivered)\s+(\d+)/,
  hooksHeader: /^\s*(?:Вебхуки|Webhooks)(?:\s|:|\(|$)/m,
  hooksEmpty: /вебхуки не зарегистрированы|no webhooks (?:are )?registered/i,
  hookActive: /активен|\bactive\b/,
  hookState: /активен|пауза|\bactive\b|\bpaused\b/,
  seatId:
    /(?:id этого места|id of this (?:seat|place))[^\n]*\n\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
};

/** Слушает ли место по доске — признак присутствия, не трафика. */
export const listens = (e: BoardEntry): boolean => FORM.listens.test(e.rest);

/** Сколько кадров доска называет недоставленными у места; 0 — строка об этом молчит. */
export function undelivered(e: BoardEntry): number {
  const m = FORM.undelivered.exec(e.rest);
  return m ? Number(m[1]) : 0;
}
