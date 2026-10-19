// Case №1046 [83]: the api closed with 4001 revoked:silent only the socket of the put-out seat
// (.sub-5); the socket of the live .sub-3 was closed 6 s later by the CLIENT, its cases left,
// its session cut, its seat still active. The plugin's real bridges here go through ONE machine
// daemon, as by default live (checked by its journal). A stop for silence ends the silent seat
// and its session only; the owner's stop (revoked:person) still ends the whole lineage (#7440).
// ISKRON_OPENCODE_PLUGIN and ISKRON_BRIDGE_PATH aim it at any copy, as opencode.test.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startFakeNks } from "./fake-nks.mjs";
import { delay, plugin, REAL_BRIDGE, SANDBOX, until } from "./opencode-kit.mjs";

/** The plugin over real bridges and the fake NKS; sessions — [id, parentID?]. */
async function standUp(sessions) {
  const fake = await startFakeNks({ pat: "nks_pat_plugin" });
  await fake.control({ richTools: true });
  const dir = mkdtempSync(join(tmpdir(), "iskron-lineage-stop-"));
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
      ISKRON_BRIDGE_NO_BROWSER: "1",
    },
    {
      location: { directory: dir },
      sessions: sessions.map(([id, parentID]) => ({
        id,
        ...(parentID ? { parentID } : {}),
        location: { directory: dir },
      })),
    },
  );
  await until(
    () => rec.tools().has("iskron_channel") && rec.tools().has("iskron_stand"),
    "the server's tools",
    15000,
  );
  return { fake, rec };
}

/** The seat a session's stand took: the newest seat on the board not known before. */
async function stood(fake, rec, session, args) {
  const before = new Set(fake.state.places.keys());
  const r = await rec.call("iskron_stand", { realm: "nks-dev", ...args }, session);
  const key = [...fake.state.places.keys()].find((k) => !before.has(k));
  assert.ok(key, `${session} stood:\n${r.content}\n${rec.said()}`);
  return { key, name: fake.state.places.get(key).name };
}

const daemonSessions = () =>
  (
    readFileSync(join(SANDBOX, "auth", "run", "daemon.log"), "utf8").match(
      /seam session \S+ opened/g,
    ) ?? []
  ).length;

/** What the stop of `put` did to the others: interrupts, leaves and revokes, open sockets. */
async function after(fake, rec, put, cut) {
  const calls = () =>
    fake.state.calls.filter((c) => ["leave", "revoke"].includes(c.arguments?.action));
  const before = calls().length;
  await fake.control({ ws_close_name: { name: put.name, code: 4001, reason: put.reason } });
  await until(
    () => rec.interrupts.some((i) => i.sessionID === cut),
    `the stopped session's turn cut:\n${rec.said()}`,
    8000,
  );
  await delay(6500); // past the plugin's sweep (5 s): the seat of a descendant goes down there
  return {
    cut: [...new Set(rec.interrupts.map((i) => i.sessionID))].sort(),
    moves: calls().slice(before),
    open: [...fake.state.wsNames.values()],
  };
}

// root → zombie → live: the live lead was launched under the long-ended one's session, and its
// seat is still "<root>.sub-N" beside it (a child's satellite is the root's, tools.ts).
for (const reason of ["revoked:silent", "revoked:person"])
  test(`one daemon: 4001 ${reason} on a child's socket — ${reason === "revoked:silent" ? "its live descendant goes on" : "its descendant stops with it (#7440)"}`, async () => {
    const { fake, rec } = await standUp([["root"], ["zombie", "root"], ["live", "zombie"]]);
    try {
      const name = `lin-${reason.slice(8)}`;
      await stood(fake, rec, "root", { karta: 931, name });
      const zombie = await stood(fake, rec, "zombie", {});
      const live = await stood(fake, rec, "live", {});
      await until(() => fake.state.ws.size === 3, "three sockets");
      assert.ok(daemonSessions() >= 3, "the bridges go through one machine daemon");
      const got = await after(fake, rec, { ...zombie, reason }, "zombie");
      if (reason === "revoked:person") {
        assert.deepEqual(got.cut, ["live", "zombie"], "the owner's stop cuts the lineage");
        return;
      }
      // One look at all of it: on the old plugin each part fails, and the probe says which.
      assert.deepEqual(
        {
          cut: got.cut,
          moves: got.moves.map((c) => `${c.name} ${c.arguments.action}`),
          liveSocket: got.open.includes(live.name),
          liveOnBoard: fake.state.places.has(live.key),
        },
        { cut: ["zombie"], moves: [], liveSocket: true, liveOnBoard: true },
        "only the silent seat and its session end; the live descendant goes on",
      );
    } finally {
      await rec.stop();
      await fake.stop();
    }
  });

for (const [what, sessions, other] of [
  ["two unrelated roots", [["a"], ["b"]], "b"],
  ["two sibling satellites", [["root"], ["a", "root"], ["b", "root"]], "b"],
])
  test(`one daemon: 4001 revoked:silent on one of ${what} — the other goes on`, async () => {
    const { fake, rec } = await standUp(sessions);
    try {
      const tag = what.split(" ")[1];
      const seats = {};
      for (const [s, parent] of sessions)
        seats[s] = await stood(fake, rec, s, parent ? {} : { karta: 931, name: `${tag}-${s}` });
      await until(() => fake.state.ws.size === sessions.length, "the sockets");
      assert.ok(daemonSessions() >= sessions.length, "the bridges go through one machine daemon");
      const got = await after(fake, rec, { ...seats.a, reason: "revoked:silent" }, "a");
      assert.deepEqual(got.cut, ["a"], "only the silent seat's session is cut");
      assert.deepEqual(got.moves, [], "no case leave or revoke by another");
      assert.ok(got.open.includes(seats[other].name), `the other's socket stays: ${got.open}`);
      assert.ok(fake.state.places.has(seats[other].key), "the other's seat stays");
    } finally {
      await rec.stop();
      await fake.stop();
    }
  });
