// Взятие места пережидает 429 rate_limited источника (граф nks-dev: #10801, второй пояс
// предохранителя): register при возврате места с диска ждёт ровно названные api секунды
// и повторяет — не больше трёх попыток и 60 с ожидания; source_paused и прочие отказы
// не повторяются, стоп сессии во время ожидания прерывает его без повтора.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { test } from "node:test";

import { holdRecord, placeOf, setup, stand, textOf, until } from "./ownseat-kit.mjs";

const KEY = "proba--931--_nks_nks-dev"; // the seat's graph as @owner/slug (#8677)
// Отказ как api 0.202.0 (#10801): HTTP 429, правило rate_limited, секунды — целым
// errors[0].data.retry_after_secs; в data ещё key («opening» на регистрации места) и
// иногда kind. Поля retry_after в data нет. source_paused — отдельное правило, без секунд.
const refused = (rule, retryAfterSecs) => ({
  text: `Too Many Requests (429): ${rule}${retryAfterSecs ? ` — retry after ${retryAfterSecs}s` : ""}`,
  status: 429,
  rule,
  data: retryAfterSecs ? { retry_after_secs: retryAfterSecs, key: "opening" } : { key: "opening" },
});

/** Место proba стоит мостом b1 из каталога cwd; мост убит, запись держания жива — возврат с диска. */
const returnedSeat = async (t) => {
  const kit = await setup(t);
  const b1 = await kit.up();
  await b1.call("iskron/resume", { session: "ses-1" });
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd: kit.cwd })),
    "proba",
  );
  await until(() => kit.fake.state.ws.size === 1, "b1 socket");
  assert.equal(holdRecord(kit.dir, KEY)?.session, "ses-1");
  b1.kill();
  await until(() => kit.fake.state.ws.size === 0, "b1's socket gone");
  return { ...kit, stood: kit.fake.state.counts.register_standing ?? 0 };
};

test("429 rate_limited with Retry-After: the return waits it out and the second register stands the seat", async (t) => {
  const { fake, stood, up } = await returnedSeat(t);
  await fake.control({ registerRefuseNext: [refused("rate_limited", 1)] });
  const b2 = await up();
  const r = await b2.call("iskron/resume", { key: KEY });
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.match(r.result.word, /переждал предел частоты источника \(1 с\)/, r.result.word);
  assert.equal(fake.state.counts.register_refused, 1, "the api refused the first register");
  assert.equal(fake.state.counts.register_standing, stood + 1, "the second register passed");
  assert.equal(fake.state.places.get("931:proba")?.listening, true, "the seat stands");
});

test("the former data.retry_after without retry_after_secs is not our form: no wait, no retry", async (t) => {
  const { fake, stood, up } = await returnedSeat(t);
  await fake.control({
    // До api 0.202.0 мост читал data.retry_after — в отказе этого поля нет (#10801):
    // отказ с ним и без retry_after_secs — не наша форма, секунды не названы.
    registerRefuseNext: [
      {
        text: "Too Many Requests (429): rate_limited — retry after 1s",
        status: 429,
        rule: "rate_limited",
        data: { retry_after: 1, key: "opening" },
      },
    ],
  });
  const b2 = await up();
  const r = await b2.call("iskron/resume", { key: KEY });
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.match(r.result.word, /register отказал.*rate_limited/, r.result.word);
  assert.doesNotMatch(r.result.word, /переждал/, r.result.word);
  assert.equal(fake.state.counts.register_refused, 1, "exactly one register, no retry");
  assert.equal(fake.state.counts.register_standing, stood, `word=${r.result.word}`);
});

test("429 source_paused: one register, no retry — the refusal returns as it came", async (t) => {
  const { fake, stood, up } = await returnedSeat(t);
  await fake.control({
    registerRefuseNext: [refused("source_paused"), refused("rate_limited", 1)],
  });
  const b2 = await up();
  const r = await b2.call("iskron/resume", { key: KEY });
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.match(r.result.word, /register отказал.*source_paused/, r.result.word);
  assert.doesNotMatch(r.result.word, /переждал/, r.result.word);
  assert.equal(fake.state.counts.register_refused, 1, "exactly one register, no retry");
  assert.equal(fake.state.counts.register_standing, stood, `word=${r.result.word}`);
});

/** Место proba стоит мостом b1 из каталога cwd, записи без сессии; мост убит — возврат по имени (iskron_stand). */
const returnedByName = async (t) => {
  const kit = await setup(t);
  const b1 = await kit.up();
  assert.equal(
    placeOf(await stand(b1, { realm: "nks-dev", karta: 931, name: "proba", cwd: kit.cwd })),
    "proba",
  );
  await until(() => kit.fake.state.ws.size === 1, "b1 socket");
  b1.kill();
  await until(() => kit.fake.state.ws.size === 0, "b1's socket gone");
  return { ...kit, stood: kit.fake.state.counts.register_standing ?? 0 };
};

test("iskron_stand returning the seat from disk: the 429 rate_limited is waited out and the retry stands the seat", async (t) => {
  const { fake, cwd, stood, up } = await returnedByName(t);
  await fake.control({ registerRefuseNext: [refused("rate_limited", 1)] });
  const b2 = await up();
  const r = await stand(b2, { realm: "nks-dev", karta: 931, name: "proba", cwd });
  assert.ok(!r.result?.isError, textOf(r));
  assert.match(textOf(r), /возврат места с диска/, textOf(r));
  assert.match(textOf(r), /переждал предел частоты источника \(1 с\)/, textOf(r));
  assert.equal(fake.state.counts.register_refused, 1, "the api refused the first register");
  assert.equal(
    fake.state.counts.register_standing,
    stood + 1,
    "the register after the wait stood the seat",
  );
  assert.equal(fake.state.places.get("931:proba")?.listening, true, "the seat stands");
});

test("three rate_limited in a row: the refusal stands after the limit of tries", async (t) => {
  const { fake, stood, up } = await returnedSeat(t);
  await fake.control({
    registerRefuseNext: [
      refused("rate_limited", 1),
      refused("rate_limited", 1),
      refused("rate_limited", 1),
    ],
  });
  const b2 = await up();
  const r = await b2.call("iskron/resume", { key: KEY });
  assert.equal(r.result?.resumed, true, JSON.stringify(r));
  assert.match(r.result.word, /register отказал.*rate_limited/, r.result.word);
  assert.equal(fake.state.counts.register_refused, 3, "three tries, then the limit");
  assert.equal(fake.state.counts.register_standing, stood, `word=${r.result.word}`);
  await new Promise((d) => setTimeout(d, 1200));
  assert.equal(fake.state.counts.register_refused, 3, "no fourth try after the limit");
});

test("a stop during the wait ends it with no retry", async (t) => {
  const { fake, stood, up } = await returnedSeat(t);
  await fake.control({ registerRefuseNext: [refused("rate_limited", 8)] });
  const b2 = await up();
  const pending = b2.call("iskron/resume", { key: KEY });
  await until(() => (fake.state.counts.register_refused ?? 0) >= 1, "the first register refused");
  await fake.control({ ws_close: 4001, ws_close_reason: "revoked:person" });
  const started = Date.now();
  const r = await pending;
  assert.ok(Date.now() - started < 6000, "the wait ended at the stop, not at Retry-After");
  // The stop is the outcome: no return, not the bare 429 as a returned seat's word (#7439).
  assert.notEqual(r.result?.resumed, true, `a stopped seat is not returned: ${JSON.stringify(r)}`);
  assert.equal(r.result?.stopped, true, `the stop is said as a stop: ${JSON.stringify(r)}`);
  assert.equal(fake.state.counts.register_refused, 1, "no second register after the stop");
  assert.equal(fake.state.counts.register_standing, stood, `word=${r.result.word}`);
  await new Promise((d) => setTimeout(d, 1000));
  assert.equal(fake.state.counts.register_refused, 1, "still no retry once Retry-After passes");
});
