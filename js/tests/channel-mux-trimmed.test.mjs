// Ответ сервера на строку занятости такта (граф @nks/nks-dev, #9320, #2287): status_trimmed —
// кадр без автора и тела. Он — мосту, не агенту: в сессию не идёт (иначе рендер даёт ход
// «[iskron] ?»), ложится в журнал демона; обрезку агенту называет ответ тула.
import assert from "node:assert/strict";
import { test } from "node:test";

import { channelOf, muxCarrying, sleep, textOf, waitFor, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const LONG = "строка занятости длиннее шестидесяти четырёх знаков, чтобы сервер её обрезал";

test("status_trimmed of a tact line goes to the daemon's journal, not into the session", async () => {
  await withMux(async ({ fake, mux, session, journal }) => {
    const a = await session();
    const r = await a.stand({ realm: REALM, karta: 931, name: "trim-a", status: LONG });
    assert.ok(r.result && !r.result.isError, textOf(r));
    const chan = channelOf(fake, "trim-a");
    await muxCarrying(fake, mux, [chan]);
    await waitFor("the server's status_trimmed", () =>
      mux.trimmed.some((t) => t.channel_id === chan),
    );
    await sleep(500);
    // What the seat's turn gets — notifications; a journal line (t: log) is stderr, not a turn.
    const turn = (s) => a.frames.filter((f) => f.t === "rpc" && JSON.stringify(f).includes(s));
    assert.equal(turn("status_trimmed").length, 0, "the frame did not reach the session");
    assert.equal(turn("trimmed_to_limit").length, 0, "its code did not reach the session");
    await waitFor("the journal line", () => /status_trimmed/.test(journal()));
  });
});
