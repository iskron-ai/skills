// Регрессионная проба выбора профиля dsh (граф nks-dev: #10777, фикс #818): по умолчанию
// dsh получает --patch пути профиля поставки (DSH_PROFILE из product.ts, под каталогом
// скилла моста плоской установки); свой patch в описании запускателя перекрывает умолчание;
// поставка с DSH_PROFILE=null без patch в описании поднять dsh не может — dsh_patch_missing,
// подъёма нет, даже если профиль плоской установки лежит на месте.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { invite, leadingDsh } from "./dsh-kit.mjs";

/** HOME с профилем поставки плоской установки на месте — умолчанию есть что брать. */
function homeWithProfile(t) {
  const home = mkdtempSync(join(tmpdir(), "iskron-dsh-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const profile = join(home, ".agents", "skills", "establish-mcp", "references", "dsh-profile.yml");
  mkdirSync(join(home, ".agents", "skills", "establish-mcp", "references"), { recursive: true });
  writeFileSync(profile, "- id: tool-ask-user\n  disabled: true\n");
  return { home, profile };
}

/** Копия собранного моста поставки без своего профиля: DSH_PROFILE = null (product.ts);
 * константа не нашлась в сборке — проба провалена, а не обойдена молча. */
function bridgeWithoutProfile(t) {
  const dir = mkdtempSync(join(tmpdir(), "iskron-dsh-null-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const to = join(dir, "iskron.mjs");
  const text = readFileSync(BUILT_BRIDGE, "utf8");
  const patched = text.replace(
    /(var|const|let) (DSH_PROFILE = )"references\/dsh-profile\.yml"/,
    "$1 $2null",
  );
  assert.notEqual(patched, text, "DSH_PROFILE constant not found in the built bridge");
  writeFileSync(to, patched, { mode: 0o755 });
  return to;
}

test("dsh profile: the description's patch overrides, the delivery's default fills in, null demands one", async (t) => {
  // (б) Свой patch в описании запускателя: dsh идёт с ним, умолчание не видно.
  const own = await leadingDsh(t);
  await own.queue([invite(30)]);
  assert.match((await own.step()).out, /invite 30: launched/);
  const call = own.dshCalls().at(-1);
  assert.deepEqual(call.argv.slice(0, 3), ["headless", "--patch", own.patch]);

  // (а) Без patch в описании: --patch — путь профиля поставки под каталогом скилла моста.
  const { home, profile } = homeWithProfile(t);
  const dflt = await leadingDsh(t, { offer: { patch: undefined }, env: { HOME: home } });
  await dflt.queue([invite(31)]);
  assert.match((await dflt.step()).out, /invite 31: launched/);
  assert.deepEqual(dflt.dshCalls().at(-1).argv.slice(0, 3), ["headless", "--patch", profile]);

  // (в) DSH_PROFILE=null и нет patch в описании: подъёма нет — dsh_patch_missing, пусть и
  // профиль плоской установки лежит в HOME: жёсткое умолчание прошлой сборки запрещено.
  const none = await leadingDsh(t, {
    offer: { patch: undefined },
    env: { HOME: home },
    bridge: bridgeWithoutProfile(t),
  });
  await none.queue([invite(32)]);
  const r = await none.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 32: dsh_patch_missing/, r.out);
  assert.equal(none.dshCalls().length, 0, "nothing was raised");
  assert.equal(none.run(32), undefined, "no run row");
  assert.equal(own.dshCalls().length + dflt.dshCalls().length, 2, "the copies above did raise");
});
