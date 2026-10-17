// Startup composition through the built plugin, real bridges and fake-nks; no paid model.
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GLOBAL_PREFIX, ONBOARD_START, ROOT_SEAT } from "../delivery/index.ts";
import { createHalts } from "../opencode/halts.ts";
import { REPO } from "./built.mjs";
import { setup, until } from "./ownseat-kit.mjs";
import { rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const invitation = ONBOARD_START.ru.start();
const seated = ROOT_SEAT.ru.seated("\0", "\0", "\0", "\0").split("\0")[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resetStops = () => {
  for (const key of ["Halts", "LiftedAt", "StopIds", "StopWords"])
    delete globalThis[`${GLOBAL_PREFIX}${key}`];
};

for (const mode of ["cover", "no-cover", "halted", "halt-during-read"]) {
  test(`startup composition: ${mode}`, async (t) => {
    resetStops();
    const s = await setup(t);
    const project = realpathSync(s.cwd);
    if (mode === "cover") writeAgents(project);
    else s.fake.state.realms = [];
    s.fake.state.readinessResult = {
      structuredContent: { wizard_due: true, realms: [] },
      content: [{ type: "text", text: "readiness" }],
    };
    s.fake.state.readinessDelayMs = mode === "cover" ? 2000 : mode === "halt-during-read" ? 300 : 0;
    const oc = await rootPlugin(s, project, {
      ISKRON_ROOT_SEAT_MS: "3000",
      ISKRON_ONBOARD_START_MS: "2500",
    });
    const sid = `onboard-${mode}`;
    const halts = createHalts(
      () => undefined,
      () => s.dir,
      () => {},
      () => {},
    );
    try {
      oc.create(sid);
      if (mode === "halted") halts.stop(sid, "ONBOARD_OWNER_STOP");
      const started = Date.now();
      const first = oc.promptOnly(sid, "hello");
      if (mode === "halt-during-read") {
        await until(
          () =>
            s.fake.state.calls.some(
              (c) => c.name === "iskron_me" && c.arguments.action === "readiness",
            ),
          "readiness pending",
        );
        halts.stop(sid, "ONBOARD_OWNER_STOP");
      }
      const text = await first;
      if (mode === "cover") {
        assert.ok(text.includes(seated), text);
        assert.ok(!text.includes(invitation), text);
        assert.ok(Date.now() - started < 1500, "cover must not wait for readiness's 2s delay");
        assert.equal(s.fake.state.calls.filter((c) => c.name === "iskron_me").length, 0);
      } else {
        assert.equal(text, mode === "no-cover" ? `hello\n${invitation}` : "hello");
        if (mode === "no-cover")
          assert.ok(
            Date.now() - started < 1500,
            "no cover must not wait for the 3s seating window",
          );
        assert.equal(s.fake.state.counts.connect, 0, "no seating without cover");
        if (mode === "halted")
          assert.equal(s.fake.state.calls.length, 0, "halted root is not probed");
      }
      assert.equal(await oc.promptOnly(sid, "second"), "second");
      assert.equal(s.fake.state.writes.length, 0);
      await sleep(20);
      assert.ok(
        !oc.wordsTo(sid).some((word) => word.includes(invitation)),
        "no late invitation through channel",
      );
    } finally {
      await oc.stop();
    }
  });
}

test("startup words name the shipped skill and iskronify branch", () => {
  const skill = readFileSync(join(REPO, "skills/onboarding/SKILL.md"), "utf8");
  const bootstrap = readFileSync(join(REPO, "skills/iskronify/SKILL.md"), "utf8");
  assert.match(skill, /^name: onboarding$/m);
  assert.ok(bootstrap.includes("Ветвь «Первый граф»"));
  for (const lang of ["ru", "en"]) {
    assert.equal(typeof ROOT_SEAT[lang].seated, "function");
    assert.equal(typeof ONBOARD_START[lang].start, "function");
    assert.ok(ONBOARD_START[lang].start().includes("onboarding"));
    assert.equal(ONBOARD_START[lang].start().split("\n").length, 1);
  }
});
