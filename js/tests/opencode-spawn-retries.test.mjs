// A launch whose register does not confirm its spawned_for pair (graph @nks/nks-dev, #10782):
// the harness opens session after session with the same first line, each prompt hook seats a
// root through a fresh bridge — 17 709 times in 15 h on 16-m3. The plugin tries the pair a
// bounded number of times with a growing pause, then refuses it without the wire and says so
// once. Real plugin and bridges (rootseat-kit.mjs) against the fake server (ownseat-kit.mjs);
// ISKRON_OPENCODE_PLUGIN aims the probe at an older build.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { SPAWNED_FOR } from "../delivery/index.ts";
import { setup } from "./ownseat-kit.mjs";
import { COVER, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const pair = { invite: 4, room: "70efab85-1f3b-46a2-a279-c9e806a9b371" };
const BASE_MS = 100;
const SESSIONS = 8;
const TRIES = 5;

test(
  "an unconfirmed pair is tried a bounded number of times, then refused locally",
  { timeout: 120_000 },
  async (t) => {
    const s = await setup(t);
    const project = realpathSync(s.cwd);
    writeAgents(project, COVER);
    // No structured receipt: register never echoes the pair back.
    s.fake.state.structured = false;
    s.fake.state.futureArgs.iskron_channel = ["spawned_for"];
    const oc = await rootPlugin(s, project, { ISKRON_SPAWN_RETRY_MS: String(BASE_MS) });
    const registers = () =>
      s.fake.state.calls.filter(
        (c) =>
          c.name === "iskron_channel" &&
          c.arguments.action === "register" &&
          c.arguments.spawned_for?.invite === pair.invite,
      ).length;
    const starts = [];
    const refusals = [];
    try {
      for (let i = 0; i < SESSIONS; i++) {
        // As the harness did: a new session, the same launch line, after every refusal.
        oc.create(`spawn-${i}`, { emit: false });
        const before = registers();
        const t0 = Date.now();
        await assert.rejects(
          oc.turn(`spawn-${i}`, `iskron/spawned_for: ${JSON.stringify(pair)}\nhi`),
          (e) => {
            refusals.push(e.message);
            return true;
          },
        );
        if (registers() > before) starts.push(t0);
      }
      const n = registers();
      assert.ok(n >= 1 && n <= TRIES, `registers with the pair: ${n}, at most ${TRIES}`);
      // The pause grows: the gap before the last try is at least four base pauses.
      const gaps = starts.slice(1).map((at, i) => at - starts[i]);
      assert.ok(gaps.at(-1) >= 4 * BASE_MS, `gaps between tries: ${gaps.join(", ")} ms`);
      // Past the bound: refused with the given-up word, no bridge, no server.
      const gaveUp = SPAWNED_FOR.ru.gaveUp?.(TRIES, pair.room, pair.invite);
      assert.ok(gaveUp, "the plugin has a given-up word");
      assert.equal(refusals.at(-1), gaveUp);
      // Loud end once: the plugin's error log names it, not once per refused session.
      assert.equal(oc.said().split(gaveUp).length - 1, 1, oc.said());
    } finally {
      await oc.stop();
    }
  },
);

test(
  "sessions opened at once with an unconfirmed pair still pass the bound only that many times",
  { timeout: 120_000 },
  async (t) => {
    const s = await setup(t);
    const project = realpathSync(s.cwd);
    writeAgents(project, COVER);
    s.fake.state.structured = false;
    s.fake.state.futureArgs.iskron_channel = ["spawned_for"];
    const oc = await rootPlugin(s, project, { ISKRON_SPAWN_RETRY_MS: String(BASE_MS) });
    try {
      const ids = Array.from({ length: SESSIONS }, (_, i) => `burst-${i}`);
      for (const id of ids) oc.create(id, { emit: false });
      const outcomes = await Promise.allSettled(
        ids.map((id) => oc.turn(id, `iskron/spawned_for: ${JSON.stringify(pair)}\nhi`)),
      );
      assert.ok(outcomes.every((o) => o.status === "rejected"));
      const n = s.fake.state.calls.filter(
        (c) =>
          c.name === "iskron_channel" &&
          c.arguments.action === "register" &&
          c.arguments.spawned_for?.invite === pair.invite,
      ).length;
      assert.ok(n >= 1 && n <= TRIES, `registers with the pair: ${n}, at most ${TRIES}`);
    } finally {
      await oc.stop();
    }
  },
);
