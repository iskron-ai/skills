// The project cover a root session seats itself by (opencode/rootseat.ts): the flat YAML
// front matter of the cover file in the session's directory. The file and the keys of the
// graph and the agent role are the delivery's (COVER); the reasons are its words.
//
// The graph is the value's first token, @owner/slug or rN, with its other form in parentheses
// after it; prose after that head (a pointer to the methodology, a graph not used) names no
// working graph (#8066). Ambiguity is another graph listed right after the head — only
// separators or the form's joining words (graphJoins) between — or two distinct graphs of one
// form in the head. The role is exactly one reference "#N <open>name<close>" at the value's
// start, the quotes the delivery's (COVER.roleQuotes; the same character may open and close —
// the name runs to the first closing one); bare numbers elsewhere in the value (a contour, a
// neighbouring repo) are prose, not roles. No cover file at all — null: the project is not
// aligned, and nothing is said. The keys are a parameter (COVER by default): another
// delivery's cover form is read by the same rule.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COVER, ROOT_SEAT } from "../delivery/index.ts";
import { words } from "./lang.ts";

/** A cover form: the file, the slots of the graph and the agent role, the role reference's quotes. */
export interface CoverKeys {
  readonly file: string;
  readonly graph: string;
  /** Words listing equal graphs in the graph slot; none — only separators list them. */
  readonly graphJoins?: readonly string[];
  readonly role: string;
  readonly roleQuotes: readonly [string, string];
}

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
const GRAPH = String.raw`((?:@[\w.-]+\/[\w.-]+|r\d+)(?=$|[\s)\x60'",;.:]))`;
const Q = String.raw`[\s\x60'"]*`;
/** A graph with its other form in parentheses: "@owner/slug (rN)". */
const HEAD = new RegExp(String.raw`^${GRAPH}(?:${Q}\(${Q}${GRAPH}${Q}\))?`);
const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** What lists the next graph as an equal: separators and the form's joining words only. */
const listing = (joins: readonly string[]): RegExp =>
  new RegExp(`^(?:[\\s\`'",;/+&|]${joins.map((j) => `|${esc(j)}(?=[\\s\`'"])`).join("")})*`, "u");

/** The graphs a value names as working ones: its head and every head listed right after it. */
function workingGraphs(value: string, joins: readonly string[]): string[] | null {
  const list = listing(joins);
  const named: string[] = [];
  let rest = value;
  for (let head = HEAD.exec(rest); head; head = HEAD.exec(rest)) {
    named.push(...head.slice(1).filter((x): x is string => !!x));
    rest = rest.slice(head[0].length);
    rest = rest.slice((list.exec(rest)?.[0] ?? "").length);
  }
  return named.length ? [...new Set(named)] : null;
}

/** The role reference in a form's quotes: "#N", spaces, the opening quote, the name up to the first closing one. */
const roleRef = (q: readonly [string, string], flags = ""): RegExp =>
  new RegExp(
    `${flags.includes("g") ? "" : "^"}#(\\d+)\\s*${esc(q[0])}[\\s\\S]*?${esc(q[1])}`,
    flags,
  );

const distinct = (re: RegExp, v: string): string[] => [
  ...new Set([...v.matchAll(re)].map((m) => m[1] as string)),
];

/** The graph and the role of a cover's slots, or the reason there is no seat. */
export function seatOfPairs(
  pairs: Map<string, string>,
  keys: CoverKeys = COVER,
): { realm: string; karta: string } | { why: string } {
  const W = words(ROOT_SEAT);
  const graph = pairs.get(keys.graph)?.trim();
  if (!graph) return { why: W.noKey(keys.file, keys.graph) };
  const role = pairs.get(keys.role)?.trim();
  if (!role) return { why: W.noKey(keys.file, keys.role) };

  const named = workingGraphs(graph.replace(LEAD, ""), keys.graphJoins ?? []);
  if (!named) return { why: W.noGraph(keys.file, keys.graph) };
  const slugs = named.filter((n) => n.startsWith("@"));
  const shorts = named.filter((n) => !n.startsWith("@"));
  if (slugs.length > 1 || shorts.length > 1)
    return { why: W.manyGraphs(keys.file, keys.graph, [...slugs, ...shorts].join(", ")) };

  const r = role.replace(LEAD, "");
  const roles = distinct(roleRef(keys.roleQuotes, "g"), r);
  if (roles.length > 1)
    return { why: W.manyRoles(keys.file, keys.role, roles.map((n) => `#${n}`).join(", ")) };
  const first = roleRef(keys.roleQuotes).exec(r);
  if (!first)
    return {
      why: W.noRoleRef(keys.file, keys.role, `#N ${keys.roleQuotes[0]}…${keys.roleQuotes[1]}`),
    };

  return { realm: slugs[0] ?? (shorts[0] as string), karta: first[1] as string };
}

/** The cover of a directory. */
export function readCover(dir: string, keys: CoverKeys = COVER): Cover {
  let text: string;
  try {
    text = readFileSync(join(dir, keys.file), "utf8");
  } catch {
    return null;
  }
  const pairs = frontMatter(text);
  if (!pairs) return { why: words(ROOT_SEAT).noFrontmatter(keys.file) };
  return seatOfPairs(pairs, keys);
}
