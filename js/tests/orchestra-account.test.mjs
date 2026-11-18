// The orchestrator's account from the whoami text (graph @nks/nks-dev, #11011): the id from an
// «id <uuid>» line when the text has one, the handle from «handle @name»; neither — account_unknown.
import assert from "node:assert/strict";
import { test } from "node:test";

import { accountOfWhoami, authorOf, sameAccount } from "../bridge/orchestra-account.ts";
import { resolveInvite } from "../bridge/orchestra-resolve.ts";

const ID = "0B6F9A3E-1C2D-4E5F-8A9B-0C1D2E3F4A5B";

test("whoami: the id line and the handle, either alone, neither refused", () => {
  const live = "Вызывающая идентичность: логин alari · handle @alari (alari@example.com)";
  assert.deepEqual(accountOfWhoami(live), { id: "", handle: "alari" });
  assert.deepEqual(accountOfWhoami(`${live}\nid ${ID}`), {
    id: ID.toLowerCase(),
    handle: "alari",
  });
  assert.deepEqual(accountOfWhoami(`Вызывающая идентичность: логин 16-m3 (x@y)\nid ${ID}`), {
    id: ID.toLowerCase(),
    handle: "",
  });
  assert.throws(() => accountOfWhoami("Вызывающая идентичность: неизвестна"), /account_unknown/);
  assert.throws(() => accountOfWhoami("id not-a-uuid"), /account_unknown/);
});

test("own: by id when both carry one, else by handle, else unknown", () => {
  const me = { id: ID.toLowerCase(), handle: "alari" };
  assert.equal(sameAccount(authorOf({ author_user_id: ID, author: "@x:lead" }), me), true);
  assert.equal(sameAccount(authorOf({ author: "@alari:lead" }), me), true);
  assert.equal(sameAccount(authorOf({ author: "@x:lead" }), { id: "", handle: "alari" }), false);
  assert.equal(sameAccount(authorOf({ author_user_id: ID }), { id: "", handle: "alari" }), null);
  assert.equal(authorOf({ author: "bare.lead" }), null);
});

// Review of the batch (P2): own not comparable with the author (the machine has no handle, the
// call has no author_user_id) must not hide a caller the description names — callers first.
const PAL_ID = "7d8e9f00-1a2b-4c3d-9e4f-5a6b7c8d9e0f";
const launchers = (account, accountId, callers) => ({
  account,
  accountId,
  own: new Map([
    [
      "l",
      {
        launcher: "l",
        host: null,
        adapter: "orca",
        limit: 5,
        harnesses: { opencode: { models: ["m"] } },
        checkouts: {},
        homes: {},
        callers,
        clone: null,
      },
    ],
  ]),
  elsewhere: new Map(),
  refused: [],
});
const call = (over) => ({
  realm: "@nks/nks-dev",
  room: "r",
  invite: 1,
  karta: 931,
  repository: "github.com/probe/one",
  launcher: "l",
  harness: "opencode",
  model: "m",
  ...over,
});
const codeOf = (r) => ("code" in r ? r.code : "raised");

test("resolve: a caller named in callers rises though own is not comparable; unknown only when nothing matches", () => {
  const noHandle = launchers("", ID.toLowerCase(), ["pal", PAL_ID]);
  for (const launcher of ["l", null]) {
    const at = (over) => codeOf(resolveInvite(call({ launcher, ...over }), noHandle, {}));
    assert.equal(at({ author: "@pal:lead" }), "raised", "callers by the address's handle");
    assert.equal(at({ author_user_id: PAL_ID, author: "pal.lead" }), "raised", "callers by id");
    assert.equal(at({ author: "@stranger:lead" }), "caller_unknown", "not comparable, not listed");
    assert.equal(at({ author: "bare.lead" }), "caller_unknown", "no basis at all");
    assert.equal(at({ author_user_id: ID, author: "x.lead" }), "raised", "own by id");
  }
  const withHandle = launchers("tester", "", []);
  const at = (over) => codeOf(resolveInvite(call(over), withHandle, {}));
  assert.equal(at({ author: "@stranger:lead" }), "caller_not_allowed");
  assert.equal(at({ author_user_id: PAL_ID, author: "pal.lead" }), "caller_unknown");
});
