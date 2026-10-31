// Пробы «конец агента закрывает место» (граф @nks/nks-dev, узел #7493): настоящие тонкие
// мосты через настоящий демон машины на фейке NKS.
//   смерть   — харнес убит или закрыл вход без метки: до окна место живо, после окна
//              демон снимает его своим revoke и стирает запись держания;
//   окно     — новый мост той же папки вернул место внутри окна: оно не снимается;
//   отлучка  — метка iskron/away: место и запись переживают окно, та же сессия
//              возвращает место по записи сразу;
//   конец    — iskron/end (удалённая сессия OpenCode): снято сразу, тихо, без слова стопа;
//   Esc      — отменённый вызов места не трогает.
// ISKRON_BRIDGE_PATH наводит пробы на другую копию моста — на прежней сборке смерть
// места не снимает, а away и end основного места не исполняются.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import {
  closed,
  DEATH_MS,
  delay,
  journalOf,
  recordOf,
  stand,
  stood,
  textOf,
  waitFor,
  withFake,
} from "./lifeend-kit.mjs";

for (const [how, end] of [
  ["killed", (b) => b.proc.kill("SIGKILL")],
  ["closed its stdin (Claude Code's exit, no hooks)", (b) => b.proc.stdin.end()],
])
  test(`the harness ${how} without a mark: the seat lives through the window and closes after it`, async () => {
    await withFake(async ({ fake, dir, bridge }) => {
      const a = await bridge();
      await stood(a, "die-x");
      assert.ok(existsSync(recordOf(dir, "die-x")), "the hold record is written");
      end(a);
      await a.gone();
      await delay(DEATH_MS / 2);
      assert.ok(!closed(fake, "die-x"), "within the window the seat is not closed");
      await waitFor("the seat closed after the window", () => closed(fake, "die-x"), 15_000).catch(
        (e) => {
          throw new Error(`${e.message}\n${journalOf(dir)}`);
        },
      );
      await waitFor("the hold record dropped", () => !existsSync(recordOf(dir, "die-x")), 5_000);
      assert.match(journalOf(dir), /without an announced absence — closing its seats/);
    });
  });

// The stop by the dead socket's token ends the whole channel (#7621 v2): the seat beside goes
// with the main one in that one call, no revoke by name — no race with a new holder.
test("a dead agent's seat beside in another graph closes with its main seat", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-b");
    const rb = await a.request("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "drugoy", karta: 48, name: "die-b" },
    });
    assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
    a.proc.kill("SIGKILL");
    await a.gone();
    await waitFor(
      "both seats closed",
      () => closed(fake, "die-b") && fake.state.closedPlaces.has("48:die-b"),
      15_000,
    ).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    assert.equal(revokesOf(fake, "die-b"), 0, `no revoke by name:\n${journalOf(dir)}`);
    assert.equal(fake.state.counts.stops, 1, "one stop for the channel");
  });
});

// A seat the stop's ended[] does not name is held by another live channel: not closed by this
// call, and its hold record is not touched.
test("a seat beside held by another live channel is not in the stop's ended: its record stays", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-k");
    const rb = await a.request("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "drugoy", karta: 48, name: "die-k" },
    });
    assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
    const beside = holdFilePathOf(dir, "die-k--48--_nks_drugoy");
    assert.ok(existsSync(beside), "the seat beside has its hold record");
    fake.state.stopKeeps.add("48:die-k");
    a.proc.kill("SIGKILL");
    await a.gone();
    await waitFor("the main seat closed", () => closed(fake, "die-k"), 15_000).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    await delay(300);
    assert.ok(!fake.state.closedPlaces.has("48:die-k"), "the seat beside lives");
    assert.match(journalOf(dir), /die-k--48--_nks_drugoy: not among the stop's ended seats/);
    assert.equal(revokesOf(fake, "die-k"), 0, "no revoke by name");
    assert.ok(existsSync(beside), "its hold record is not touched");
    assert.ok(!existsSync(recordOf(dir, "die-k")), "the main seat's record dropped");
  });
});

test("a new bridge of the folder takes the seat back within the window: it is not closed after it", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-r");
    a.proc.stdin.end();
    await a.gone();
    const b = await bridge(); // an MCP reconnect: the same folder, a new bridge
    const r = await stand(b, "die-r");
    assert.ok(!r.result?.isError, textOf(r));
    assert.match(textOf(r), /die-r/);
    await delay(DEATH_MS + 2_000);
    assert.ok(!closed(fake, "die-r"), `the returned seat stays:\n${journalOf(dir)}`);
    assert.match(journalOf(dir), /die-r--931--_nks_nks-dev is held again — not closed/);
  });
});

test("an announced absence keeps the seat past the window, and the same session takes it back at once", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await a.request("iskron/resume", { session: "ses-away" }); // the plugin names the session
    await stood(a, "die-a");
    const away = await a.request("iskron/away");
    assert.equal(away.result?.away, true, `away is taken: ${JSON.stringify(away)}`);
    a.proc.stdin.end();
    await a.gone();
    await delay(DEATH_MS + 2_000);
    assert.ok(!closed(fake, "die-a"), `the absent seat is not closed:\n${journalOf(dir)}`);
    assert.ok(existsSync(recordOf(dir, "die-a")), "its hold record waits");
    const b = await bridge();
    const started = Date.now();
    const back = await b.request("iskron/resume", {
      key: "die-a--931--_nks_nks-dev",
      session: "ses-away",
    });
    assert.equal(back.result?.resumed, true, JSON.stringify(back));
    assert.ok(back.result?.own, "returned as the session's own seat");
    assert.ok(Date.now() - started < 10_000, "no wait for a probe");
  });
});

test("the plugin's end of a deleted session revokes the main seat at once, quietly", async () => {
  await withFake(async ({ fake, bridge }) => {
    const a = await bridge();
    await stood(a, "die-e");
    const r = await a.request("iskron/end");
    assert.equal(r.result?.ended, true, JSON.stringify(r));
    assert.ok(
      r.result.revoked.some((s) => s.name === "die-e"),
      `revoked by the bridge itself: ${JSON.stringify(r)}`,
    );
    assert.ok(closed(fake, "die-e"), "the seat is off the board at once");
    await delay(300);
    const stop = a.notifications.filter((n) => n.params?.data?.kind === "stopped");
    assert.equal(stop.length, 0, `no stop word: ${JSON.stringify(stop)}`);
  });
});

const revokesOf = (fake, name) =>
  fake.state.calls.filter(
    (c) =>
      c.name === "iskron_channel" &&
      c.arguments.action === "revoke" &&
      c.arguments.standing === name,
  ).length;

// №677, api 0.124.0 (case №675): the main seat ends by its dead socket's own token — the check
// that the token is still current and the end are one transaction on the server.
test("after the window the main seat ends by its dead socket's token, not by a revoke by name", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-s");
    a.proc.kill("SIGKILL");
    await a.gone();
    await waitFor("the seat closed after the window", () => closed(fake, "die-s"), 15_000).catch(
      (e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      },
    );
    await waitFor("the hold record dropped", () => !existsSync(recordOf(dir, "die-s")), 5_000);
    assert.match(journalOf(dir), /die-s--931--_nks_nks-dev ended by its dead socket's token \(200/);
    assert.equal(revokesOf(fake, "die-s"), 0, "no revoke by name");
  });
});

// Another holder's connect lands right after the bridge's last check: between the board's read
// and the revoke by name (an old bridge), or before the stop by token — whose 404 with the rule
// leaves the new holder's seat alive.
test("the name taken right after the bridge's last check: the stop by token answers not current, the new holder's seat lives", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-g");
    a.proc.kill("SIGKILL");
    await a.gone();
    fake.state.takeInWindow = "931:die-g";
    await waitFor(
      "the window's judgement",
      () =>
        /die-g--931--_nks_nks-dev: its dead socket's token is not current/.test(journalOf(dir)) ||
        closed(fake, "die-g"),
      15_000,
    ).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    await delay(500);
    assert.ok(!closed(fake, "die-g"), `the new holder's seat lives:\n${journalOf(dir)}`);
    assert.ok(fake.state.places.has("931:die-g"), "the seat is on the board");
    assert.ok(!existsSync(recordOf(dir, "die-g")), "the dead agent's own record is dropped");
  });
});

// A new holder of the same home writes its hold record before the stop answers not current:
// the dead agent drops only its own record (the same socket address), not the new holder's.
test("the stop answers not current after a new holder of this home wrote its record: that record lives", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "die-h");
    a.proc.kill("SIGKILL");
    await a.gone();
    const rec = recordOf(dir, "die-h");
    const theirs = { realm: "nks-dev", karta: 931, name: "die-h", url: "ws://new-holder/x" };
    fake.state.takeInWindow = "931:die-h";
    fake.state.beforeStopReply = () =>
      writeFileSync(rec, JSON.stringify({ ...theirs, session: "new-holder", at: Date.now() }));
    await waitFor("the window's judgement", () =>
      /die-h--931--_nks_nks-dev: its dead socket's token is not current/.test(journalOf(dir)),
    ).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    await delay(300);
    assert.ok(existsSync(rec), `the new holder's record lives:\n${journalOf(dir)}`);
    assert.equal(JSON.parse(readFileSync(rec, "utf8")).url, theirs.url);
  });
});

// A satellite has no death window — its end is its death: dead in the middle of its first
// connect, the late reply opens no socket and its seat ends at once by that reply's token.
test("a satellite dead in the middle of its first connect: no socket, the seat ends at once", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    const s = await bridge(dir, ["--satellite"]);
    fake.state.connectReplyDelayMs = 1_500;
    void s
      .request("tools/call", {
        name: "iskron_stand",
        arguments: { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` },
      })
      .catch(() => {});
    const connects = () =>
      fake.state.calls.filter(
        (c) => c.name === "iskron_channel" && c.arguments.action === "connect",
      ).length;
    await waitFor("the connect sent", () => connects() > 0);
    s.proc.kill("SIGKILL");
    await s.gone();
    const name = `${CALLER}.sub-1`;
    const listens = () => [...fake.state.ws].some((w) => fake.state.wsNames.get(w) === name);
    // The session ends when its stand in flight has answered: the seat goes then, not a window later.
    await waitFor("the session's end", () => / session \S+ ended: /.test(journalOf(dir))).catch(
      (e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      },
    );
    const since = Date.now();
    await waitFor("the seat closed", () => closed(fake, name), 15_000).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    assert.ok(Date.now() - since < DEATH_MS, `at once, not after a window:\n${journalOf(dir)}`);
    assert.match(
      journalOf(dir),
      /connect answered after the run's end — no socket opened, it ends at once/,
    );
    assert.match(journalOf(dir), /ended by its dead socket's token \(200/);
    assert.ok(!listens(), `no socket listens on it:\n${journalOf(dir)}`);
    assert.equal(connects(), 1, "one connect");
  });
});

// An api without the stop (404 without a rule, 405): the board's check and a revoke by name.
for (const absent of [404, 405])
  test(`an api without the stop by token (${absent}): the dead seat closes by the board and a revoke`, async () => {
    await withFake(
      async ({ fake, dir, bridge }) => {
        const a = await bridge();
        await stood(a, "die-o");
        a.proc.kill("SIGKILL");
        await a.gone();
        await waitFor(
          "the seat closed after the window",
          () => closed(fake, "die-o"),
          15_000,
        ).catch((e) => {
          throw new Error(`${e.message}\n${journalOf(dir)}`);
        });
        assert.match(journalOf(dir), new RegExp(`no stop by token on this api \\(${absent}`));
        assert.equal(revokesOf(fake, "die-o"), 1, "the revoke by name");
        await waitFor("the hold record dropped", () => !existsSync(recordOf(dir, "die-o")), 5_000);
      },
      { stopAbsent: absent },
    );
  });

// A revoke whose reply only reads as gone (prose without refusal data) is not confirmed: the
// bridge says it apart from failed, and the hold record stays for the window. The end revokes
// by name only on an api without the stop by token (lifeend-word.test.mjs).
test("an end whose revoke is gone only by the reply's prose answers it as probably, the record kept", async () => {
  await withFake(
    async ({ fake, dir, bridge }) => {
      const a = await bridge();
      await stood(a, "die-p");
      fake.state.revokeRefuseNext = [{ text: "Место уже снято." }];
      const r = await a.request("iskron/end");
      assert.deepEqual(r.result?.probably, ["die-p"], JSON.stringify(r));
      assert.deepEqual(r.result?.failed, [], JSON.stringify(r));
      assert.ok(existsSync(recordOf(dir, "die-p")), "the hold record stays");
    },
    { stopAbsent: 404 },
  );
});

// №677: the death window checks the server, not only this machine's socket — a bridge of
// another home took the name in the window, and a revoke by name would close its live seat.
// An api without the stop by token: the board's check (with the token's stop see above).
for (const [how, opts, mute, said] of [
  ["listens on it", { stopAbsent: 404 }, false, /someone listens on it — another holder took it/],
  [
    "turned its address (its socket not on the board)",
    { statusRotates: true, stopAbsent: 404 },
    true,
    /its socket's address was turned — another holder took it/,
  ],
])
  test(`the name taken by another home within the window — the board ${how}: the dead seat is not revoked`, async () => {
    await withFake(async ({ fake, dir, bridge, home }) => {
      const a = await bridge();
      await stood(a, "die-t");
      a.proc.kill("SIGKILL");
      await a.gone();
      // The dead session's end has released its socket: the take below is no eviction of it.
      await waitFor(
        "the dead socket released",
        () => !fake.state.places.get("931:die-t")?.listening,
      );
      const b = await bridge(home());
      const r = await b.request("tools/call", {
        name: "iskron_stand",
        arguments: { realm: "nks-dev", karta: 931, name: "die-t", take: true },
      });
      assert.ok(!r.result?.isError, textOf(r));
      // A holder that keeps no socket between its windows: the board does not hear it.
      if (mute) fake.state.places.get("931:die-t").listening = false;
      await waitFor(
        "the window's judgement",
        () => said.test(journalOf(dir)) || closed(fake, "die-t"),
        15_000,
      ).catch((e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      });
      await delay(500);
      assert.ok(!closed(fake, "die-t"), `the new holder's seat lives:\n${journalOf(dir)}`);
      assert.match(journalOf(dir), said);
      assert.ok(fake.state.places.has("931:die-t"), "the seat is on the board");
      assert.ok(!existsSync(recordOf(dir, "die-t")), "the dead agent's own record is dropped");
    }, opts);
  });

test("an end whose revoke is refused keeps the hold record, and the death window repeats the revoke", async () => {
  await withFake(
    async ({ fake, dir, bridge }) => {
      const a = await bridge();
      await stood(a, "die-f");
      fake.state.revokeRefuseNext = [{ text: "Отказано (503): сбой", status: 503, rule: "x" }];
      const r = await a.request("iskron/end");
      assert.ok(
        r.result?.failed?.includes("die-f"),
        `the refusal is in the answer: ${JSON.stringify(r)}`,
      );
      assert.ok(!closed(fake, "die-f"), "the seat stands");
      assert.ok(existsSync(recordOf(dir, "die-f")), "the hold record stays for the repeat");
      a.proc.stdin.end();
      await a.gone();
      await waitFor("the repeat closed the seat", () => closed(fake, "die-f"), 15_000).catch(
        (e) => {
          throw new Error(`${e.message}\n${journalOf(dir)}`);
        },
      );
      await waitFor("the hold record dropped", () => !existsSync(recordOf(dir, "die-f")), 5_000);
    },
    { stopAbsent: 404 },
  );
});

// №677: the agent dies while its first connect is in flight — the run's end finds no seat, and
// the connect's late reply must not open a socket nobody ends: the seat goes with the window.
test("death in the middle of the first connect: the late reply opens no socket, the seat ends after the window", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    fake.state.connectReplyDelayMs = 1_500;
    void stand(a, "die-m").catch(() => {});
    const connects = () =>
      fake.state.calls.filter(
        (c) => c.name === "iskron_channel" && c.arguments.action === "connect",
      ).length;
    await waitFor("the connect sent", () => connects() > 0);
    a.proc.kill("SIGKILL");
    await a.gone();
    const listens = () => [...fake.state.ws].some((s) => fake.state.wsNames.get(s) === "die-m");
    await waitFor("the late reply", () =>
      /connect answered after the run's end/.test(journalOf(dir)),
    );
    await delay(300);
    assert.ok(!listens(), `the late reply opened no socket:\n${journalOf(dir)}`);
    await waitFor("the seat closed after the window", () => closed(fake, "die-m"), 15_000).catch(
      (e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      },
    );
    assert.ok(!fake.state.places.has("931:die-m"), "the seat is off the board");
    assert.ok(!listens(), `no socket listens on it:\n${journalOf(dir)}`);
    assert.equal(connects(), 1, "one connect");
    assert.match(journalOf(dir), /die-m--931--_nks_nks-dev ended by its dead socket's token \(200/);
    assert.ok(!existsSync(recordOf(dir, "die-m")), "no hold record left");
  });
});

test("a cancelled call (Esc) leaves the seat alone past the window", async () => {
  await withFake(async ({ fake, bridge }) => {
    const a = await bridge();
    await stood(a, "die-c");
    a.send({
      jsonrpc: "2.0",
      id: "esc-1",
      method: "tools/call",
      params: { name: "iskron_orient", arguments: { realm: "nks-dev" } },
    });
    a.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "esc-1" } });
    await delay(DEATH_MS + 1_000);
    assert.ok(!closed(fake, "die-c"), "the seat stays");
    assert.equal(a.proc.exitCode, null, "the bridge lives");
  });
});
