// The bridge's observed realm-list rows; completeness is only known for its Russian header.
import { REALM_LIST_GROUP, REALM_LIST_HEADER } from "../delivery/index.ts";

const LIST_LINE_RE = /^ {4}(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) {2}(r\d+) {2}.* · /;
const rowOf = (line: string): { canonical: string; short: string } | null => {
  const m = LIST_LINE_RE.exec(line);
  return m ? { canonical: m[1], short: m[2] } : null;
};

/** Alias learning needs rows, even when the surrounding prose is not recognised. */
export const realmListRows = (text: string): { canonical: string; short: string }[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const row = rowOf(line);
    return row ? [row] : [];
  });

/** Absence requires a complete list, not merely zero recognised rows. English is unknown. */
export function completeRealmList(text: string): string[] | null {
  const header = REALM_LIST_HEADER.exec(text);
  if (!header || text.slice(0, header.index).trim()) return null;
  const refs: string[] = [];
  for (const line of text.slice(header.index + header[0].length).split(/\r?\n/)) {
    if (!line.trim() || REALM_LIST_GROUP.test(line)) continue;
    const row = rowOf(line);
    if (!row) return null;
    refs.push(row.canonical);
  }
  return refs.length === Number(header[1]) && new Set(refs).size === refs.length ? refs : null;
}
