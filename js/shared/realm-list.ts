// Shared bridge rows and the observed Russian owner blocks, count and prose tail.
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
export function completeRealmList(
  text: string,
): { canonical: string; ownerKind: "organization" | "user" }[] | null {
  const header = REALM_LIST_HEADER.exec(text);
  if (!header || text.slice(0, header.index).trim()) return null;
  const rows: { canonical: string; ownerKind: "organization" | "user" }[] = [];
  let owner: { handle: string; kind: "organization" | "user" } | null = null;
  let tail = false;
  for (const line of text.slice(header.index + header[0].length).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const group = REALM_LIST_GROUP.exec(line);
    const row = rowOf(line);
    if (group) {
      if (tail) return null;
      owner = { handle: group[1], kind: group.groups?.organization ? "organization" : "user" };
    } else if (row) {
      if (tail || !owner || !row.canonical.startsWith(`@${owner.handle}/`)) return null;
      rows.push({ canonical: row.canonical, ownerKind: owner.kind });
    } else {
      // Graph/block-looking damage is not footer prose. Footer starts only after all N rows.
      if (/^(?:\s*(?:@|▸)| {4}\S)/.test(line) || rows.length !== Number(header[1])) return null;
      tail = true;
    }
  }
  return rows.length === Number(header[1]) &&
    new Set(rows.map((r) => r.canonical)).size === rows.length
    ? rows
    : null;
}
