// Production sliceBy -> mindSlice -> bundled compaction, with only bridge I/O substituted.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { MIND_SLICE } from "../delivery/index.ts";
import { BUILT_PLUGIN } from "./built.mjs";
import { SANDBOX } from "./opencode-kit.mjs";

const copy = join(SANDBOX, "compaction-production-read.mjs");
writeFileSync(
  copy,
  readFileSync(process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, "utf8") +
    "\nexport { createCompaction, sliceBy };\n",
);
const { createCompaction, sliceBy } = await import(pathToFileURL(copy).href);
const WHO = "Вызывающая идентичность: @tester · handle @tester";
const READY =
  "Доступные графы (1) — адресуй их как @owner/slug:\n    @tester/mind  r204  mind · 2026-09-23";
const MISSING =
  "Доступные графы (1) — адресуй их как @owner/slug:\n    @other/mind  r35  mind · 2026-09-23";
const PAGE = "Найдено 1 узлов:\n  📌 Правило (#31, phenomenon, Pt/Va/Ad, v1) — читать источник";
const answer = (text, isError = false) => ({ content: [{ type: "text", text }], isError });
const request = () => ({ sessionID: "production-read", system: [] });
const text = (r) => r.system.map((p) => p.text).join("\n");
const words = (s) => s.split("контекст сжат").length - 1;
/** A bridge of an older build: no `whoami` of its own — «no such method». */
const older = () => Object.assign(new Error("no such method"), { code: -32601 });
// The slice is one per server and account for the plugin's process (shared/mindcache.ts), the
// account the bridge's own whoami names: each read here is another server's — or the first
// one's slice would serve the rest under the same @tester.
let accounts = 0;
const fresh = () =>
  void (process.env.ISKRON_BRIDGE_URL = `https://compaction-read-${++accounts}.test/mcp`);

for (const failure of ["OFFLINE", "readiness refusal", "search refusal"]) {
  test(`production compaction retries ${failure} without consuming a partial return`, async () => {
    fresh();
    let refused = false;
    const calls = [];
    const bridge = {
      async request(method, p) {
        if (method !== "tools/call") throw older(); // whoami by its own call, as an older bridge
        calls.push(p.name);
        if (!refused && (failure !== "search refusal" || p.name === "iskron_search")) {
          refused = true;
          if (failure === "OFFLINE") throw new Error("OFFLINE");
          return answer("REFUSED", true);
        }
        return answer(p.name === "iskron_me" ? WHO : p.name === "iskron_realm" ? READY : PAGE);
      },
    };
    const c = createCompaction({
      placeOf: () => ({ realm: "r5", karta: "931", name: "production-read" }),
      closed: () => false,
      slice: () => sliceBy(bridge, { strict: true }),
      say: () => {},
    });
    c.instruct(request());
    const failed = request();
    await assert.rejects(c.tell(failed), /OFFLINE|REFUSED/);
    assert.equal(text(failed), "", "no role or unread diagnostic enters the failed request");
    const before = calls.length;
    const retry = request();
    await c.tell(retry);
    assert.deepEqual(
      calls.slice(before),
      failure === "search refusal"
        ? // the account asked anew (every read asks whoami — an older bridge by its own call),
          // its mind remembered: then only the failed search again
          ["iskron_me", "iskron_search"]
        : ["iskron_me", "iskron_realm", "iskron_search"],
      "retry the failed read",
    );
    assert.equal(words(text(retry)), 1);
    assert.match(text(retry), /📌 Правило/);
    const again = request();
    await c.tell(again);
    assert.equal(text(again), "");
    assert.equal(
      calls.length,
      before + (failure === "search refusal" ? 2 : 3),
      "one complete return consumes the obligation",
    );
  });
}

test("production slice keeps a confirmed absent mind and an empty slice valid in strict mode", async () => {
  for (const readiness of [MISSING, READY]) {
    fresh();
    const calls = [];
    const result = await sliceBy(
      {
        async request(method, p) {
          if (method !== "tools/call") throw older();
          calls.push(p.name);
          return answer(
            p.name === "iskron_me"
              ? WHO
              : p.name === "iskron_realm"
                ? readiness
                : "Найдено 0 узлов:",
          );
        },
      },
      { strict: true },
    );
    assert.equal(result, readiness === MISSING ? MIND_SLICE.ru.absent() : MIND_SLICE.ru.empty());
    assert.equal(calls.length, readiness === MISSING ? 2 : 3);
  }
});

test("ordinary production slice reads retain soft diagnostics for transport and server refusal", async () => {
  for (const failure of ["OFFLINE", "REFUSED"]) {
    fresh();
    const result = await sliceBy({
      async request(method) {
        if (failure === "OFFLINE") throw new Error(failure);
        if (method !== "tools/call") throw older();
        return answer(failure, true);
      },
    });
    assert.equal(result, MIND_SLICE.ru.unread(failure));
  }
});

test("unknown readiness is not a successful strict slice but stays diagnostic for ordinary reads", async () => {
  const bridge = { request: async () => answer("readiness unavailable") };
  fresh();
  await assert.rejects(sliceBy(bridge, { strict: true }), /account handle unknown/);
  fresh();
  assert.equal(await sliceBy(bridge), MIND_SLICE.ru.unread("account handle unknown"));
});

// The reviewer's scene (№5817 [573]; REALITY.md, the mind cache's row): ONE bridge, a new login
// in its store switches the account it speaks for (OAuth: the bridge reads its token on every
// request). The next read asks whoami of that bridge again and gets Bob's rules (or «still being
// read») — never Alice's text in Bob's session, never a read without whoami after the switch,
// never @alice/mind read by Bob's bridge. Both bridges: one answering its own `whoami`, and an
// older one that knows no such method — its whoami is a call of its own.
for (const own of [true, false])
  test(`one bridge whose account a new login switches: the next read asks whoami and reads Bob's rules (${own ? "the bridge's own whoami" : "an older bridge"})`, async () => {
    fresh();
    let subject = "alice";
    const asked = [];
    const bridge = {
      async request(method, p) {
        if (method === "iskron/whoami") {
          if (!own) throw older();
          asked.push({ whoami: subject });
          return { handle: subject };
        }
        const a = p.arguments ?? {};
        asked.push({ [p.name]: a.realm ?? a.action ?? "", by: subject });
        if (p.name === "iskron_me")
          return answer(`Вызывающая идентичность: @${subject} · handle @${subject}`);
        if (p.name === "iskron_realm")
          return answer(
            `Доступные графы (1) — адресуй их как @owner/slug:\n    @${subject}/mind  r204  mind · 2026-09-23`,
          );
        const owner = String(a.realm).split("/")[0].slice(1);
        return answer(
          `Найдено 1 узлов:\n  📌 Правило ${owner} (#31, phenomenon, Pt/Va/Ad, v1) — правило ${owner}`,
        );
      },
    };
    assert.match(await sliceBy(bridge), /Правило alice/);
    const from = asked.length;
    subject = "bob"; // a new login in the bridge's store: Bob from now on
    const second = await sliceBy(bridge);
    const after = asked.slice(from);
    assert.ok(
      after.some((c) => c.whoami === "bob" || c.iskron_me === "whoami"),
      `the read after the switch asks whoami: ${JSON.stringify(after)}`,
    );
    assert.doesNotMatch(second, /Правило alice/, "never Alice's rules in Bob's session");
    assert.ok(
      /Правило bob/.test(second) || second === MIND_SLICE.ru.pending(),
      `Bob's rules, or that they are still being read: ${second}`,
    );
    assert.ok(
      !after.some((c) => c.iskron_search === "@alice/mind"),
      `@alice/mind is not read by Bob's bridge: ${JSON.stringify(after)}`,
    );
  });

/**
 * A bridge on `server` whose account is @tester; its mind holds `rule`. `own` — it answers its
 * own whoami (naming its server), else it is of an older build.
 */
function onServer(server, rule, own = true) {
  const searches = [];
  const bridge = {
    searches,
    async request(method, p) {
      if (method === "iskron/whoami") {
        if (!own) throw older();
        return { handle: "tester", server };
      }
      if (p.name === "iskron_me") return answer(WHO);
      if (p.name === "iskron_realm") return answer(READY);
      searches.push(p.arguments?.realm);
      return answer(
        `Найдено 1 узлов:\n  📌 ${rule} (#31, phenomenon, Pt/Va/Ad, v1) — правило ${rule}`,
      );
    },
  };
  return bridge;
}

// The reviewer's scene (№5817 [585]): the server is chosen beside the grant (`use`), not by the
// variable — an old live bridge A and a new B speak to two servers, one handle on both. Each slice
// is the server's its bridge names: B reads its own rules by its own search, never A's.
test("two bridges of one handle on two servers: each reads its own server's rules", async () => {
  fresh();
  delete process.env.ISKRON_BRIDGE_URL; // the server chosen by the file, not the variable
  const a = onServer("https://a.test/mcp", "Rule-A");
  const b = onServer("https://b.test/mcp", "Rule-B");
  assert.match(await sliceBy(a), /Rule-A/);
  const got = await sliceBy(b);
  assert.match(got, /Rule-B/, got);
  assert.doesNotMatch(got, /Rule-A/, "never the other server's rules");
  assert.equal(b.searches.length, 1, "B read by its own search");
});

// A bridge of an older build names no server: its slice is its own — shared with no other bridge,
// however alike their accounts look.
test("bridges of an older build name no server: each its own slice, none shared", async () => {
  fresh();
  delete process.env.ISKRON_BRIDGE_URL;
  const a = onServer("https://a.test/mcp", "Rule-A", false);
  const b = onServer("https://b.test/mcp", "Rule-B", false);
  assert.match(await sliceBy(a), /Rule-A/);
  const got = await sliceBy(b);
  assert.match(got, /Rule-B/, got);
  assert.equal(b.searches.length, 1, "B read by its own search");
  assert.match(await sliceBy(a), /Rule-A/, "A's own slice stays A's");
  assert.equal(a.searches.length, 1, "A's slice kept for A alone");
});
