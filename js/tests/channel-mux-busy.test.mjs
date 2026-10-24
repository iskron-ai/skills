// Контрольный образец #8620 v11 (граф @nks/nks-dev), половина моста — занятость места под
// диспетчером идёт только тактом: на уходе (конец сессии, leave по слову, SIGINT полного
// моста) пустая строка — кадром tick до unsubscribe; возврат — тактом; после superseded и
// при передаче, не взятой преемником, место не трогается; POST статуса — только в откате.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

test("usage goes in the tact, no register replay for it; the last numbers before the unsubscribe", async () => {
  await withMux(
    async ({ fake, mux, session }) => {
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "use-a" }), "A stands");
      const chan = channelOf(fake, "use-a");
      const conn = await muxCarrying(fake, mux, [chan]);
      const id = seatIdOf(fake, "use-a");
      const registers = fake.state.counts.register_standing;
      const first = await a.rpc("iskron/usage", { tokens: 1000, model: "m1" });
      assert.equal(first.result?.pushed, true, JSON.stringify(first));
      await waitFor("the numbers by tick", () => mux.usage.get(id)?.tokens === 1000);
      await a.rpc("iskron/usage", { tokens: 90_000, model: "m2" });
      await waitFor("the shift by tick", () => mux.usage.get(id)?.tokens === 90_000);
      await a.rpc("iskron/usage", { tokens: 95_000, model: "m2" });
      a.bye();
      await waitFor("A's unsubscribe", () => mux.sent("unsubscribe").length);
      // Последние числа — тактом или кадром ухода, но до отписки.
      const frames = conn.frames.map((f) => f.frame);
      const lastAt = frames.findIndex(
        (f) => f?.type === "tick" && f.entries.some((e) => e.usage?.tokens === 95_000),
      );
      assert.ok(lastAt >= 0 && lastAt < leaveFrames(conn, chan, id).unsubAt, "last numbers first");
      assert.equal(fake.state.counts.register_standing, registers, "no register for the numbers");
    },
    { daemonEnv: { ISKRON_USAGE_GAP_MS: "1" } },
  );
});

test("a seat id unknown on a channel of one seat: the tact line goes without standing_id and lands; standing_required is a journal line", async () => {
  await withMux(
    async ({ fake, mux, session, journal }) => {
      await fake.control({ registerNoId: true, helloNoIds: true });
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "noid-a", status: "занят N" }), "A");
      const chan = channelOf(fake, "noid-a");
      const conn = await muxCarrying(fake, mux, [chan]);
      await waitFor("the line on the one seat", () => busyOf(fake, "noid-a") === "занят N");
      const rows = mux.ticks.flatMap((t) => t.entries).filter((e) => e.status === "занят N");
      assert.ok(rows.length && rows.every((e) => !("standing_id" in e)), JSON.stringify(rows));
      assert.equal(fake.state.counts.status_requests, 0, "no POST");
      mux.push({ type: "error", channel_id: chan, code: "standing_required" });
      await waitFor("the refusal in the journal", () =>
        /refused a frame: standing_required/.test(journal()),
      );
      assert.ok(!conn.closed && conn.subs.has(chan), "the connection and the subscription live");
    },
    { noIds: true },
  );
});

test("leave while the dispatcher subscription is broken: no refusal to the agent, the line stays, no POST; the return brings it back by tick", async () => {
  await withMux(async ({ fake, mux, dir, session, journal }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "brk-l", status: "занят L" }), "A");
    ok(await b.stand({ realm: REALM, karta: 931, name: "brk-b" }), "B keeps the connection wanted");
    const [chan, cb] = [channelOf(fake, "brk-l"), channelOf(fake, "brk-b")];
    const first = await muxCarrying(fake, mux, [chan, cb]);
    await waitFor("the line by tick", () => busyOf(fake, "brk-l") === "занят L");
    mux.mode = "down";
    mux.drop();
    await waitFor(
      "a try on the down dispatcher",
      () => mux.attempts.some((x) => x.answered === 503),
      15_000,
    );
    const left = await a.rpc("tools/call", {
      name: "iskron_channel",
      arguments: { action: "leave", realm: REALM },
    });
    ok(left, "leave by word");
    assert.doesNotMatch(textOf(left), /Отказано|Refused/, "no refusal to the agent");
    assert.match(textOf(left), /до истечения пульса|till the pulse runs out/);
    assert.equal(fake.state.counts.status_requests, 0, "no POST");
    assert.equal(busyOf(fake, "brk-l"), "занят L", "the line stays on the board");
    const kept = readdirSync(join(dir, "standings"))
      .filter((f) => f.endsWith(".hold"))
      .map((f) => JSON.parse(readFileSync(join(dir, "standings", f), "utf8")))
      .find((r) => r.name === "brk-l");
    assert.equal(kept?.status, "занят L", "the hold record keeps the line");
    mux.mode = "mux";
    await waitFor(
      "the connection back",
      () => mux.live().find((c) => c !== first && c.subs.has(cb)),
      30_000,
    );
    const before = mux.ticks.length;
    ok(await a.stand({ realm: REALM, karta: 931, name: "brk-l" }), "A returns");
    await waitFor(
      "the line back by tick",
      () => mux.ticks.slice(before).some((t) => t.entries.some((e) => e.status === "занят L")),
      10_000,
    ).catch((e) => {
      throw new Error(`${e.message}\n${journal()}`);
    });
  });
});

// Снимок моста кратно меньше 2048 байт (девять чисел, model до 120 знаков): снаружи предел не
// превысить — проба опускает его наводкой ISKRON_USAGE_MAX_BYTES (#8620 (н)).
test("usage over the limit goes nowhere: no tact record, not remembered, no register carries it on leave or return", async () => {
  await withMux(
    async ({ fake, mux, session, journal }) => {
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "big-a" }), "A stands");
      await muxCarrying(fake, mux, [channelOf(fake, "big-a")]);
      const big = await a.rpc("iskron/usage", { tokens: 7, model: "m".repeat(120) });
      assert.equal(big.result?.pushed, false, JSON.stringify(big).slice(0, 300));
      assert.match(String(big.result?.why), /150/);
      await waitFor("the journal line", () => /usage: \d+ bytes, over 150/.test(journal()));
      const carries = () =>
        JSON.stringify(fake.state.placeAttrs.get("931:big-a") ?? {}).includes("m".repeat(120));
      ok(
        await a.rpc("tools/call", {
          name: "iskron_channel",
          arguments: { action: "leave", realm: REALM },
        }),
        "leave by word",
      );
      assert.ok(!carries(), "the leave's last snapshot does not carry it");
      ok(await a.stand({ realm: REALM, karta: 931, name: "big-a" }), "A returns");
      assert.ok(!carries(), "the return's register does not carry it");
      const rows = mux.ticks.flatMap((t) => t.entries).filter((e) => e.usage);
      assert.deepEqual(rows, [], "no usage record in the tact");
    },
    { daemonEnv: { ISKRON_USAGE_MAX_BYTES: "150", ISKRON_USAGE_GAP_MS: "1" } },
  );
});

test("a satellite leaves by word while the dispatcher subscription is broken: told the truth, the line stays, no POST", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    const s = await session(["--satellite"]);
    const satellite_of = `@tester:${CALLER}`;
    ok(await s.stand({ realm: REALM, karta: 931, satellite_of, status: "занят S" }), "it stands");
    const name = `${CALLER}.sub-1`;
    await muxCarrying(fake, mux, [channelOf(fake, name)]);
    await waitFor("the line by tick", () => busyOf(fake, name) === "занят S");
    mux.mode = "down";
    mux.drop();
    await waitFor(
      "a try on the down dispatcher",
      () => mux.attempts.some((x) => x.answered === 503),
      15_000,
    );
    const left = await s.rpc("tools/call", {
      name: "iskron_channel",
      arguments: { action: "leave", realm: REALM },
    });
    ok(left, "leave by word");
    assert.doesNotMatch(textOf(left), /занятость снята|busyness cleared/, "no false «cleared»");
    assert.match(textOf(left), /до истечения пульса|till the pulse runs out/);
    assert.equal(fake.state.counts.status_requests, 0, "no POST");
    assert.equal(busyOf(fake, name), "занят S", "the line stays on the board");
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

test("SIGINT after a fallback, a slow held POST in the turn: the leave's cleared line keeps its 2 s cap from the queue, not after it", async () => {
  await withMux(
    async ({ fake, mux, full }) => {
      const f = await full();
      await f.stand({ realm: REALM, karta: 931, name: "cap-a", status: "занят C" });
      await waitFor("the dispatcher's 503", () => mux.attempts.length >= 1);
      fake.state.statusDelayMs = 6000; // придержанная строка застревает в очереди
      mux.mode = "old";
      await waitFor("the held line's POST", () => fake.state.counts.status_requests >= 1, 15_000);
      const exited = new Promise((r) => f.proc.once("exit", r));
      const at = Date.now();
      f.proc.kill("SIGINT");
      await exited;
      const took = Date.now() - at;
      assert.ok(took < 4000, `the bridge left in ${took} ms — the 2 s cap counts from the queue`);
    },
    { mode: "down" },
  );
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
