// The family "a stop or a seat's end × the path of a register move" (graph nks-dev: #7439,
// #10801, #11030) as one matrix: every kind of register move — the rebind on a new MCP
// session, the disk return (the plugin's resume and iskron_stand), the skills refresh — meets
// each event during a 429 rate_limited wait: the owner's stop of the main seat (4001
// revoked:person) and the end of the seat beside (standing_ended by=person). In every cell:
// no register of the taken-off seat after the event; on the main stop no register at all and
// the agent's waiting call is not sent; the move keeps within the client's cap.
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
import { placeOf, saidKind, setup, stand, textOf, until, write } from "./ownseat-kit.mjs";

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
async function twoSeats(t, env = {}, session = true) {
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
  const side = await stand(b1, { realm: "drugoy", karta: 48, name: "a-beside" });
  assert.ok(!side.result?.isError, JSON.stringify(side));
  await until(() => saidKind(b1, "beside"), "the beside word");
  const sideId = [...kit.fake.state.channels.values()]
    .map((c) => c.places.get(SIDE))
    .find(Boolean)?.standing_id;
  assert.ok(sideId, "the seat beside has an id");
  return { ...kit, b1, sideId };
}

/** The bridge b1 is gone, its hold records stay: the next bridge returns the seats from disk. */
async function fromDisk(kit) {
  kit.b1.kill();
  await until(() => kit.fake.state.ws.size === 0, "b1's socket gone");
  return kit.up();
}

// Each kind: the seat whose register meets the 429 (`limited`), how the move begins (`begin`,
// after the refusal is armed) and what the stopped agent's waiting call shows (`stoppedCall`).
const KINDS = {
  rebind: {
    limited: SIDE,
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
    limited: SIDE,
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
    limited: MAIN, // this path returns the named seat only: its own register meets the 429
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
    limited: SIDE,
    env: () => ({ ISKRON_SKILLS_ROOT: skillSet(), ISKRON_SKILLS_GAP_MS: "1" }),
    async begin(kit) {
      // A changed set: the next call's background refresh registers every seat with it.
      writeFileSync(join(process.env.ISKRON_SKILLS_ROOT, "establish-mcp", "SKILL.md"), "after");
      await write(kit.b1);
      return { pending: Promise.resolve(null), stoppedCall: () => {} };
    },
  },
};

const EVENTS = {
  "the main seat's stop": (kit) =>
    kit.fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" }),
  "the seat beside's end": (kit) =>
    kit.fake.control({
      ws_send: JSON.stringify({ type: "standing_ended", standing_id: kit.sideId, by: "person" }),
    }),
};

for (const [kind, k] of Object.entries(KINDS))
  for (const [event, fire] of Object.entries(EVENTS))
    test(`${kind} × ${event} during the 429 wait`, async (t) => {
      if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
      const kit = await twoSeats(t, k.env?.() ?? {}, !k.unsigned);
      await kit.fake.control({ registerRefuseNext: [rateLimited(k.limited)] });
      const started = Date.now();
      const { pending, stoppedCall, always } = await k.begin(kit);
      await until(() => (kit.fake.state.counts.register_refused ?? 0) >= 1, "the 429", 10_000);
      const at = { all: registers(kit.fake), side: registers(kit.fake, SIDE) };
      await fire(kit);
      const r = await pending;
      const tookMs = (Date.now() - started) * FAST;
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
