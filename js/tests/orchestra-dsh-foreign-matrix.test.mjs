// Foreign stops and a re-read of the run's own stop on the same orders page.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { invite, leadingDsh, ROOM } from "./dsh-kit.mjs";

process.env.NODE_OPTIONS = `--require ${join(dirname(fileURLToPath(import.meta.url)), "fast-clock.cjs")}`;
process.env.FAST_CLOCK = "10";
const SEAT = "11111111-1111-4111-8111-111111111111";
const KARTA = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const entry = (id, kind, extra = {}) => ({
  id,
  kind,
  to_standing_id: null,
  to_karta_node_id: null,
  in_reply_to: null,
  author_standing_id: LEAD,
  author: "@tester:lead",
  payload: {},
  ...extra,
});

test("foreign stopped × dormant × exit observed × own order on page", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the accelerated clock requires NODE_OPTIONS");
  const first = entry(31, "invite", { to_karta_node_id: KARTA });
  const o = await leadingDsh(t, {
    env: { FAKE_DSH_HOLD_MS: "1000" },
    caseRoom: { status: "open", entries: [first] },
  });
  await o.queue([invite(31)]);
  assert.match((await o.step()).out, /invite 31: launched/);
  await o.queue([], [{ cursor: "s-31", spawned_for: { invite: 31, room: ROOM }, standing: SEAT }]);
  await o.step();
  const sleeping = await o.until(31, (r) => r.state === "dormant", 30_000);
  assert.ok(sleeping.tree.exit, "the process exit was observed");

  // The fake has no seat to accept our exit stop; seed the known own id on the persisted run,
  // then let its orders API serve that id and the foreign one on the same page.
  const registry = join(o.dir, "run", "orchestra-runs.json");
  const data = JSON.parse(readFileSync(registry, "utf8"));
  const row = Object.values(data.runs).find((r) => r.invite === 31);
  row.orders = [...(row.orders ?? []), "ord-own"];
  writeFileSync(registry, JSON.stringify(data));
  const base = readFileSync(join(o.dir, "server"), "utf8").trim().replace(/\/mcp$/, "");
  await fetch(`${base}/control`, {
    method: "POST",
    body: JSON.stringify({
      stop_orders: [
        { id: "ord-own", standing_id: SEAT, realm: "@nks/nks-dev", frame: false },
        { id: "ord-foreign", standing_id: SEAT, realm: "@nks/nks-dev", frame: false },
      ],
    }),
  });
  const ack = await fetch(`${base}/api/me/orders/ord-foreign/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "probe",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.ok(ack.ok, `foreign stop ack: ${ack.status}`);
  await o.room("open", [first, entry(32, "said", { to_standing_id: SEAT })]);
  const calls = o.dshCalls().length;
  await o.step();
  const ended = await o.until(31, (r) => r.state === "ended");
  assert.equal(o.dshCalls().length, calls, "no continuation after the foreign stop was read");
  assert.equal(ended.foreign_stop?.id, "ord-foreign");
  assert.equal(ended.foreign_stop?.state, "stopped");
});
