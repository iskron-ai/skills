import assert from "node:assert/strict";
import { test } from "node:test";

import { setup, stand, textOf, until } from "./ownseat-kit.mjs";
import { realmListFields, realmListText } from "./realm-list-text.mjs";

// Отфильтрованный список графов — не весь список: есть ли у аккаунта свой mind, он не
// говорит, и «своего mind нет» из него не помнят — иначе следующий stand молчит о правилах.
test("a filtered graph list is not taken for the whole one: the next stand still reads the own mind", async (t) => {
  const { fake, up } = await setup(t);
  await fake.control({ mind: { rules: [] } });
  const b = await up();
  const filtered = fake.state.realms.filter((r) => r.canon !== "@tester/mind");
  fake.state.realmResult = {
    content: [{ type: "text", text: realmListText(filtered) }],
    structuredContent: realmListFields(filtered),
  };
  const listed = await b.call("tools/call", {
    name: "iskron_realm",
    arguments: { action: "list", q: "nks" },
  });
  assert.ok(!listed.result?.isError, JSON.stringify(listed));
  assert.doesNotMatch(textOf(listed), /@tester\/mind/, "the filtered answer named no mind");
  fake.state.realmResult = null;
  const stood = await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "after-filter" });
  assert.ok(!stood.result?.isError, textOf(stood));
  const searches = fake.state.calls.filter(
    (c) => c.name === "iskron_search" && c.arguments?.attrs_filter === "slice:agents,ways",
  );
  assert.equal(searches.length, 1, "the rules slice is read after a filtered list");
  assert.equal(searches[0]?.arguments.realm, "@tester/mind");
});

test("stands never ask readiness and search only the caller's fully addressed mind", async (t) => {
  const { fake, up } = await setup(t);
  await fake.control({ mind: { rules: [] } });
  const b = await up();
  await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "storm" });
  await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "storm-next", take: true });
  const calls = fake.state.calls;
  assert.equal(
    calls.filter((c) => c.name === "iskron_me" && c.arguments?.action === "readiness").length,
    0,
  );
  const searches = calls.filter(
    (c) => c.name === "iskron_search" && c.arguments?.attrs_filter === "slice:agents,ways",
  );
  assert.equal(searches.length, 2);
  assert.ok(searches.every((c) => c.arguments.realm === "@tester/mind"));
  assert.equal(
    calls.filter((c) => c.name === "iskron_me" && c.arguments?.action === "whoami").length,
    1,
  );
});

test("a foreign mind does not authorize a slice search", async (t) => {
  const { fake, up } = await setup(t);
  await fake.control({ mind: { missing: true } });
  const b = await up();
  await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "absent" });
  const calls = fake.state.calls;
  assert.equal(
    calls.filter((c) => c.name === "iskron_me" && c.arguments?.action === "readiness").length,
    0,
  );
  assert.equal(
    calls.filter(
      (c) => c.name === "iskron_search" && c.arguments?.attrs_filter === "slice:agents,ways",
    ).length,
    0,
  );
});

test("an automatic return does not read the personal slice", async (t) => {
  const { fake, cwd, up } = await setup(t);
  await fake.control({ mind: { rules: [] } });
  const first = await up();
  await first.call("iskron/resume", { cwd, session: "same-session" });
  await stand(first, { realm: "@nks/nks-dev", karta: 931, name: "return-probe", cwd });
  await until(() => fake.state.ws.size === 1, "first socket");
  const count = () =>
    fake.state.calls.filter(
      (c) => c.name === "iskron_search" && c.arguments?.attrs_filter === "slice:agents,ways",
    ).length;
  const before = count();
  const second = await up();
  await second.call("iskron/resume", { cwd, session: "same-session" });
  assert.equal(count(), before);
});
