// Server-owned snapshot, never a local count or clock (graph @nks/nks-dev, #10167).
import { FRAME_TEXT } from "../delivery/index.ts";
import type { Frame } from "./channel.ts";
import { words } from "./lang.ts";

export interface OpenCards {
  count: number;
  oldest_at: string | null;
}

/** Strip untrusted snapshot data even when the reader is paired with an older bridge. */
export const cardFrame = (frame: Frame | null): Frame | null =>
  frame && Object.hasOwn(frame, "my_open_cards")
    ? { ...frame, my_open_cards: openCards(frame.my_open_cards) }
    : frame;

/** Accept only the known wire shape; never echo malformed server data. */
export function openCards(value: unknown): OpenCards | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { count, oldest_at: at } = value as Record<string, unknown>;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
  if (count === 0) return at === null ? { count, oldest_at: null } : null;
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
  return { count, oldest_at: at };
}

export const openCardsText = (frame: Frame): string => {
  const value = frame.my_open_cards;
  const cards = openCards(value);
  return words(FRAME_TEXT).openCards(
    cards?.count ?? null,
    cards?.oldest_at ?? null,
    value !== undefined && cards === null,
  );
};

/** The latest envelope in this output wins; it does not become a delivery event. */
export const cardsIn = (frames: Frame[]): string =>
  frames.length ? openCardsText(frames[frames.length - 1]) : "";
