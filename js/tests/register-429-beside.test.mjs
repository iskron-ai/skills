// The 429 rate_limited wait budget is the whole return's, not each seat's (graph nks-dev:
// #10801): the main seat and the seat beside it come back in one move, and the client's
// cap on the answer (budget + 15 s) holds only if their waits share one budget. The seat
// beside waits only what the main seat left; more — its refusal stands, as without a wait.
//
// The bridge runs on the probe's clock (fast-clock.cjs: ten times faster), so a Retry-After
// of 40 s passes in 4 s and the probe stays under 10 s.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { RESUME_ANSWER_MS } from "../shared/ratelimit.ts";
import { placeOf, saidKind, setup, stand, until } from "./ownseat-kit.mjs";

const FAST = 10;
process.env.NODE_OPTIONS = `--require ${join(dirname(fileURLToPath(import.meta.url)), "fast-clock.cjs")}`;
process.env.FAST_CLOCK = String(FAST);

const KEY = "proba--931--_nks_nks-dev";
const RETRY_AFTER_S = 40;
const rateLimited = (realm) => ({
  text: `Too Many Requests (429): rate_limited — retry after ${RETRY_AFTER_S}s`,
  status: 429,
  rule: "rate_limited",
  data: { retry_after_secs: RETRY_AFTER_S, key: "opening" },
  realm,
});
const registersIn = (fake, realm) =>
  fake.state.calls.filter(
    (c) =>
      c.name === "iskron_channel" &&
      c.arguments.action === "register" &&
      String(c.arguments.realm).endsWith(realm),
  ).length;

test("main seat and the seat beside, both 429 for 40 s: the answer comes within the client's cap, the seat beside does not wait past the rest", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the probe's clock rides NODE_OPTIONS");
  const { fake, cwd, up } = await setup(t);
  const b1 = await up();
  await b1.call("iskron/resume", { session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd })),
    "proba",
  );
  const beside = await stand(b1, { realm: "drugoy", karta: 48, name: "proba" });
  assert.ok(!beside.result?.isError, JSON.stringify(beside));
  await until(() => saidKind(b1, "beside"), "the beside word");
  b1.kill();
  await until(() => fake.state.ws.size === 0, "b1's socket gone");
  await fake.control({
    registerRefuseNext: [rateLimited("@nks/nks-dev"), rateLimited("@nks/drugoy")],
  });
  const mainBefore = registersIn(fake, "nks-dev");
  const besideBefore = registersIn(fake, "drugoy");
  const b2 = await up();
  const started = Date.now();
  const r = await b2.call("iskron/resume", { key: KEY });
  const tookMs = (Date.now() - started) * FAST; // on the bridge's clock
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.match(r.result.word, /переждал предел частоты источника \(40 с\)/, r.result.word);
  assert.ok(
    tookMs < RESUME_ANSWER_MS,
    `the answer within the client's cap: ${tookMs} ms of ${RESUME_ANSWER_MS}`,
  );
  assert.equal(fake.state.counts.register_refused, 2, "each seat refused once");
  assert.equal(registersIn(fake, "nks-dev") - mainBefore, 2, "the main seat waited and stood");
  assert.equal(
    registersIn(fake, "drugoy") - besideBefore,
    1,
    "the seat beside did not wait past the move's rest: its refusal stands",
  );
});
