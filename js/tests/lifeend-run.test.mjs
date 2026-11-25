// Отлучка экземпляра отдельного прогона (граф @nks/nks-dev, #6593, #11359): плагин говорит
// iskron/away с pid прогона. Прогон жив за окном — это перезагрузка внутри живого прогона: место
// и запись держания ждут возврата. Прогон ушёл в окне — конец агента: место снимает свой мост
// (демон), не окно слуха. Настоящие тонкие мосты через настоящий демон на фейке NKS.
// ISKRON_BRIDGE_PATH наводит пробу на прежнюю сборку: та pid прогона не знает и места не снимает.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  closed,
  DEATH_MS,
  delay,
  journalOf,
  recordOf,
  stood,
  waitFor,
  withFake,
} from "./lifeend-kit.mjs";

const fakeRun = (t) => {
  const p = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  t.after(() => p.kill("SIGKILL"));
  return p;
};

async function awayWithRun(t, b, name) {
  const run = fakeRun(t);
  await b.request("iskron/resume", { session: `ses-${name}` });
  await stood(b, name);
  const away = await b.request("iskron/away", { run_pid: run.pid });
  assert.equal(away.result?.away, true, JSON.stringify(away));
  b.proc.stdin.end();
  await b.gone();
  return run;
}

test("a reload inside a live standalone run: the run lives past the window — the seat and its record wait", async (t) => {
  await withFake(async ({ fake, dir, bridge }) => {
    const b = await bridge();
    await awayWithRun(t, b, "run-live");
    await delay(DEATH_MS + 2_000);
    assert.ok(!closed(fake, "run-live"), `the seat of a live run stays:\n${journalOf(dir)}`);
    assert.ok(existsSync(recordOf(dir, "run-live")), "its hold record waits for the return");
  });
});

test("the standalone run is over within the window: its own bridge ends the seat", async (t) => {
  await withFake(async ({ fake, dir, bridge }) => {
    const b = await bridge();
    const run = await awayWithRun(t, b, "run-over");
    run.kill("SIGKILL");
    const at = Date.now();
    await waitFor("the seat closed after the run", () => closed(fake, "run-over"), 15_000).catch(
      (e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      },
    );
    assert.ok(Date.now() - at < DEATH_MS + 2_000, "within the window, not after a hearing watch");
    assert.match(journalOf(dir), /the standalone run \d+ is over/);
  });
});
