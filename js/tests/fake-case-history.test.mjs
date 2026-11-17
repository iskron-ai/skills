import assert from "node:assert/strict";
import { test } from "node:test";

import { startFakeNks } from "./fake-nks.mjs";

test("fake case REST exposes status and history after a cursor", async (t) => {
  const fake = await startFakeNks({ pat: "secret" });
  t.after(() => fake.stop());
  await fake.control({
    caseRooms: {
      "room-1": {
        status: "open",
        entries: [{ entry_id: 1, kind: "said" }, { entry_id: 2, kind: "closed" }],
      },
    },
  });
  const headers = { authorization: "Bearer secret", "user-agent": "probe" };
  const room = await fetch(`${fake.base}/api/rooms/room-1`, { headers });
  assert.equal(room.status, 200);
  assert.equal((await room.json()).status, "open");
  const history = await fetch(`${fake.base}/api/rooms/room-1/history?since=1&advance=false`, {
    headers,
  });
  assert.deepEqual(await history.json(), [{ entry_id: 2, kind: "closed" }]);
  assert.equal(
    (await fetch(`${fake.base}/api/rooms/room-1`, { headers: { "user-agent": "probe" } })).status,
    401,
  );
  assert.equal((await fetch(`${fake.base}/api/rooms/missing`, { headers })).status, 404);
});
