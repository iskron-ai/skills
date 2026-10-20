// The graph slot of a project cover (shared/cover.ts): which graph it names as the working one
// (#8066). A head is a graph, @owner/slug or rN, with at most its other form in parentheses
// right after it — the only place two addresses are one graph. Heads listed one after another
// — separators, framing (backticks, quotes, *, _, ~) or the form's joining words between —
// are equal candidates whatever their forms: two of them are ambiguity. After the last head,
// prose that starts with a word (a pointer to the methodology, a graph not used) names no
// working graph; anything else that still names a graph is doubt, and doubt is ambiguity.

const ADDRESS = String.raw`(?:@[\w.-]+\/[\w.-]+|r\d+)(?=$|[\s)\x60'",;.:*~«»“”])`;
/** Framing around an address: spaces, backticks, quotes, markdown emphasis. */
const FRAME = String.raw`[\s\x60'"*_~«»“”]*`;
const HEAD = new RegExp(String.raw`^(${ADDRESS})(?:${FRAME}\(${FRAME}(${ADDRESS})${FRAME}\))?`);
/** Any address anywhere — what makes unread rest doubtful. */
const ANY = /@[\w.-]+\/[\w.-]+|(?<![\w/])r\d+(?!\w)/u;
/** Prose after the heads: optional punctuation, then a word. */
const PROSE = /^[—–\-:.(]*\s*(?!r\d)\p{L}/u;

const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** What lists the next head as an equal: separators, framing and the form's joining words. */
const listing = (joins: readonly string[]): RegExp =>
  new RegExp(
    `^(?:[\\s\`'",;/+&|*_~«»“”]${joins.map((j) => `|${esc(j)}(?=[\\s\`'"*_~«»“”])`).join("")})*`,
    "u",
  );

/** One graph of a head: its slug when it names one, else its rN; two of one form — none. */
function oneGraph(main: string, alias: string | undefined): string | null {
  if (!alias || alias === main) return main;
  if (main.startsWith("@") === alias.startsWith("@")) return null;
  return main.startsWith("@") ? main : alias;
}

/** The working graph a slot value names, the graphs it lists as equals, or null — none at its start. */
export function graphOfSlot(
  value: string,
  joins: readonly string[],
): { realm: string } | { many: string[] } | null {
  const list = listing(joins);
  const named: string[] = [];
  const graphs = new Set<string | null>();
  let rest = value.replace(new RegExp(`^${FRAME}`), "");
  for (let head = HEAD.exec(rest); head; head = HEAD.exec(rest)) {
    const [whole, main, alias] = head as unknown as [string, string, string | undefined];
    named.push(main, ...(alias ? [alias] : []));
    graphs.add(oneGraph(main, alias));
    rest = rest.slice(whole.length);
    rest = rest.slice((list.exec(rest)?.[0] ?? "").length);
  }
  if (!named.length) return null;
  const doubt = rest !== "" && !PROSE.test(rest) && ANY.test(rest);
  const [only] = graphs;
  if (graphs.size === 1 && only && !doubt) return { realm: only };
  const tail = doubt ? [...rest.matchAll(new RegExp(ANY.source, "gu"))].map((m) => m[0]) : [];
  return { many: [...new Set([...named, ...tail])] };
}
