// Перенос записей держания прежней сборки на ключ @owner/slug (граф @nks/nks-dev: решение
// #8200, вопрос #8677) — один на процесс: две сессии одного демона, читающие записи разом,
// переносят их один раз; вторая не пишет ложного «not moved» и не трогает каноническую
// запись, которую держатель первой уже обновил.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import { sleep, textOf, waitFor, withMux } from "./mux-kit.mjs";

const OLD_KEY = "proba--931--nks-dev";
const CANON_KEY = "proba--931--_nks_nks-dev";

const recordOf = (dir, key) => JSON.parse(readFileSync(holdFilePathOf(dir, key), "utf8"));
const holds = (dir) => readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".hold"));

test("two sessions of one daemon move an earlier build's record once: no «not moved», the holder's fields stay", async () => {
  await withMux(
    async ({ fake, dir, session, journal }) => {
      // Место встало и ушло; его запись — как писала прежняя сборка (граф голым слагом).
      const first = await session();
      const r = await first.stand({ realm: "@nks/nks-dev", karta: 931, name: "proba" });
      assert.ok(!r.result?.isError, textOf(r));
      await waitFor("the socket", () => fake.state.ws.size === 1);
      first.bye();
      await waitFor("the socket to close", () => fake.state.ws.size === 0);
      await waitFor("the record kept", () => holds(dir).length === 1);
      const kept = recordOf(dir, CANON_KEY);
      unlinkSync(holdFilePathOf(dir, CANON_KEY));
      const old = { ...kept, realm: "nks-dev", key: OLD_KEY, at: Date.now() };
      writeFileSync(holdFilePathOf(dir, OLD_KEY), JSON.stringify(old) + "\n");
      // Медленный список графов: обе сессии читают записи, пока ни одна не перенесла.
      fake.state.realmDelayMs = 600;
      const [a, b] = [await session(), await session()];
      const [ra, rb] = await Promise.all([
        a.stand({ realm: "nks-dev", karta: 931, name: "proba", status: "занят A" }),
        b.stand({ realm: "nks-dev", karta: 931, name: "other-b" }),
      ]);
      assert.ok(!ra.result?.isError, `A: ${textOf(ra)}`);
      assert.ok(!rb.result?.isError, `B: ${textOf(rb)}`);
      await sleep(500);
      const log = journal();
      assert.doesNotMatch(log, /not moved/, `no false «not moved»:\n${log}`);
      assert.equal(
        log.match(/hold record proba--931--nks-dev: the graph nks-dev is @nks\/nks-dev — moved/g)
          ?.length,
        1,
        `one move:\n${log}`,
      );
      const now = recordOf(dir, CANON_KEY);
      assert.equal(now.realm, "@nks/nks-dev");
      assert.equal(now.status, "занят A", "the holder's busy line stays");
      const token = now.url.split("/channel/ws/")[1];
      assert.ok(fake.state.wsTokens.has(token), `the address the seat holds now: ${now.url}`);
      assert.ok(
        [...fake.state.ws].some((s) => fake.state.wsNames.get(s) === "proba"),
        "its socket is open",
      );
      assert.ok(!existsSync(holdFilePathOf(dir, OLD_KEY)), "the earlier record is gone");
    },
    { mode: "old" },
  );
});
