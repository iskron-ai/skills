import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { setup } from "./ownseat-kit.mjs";
import { rootPlugin, writeAgents } from "./rootseat-kit.mjs";

test("an existing root's next request after a plugin reload does not read the slice", async (t) => {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  writeAgents(project);
  await s.fake.control({ mind: { rules: [] } });
  const first = await rootPlugin(s, project);
  first.create("root");
  await first.turn("root", "first");
  await first.stop();
  const count = () =>
    s.fake.state.calls.filter(
      (c) => c.name === "iskron_search" && c.arguments?.attrs_filter === "slice:agents,ways",
    ).length;
  const before = count();
  assert.ok(before > 0, "the new root read its slice");
  const next = await rootPlugin(s, project, {}, [{ id: "root" }]);
  try {
    await next.turn("root", "after reload");
    assert.equal(count(), before);
  } finally {
    await next.stop();
  }
});
