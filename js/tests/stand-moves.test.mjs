// Отказы iskron_stand называют рабочий ход (граф nks-dev: #5036 п. 8, контрпримеры
// #7552–#7556): правило api — словом поверхности, вызов — целиком.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { test } from "node:test";

import { setup, stand, textOf } from "./ownseat-kit.mjs";

const METH = "@nks/methodology";

// #7556: 409 channel_already_stands_in_realm доходил голым английским, без хода.
test("register refused by channel_already_stands_in_realm reads in the session language with the move", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const first = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  await fake.control({ structured: true, registerStandsInRealmNext: 1 });
  const r = await stand(b, { realm: METH, karta: 12, name: "proba-b" });
  const text = textOf(r);
  assert.equal(r.result?.isError, true, text);
  assert.equal(fake.state.counts.register_stands_in_realm, 1, "the api refusal was met");
  assert.match(
    text,
    /^Отказано \(409\): канал этого моста уже стоит в графе @nks\/methodology/,
    text,
  );
  assert.match(text, /iskron_channel\(action="list", realm="@nks\/methodology"\)/, text);
  assert.match(text, /iskron_stand\(realm="@nks\/methodology", karta, name=/, text);
  assert.doesNotMatch(text, /channel_already_stands_in_realm|Conflict|already stands/, text);
});
