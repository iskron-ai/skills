import assert from "node:assert/strict";
import { test } from "node:test";

import { startFakeNks } from "./fake-nks.mjs";

const entry = (id, kind = "said") => ({ id, kind, payload: {} });

test("fake case REST serves the holder's page form: items, cursor, numbering", async (t) => {
  const fake = await startFakeNks({ pat: "secret" });
  t.after(() => fake.stop());
  await fake.control({
    caseRooms: {
      "room-1": {
        status: "open",
        entries: [entry(1, "invite"), entry(2, "closed"), entry(3, "line")],
      },
    },
  });
  const headers = { authorization: "Bearer secret", "user-agent": "probe" };
  const room = await fetch(`${fake.base}/api/rooms/room-1`, { headers });
  assert.equal(room.status, 200);
  assert.equal((await room.json()).status, "open");
  const page = await (await fetch(`${fake.base}/api/rooms/room-1/history?since=1&limit=1`, { headers })).json();
  assert.deepEqual(page, { items: [entry(2, "closed")], cursor: 2, numbering: "case" });
  // The end is an empty items with the cursor unmoved.
  const end = await (await fetch(`${fake.base}/api/rooms/room-1/history?since=3`, { headers })).json();
  assert.deepEqual(end, { items: [], cursor: 3, numbering: "case" });
  assert.equal(
    (await fetch(`${fake.base}/api/rooms/room-1`, { headers: { "user-agent": "probe" } })).status,
    401,
  );
  assert.equal((await fetch(`${fake.base}/api/rooms/missing`, { headers })).status, 404);
});
