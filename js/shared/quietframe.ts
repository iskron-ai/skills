// A frame's text with nothing addressed to the seat (graph @nks/nks-dev, nodes #9345, #6574):
// case count lines only, each saying none of the records is the seat's, under a stale batch's
// head or none. Read back from the words the delivery writes them with (frame-text.ts,
// stalebatch.ts), whitespace aside: the watchdog wraps long lines (watchdog.ts wrapLines).
import { FRAME_MARK, FRAME_TEXT, LANGS, ROOM, STALE } from "../delivery/index.ts";

const flat = (s: string): string => s.replace(/\s+/g, "");
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Placeholders the words are called with, then read back as patterns. */
const HEAD = "\u0001";
const ARGS = "\u0002";
const N = 1234567;
const NUM = new RegExp(String(N), "g");

function countLine(lang: (typeof LANGS)[number]): string {
  const T = FRAME_TEXT[lang];
  const call = esc(flat(T.caseHistory(ARGS, N)))
    .replace(ARGS, `[^()]*`)
    .replace(NUM, String.raw`-?\d+`);
  const cases = `(?:${call}(?:;${call})*|${esc(flat(T.myCases()))})`;
  const count = esc(flat(T.count(HEAD, N, 0)))
    .replace(HEAD, ".+?")
    .replace(NUM, String.raw`\d+`);
  return `${count}[^()]*?${esc(flat(T.noneYours()))}${esc(flat(T.inFull(ARGS))).replace(ARGS, cases)}\\.`;
}

const head = (lang: (typeof LANGS)[number]): string[] =>
  [false, true]
    .flatMap((legacy) => [STALE[lang].head(1, 1, legacy), STALE[lang].head(2, 1, legacy)])
    .map((h) => esc(flat(h)).replace(/\d+/g, String.raw`\d+`));

const LINE = `(?:${LANGS.map(countLine).join("|")})`;
const QUIET = new RegExp(`^(?:${LANGS.flatMap(head).join("|")})?(?:${LINE})+$`);

function compact(lang: (typeof LANGS)[number]): string {
  const T = FRAME_TEXT[lang];
  const caseHead = esc(flat(ROOM[lang].case(HEAD))).replace(HEAD, "[^«»():;]+") + "(?:«[^»]*»)?";
  const count = esc(flat(T.count(HEAD, N, 0)))
    .replace(HEAD, caseHead)
    .replace(NUM, String.raw`\d+`);
  const gone = esc(flat(T.supersededLines(N))).replace(NUM, String.raw`\d+`);
  const history = esc(flat(T.inFull(T.caseHistory(ARGS, N))))
    .replace(ARGS, "[^()]*")
    .replace(NUM, String.raw`-?\d+`);
  const template = esc(flat(T.inFull(T.caseHistory('realm=R, action="history", room=N', "S"))));
  const fallback = esc(flat(T.inFull("")));
  const cursor = String.raw`·realm="(?:[^"\\]|\\.)*",since=\d+`;
  const line = `${count}(?:${gone})?`;
  return `(?:${line}(?:${cursor})?;(?:${history}|${fallback})\\.|(?:${line}(?:${cursor})?){2,}(?:${template}|${fallback})\\.)`;
}

const COMPACT = new RegExp(
  `^(?:${LANGS.flatMap(head).join("|")})?(?:${LANGS.map(compact).join("|")})$`,
);

// A server card snapshot is context, not another wake-up (#10167).
const KEY = "\u0003";
const WHO = "\u0004";
/** A listed card's room number and entry are numbers on the wire; so are their placeholders. */
const ENTRY = 7654321;
const ANY = `[^${HEAD}${ARGS}${KEY}${WHO}]`;
/** The server's «unknown» of a language, read back from its words. */
const unknownWord = (lang: (typeof LANGS)[number]): string =>
  flat(FRAME_TEXT[lang].openCards(null, null)).slice(
    flat(FRAME_TEXT[lang].openCards(N, null)).indexOf(String(N)),
  );
/** One named card of the list (#11342): a number or the unknown word; text otherwise. */
const card = (lang: (typeof LANGS)[number]): string => {
  const listed = flat(
    FRAME_TEXT[lang].openCards(N, null, false, [{ room: N, entry: ENTRY, key: KEY, asker: WHO }]),
  );
  const oneOf = `(?:\\d+|${esc(unknownWord(lang))})`;
  const by: Record<string, string> = {
    [N]: oneOf,
    [ENTRY]: oneOf,
    [KEY]: `${ANY}*`,
    [WHO]: `${ANY}+`,
  };
  // One pass: the text put in for a placeholder is not searched for the next one.
  return esc(listed.slice(flat(FRAME_TEXT[lang].openCards(N, null)).length + 1)).replace(
    new RegExp(`[${KEY}${WHO}]|${N}|${ENTRY}`, "g"),
    (at) => by[at],
  );
};
const LISTED = LANGS.map((lang) => {
  const one = card(lang);
  return `—${one}(?:;${one}){0,4}`;
}).join("|");

const CARDS = new RegExp(
  `(?:${LANGS.flatMap((lang) => {
    const T = FRAME_TEXT[lang];
    return [
      esc(flat(T.openCards(null, null))),
      esc(flat(T.openCards(null, null, true))),
      esc(flat(T.openCards(N, null))).replace(NUM, String.raw`\d+`),
      esc(flat(T.openCards(N, ARGS)))
        .replace(NUM, String.raw`\d+`)
        .replace(ARGS, String.raw`[0-9T:.+Z-]+`),
    ];
  }).join("|")})(?:${LISTED})?$`,
);

/** A frame's text (under the delivery's mark or not) that addresses nothing to the seat. */
export function quiet(text: string): boolean {
  const t = flat(text);
  const body = t.startsWith(FRAME_MARK) ? t.slice(FRAME_MARK.length) : t;
  const withoutCards = body.replace(CARDS, "");
  return (
    (withoutCards !== body && !withoutCards) ||
    QUIET.test(withoutCards) ||
    COMPACT.test(withoutCards)
  );
}
