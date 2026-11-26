// my_open_cards на проводе 0.181.0 (граф @nks/nks-dev, узлы #10167, #11419): счёт, старшая
// и до пяти старших карточек, каждая с делом, записью, ключом, временем вопроса и спросившим.
export const card = (i, asker = {}) => ({
  room: { id: `room-uuid-${i}`, number: 4330 + i, realm: "@nks/nks-dev" },
  entry_id: 40 + i,
  key: `card-key-${i}`,
  asked_at: `2026-11-1${i}T12:00:00Z`,
  asker: {
    standing_id: `seat-uuid-${i}`,
    standing: `@asker:seat-${i}`,
    karta_seq: 900 + i,
    ...asker,
  },
});

/** Five cards; the third asked by a role without a seat, the fifth with its role not read. */
export const FIVE = [
  card(1),
  card(2),
  card(3, { standing_id: null, standing: null }),
  card(4),
  card(5, { karta_seq: null }),
];

export const snapshot = (items = FIVE) => ({
  count: 7,
  oldest_at: "2026-11-11T12:00:00Z",
  items,
});
