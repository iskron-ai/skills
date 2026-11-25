// Server-owned snapshot, never a local count or clock (graph @nks/nks-dev, #10167). Next to its
// count the envelope names the open cards (#11342): the case, the entry, the key and who asked.
import { FRAME_TEXT } from "../delivery/index.ts";
import type { Frame } from "./channel.ts";
import { clockNoticeFrame, wire } from "./clock-notices.ts";
import { words } from "./lang.ts";

/** One open card as the server names it; a field of an unknown shape reads as null — unknown. */
export interface OpenCard {
  room: { id: string | null; number: number | null; realm: string | null };
  entry_id: number | null;
  key: string | null;
  asked_at: string | null;
  asker: { standing_id: string | null; standing: string | null; karta_seq: number | null };
}

export interface OpenCards {
  count: number;
  oldest_at: string | null;
  /** Only when the server sent a list; at most LISTED, as it sends them. */
  items?: OpenCard[];
}

/** The server names up to five cards; the count behind them stands. */
const LISTED = 5;

const repeatNumber = (n: unknown): number | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;

const seat = (v: unknown): OpenCard["asker"] => {
  const s = wire.rec(v);
  return {
    standing_id: wire.text(s.standing_id),
    standing: wire.text(s.standing),
    karta_seq: wire.number(s.karta_seq),
  };
};

function openCard(value: unknown): OpenCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { room, entry_id, key, asked_at, asker } = value as Record<string, unknown>;
  const r = wire.rec(room);
  return {
    room: { id: wire.text(r.id), number: wire.number(r.number), realm: wire.text(r.realm) },
    entry_id: wire.number(entry_id),
    key: wire.text(key),
    asked_at: wire.timestamp(asked_at),
    asker: seat(asker),
  };
}

/** A list that is not a list of objects is broken; the cards past the fifth are not looked at. */
function openItems(value: unknown): OpenCard[] | null {
  if (!Array.isArray(value)) return null;
  const cards = value.slice(0, LISTED).map(openCard);
  return cards.every((c): c is OpenCard => c !== null) ? cards : null;
}

/** Strip untrusted card fields even when the reader is paired with an older bridge. */
export function cardFrame(frame: Frame | null): Frame | null {
  if (!frame) return null;
  frame = clockNoticeFrame(frame);
  const checked: Record<string, unknown> = {};
  if (Object.hasOwn(frame, "my_open_cards")) checked.my_open_cards = openCards(frame.my_open_cards);
  if (Object.hasOwn(frame, "repeat")) checked.repeat = frame.repeat === true;
  if (Object.hasOwn(frame, "repeat_n")) checked.repeat_n = repeatNumber(frame.repeat_n);
  return Object.keys(checked).length ? { ...frame, ...checked } : frame;
}

/** This is the server's repeat marker, not a local retry count (#10167 v13). */
export const cardRepeatText = (frame: Frame): string => {
  if (frame.repeat !== true) return "";
  return words(FRAME_TEXT).cardRepeat(repeatNumber(frame.repeat_n));
};

/** Accept only the known wire shape; never echo malformed server data. */
export function openCards(value: unknown): OpenCards | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { count, oldest_at: at, items } = value as Record<string, unknown>;
  // No list — the count as before; a broken list hides the envelope like a broken count does.
  const named = items == null ? [] : openItems(items);
  if (named === null || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
    return null;
  const list = items == null ? {} : { items: named };
  if (count === 0) return at === null ? { count, oldest_at: null, ...list } : null;
  if (
    typeof at !== "string" ||
    at.length > 64 ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      at,
    ) ||
    !Number.isFinite(Date.parse(at)) ||
    new Date(`${at.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== at.slice(0, 10)
  )
    return null;
  return { count, oldest_at: at, ...list };
}

export const openCardsText = (frame: Frame): string => {
  const value = frame.my_open_cards;
  const cards = openCards(value);
  const T = words(FRAME_TEXT);
  return T.openCards(
    cards?.count ?? null,
    cards?.oldest_at ?? null,
    value !== undefined && cards === null,
    cards?.items?.map(({ room, entry_id, key, asker }) => ({
      room: room.number,
      entry: entry_id,
      key,
      asker: T.openCardAsker(asker.standing, asker.karta_seq),
    })),
  );
};

/** The latest envelope in this output wins; it does not become a delivery event. */
export const cardsIn = (frames: readonly Frame[]): string =>
  frames.length ? openCardsText(frames[frames.length - 1]) : "";
