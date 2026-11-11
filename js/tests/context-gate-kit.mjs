import assert from "node:assert/strict";

import { setup, stand, textOf } from "./ownseat-kit.mjs";

export const usage = (b, context) =>
  b.call("iskron/usage", { context, window: 200000, model: "probe" });
export const recovery = (b, phase, id, skill, ok = true) =>
  b.call("iskron/usage", { recovery: { phase, id, skill, ok } });
export const loaded = async (b, id, skill, ok = true) => {
  await recovery(b, "begin", id, skill);
  await recovery(b, "end", id, skill, ok);
};
export async function seated(t, skills) {
  const kit = await setup(t);
  kit.fake.state.kartaSkills = skills === undefined ? {} : { 931: skills };
  const b = await kit.up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  const got = await stand(b, { realm: "nks-dev", karta: "931", name: "context-gate" });
  assert.ok(!got.result?.isError, textOf(got));
  return { ...kit, b };
}
