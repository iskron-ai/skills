// Built dev bridge: hello/list has proved r5 -> canonical before the exact own Run stop.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { setup, stand, textOf, until } from "./ownseat-kit.mjs";
import { acks, NKS, seatId, states } from "./stoporder-kit.mjs";

for (const realm of ["r5", NKS, "@nks/foreign"]) {
  test(`built own Run realm binding: ${realm}`, async (t) => {
    const bin = new URL("./fake-orca.mjs", import.meta.url).pathname;
    // setup's up() reads process.env when it launches the isolated test bridge.
    const { fake, dir, up } = await setup(t);
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/orca"), `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`, {
      mode: 0o755,
    });
    const old = { PATH: process.env.PATH, FAKE_ORCA_LOG: process.env.FAKE_ORCA_LOG };
    process.env.PATH = `${join(dir, "bin")}:${process.env.PATH}`;
    process.env.FAKE_ORCA_LOG = join(dir, "orca.log");
    t.after(() => {
      for (const [k, v] of Object.entries(old)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
    const b = await up(undefined, { experimental: { "iskron/halts": {} } });
    const first = await stand(b, { realm: NKS, karta: 931, name: "alias-stop" });
    assert.ok(!first.result?.isError, textOf(first));
    await until(
      () => seatId(fake, NKS, "alias-stop") && fake.state.orders.reads >= 1,
      "own seat and hello",
    );
    const id = seatId(fake, NKS, "alias-stop");
    const own = {
      realm,
      room: "room-own",
      invite: 5,
      karta: 931,
      launcher: "own",
      harness: "opencode",
      model: "unused",
      repository: "local",
      worktree: dir,
      terminal: "term_owned",
      runtime: "rt_fake",
      standing_id: id,
      state: "raised",
      at: "now",
    };
    mkdirSync(join(dir, "run"), { recursive: true });
    const registry = join(dir, "run/orchestra-runs.json");
    writeFileSync(registry, JSON.stringify({ runs: { own } }));
    // Force realm-list learning through the ordinary stand route, not a test-only alias hook.
    const again = await stand(b, { realm: "r5", karta: 931, name: "alias-stop" });
    assert.ok(!again.result?.isError, textOf(again));
    await fake.control({ stop_order: { id: "ord-alias", standing_id: id } });
    await until(
      () => b.notifications.some((n) => n.params?.data?.order === "ord-alias"),
      "stop word",
    );
    await b.call("iskron/halted", { order: "ord-alias", ok: false, code: "client_unbound" });
    await until(
      () => states(fake, "ord-alias").some((s) => ["failed", "stopped"].includes(s)),
      "terminal ack",
    );
    assert.equal(
      acks(fake, "ord-alias").at(-1).reason_code,
      realm === "@nks/foreign" ? "client_unbound" : "client_exited",
    );
    assert.equal(
      JSON.parse(readFileSync(registry, "utf8")).runs.own.closed,
      realm === "@nks/foreign" ? undefined : "client_exited",
    );
  });
}
