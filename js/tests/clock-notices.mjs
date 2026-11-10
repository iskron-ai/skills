// Full message envelopes from #10167 v15 (server 0.181.0), not room records.
export const clockNotice = (notice = "card_unanswered", data = {}) => ({
  type: "message",
  id: `clock-${notice}`,
  received_at: "2026-11-10T12:10:00Z",
  stale: false,
  content_type: "text/plain",
  to_standing_id: "sender-seat-id",
  to_standing: "@h:sender",
  realm: "@o/s",
  karta_seq: 48,
  provenance: {
    via: "platform",
    auth: "none",
    notice,
    notice_data: {
      room: { id: "case-id", number: 4330, realm: "@o/s" },
      entry_id: 41,
      key: "clock-key",
      ...(notice === "card_unanswered"
        ? {
            to: { standing_id: "seat-id", standing: "@h:recipient", karta_seq: 163 },
            listening: false,
            last_act_at: "2026-11-10T12:00:00Z",
            role_called: true,
          }
        : {
            holder: { standing_id: "seat-id", standing: "@h:recipient", karta_seq: 163 },
            due_at: "2026-11-10T12:05:00Z",
            escalated: false,
          }),
      ...data,
    },
  },
  body: "SERVER-BODY-NOT-A-SOURCE-OF-FACTS",
});
