import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readDemands } from "../bridge/orchestra-demands.ts";
import { command, fixture } from "./demands-fixture.mjs";

// Wire sources: #4951/#7509, API 0.162, case 3798[26] (demands-fixture);
// raised: #6010/#8202, live API 0.130.12 (orchestra-tact.ts). Full invites is not a tape.
const realms = ["@probe/one", "@probe/two"];
const empty = { body: { items: [] } };
async function admitted(reply, env = {}) {
  const f = await fixture(reply, realms, {
    ISKRON_ORCHESTRA: "1",
    ISKRON_ORCHESTRA_TACT_MS: "3600000",
    ISKRON_BRIDGE_LANG: "en",
    ...env,
  });
  writeFileSync(join(f.dir, "run", "orchestra.json"), JSON.stringify({ on: true, realms }));
  return f;
}
const invites = (f) => f.calls.filter((c) => c.path.endsWith("/invites"));

test("invites tact: admitted daemon timer also reads each realm only once per tact", async () => {
  const f = await admitted(() => empty, { ISKRON_ORCHESTRA_TACT_MS: "300" });
  try {
    const until = Date.now() + 10_000;
    while (!f.calls.some((c) => c.path.includes("/me/orders")) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(
      f.calls.some((c) => c.path.includes("/me/orders")),
      "timer reached demands",
    );
    assert.equal((await command(f.dir, ["off"])).code, 0);
    // Flush any in-flight timer tact; flag off makes this explicit step read nothing.
    assert.equal((await command(f.dir, ["step"])).code, 0);
    for (const realm of realms) {
      const calls = f.calls.filter((c) => c.path.includes(encodeURIComponent(realm)));
      const raised = calls.filter((c) => c.path.includes("/raised")).length;
      assert.ok(raised >= 1, "at least one automatic tact");
      assert.equal(calls.filter((c) => c.path.endsWith("/invites")).length, raised);
    }
  } finally {
    await f.close();
  }
});

test("invites tact: N full reads per admitted tact, no inter-tact cache; explicit demands reads itself", async () => {
  const f = await admitted(() => empty);
  try {
    for (let tact = 1; tact <= 2; tact++) {
      const r = await command(f.dir, ["step"]);
      assert.equal(r.code, 0, r.err + r.out);
      assert.equal(invites(f).length, tact * realms.length, "one invites GET per realm per tact");
      for (const realm of realms)
        assert.equal(
          invites(f).filter((c) => c.path.includes(encodeURIComponent(realm))).length,
          tact,
        );
    }
    const r = await f.read(...realms);
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(JSON.parse(r.out).complete, true);
    assert.equal(invites(f).length, 3 * realms.length, "explicit demands has no supplied read");
    assert.equal(f.calls.filter((c) => c.path.includes("/raised")).length, 2 * realms.length);
  } finally {
    await f.close();
  }
});

test("invites tact: first-read failure or malformed full input never admits actions", async () => {
  for (const [response, early] of [
    [{ status: 503, body: {} }, true],
    [{ status: 302, headers: { location: "/api/redirect-invites" }, body: {} }, true],
    [{ body: { numbering: "realm" } }, true],
    [{ body: { items: [{ entry_id: 7 }] } }, false],
  ]) {
    const f = await admitted((path) => (path.endsWith("/invites") ? response : empty));
    try {
      const r = await command(f.dir, ["step"]);
      if (early) assert.equal(r.code, 1, r.err + r.out);
      else assert.match(r.out, /incomplete/, r.err + r.out);
      assert.ok(
        f.calls.every((c) => c.method === "GET"),
        "no launch, stop or mutation",
      );
      assert.ok(
        f.calls.every((c) => !c.path.includes("/mcp")),
        "no launcher/action phase",
      );
      assert.ok(
        f.calls.every((c) => !c.path.includes("/redirect-invites")),
        "no redirected source",
      );
      if (early) assert.ok(f.calls.every((c) => !c.path.includes("/me/orders")));
      else assert.equal(invites(f).length, realms.length, "invalid supplied rows are not re-read");
    } finally {
      await f.close();
    }
  }
});

test("invites tact: supplied responses cannot cross API, account or realm, nor omit a realm", async () => {
  const base = "http://127.0.0.1:1/api";
  const token = "snapshot-probe";
  const responses = realms.map((realm) => ({ realm, body: { items: [] } }));
  for (const bad of [
    { base: `${base}/other`, token, responses },
    { base, token: "another-account", responses },
    { base, token, responses: responses.slice(1) },
    { base, token, responses: [responses[0], responses[0]] },
    { base, token, responses: [responses[0], { ...responses[1], realm: "@outside/realm" }] },
  ]) {
    const r = await readDemands(base, token, realms, realms, undefined, undefined, bad);
    assert.equal(r.complete, false);
    assert.deepEqual(r.errors, [{ source: "invites", code: "invalid_snapshot" }]);
    assert.deepEqual(r.start, []);
    assert.deepEqual(r.stop, []);
  }
});
