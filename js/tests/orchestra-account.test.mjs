// The orchestrator's account from the whoami text (graph @nks/nks-dev, #11011): the id from an
// «id <uuid>» line when the text has one, the handle from «handle @name»; neither — account_unknown.
import assert from "node:assert/strict";
import { test } from "node:test";

import { accountOfWhoami, authorOf, sameAccount } from "../bridge/orchestra-account.ts";

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
