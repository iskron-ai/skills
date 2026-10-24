// Контрольный образец #8620 v11 (граф @nks/nks-dev), половина моста — занятость места под
// диспетчером идёт только тактом: на уходе (конец сессии, leave по слову, SIGINT полного
// моста) пустая строка — кадром tick до unsubscribe; возврат — тактом; после superseded и
// при передаче, не взятой преемником, место не трогается; POST статуса — только в откате.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alive,
  busyOf,
  channelOf,
  daemonPids,
  leaveFrames,
  muxCarrying,
  rawClient,
  seatIdOf,
  secretOf,
  sleep,
  textOf,
  told,
  waitFor,
  withMux,
} from "./mux-kit.mjs";

const REALM = "nks-dev";
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);

/** Пустая строка ушла одним кадром tick уходящего места, до его отписки, без POST. */
function clearedBeforeUnsubscribe(fake, conn, name) {
  const chan = channelOf(fake, name);
  const { clearing, clearAt, unsubAt } = leaveFrames(conn, chan, seatIdOf(fake, name));
  assert.ok(clearAt >= 0, `${name}: the busy line cleared by a tick on the dispatcher connection`);
  assert.ok(unsubAt >= 0, `${name}: unsubscribed`);
  assert.ok(
    clearAt < unsubAt,
    `${name}: the last line before the unsubscribe: ${clearAt}, ${unsubAt}`,
  );
  assert.equal(clearing.length, 1, `${name}: one leaving frame per leave`);
  assert.ok(
    clearing[0].entries.every((e) => e.channel_id === chan),
    `${name}: the leaving frame carries the leaving seat only`,
  );
  assert.equal(fake.state.counts.status_requests, 0, "no POST to /channel/status");
  assert.equal(busyOf(fake, name), "", `${name}: the board shows no busy line`);
}

test("the session ends: its last busy line goes in a tick before its unsubscribe, no POST", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "last-a", status: "занят A" }), "A");
    ok(await b.stand({ realm: REALM, karta: 931, name: "last-b", status: "занят B" }), "B");
    const conn = await muxCarrying(fake, mux, [
      channelOf(fake, "last-a"),
      channelOf(fake, "last-b"),
    ]);
    await waitFor("A's busy line by tick", () => busyOf(fake, "last-a") === "занят A");
    a.bye();
    await waitFor("A's unsubscribe", () => mux.sent("unsubscribe").length);
    await sleep(500);
    clearedBeforeUnsubscribe(fake, conn, "last-a");
    assert.equal(busyOf(fake, "last-b"), "занят B", "B's line stays");
  });
});

test("leave by word clears the line by tick before the unsubscribe; the return brings it back by tick, no POST", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "word-a", status: "занят W" }), "A");
    const chan = channelOf(fake, "word-a");
    const conn = await muxCarrying(fake, mux, [chan]);
    await waitFor("A's busy line by tick", () => busyOf(fake, "word-a") === "занят W");
    const left = await a.rpc("tools/call", {
      name: "iskron_channel",
      arguments: { action: "leave", realm: REALM },
    });
    ok(left, "leave by word");
    await waitFor("A's unsubscribe", () => mux.sent("unsubscribe").length);
    await sleep(300);
    clearedBeforeUnsubscribe(fake, conn, "word-a");
    ok(await a.stand({ realm: REALM, karta: 931, name: "word-a" }), "A returns");
    await waitFor("the line back by tick", () => busyOf(fake, "word-a") === "занят W");
    assert.equal(fake.state.counts.status_requests, 0, "no POST on the return either");
  });
});

test("SIGINT of a full bridge on the dispatcher: the cleared line in a tick before the unsubscribe, no POST", async () => {
  await withMux(async ({ fake, mux, full }) => {
    const f = await full();
    ok(await f.stand({ realm: REALM, karta: 931, name: "int-a", status: "занят I" }), "F stands");
    const conn = await muxCarrying(fake, mux, [channelOf(fake, "int-a")], 10_000);
    await waitFor("the busy line by tick", () => busyOf(fake, "int-a") === "занят I");
    const exited = new Promise((r) => f.proc.once("exit", r));
    f.proc.kill("SIGINT");
    await exited;
    await sleep(300);
    clearedBeforeUnsubscribe(fake, conn, "int-a");
  });
});

test("a handover no successor takes: the seat keeps its last busy line, nothing cleared, no POST", async () => {
  await withMux(
    async ({ fake, mux, dir, session }) => {
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "hand-a", status: "занят H" }), "A");
      const chan = channelOf(fake, "hand-a");
      const conn = await muxCarrying(fake, mux, [chan]);
      await waitFor("the busy line by tick", () => busyOf(fake, "hand-a") === "занят H");
      const [pid] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
      process.kill(pid, "SIGTERM");
      await waitFor("the daemon gone", () => !alive(pid), 30_000);
      const { clearAt } = leaveFrames(conn, chan, seatIdOf(fake, "hand-a"));
      assert.equal(clearAt, -1, "no cleared line in a tick");
      assert.equal(fake.state.counts.status_requests, 0, "no POST to /channel/status");
      assert.equal(busyOf(fake, "hand-a"), "занят H", "the last busy line stays on the board");
    },
    { daemonEnv: { ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" } },
  );
});

test("superseded by another connection: the bridge touches the old seat's line no more, no POST", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "gone-a", status: "занят G" }), "A");
    const chan = channelOf(fake, "gone-a");
    const ida = seatIdOf(fake, "gone-a");
    const conn = await muxCarrying(fake, mux, [chan]);
    await waitFor("the busy line by tick", () => busyOf(fake, "gone-a") === "занят G");
    const other = await rawClient(`${fake.base.replace(/^http:/, "ws:")}/api/channel/mux`);
    try {
      const from = conn.frames.length;
      other.send({ type: "subscribe", secret: secretOf(fake, chan), ref: "theirs" });
      await waitFor("A told its seat is taken", () => told(a, "evicted").length);
      a.bye();
      await sleep(1500);
      const touched = mux.conns
        .flatMap((c) => c.frames.slice(c === conn ? from : 0).map((f) => f.frame))
        .filter((f) => f?.type === "tick" && f.entries.some((e) => e.standing_id === ida));
      assert.deepEqual(touched, [], "no tick about the superseded seat");
      assert.equal(fake.state.counts.status_requests, 0, "no POST to /channel/status");
      assert.equal(busyOf(fake, "gone-a"), "занят G", "its line is the new holder's to change");
    } finally {
      other.close();
    }
  });
});
