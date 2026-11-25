import assert from "node:assert/strict";
import { test } from "node:test";

import { setup, stand } from "./ownseat-kit.mjs";

test("a status-only refusal does not read the graph list", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const before = fake.state.counts.realm_list ?? 0;
  await stand(b, { realm: "r999", status: "working" });
  assert.equal(fake.state.counts.realm_list ?? 0, before);
});
