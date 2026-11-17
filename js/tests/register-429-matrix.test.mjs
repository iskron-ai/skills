// The family "a stop or a seat's end × the path of a register move" (graph nks-dev: #7439,
// #10801, #11030) as one matrix: every kind of register move — the rebind on a new MCP
// session, the disk return (the plugin's resume and iskron_stand), the skills refresh — meets
// each event during the main seat's 429 rate_limited wait (only the main seat waits): the
// owner's stop of the main seat (4001 revoked:person) and the end of the seat beside the move
// has not reached yet (standing_ended by=person). In every cell: no register of the taken-off
// seat after the event; on the main stop no register at all and the agent's waiting call is
// not sent; the move keeps within the client's cap. Beside them: a seat beside's own 429 —
// one register, no wait; two seats beside of one role and name in two graphs.
//
// The bridge runs on the probe's clock (fast-clock.cjs: ten times faster): a Retry-After of
// 40 s passes in 4 s, each cell takes a few seconds.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { RESUME_ANSWER_MS } from "../shared/ratelimit.ts";
import { placeOf, setup, stand, textOf, until, write } from "./ownseat-kit.mjs";

const FAST = 10;
process.env.NODE_OPTIONS = `--require ${join(dirname(fileURLToPath(import.meta.url)), "fast-clock.cjs")}`;
process.env.FAST_CLOCK = String(FAST);

const KEY = "proba--931--_nks_nks-dev";
const MAIN = "@nks/nks-dev";
const SIDE = "@nks/drugoy";
const rateLimited = (realm) => ({
  text: "Too Many Requests (429): rate_limited — retry after 40s",
  status: 429,
  rule: "rate_limited",
  data: { retry_after_secs: 40, key: "opening" },
  realm,
});
const registers = (fake, realm = "") =>
  fake.state.calls.filter(
    (c) =>
      c.name === "iskron_channel" &&
      c.arguments.action === "register" &&
      String(c.arguments.realm).endsWith(realm.replace(/^@nks\//, "")),
  ).length;

/** A set of skills of its own for the bridge (skillset.ts): a SKILL.md edit makes the refresh due. */
function skillSet() {
  const root = join(tmpdir(), `iskron-matrix-skills-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
  writeFileSync(join(root, "establish-mcp", "SKILL.md"), "before");
  return root;
}

/** The main seat proba and a seat beside it in drugoy, stood by bridge b1 from cwd. */
async function twoSeats(t, env = {}, session = true, besides = [["drugoy", 48, "a-beside"]]) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => {
    if (env.ISKRON_SKILLS_ROOT) rmSync(env.ISKRON_SKILLS_ROOT, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const kit = await setup(t);
  const b1 = await kit.up();
  // A record signed by a harness session goes back by the plugin's resume; an unsigned one by name.
  if (session) await b1.call("iskron/resume", { session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd: kit.cwd })),
    "proba",
  );
  for (const [realm, karta, name] of besides) {
    const side = await stand(b1, { realm, karta, name });
    assert.ok(!side.result?.isError, JSON.stringify(side));
  }
  const beside = () => b1.notifications.filter((n) => n.params?.data?.kind === "beside");
  await until(() => beside().length === besides.length, "the beside words");
  const idIn = (realm) =>
    [...kit.fake.state.channels.values()].map((c) => c.places.get(realm)).find(Boolean)
      ?.standing_id;
  const sideId = idIn(SIDE);
  assert.ok(sideId, "the seat beside has an id");
  return { ...kit, b1, sideId, idIn };
}

/** The bridge b1 is gone, its hold records stay: the next bridge returns the seats from disk. */
async function fromDisk(kit) {
  kit.b1.kill();
  await until(() => kit.fake.state.ws.size === 0, "b1's socket gone");
  return kit.up();
}

// Each kind: how the move begins (`begin`, after the refusal is armed), what the stopped agent's
// waiting call shows (`stoppedCall`), whether it registers the seats beside (`besides`).
const KINDS = {
  rebind: {
    besides: true,
    async begin(kit) {
      await kit.fake.control({ kill_session: true }); // the next call meets a new session
      const writes = kit.fake.state.writes.length;
      return {
        pending: write(kit.b1),
        stoppedCall: (r) => {
          assert.equal(
            kit.fake.state.writes.length,
            writes,
            `the call not sent: ${JSON.stringify(r)}`,
          );
          assert.ok(
            r.error || r.result?.isError,
            `the call answers the stop: ${JSON.stringify(r)}`,
          );
        },
      };
    },
  },
  "disk return (resume)": {
    besides: true,
    async begin(kit) {
      const b2 = await fromDisk(kit);
      return {
        pending: b2.call("iskron/resume", { key: KEY }),
        stoppedCall: (r) => {
          assert.equal(r.result?.stopped, true, JSON.stringify(r));
          assert.notEqual(r.result?.resumed, true, JSON.stringify(r));
        },
      };
    },
  },
  "disk return (iskron_stand)": {
    besides: false, // this path returns the named seat only
    unsigned: true,
    async begin(kit) {
      const b2 = await fromDisk(kit);
      const connects = kit.fake.state.counts.connect ?? 0;
      return {
        pending: stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd: kit.cwd }),
        // The disk path: the seat's socket reopened by its record, no new connect.
        always: () => assert.equal(kit.fake.state.counts.connect ?? 0, connects, "no connect"),
        stoppedCall: (r) => assert.match(textOf(r), /снят/, textOf(r)),
      };
    },
  },
  "skills refresh": {
    besides: true,
    env: () => ({ ISKRON_SKILLS_ROOT: skillSet(), ISKRON_SKILLS_GAP_MS: "1" }),
    // The refresh runs behind the call: let a 40 s wait (4 s here) run out before reading.
    settle: () => new Promise((d) => setTimeout(d, 4_500)),
    async begin(kit) {
      // A changed set: the next call's background refresh registers every seat with it.
      writeFileSync(join(process.env.ISKRON_SKILLS_ROOT, "establish-mcp", "SKILL.md"), "after");
      await write(kit.b1);
      return { pending: Promise.resolve(null), stoppedCall: () => {} };
    },
  },
};

const ended = (kit, id) =>
  kit.fake.control({
    ws_send: JSON.stringify({ type: "standing_ended", standing_id: id, by: "person" }),
  });
// Only the main seat waits out a 429: every event comes during its wait. The seat beside's end
// comes before its own register — a seat the move has not reached yet (not held, on a disk return).
const EVENTS = {
  "the main seat's stop": (kit) =>
    kit.fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" }),
  "the seat beside's end": (kit) => ended(kit, kit.sideId),
};

for (const [kind, k] of Object.entries(KINDS))
  for (const [event, fire] of Object.entries(EVENTS))
    test(`${kind} × ${event} during the main seat's 429 wait`, async (t) => {
      if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
      const kit = await twoSeats(t, k.env?.() ?? {}, !k.unsigned);
      await kit.fake.control({ registerRefuseNext: [rateLimited(MAIN)] });
      const started = Date.now();
      const { pending, stoppedCall, always } = await k.begin(kit);
      await until(() => (kit.fake.state.counts.register_refused ?? 0) >= 1, "the 429", 10_000);
      const at = { all: registers(kit.fake), side: registers(kit.fake, SIDE) };
      await fire(kit);
      const r = await pending;
      const tookMs = (Date.now() - started) * FAST;
      await k.settle?.();
      await new Promise((d) => setTimeout(d, 600)); // a late register would land by now
      const seen = `${kind} × ${event}: ${JSON.stringify(r)}`;
      always?.();
      assert.equal(
        registers(kit.fake, SIDE) - at.side,
        0,
        `no register of the seat beside after: ${seen}`,
      );
      if (EVENTS[event] === EVENTS["the main seat's stop"]) {
        assert.equal(registers(kit.fake) - at.all, 0, `no register at all after the stop: ${seen}`);
        stoppedCall(r);
      }
      assert.ok(tookMs < RESUME_ANSWER_MS, `the move within the cap: ${tookMs} ms — ${seen}`);
    });

// A seat beside does not wait out its 429: one register, its refusal stands, the move goes on
// at once — the next move of its own brings it back (#10801).
for (const [kind, k] of Object.entries(KINDS).filter(([, k]) => k.besides))
  test(`${kind} × the seat beside's own 429: one register, no wait`, async (t) => {
    if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
    const kit = await twoSeats(t, k.env?.() ?? {}, !k.unsigned);
    await kit.fake.control({ registerRefuseNext: [rateLimited(SIDE)] });
    const side = registers(kit.fake, SIDE);
    const started = Date.now();
    const { pending } = await k.begin(kit);
    await until(() => (kit.fake.state.counts.register_refused ?? 0) >= 1, "the 429", 10_000);
    await pending;
    const tookMs = (Date.now() - started) * FAST;
    await k.settle?.();
    await new Promise((d) => setTimeout(d, 600)); // a retry after a wait would show by now
    assert.equal(registers(kit.fake, SIDE) - side, 1, `${kind}: the seat beside registered once`);
    assert.ok(tookMs < 40_000, `${kind}: no 40 s wait behind it — ${tookMs} ms`);
  });

// Two seats beside with one role and name in two graphs: the end of one is matched by its graph
// too (hello names both), the other comes back (#7439).
test("disk return × two seats beside of one role and name in two graphs: the ended one is not registered, the other is", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
  const kit = await twoSeats(t, {}, true, [
    ["drugoy", 48, "a-beside"],
    ["methodology", 48, "a-beside"],
  ]);
  await kit.fake.control({ registerRefuseNext: [rateLimited(MAIN)] });
  const other = registers(kit.fake, "@nks/methodology");
  const b2 = await fromDisk(kit);
  const pending = b2.call("iskron/resume", { key: KEY });
  await until(() => (kit.fake.state.counts.register_refused ?? 0) >= 1, "the 429", 10_000);
  const side = registers(kit.fake, SIDE);
  await ended(kit, kit.sideId);
  const r = await pending;
  await new Promise((d) => setTimeout(d, 600));
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.equal(registers(kit.fake, SIDE) - side, 0, "the ended seat in drugoy not registered");
  assert.equal(registers(kit.fake, "@nks/methodology") - other, 1, "the one in methodology is");
});

// The move begins at the return's entry, before its preparation (the disk read, the socket,
// the busy line back): a seat beside ended there is not registered either (#7439).
test("disk return (resume) × the seat beside's end while the return prepares (its busy line), before any register", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
  const kit = await twoSeats(t);
  const busy = await stand(kit.b1, { realm: "nks-dev", status: "занят" });
  assert.ok(!busy.result?.isError, textOf(busy));
  const b2 = await fromDisk(kit);
  await kit.fake.control({ statusDelayMs: 1500 }); // the busy line back is slow
  const side = registers(kit.fake, SIDE);
  const statuses = kit.fake.state.counts.status_requests ?? 0;
  const pending = b2.call("iskron/resume", { key: KEY, session: "ses-1" });
  await until(() => (kit.fake.state.counts.status_requests ?? 0) > statuses, "the busy line");
  await ended(kit, kit.sideId);
  const r = await pending;
  await new Promise((d) => setTimeout(d, 600));
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.equal(
    registers(kit.fake, SIDE) - side,
    0,
    "the seat ended in the preparation not registered",
  );
});

// A stop that lands while a register is on the wire is asked again before the next send: after
// a waited 429 the retry answers 409 opened concurrently, and its fallback register goes through
// the gate too — nothing after the stop (registergate.ts, #7439).
test("rebind × the main seat's stop while its retry after the 429 is on the wire, answered 409 opened concurrently: no register after the stop", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
  const kit = await twoSeats(t);
  const brief = { ...rateLimited(MAIN), data: { retry_after_secs: 1, key: "opening" } };
  // structured: the 409's refusal carries its status (refusal.ts openedConcurrently reads it).
  await kit.fake.control({
    structured: true,
    registerRefuseNext: [brief],
    registerConcurrentNext: 1,
  });
  await kit.fake.control({ kill_session: true }); // the next call meets a new session: the rebind
  await kit.fake.control({ registerToolDelayMs: 1500 }); // every register's answer is slow
  const writes = kit.fake.state.writes.length;
  const first = registers(kit.fake, MAIN);
  const pending = write(kit.b1);
  // The first register (429) and its retry after the wait: the retry is on the wire now.
  await until(() => registers(kit.fake, MAIN) >= first + 2, "the retry on the wire", 10_000);
  const atStop = registers(kit.fake);
  await kit.fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const r = await pending;
  await kit.fake.control({ registerToolDelayMs: 0 });
  await new Promise((d) => setTimeout(d, 600)); // a late register would land by now
  assert.equal(kit.fake.state.counts.register_concurrent ?? 0, 1, "the retry answered 409");
  assert.equal(registers(kit.fake) - atStop, 0, `no register after the stop: ${JSON.stringify(r)}`);
  assert.equal(kit.fake.state.writes.length, writes, `the call not sent: ${JSON.stringify(r)}`);
});
