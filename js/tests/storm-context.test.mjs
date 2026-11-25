import assert from "node:assert/strict";
import { test } from "node:test";

import { loaded, seated, usage } from "./context-gate-kit.mjs";
import { stand } from "./ownseat-kit.mjs";

test("context collapse and skill observations do not read the role", async (t) => {
  const { fake, b } = await seated(t, "entry");
  const before = fake.state.counts.look ?? 0;
  await usage(b, 100000);
  await usage(b, 10000);
  await loaded(b, "a", "entry");
  assert.equal(fake.state.counts.look ?? 0, before);
});

test("context confirmation with an unresolved realm never reads the graph list", async (t) => {
  const { fake, b } = await seated(t, "entry");
  await usage(b, 100000);
  await usage(b, 10000);
  const before = fake.state.counts.realm_list ?? 0;
  const reply = await stand(b, { realm: "r999", context_restored: true });
  assert.ok(reply.result?.isError);
  assert.equal(fake.state.counts.realm_list ?? 0, before);
});
