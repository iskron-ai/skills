// The human's rules into the session's turn (graph @nks/nks-dev, kriya #9817, outcome #9816):
// the delivery reads the slice agents,ways of the account's own graph "mind" — not the model.
// Only the account's fully addressed graph is read; another owner's mind is never a substitute.
// Name and one line per rule, the body by number (#9819); every word carries the mark
// "personal": a rule is cited only in a case it describes, never in briefs, the project's graph
// or commits — the owner's word on #9818; the words themselves live in MIND_SLICE.
import { LANGS, MIND_ROW, MIND_SLICE, tool } from "../delivery/index.ts";
import { words } from "./lang.ts";
import { cachedSlice, type SliceRead } from "./mindcache.ts";
import { scoped } from "./scope.ts";

/** One tool call on the account's behalf: the answer's text and whether it was a refusal. */
export type MindCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ isError?: boolean; text: string; structured?: unknown }>;

const LIMIT = 100;
/** Any node row of the server's page, a rule or not: the page is full by these, not by parsed rules. */
const NODE_ROW = /^\s+\S.* \(#\d+, /;
const SLICE_ARGS = {
  q: "",
  attrs_filter: "slice:agents,ways",
  limit: LIMIT,
  include_description: true,
};

type Listing = { text: string; structured?: unknown; at?: number };
type Cache = {
  listing: Listing | null;
  handle: string;
  result: boolean | null;
  expires: number;
};
const C = scoped(() => ({
  entries: new WeakMap<object, Cache>(),
  listing: null as Listing | null,
}));
const cacheFor = (key: object): Cache => {
  let cache = C.entries.get(key);
  if (!cache) {
    cache = { listing: null, handle: "", result: null, expires: 0 };
    C.entries.set(key, cache);
  }
  return cache;
};

/** Reuse a list already obtained during this stand; never infer ownership from a slug alone. */
export function rememberMindRealmList(text: string, structured?: unknown): void {
  C.listing = { text, structured, at: Date.now() };
}

/** The account the server answers this call's credential for: its handle from whoami. */
async function whoami(call: MindCall): Promise<string> {
  const who = await call(tool("me"), { action: "whoami" });
  if (who.isError) throw new Error(who.text);
  const handle = /\bhandle @([A-Za-z0-9_.-]+)/.exec(who.text)?.[1] ?? "";
  if (!handle) throw new Error("account handle unknown");
  return handle;
}

/**
 * The account's own mind, or null. `handle` — the account as whoami named it just now; another
 * one than this key remembered drops what it remembered (an account switched under the bridge).
 */
async function ownMind(call: MindCall, key: object, handle?: string): Promise<string | null> {
  const cache = cacheFor(key);
  if (handle && handle !== cache.handle) Object.assign(cache, { handle, result: null, expires: 0 });
  if (!cache.handle) cache.handle = await whoami(call);
  const address = `@${cache.handle}/mind`;
  if (cache.result !== null && Date.now() < cache.expires) return cache.result ? address : null;
  cache.listing = C.listing && Date.now() - (C.listing.at ?? 0) < 10_000 ? C.listing : null;
  if (!cache.listing) {
    const listing = await call(tool("realm"), { action: "list" });
    if (listing.isError) throw new Error(listing.text);
    cache.listing = listing;
  }
  const { text, structured } = cache.listing;
  C.listing = null;
  cache.listing = null;
  const data = structured as { action?: unknown; realms?: unknown } | undefined;
  let addresses: string[];
  if (data?.action === "list" && Array.isArray(data.realms)) {
    addresses = data.realms.flatMap((r: { ref?: unknown }) =>
      typeof r?.ref === "string" ? [r.ref] : [],
    );
  } else {
    if (!/^\s*[^\n]*\(\d+\).*@owner\/slug/m.test(text)) throw new Error("realm list unknown");
    addresses = [...text.matchAll(/^\s{4}(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s{2}r\d+\s{2}/gm)].map(
      (m) => m[1],
    );
  }
  cache.result = addresses.includes(address);
  cache.expires = Date.now() + (cache.result ? 6 * 60 * 60_000 : 10 * 60_000);
  return cache.result ? address : null;
}

const brief = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 119)}\u2026` : t || "-";
};

/** Recovery must retry a failed read; ordinary starts retain the soft diagnostic (#9817). */
export interface MindSliceOptions {
  strict?: boolean;
  cacheKey?: object;
  /** The credential's account: the slice is cached for the whole process by it (mindcache.ts). */
  account?: string;
}

/** One read of the slice; a refused read or an unknown account throws. */
async function readSlice(call: MindCall, key: object, handle?: string): Promise<SliceRead> {
  const W = words(MIND_SLICE);
  const realm = await ownMind(call, key, handle);
  if (!realm) return { block: W.absent(), mind: null };
  const got = await call(tool("search"), { ...SLICE_ARGS, realm });
  if (got.isError) throw new Error(brief(got.text));
  // A rule's line: its name, number and the description's fragment — the badges stay in the graph.
  const listed = got.text.split("\n").filter((l) => NODE_ROW.test(l)).length;
  const rows = got.text.split("\n").flatMap((l) => {
    const [, name, seq, line] = MIND_ROW.exec(l) ?? [];
    return name ? [`  ${name} (#${seq})${line ? ` — ${line}` : ""}`] : [];
  });
  const full = listed >= LIMIT;
  const block = rows.length
    ? [W.head(rows.length), ...rows, W.foot(full, LIMIT)].join("\n")
    : full
      ? `${W.empty()}\n${W.foot(true, LIMIT)}`
      : W.empty();
  return { block, mind: realm };
}

/** The slice as a block of lines; strict recovery propagates failures instead of rendering them. */
export async function mindSlice(call: MindCall, options: MindSliceOptions = {}): Promise<string> {
  const unread = (text: string): string => words(MIND_SLICE).unread(brief(text));
  const key = options.cacheKey ?? call;
  // A strict reader (recovery) takes a cached slice too; no slice is its failure to retry.
  const fail = (why: string): never => {
    throw new Error(why);
  };
  try {
    if (options.account) {
      // Personal rules never cross accounts: the shared slice is keyed by the account the server
      // answers this credential for — asked now, on every read, so an account switched under
      // the same grant directory reads its own; unknown — the read below throws, nothing shared.
      const handle = await whoami(call);
      return await cachedSlice(
        `${options.account}\n@${handle}`,
        () => readSlice(call, key, handle),
        options.strict
          ? {
              unread: fail,
              pending: () => fail("the rules slice is still being read"),
              retry: true,
            }
          : { unread, pending: () => words(MIND_SLICE).pending() },
      );
    }
    return (await readSlice(call, key)).block;
  } catch (e) {
    if (options.strict) throw new Error(brief((e as Error).message), { cause: e });
    return unread((e as Error).message);
  }
}

/** The slice block a stand answer carries — from its mark to the end; none — null. */
export function sliceIn(text: string): string | null {
  for (const lang of LANGS) {
    const mark = MIND_SLICE[lang].mark();
    if (text.startsWith(mark)) return text;
    const at = text.indexOf(`\n${mark}`);
    if (at >= 0) return text.slice(at + 1);
  }
  return null;
}
