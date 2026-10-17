// nks-mcp #466 contract: only declared structured realm data can drive the hook.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { GLOBAL_PREFIX, OPENCODE } from "../delivery/index.ts";
import { wizardDue } from "../shared/onboardstart.ts";
import { PAT, setup } from "./ownseat-kit.mjs";
import { liveListVariant } from "./realm-list-live.mjs";
import { rootPlugin } from "./rootseat-kit.mjs";

const unavailable = {
  isError: true,
  content: [{ type: "text", text: 'неизвестный action "readiness"' }],
};
const row = (ref, owner_kind = "user") => ({
  ref,
  short: "r204",
  owner: ref.split("/")[0].slice(1),
  owner_kind,
});

test("fake list fields are per-session opt-in, not the last client's capability", async (t) => {
  const s = await setup(t);
  s.fake.state.realms.push({ short: "r999" });
  const rpc = async (method, params, session) => {
    const res = await fetch(s.fake.mcpUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${PAT}`,
        "content-type": "application/json",
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    assert.equal(res.status, 200);
    return { session: res.headers.get("mcp-session-id"), body: await res.json() };
  };
  const yes = await rpc("initialize", {
    capabilities: { experimental: { "iskron/structured": {} } },
  });
  const no = await rpc("initialize", { capabilities: {} });
  const call = { name: "iskron_realm", arguments: { action: "list" } };
  const fields = (await rpc("tools/call", call, yes.session)).body.result.structuredContent;
  assert.equal(fields.action, "list");
  assert.ok(fields.realms.some((r) => r.owner_kind === "user"));
  assert.ok(fields.realms.some((r) => r.owner_kind === "org"));
  assert.ok(fields.realms.filter((r) => r.ref).every((r) => r.ref && r.short && r.owner));
  assert.deepEqual(fields.realms.at(-1), { short: "r999" });
  assert.equal(
    (await rpc("tools/call", call, no.session)).body.result.structuredContent,
    undefined,
  );
});

for (const [name, realms, expected] of [
  ["personal mind", [row("@ivan/mind")], true],
  ["organization mind", [row("@acme/mind", "org")], false],
  ["working graph", [row("@ivan/notes")], false],
  ["empty list", [], true],
  ["short only", [{ short: "r204" }], "unsupported"],
  ["work plus unknown element", [row("@ivan/notes"), { short: "r205" }], "unsupported"],
]) {
  test(`structured realms: ${name}`, async () => {
    const result = await wizardDue(
      async (tool) =>
        tool === "iskron_me"
          ? unavailable
          : {
              structuredContent: { action: "list", realms },
              // Deliberately contradict the fields: prose must never win.
              content: [
                { type: "text", text: liveListVariant(expected === true ? "work" : "personal") },
              ],
            },
      new AbortController().signal,
    );
    assert.equal(result, expected);
  });
}

test("structured realms: other shapes cannot be repaired from prose", async () => {
  for (const fields of [
    null,
    {},
    { action: "readiness", realms: [] },
    { action: "list" },
    { action: "list", realms: [null] },
    { action: "list", realms: [{ ref: "@ivan/mind", short: "r1", owner: "ivan" }] },
  ]) {
    assert.equal(
      await wizardDue(
        async (tool) =>
          tool === "iskron_me"
            ? unavailable
            : {
                structuredContent: fields,
                content: [{ type: "text", text: liveListVariant("personal") }],
              },
        new AbortController().signal,
      ),
      "unsupported",
    );
  }
});

test("structured realms: correct-looking prose without data is unsupported and account-cached", async (t) => {
  const s = await setup(t);
  s.fake.state.readinessResult = unavailable;
  s.fake.state.realmResult = { content: [{ type: "text", text: liveListVariant("personal") }] };
  let oc = await rootPlugin(s, realpathSync(s.cwd));
  try {
    oc.create("text-only-first");
    assert.equal(await oc.promptOnly("text-only-first", "first"), "first");
    const count = s.fake.state.calls.length;
    assert.equal(count, 2);
    await oc.stop();
    delete globalThis[`${GLOBAL_PREFIX}WorkGraphs`];
    oc = await rootPlugin(s, realpathSync(s.cwd));
    oc.create("text-only-second");
    const started = Date.now();
    assert.equal(await oc.promptOnly("text-only-second", "second"), "second");
    assert.ok(Date.now() - started < 250);
    assert.equal(s.fake.state.calls.length, count);
    assert.ok(
      (await oc.tools().get("iskron_bridge").execute()).content.includes(
        OPENCODE.ru.statusBridges(1, 0),
      ),
    );
  } finally {
    await oc.stop();
  }
});
