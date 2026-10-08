// Слова мест канала в других графах (граф @nks/nks-dev, узел #5838).
import type { Lang } from "../lang.ts";

export interface PlacesWords {
  anotherSeat: () => string;
  graph: () => string;
  /** Кадр не сопоставлен месту; several — подходят несколько, иначе ни одно. */
  unmatched: (
    frame: string,
    standingId: string,
    to: string,
    realm: string,
    several: boolean,
    key: string,
  ) => string;
}

export const PLACES: Readonly<Record<Lang, PlacesWords>> = {
  ru: {
    anotherSeat: () => "другое место графа",
    graph: () => "граф",
    unmatched: (frame, standingId, to, realm, several, key) =>
      `ДЕЛАТЕЛЬ: кадр ${frame} (to_standing_id ${standingId}, ${to}, граф ${realm}) ` +
      `не сопоставлен ни одному месту моста (${several ? "подходят несколько" : "не подходит ни одно"}) — отдан основному месту ${key}; сверь адрес кадра.`,
  },
  en: {
    anotherSeat: () => "another seat of the graph",
    graph: () => "graph",
    unmatched: (frame, standingId, to, realm, several, key) =>
      `DOER: frame ${frame} (to_standing_id ${standingId}, ${to}, graph ${realm}) ` +
      `matches no seat of the bridge (${several ? "several fit" : "none fits"}) — given to the main seat ${key}; check the frame's address.`,
  },
};
