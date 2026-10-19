// Behavioural probe for the OpenCode plugin against REAL bridges and the fake NKS: sibling
// satellites of one session. Apart from opencode.test.mjs for its time — each file is one
// process under the runner's per-file timeout; the plugin's stand-in context is opencode-kit.mjs.
// ISKRON_OPENCODE_PLUGIN and ISKRON_BRIDGE_PATH aim it at any copy, as there.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startFakeNks } from "./fake-nks.mjs";
import { delay, plugin, REAL_BRIDGE, until } from "./opencode-kit.mjs";

// Case №1046, seen live 19.10 00:21Z: one OpenCode session, a root and satellite children on
// bridges of their own. The platform put out the long-ended one for silence — 4001 revoked:silent
// on its socket, or standing_ended with its id — and 6 s later the LIVE sibling left its cases and
// its session was cut, its seat untouched by the platform. The stop is the named seat's only:
// the sibling and the root go on — no stop word, no interrupt, no case leave, the seat held.
const SIBLING_STOPS = {
  "close 4001 revoked:silent": (fake, zombie) =>
    fake.control({ ws_close_name: { name: zombie.name, code: 4001, reason: "revoked:silent" } }),
  "standing_ended silent to its own socket": (fake, zombie) =>
    fake.control({
      ws_send_name: {
        name: zombie.name,
        text: JSON.stringify({
          type: "standing_ended",
          standing_id: zombie.id,
          reason: "silent",
          to_standing: `@tester:${zombie.name}`,
          to_standing_id: zombie.id,
        }),
      },
    }),
  // The frame about the put-out seat on every socket of the session's bridges, each addressed to
  // its socket's own seat, as the api addresses every frame (to_standing, to_standing_id).
  "standing_ended silent on every socket": async (fake, zombie, seats) => {
    for (const s of seats)
      await fake.control({
        ws_send_name: {
          name: s.name,
          text: JSON.stringify({
            type: "standing_ended",
            standing_id: zombie.id,
            reason: "silent",
            to_standing: `@tester:${s.name}`,
            to_standing_id: s.id,
          }),
        },
      });
  },
};
for (const [how, put] of Object.entries(SIBLING_STOPS))
  for (const noId of [false, true])
    test(`real bridges: a sibling satellite put out by ${how}${noId ? ", the bridges not knowing their seats' ids" : ""} — the live satellite and the root go on`, async () => {
      const fake = await startFakeNks({ pat: "nks_pat_plugin" });
      await fake.control({
        richTools: true,
        ...(noId ? { registerNoId: true, helloNoIds: true } : {}),
      });
      const dir = mkdtempSync(join(tmpdir(), "iskron-sibling-stop-"));
      const rec = await plugin(
        {
          ISKRON_BRIDGE_PATH: REAL_BRIDGE,
          ISKRON_BRIDGE_URL: fake.mcpUrl,
          ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
          ISKRON_BRIDGE_NO_BROWSER: "1",
        },
        {
          location: { directory: dir },
          sessions: ["root", "live", "zombie"].map((id) => ({
            id,
            ...(id === "root" ? {} : { parentID: "root" }),
            location: { directory: dir },
          })),
        },
      );
      const seatOf = (re) => {
        const [key, p] = [...fake.state.places].find(([k]) => re.test(k)) ?? [];
        const ch = [...fake.state.channels.values()].find((c) =>
          [...c.places.values()].some((x) => x.name === p?.name),
        );
        const id = [...(ch?.places.values() ?? [])].find((x) => x.name === p?.name)?.standing_id;
        return key ? { key, name: p.name, id } : null;
      };
      try {
        await until(
          () => rec.tools().has("iskron_channel") && rec.tools().has("iskron_stand"),
          "the server's tools",
          15000,
        );
        const name = `sib-${how.length}-${noId ? 1 : 0}`;
        const root = await rec.call("iskron_stand", { realm: "nks-dev", karta: 931, name }, "root");
        assert.match(root.content, /стояние/, root.content);
        const seats = [{ name, id: seatOf(new RegExp(`:${name}$`))?.id }];
        for (const [s, n] of [
          ["live", 1],
          ["zombie", 2],
        ]) {
          const r = await rec.call("iskron_stand", { realm: "nks-dev" }, s);
          const seat = seatOf(new RegExp(`\\.sub-${n}$`));
          assert.ok(seat, `${s} stood as a satellite:\n${r.content}\n${rec.said()}`);
          seats.push(seat);
        }
        const [, live, zombie] = seats;
        await until(() => fake.state.ws.size === 3, "three sockets: root and both satellites");
        const leaves = () =>
          fake.state.calls.filter((c) => ["leave", "revoke"].includes(c.arguments?.action));
        const before = { prompts: rec.prompts.length, leaves: leaves().length };
        await put(fake, zombie, seats);
        await until(
          () => rec.interrupts.some((i) => i.sessionID === "zombie"),
          `the put-out satellite's turn cut:\n${rec.said()}`,
          8000,
        );
        await delay(1500);
        assert.deepEqual(
          rec.interrupts.map((i) => i.sessionID),
          ["zombie"],
          "only the put-out satellite's session is cut",
        );
        const words = rec.prompts
          .slice(before.prompts)
          .filter((p) => /остановлен/.test(p.text) && p.sessionID !== "zombie");
        assert.deepEqual(words, [], "no stop word to the live satellite or the root");
        assert.deepEqual(leaves().slice(before.leaves), [], "no case leave or revoke by anyone");
        assert.ok(fake.state.places.has(live.key), "the live satellite's seat stays on the board");
        const open = [...fake.state.wsNames.values()];
        assert.ok(open.includes(live.name) && open.includes(name), `the sockets stay: ${open}`);
        const said = rec.said();
        assert.doesNotMatch(
          said,
          new RegExp(`место ${live.name.replace(/\./g, "\\.")} снято`),
          said,
        );
        assert.doesNotMatch(said, new RegExp(`место ${name} снято`), said);
      } finally {
        await rec.stop();
        await fake.stop();
      }
    });
