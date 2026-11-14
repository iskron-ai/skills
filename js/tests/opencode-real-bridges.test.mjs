// Real-bridge satellite probes kept in their own file budget under coverage.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { startFakeNks } from "./fake-nks.mjs";
import { delay, plugin, REAL_BRIDGE, until } from "./opencode-kit.mjs";

// №664: against the real bridge — the child's own revoke at its run's end met only prose that
// looks like «already gone» («role #931 not found», no refusal data): no confirmation, so the
// launcher's revoke still goes and takes the seat off the board.
test("real bridges: the child's revoke answered by bare prose is not taken as revoked — the launcher's revoke goes and the seat leaves the board", async () => {
  const fake = await startFakeNks({ pat: "nks_pat_plugin" });
  await fake.control({ richTools: true });
  const dir = mkdtempSync(join(tmpdir(), "iskron-lead-real-"));
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
      ISKRON_BRIDGE_NO_BROWSER: "1",
    },
    {
      location: { directory: dir },
      sessions: [
        { id: "root", location: { directory: dir } },
        { id: "child", parentID: "root", location: { directory: dir } },
      ],
    },
  );
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 15000);
    const root = await rec.call(
      "iskron_stand",
      { realm: "nks-dev", karta: 931, name: "proba" },
      "root",
    );
    assert.match(root.content, /стояние/, root.content);
    const child = await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const sub = [...fake.state.places.keys()].find((k) => /\.sub-\d+$/.test(k));
    assert.ok(sub, `the child stood as a satellite:\n${child.content}\n${rec.said()}`);
    const name = sub.replace(/^\d+:/, "");
    await fake.control({ revokeRefuseNext: [{ text: "role #931 not found" }] });
    await rec.call(
      "iskron_channel",
      { realm: "nks-dev", action: "revoke", standing: name },
      "root",
    );
    await until(() => !fake.state.places.has(sub), `the seat ${name} off the board`, 8000);
    const revokes = fake.state.calls.filter(
      (c) => c.name === "iskron_channel" && c.arguments.action === "revoke",
    );
    assert.equal(revokes.length, 2, "the child's own revoke, then the launcher's");
  } finally {
    await rec.stop();
    await fake.stop();
  }
});

// #7599: the launcher names its graph short («nks-dev»); its bridge resolves it (#8191), so the
// child's confirmed revoke matches and the launcher's revoke does not go. Were it sent, it would
// meet the seat already off (404 standing_not_found) — «место снято» either way, never «НЕ снято».
test("real bridges: the launcher's revoke in a short graph of a seat the child's bridge already revoked is not sent again — «место снято», no «НЕ снято»", async () => {
  const fake = await startFakeNks({ pat: "nks_pat_plugin" });
  await fake.control({ richTools: true, revokeGone: 404 });
  const dir = mkdtempSync(join(tmpdir(), "iskron-lead-gone-"));
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
      ISKRON_BRIDGE_NO_BROWSER: "1",
    },
    {
      location: { directory: dir },
      sessions: [
        { id: "root", location: { directory: dir } },
        { id: "child", parentID: "root", location: { directory: dir } },
      ],
    },
  );
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 15000);
    const root = await rec.call(
      "iskron_stand",
      { realm: "nks-dev", karta: 931, name: "proba-gone" },
      "root",
    );
    assert.match(root.content, /стояние/, root.content);
    const child = await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const sub = [...fake.state.places.keys()].find((k) => /\.sub-\d+$/.test(k));
    assert.ok(sub, `the child stood as a satellite:\n${child.content}\n${rec.said()}`);
    const name = sub.replace(/^\d+:/, "");
    const said = await rec
      .call("iskron_channel", { realm: "nks-dev", action: "revoke", standing: name }, "root")
      .then(
        (r) => r.content,
        (e) => e.message,
      );
    assert.ok(!fake.state.places.has(sub), "the seat is off the board");
    const revokes = fake.state.calls.filter(
      (c) => c.name === "iskron_channel" && c.arguments.action === "revoke",
    );
    assert.equal(revokes.length, 1, "the child's own revoke only");
    assert.match(said, /место снято/, said);
    assert.doesNotMatch(said, /НЕ снято|повтори/, said);
  } finally {
    await rec.stop();
    await fake.stop();
  }
});

// №680 (#7591): the board printed the main seat's model, but a satellite seat only its build and
// harness — the child's stand named no model, and the plugin did not hand it the harness's. The
// satellite's seat carries the model its session runs on, from OpenCode, from the take on.
test("real bridges: a child standing as a satellite carries its own session's model from the harness, not the root's", async () => {
  const fake = await startFakeNks({ pat: "nks_pat_plugin" });
  await fake.control({ richTools: true });
  const dir = mkdtempSync(join(tmpdir(), "iskron-sat-model-"));
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
      ISKRON_BRIDGE_NO_BROWSER: "1",
    },
    {
      location: { directory: dir },
      sessions: [
        {
          id: "root",
          location: { directory: dir },
          model: { id: "claude-opus-5-5", providerID: "anthropic" },
        },
        {
          id: "child",
          parentID: "root",
          location: { directory: dir },
          model: { id: "gpt-6.1-sol", providerID: "openai" },
        },
      ],
    },
  );
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 15000);
    const root = await rec.call(
      "iskron_stand",
      // A name of its own: the paused satellite of this run must not meet the next test's.
      { realm: "nks-dev", karta: 931, name: "proba-model", model: "claude-opus-5-5" },
      "root",
    );
    assert.match(root.content, /стояние/, root.content);
    const child = await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const seat = fake.state.placeArgs.filter((p) => /\.sub-\d+$/.test(String(p.name)));
    assert.ok(seat.length, `the child stood as a satellite:\n${child.content}\n${rec.said()}`);
    assert.deepEqual(
      seat.map((p) => [p.action, p.model]),
      seat.map((p) => [p.action, "gpt-6.1-sol"]),
      "every connect and register of the satellite names the child's model",
    );
  } finally {
    await rec.stop();
    await fake.stop();
  }
});

// №664: one satellite name in two graphs is two seats (#5838). The child's bridge revoked its seat
// in A and was refused in B: the launcher's revoke for B goes and its refusal is loud; for A it
// is not sent again. A name-only match let A's success hide B's refusal — «место снято», B hung.
for (const [graph, own] of [
  ["@nks/nks-dev", false],
  ["@nks/drugoy", true],
])
  test(`real bridges: one name in two graphs, the child's revoke refused in @nks/nks-dev — the launcher's revoke in ${graph} ${own ? "is not sent again" : "goes, its refusal loud"}`, async () => {
    const fake = await startFakeNks({ pat: "nks_pat_plugin" });
    await fake.control({ richTools: true });
    const dir = mkdtempSync(join(tmpdir(), "iskron-lead-two-"));
    const rec = await plugin(
      {
        ISKRON_BRIDGE_PATH: REAL_BRIDGE,
        ISKRON_BRIDGE_URL: fake.mcpUrl,
        ISKRON_BRIDGE_TOKEN: "nks_pat_plugin",
        ISKRON_BRIDGE_NO_BROWSER: "1",
      },
      {
        location: { directory: dir },
        sessions: [
          { id: "root", location: { directory: dir } },
          { id: "child", parentID: "root", location: { directory: dir } },
        ],
      },
    );
    const revokesIn = (realm) =>
      fake.state.calls.filter(
        (c) =>
          c.name === "iskron_channel" &&
          c.arguments.action === "revoke" &&
          c.arguments.realm === realm,
      );
    try {
      await until(() => rec.tools().has("iskron_channel"), "the server's tools", 15000);
      const name = "proba.sub-1";
      for (const realm of ["@nks/nks-dev", "@nks/drugoy"]) {
        const root = await rec.call("iskron_stand", { realm, karta: 931, name: "proba" }, "root");
        assert.match(root.content, /стояние/, root.content);
        const sat = await rec.call("iskron_stand", { realm }, "child");
        assert.match(sat.content, /proba\.sub-1/, `one name in both graphs:\n${sat.content}`);
      }
      const refused = { realm: "@nks/nks-dev", text: "Отказано.", status: 409, rule: "busy" };
      await fake.control({ revokeRefuseNext: [refused, refused] });
      const said = await rec
        .call("iskron_channel", { realm: graph, action: "revoke", standing: name }, "root")
        .then(
          (r) => r.content,
          (e) => e.message,
        );
      await delay(300);
      if (own) {
        assert.match(said, /место снято/, said);
        assert.equal(revokesIn(graph).length, 1, "only the child's own revoke");
      } else {
        assert.match(said, /место НЕ снято/, said);
        assert.equal(revokesIn(graph).length, 2, "the child's own revoke, then the launcher's");
      }
    } finally {
      await rec.stop();
      await fake.stop();
    }
  });
