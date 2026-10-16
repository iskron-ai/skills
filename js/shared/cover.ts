// The project cover a root session seats itself by (opencode/rootseat.ts): the flat YAML
// front matter of the cover file in the session's directory. The file and the keys of the
// graph and the agent role are the delivery's (COVER); the reasons are its words.
//
// The graph is the value's first token, @owner/slug or rN; one more distinct graph of the
// same form in the value is ambiguity. The role is exactly one reference "#N <<name>>" (in the
// delivery's quotes) at the value's start; bare numbers elsewhere in the value (a contour, a
// neighbouring repo) are prose, not roles. No cover file at all — null: the project is not
// aligned, and nothing is said.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COVER, ROOT_SEAT } from "../delivery/index.ts";
import { words } from "./lang.ts";

/** The seat the cover names, the reason it names none, or null — no cover file. */
export type Cover = { realm: string; karta: string } | { why: string } | null;

const unquote = (v: string): string => {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'"))
    return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
};

/** Flat front matter: key → value; no opening and closing "---" — null. */
export function frontMatter(text: string): Map<string, string> | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const pairs = new Map<string, string>();
  for (const line of lines.slice(1, end)) {
    const kv = /^\s*('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^\s'"#][^:]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (kv) pairs.set(unquote(kv[1]), unquote(kv[2] ?? ""));
  }
  return pairs;
}

const LEAD = /^[\s`'"<]*/;
const SLUG = /(?:^|[\s(`'",;])(@[\w.-]+\/[\w.-]+)/g;
const SHORT = /(?:^|[\s(`'",;])(r\d+)(?=$|[\s)`'",;.:])/g;
const ROLE_REF = /#(\d+)\s*«[^»]*»/g;

const distinct = (re: RegExp, v: string): string[] => [
  ...new Set([...v.matchAll(re)].map((m) => m[1] as string)),
];

/** The graph and the role of a cover's slots, or the reason there is no seat. */
export function seatOfPairs(
  pairs: Map<string, string>,
): { realm: string; karta: string } | { why: string } {
  const W = words(ROOT_SEAT);
  const graph = pairs.get(COVER.graph)?.trim();
  if (!graph) return { why: W.noKey(COVER.file, COVER.graph) };
  const role = pairs.get(COVER.role)?.trim();
  if (!role) return { why: W.noKey(COVER.file, COVER.role) };

  const g = graph.replace(LEAD, "");
  if (!/^(?:@[\w.-]+\/[\w.-]+|r\d+)(?=$|[\s)`'",;.:])/.test(g))
    return { why: W.noGraph(COVER.file, COVER.graph) };
  const slugs = distinct(SLUG, ` ${g}`);
  const shorts = distinct(SHORT, ` ${g}`);
  if (slugs.length > 1 || shorts.length > 1)
    return { why: W.manyGraphs(COVER.file, COVER.graph, [...slugs, ...shorts].join(", ")) };

  const r = role.replace(LEAD, "");
  const roles = distinct(ROLE_REF, r);
  if (roles.length > 1)
    return { why: W.manyRoles(COVER.file, COVER.role, roles.map((n) => `#${n}`).join(", ")) };
  const first = /^#(\d+)\s*«[^»]*»/.exec(r);
  if (!first) return { why: W.noRoleRef(COVER.file, COVER.role) };

  return { realm: slugs[0] ?? (shorts[0] as string), karta: first[1] as string };
}

/** The cover of a directory. */
export function readCover(dir: string): Cover {
  let text: string;
  try {
    text = readFileSync(join(dir, COVER.file), "utf8");
  } catch {
    return null;
  }
  const pairs = frontMatter(text);
  if (!pairs) return { why: words(ROOT_SEAT).noFrontmatter(COVER.file) };
  return seatOfPairs(pairs);
}
