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
// The slice is one per account for the plugin's process (shared/mindcache.ts): each read here
// is another account's — a token of its own — or the first one's slice would serve the rest.
let accounts = 0;
const fresh = () => void (process.env.ISKRON_BRIDGE_TOKEN = `compaction-read-${++accounts}`);

for (const failure of ["OFFLINE", "readiness refusal", "search refusal"]) {
  test(`production compaction retries ${failure} without consuming a partial return`, async () => {
    fresh();
    let refused = false;
    const calls = [];
    const bridge = {
      async request(_method, p) {
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
        ? ["iskron_search"]
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
      before + (failure === "search refusal" ? 1 : 3),
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
        async request(_method, p) {
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
      async request() {
        if (failure === "OFFLINE") throw new Error(failure);
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
