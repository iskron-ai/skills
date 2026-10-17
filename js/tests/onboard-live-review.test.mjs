// Cold review .3: live realm-list tail, owner kinds and bounded server-capability misses.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { canonRealm, learnRealmList } from "../bridge/realms.ts";
import { GLOBAL_PREFIX, ONBOARD_START, OPENCODE } from "../delivery/index.ts";
import { wizardDue } from "../shared/onboardstart.ts";
import { setup, until } from "./ownseat-kit.mjs";
import { LIVE_REALM_LIST, liveListVariant } from "./realm-list-live.mjs";
import { realmListText } from "./realm-list-text.mjs";
import { rootPlugin } from "./rootseat-kit.mjs";

const response = (text) => ({ content: [{ type: "text", text }] });
const unknownAction = { isError: true, ...response('неизвестный action "readiness"') };

test("fake list serializer exactly matches the observed framing, owner blocks and footer", () => {
  const realms = [
    ["@acme/product", "r43", "Product", "2026-10-16", "organization"],
    ["@acme/mind", "r57", "Разум acme", "2026-06-26", "organization"],
    ["@ivan/mind", "r204", "Разум", "2026-10-14", "user"],
    ["@ivan/notes", "r27", "notes", "2026-07-09", "user"],
    ["@petr/mind", "r35", "Разум", "2026-10-16", "user"],
    ["@petr/rust", "r34", "rust", "2026-05-02", "user"],
    ["@petr/vpn", "r51", "vpn", "2026-09-24", "user"],
  ].map(([canon, short, name, date, ownerKind]) => ({ canon, short, name, date, ownerKind }));
  assert.equal(realmListText(realms), LIVE_REALM_LIST.trimEnd());
});

for (const kind of ["personal", "org-mind", "work"]) {
  for (const archived of [true, false]) {
    test(`prose-only list is ignored: ${kind}, archive paragraph ${archived}`, async () => {
      assert.equal(
        await wizardDue(
          async (name) =>
            name === "iskron_me" ? unknownAction : response(liveListVariant(kind, archived)),
          new AbortController().signal,
        ),
        "unsupported",
      );
    });
  }
}

test("prose count and tail never produce hook evidence", async () => {
  for (const text of [
    LIVE_REALM_LIST.replace("графы (7)", "графы (8)"),
    `${liveListVariant("personal")}\n    @hidden/work  r999  hidden · 2026-10-17`,
  ]) {
    const result = await wizardDue(
      async (name) => (name === "iskron_me" ? unknownAction : response(text)),
      new AbortController().signal,
    );
    assert.ok(
      result !== true && result !== false,
      "invalid list must not turn into known evidence",
    );
  }
});

test("live list: bridge alias learning still reads all seven rows through the tail", () => {
  learnRealmList(LIVE_REALM_LIST);
  for (const [short, canonical] of [
    ["r43", "@acme/product"],
    ["r57", "@acme/mind"],
    ["r204", "@ivan/mind"],
    ["r27", "@ivan/notes"],
    ["r35", "@petr/mind"],
    ["r34", "@petr/rust"],
    ["r51", "@petr/vpn"],
  ])
    assert.equal(canonRealm(short), canonical);
});

test("server answered but unsupported: one attempt, then session and account are quiet", async (t) => {
  const s = await setup(t);
  s.fake.state.readinessResult = unknownAction;
  s.fake.state.realmResult = response("неразборчивый list");
  const project = realpathSync(s.cwd);
  let oc = await rootPlugin(s, project);
  const calls = () =>
    s.fake.state.calls.filter((c) => ["iskron_me", "iskron_realm"].includes(c.name)).length;
  try {
    oc.create("unsupported-first");
    assert.equal(await oc.promptOnly("unsupported-first", "hello"), "hello");
    assert.equal(calls(), 2, "one readiness + one fallback list");
    assert.equal(await oc.promptOnly("unsupported-first", "again"), "again");
    assert.equal(calls(), 2, "the session is exhausted");
    oc.create("unsupported-second");
    assert.equal(await oc.promptOnly("unsupported-second", "second"), "second");
    assert.equal(calls(), 2, "account capability miss is cached");
    await oc.stop();
    delete globalThis[`${GLOBAL_PREFIX}WorkGraphs`];
    oc = await rootPlugin(s, project);
    oc.create("unsupported-reload");
    const started = Date.now();
    assert.equal(await oc.promptOnly("unsupported-reload", "reload"), "reload");
    assert.ok(Date.now() - started < 250);
    assert.equal(calls(), 2, "disk cache survives reload");
    assert.ok(
      (await oc.tools().get("iskron_bridge").execute()).content.includes(
        OPENCODE.ru.statusBridges(1, 0),
      ),
    );
  } finally {
    await oc.stop();
  }
});

test("cold bridge timeout can retry after readiness arrives", async (t) => {
  const s = await setup(t);
  s.fake.state.readinessDelayMs = 500;
  s.fake.state.readinessResult = { structuredContent: { wizard_due: true }, content: [] };
  const oc = await rootPlugin(s, realpathSync(s.cwd), { ISKRON_ONBOARD_START_MS: "150" });
  try {
    oc.create("cold-retry");
    assert.equal(await oc.promptOnly("cold-retry", "first"), "first");
    await until(() => oc.tools().has("iskron_stand"), "cold bridge ready");
    s.fake.state.readinessDelayMs = 0;
    assert.equal(
      await oc.promptOnly("cold-retry", "second"),
      `second\n${ONBOARD_START.ru.start()}`,
    );
  } finally {
    await oc.stop();
  }
});
