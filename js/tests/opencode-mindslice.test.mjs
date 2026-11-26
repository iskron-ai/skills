// The human's rules from mind in an OpenCode session (graph @nks/nks-dev: kriya #9817, outcome
// #9816, risk #9818): a child launched with a case reads them in its launch word — taken from its
// own stand answer, not from the launcher's brief; a seated session after a compaction reads them
// in the first request's system, read by its own bridge as a service move; a root seated by its
// cover reads them beside its seating word. Fake bridge (opencode-kit.mjs) and the real bridge
// over the fake server (rootseat-kit.mjs); ISKRON_OPENCODE_PLUGIN aims it at any copy.
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MIND_SLICE } from "../delivery/index.ts";
import { plugin, SANDBOX, until } from "./opencode-kit.mjs";
import { setup } from "./ownseat-kit.mjs";
import { rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const PLACE = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
const W = MIND_SLICE.ru;
const MARK = W.mark();
const BLOCK = [
  W.head(1),
  "  📌 Итог — одной строкой (#31) — Фрагмент правила",
  W.foot(false, 100),
].join("\n");
const READINESS = "Вызывающая идентичность: @tester · handle @tester";
const REALMS =
  "Доступные графы (1) — адресуй их как @owner/slug:\n    @tester/mind  r204  mind · 2026-09-23";
const SEARCH =
  "Найдено 1 узлов:\n  📌 Итог — одной строкой (#31, phenomenon, Pt/Va/Ad, v1) — Фрагмент правила\n\n" +
  '↳ Выбери один узел и иди по стрелкам: iskron_look(realm="mind", node_id="#31")';

function lay(name, extra = {}) {
  const files = Object.fromEntries(
    ["log", "reply", "events", "calls"].map((k) => [k, join(SANDBOX, `mind-${name}.${k}`)]),
  );
  for (const f of Object.values(files)) writeFileSync(f, "");
  const env = {
    ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
    FB_LOG: files.log,
    FB_REPLY: files.reply,
    FB_EVENTS: files.events,
    FB_CALLS: files.calls,
    ...extra,
  };
  return { files, env };
}

const sent = (file) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.name?.startsWith("iskron_"));

test("a launched child reads the human's rules from its own stand answer, under its launch word", async () => {
  const { files, env } = lay("launch", {
    FB_TOOLS: JSON.stringify([
      { name: "iskron_stand", description: "Стояние.", inputSchema: { type: "object" } },
      { name: "iskron_case", description: "Дело.", inputSchema: { type: "object" } },
    ]),
    FB_STAND_HELD: "host.repo.opus-5",
  });
  writeFileSync(`${files.reply}.iskron_stand`, `Искрон: стояние host.repo.opus-5.sub-1\n${BLOCK}`);
  const rec = await plugin(env, {
    sessions: [
      { id: "root", location: { directory: "/work/root" } },
      { id: "child", parentID: "root", location: { directory: "/work/child" } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_stand"), "the stand tool", 8000);
    await rec.call("iskron_stand", { realm: "@nks/nks-dev", karta: "#2816" }, "root");
    const read = await rec.prompt("child", "start @nks/nks-dev #48 дело №77\nБриф: почини мост.");
    assert.ok(
      read.endsWith(
        "Искрон: встал host.repo.opus-5.sub-1, вошёл в дело №77: перескажи бриф через say с to запустившему и in_reply_to на поручение; адрес неизвестен — прочти участников. Ход и исход — line своего ключа, без дубля say.\n" +
          BLOCK,
      ),
      read,
    );
    assert.match(
      read,
      /Личное: в дело правило приводи, только когда оно описывает это дело/,
      "the rules carry the personal mark",
    );
  } finally {
    await rec.stop();
  }
});

test("a seated session after a compaction reads the human's rules in the first request's system, by service calls of its bridge", async () => {
  const { files, env } = lay("compact");
  writeFileSync(`${files.reply}.iskron_me`, READINESS);
  writeFileSync(`${files.reply}.iskron_realm`, REALMS);
  writeFileSync(`${files.reply}.iskron_search`, SEARCH);
  const rec = await plugin(env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 8000);
    await rec.call("iskron_channel", { action: "connect" }, "s-m");
    const pid = Number(readFileSync(files.log, "utf8").trim().split(/\s+/)[1]);
    appendFileSync(
      `${files.events}.${pid}`,
      JSON.stringify({ kind: "held", automatic: false, key: "k-m", place: PLACE }) + "\n",
    );
    await until(() => rec.said().includes("мост держит место k-m"), "held");
    const system = async (hook) => {
      const req = { sessionID: "s-m", system: [], messages: [], tools: {}, options: {} };
      for (const cb of rec.hooks[hook] ?? []) await cb(req);
      return req.system.map((p) => p.text).join("\n");
    };
    assert.ok(!(await system("context")).includes(MARK), "no compaction — no rules");
    const order = await system("compaction");
    assert.ok(!order.includes(MARK), "the compaction request itself gets no rules");
    const first = await system("context");
    assert.ok(first.includes(BLOCK), first);
    assert.ok(!(await system("context")).includes(MARK), "the next request — none");
    const mind = sent(files.calls).filter((c) => c.name !== "iskron_channel");
    assert.deepEqual(
      mind.map((c) => c.name),
      ["iskron_me", "iskron_realm", "iskron_search"],
    );
    assert.equal(mind[2].arguments.realm, "@tester/mind");
    assert.equal(mind[2].arguments.attrs_filter, "slice:agents,ways");
    assert.ok(
      mind.every((c) => String(c.id).startsWith("iskron-service-")),
      "a service move, not the agent's work",
    );
  } finally {
    await rec.stop();
  }
});

// One slice per account for the plugin's process (shared/mindcache.ts): two seated sessions after
// a compaction read the rules by one search, not one each.
test("two seated sessions of one plugin read the human's rules by one search", async () => {
  const { files, env } = lay("compact-two");
  writeFileSync(`${files.reply}.iskron_me`, READINESS);
  writeFileSync(`${files.reply}.iskron_realm`, REALMS);
  writeFileSync(`${files.reply}.iskron_search`, SEARCH);
  const rec = await plugin(env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 8000);
    const systems = [];
    for (const s of ["s-one", "s-two"]) {
      await rec.call("iskron_channel", { action: "connect" }, s);
      const pids = readFileSync(files.log, "utf8").trim().split("\n");
      const pid = Number(pids.at(-1).split(/\s+/)[1]);
      appendFileSync(
        `${files.events}.${pid}`,
        JSON.stringify({ kind: "held", automatic: false, key: `k-${s}`, place: PLACE }) + "\n",
      );
      await until(() => rec.said().includes(`мост держит место k-${s}`), `held ${s}`);
    }
    for (const s of ["s-one", "s-two"]) {
      for (const cb of rec.hooks.compaction ?? []) await cb({ sessionID: s, system: [] });
      const req = { sessionID: s, system: [], messages: [], tools: {}, options: {} };
      for (const cb of rec.hooks.context ?? []) await cb(req);
      systems.push(req.system.map((p) => p.text).join("\n"));
    }
    for (const text of systems) assert.ok(text.includes(BLOCK), text);
    const searches = sent(files.calls).filter((c) => c.name === "iskron_search");
    assert.equal(searches.length, 1, "one search for the account, not one per session");
  } finally {
    await rec.stop();
  }
});

// Personal rules never cross accounts: the account switched under the same grant directory (a new
// login), the next bridge asks whoami, reads its own account's slice — never the previous one's.
test("an account switched under the same grant directory: Bob's bridge reads Bob's slice, never Alice's", async () => {
  const { files, env } = lay("account-switch");
  const as = (who, rule) => {
    writeFileSync(`${files.reply}.iskron_me`, `Вызывающая идентичность: @${who} · handle @${who}`);
    writeFileSync(
      `${files.reply}.iskron_realm`,
      `Доступные графы (1) — адресуй их как @owner/slug:\n    @${who}/mind  r204  mind · 2026-09-23`,
    );
    writeFileSync(
      `${files.reply}.iskron_search`,
      `Найдено 1 узлов:\n  📌 ${rule} (#31, phenomenon, Pt/Va/Ad, v1) — правило ${who}\n`,
    );
  };
  const rec = await plugin(env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 8000);
    const rulesOf = async (s) => {
      await rec.call("iskron_channel", { action: "connect" }, s);
      const pid = Number(readFileSync(files.log, "utf8").trim().split("\n").at(-1).split(/\s+/)[1]);
      appendFileSync(
        `${files.events}.${pid}`,
        JSON.stringify({ kind: "held", automatic: false, key: `k-${s}`, place: PLACE }) + "\n",
      );
      await until(() => rec.said().includes(`мост держит место k-${s}`), `held ${s}`);
      for (const cb of rec.hooks.compaction ?? []) await cb({ sessionID: s, system: [] });
      const req = { sessionID: s, system: [], messages: [], tools: {}, options: {} };
      for (const cb of rec.hooks.context ?? []) await cb(req);
      return req.system.map((p) => p.text).join("\n");
    };
    as("alice", "Правило Алисы");
    assert.match(await rulesOf("s-alice"), /Правило Алисы/);
    const before = sent(files.calls).filter((c) => c.name === "iskron_search").length;
    // Bob signs in under the same grant directory: the new login rewrites the grant on disk.
    const auth = process.env.ISKRON_BRIDGE_AUTH_DIR;
    mkdirSync(auth, { recursive: true });
    writeFileSync(join(auth, "account-switch-grant.json"), JSON.stringify({ who: "bob" }));
    as("bob", "Правило Боба");
    const bob = await rulesOf("s-bob");
    assert.match(bob, /Правило Боба/, bob);
    assert.doesNotMatch(bob, /Алис/, "never Alice's block");
    const searches = sent(files.calls)
      .filter((c) => c.name === "iskron_search")
      .slice(before);
    assert.deepEqual(
      searches.map((c) => c.arguments.realm),
      ["@bob/mind"],
      "one request for Bob",
    );
  } finally {
    await rec.stop();
    rmSync(join(process.env.ISKRON_BRIDGE_AUTH_DIR, "account-switch-grant.json"), { force: true });
  }
});

// The reviewer's scene (№5817 [567]): a running bridge keeps the token it started with, whatever
// lies on disk now. Alice's bridge reads with PAT_A; the token file is replaced with PAT_B; Alice's
// bridge reads again — still Alice; Bob's bridge, started with PAT_B, is asked itself and reads
// Bob's rules — never Alice's filed under a key the disk named.
test("a token file switched under a live bridge: that bridge stays its own account; the next bridge asks its own whoami", async () => {
  const { files, env } = lay("token-switch");
  const auth = process.env.ISKRON_BRIDGE_AUTH_DIR;
  mkdirSync(auth, { recursive: true });
  const tokenFile = join(auth, "token");
  const as = (token, who, rule) => {
    writeFileSync(
      `${files.reply}.iskron_me@${token}`,
      `Вызывающая идентичность: @${who} · handle @${who}`,
    );
    writeFileSync(
      `${files.reply}.iskron_realm@${token}`,
      `Доступные графы (1) — адресуй их как @owner/slug:\n    @${who}/mind  r204  mind · 2026-09-23`,
    );
    writeFileSync(
      `${files.reply}.iskron_search@${token}`,
      `Найдено 1 узлов:\n  📌 ${rule} (#31, phenomenon, Pt/Va/Ad, v1) — правило ${who}\n`,
    );
  };
  as("PAT_A", "alice", "Правило alice");
  as("PAT_B", "bob", "Правило bob");
  writeFileSync(tokenFile, "PAT_A\n", { mode: 0o600 });
  const rec = await plugin(env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 8000);
    const stand = async (s) => {
      await rec.call("iskron_channel", { action: "connect" }, s);
      const pid = Number(readFileSync(files.log, "utf8").trim().split("\n").at(-1).split(/\s+/)[1]);
      appendFileSync(
        `${files.events}.${pid}`,
        JSON.stringify({ kind: "held", automatic: false, key: `k-${s}`, place: PLACE }) + "\n",
      );
      await until(() => rec.said().includes(`мост держит место k-${s}`), `held ${s}`);
      return pid;
    };
    const rulesOf = async (s) => {
      for (const cb of rec.hooks.compaction ?? []) await cb({ sessionID: s, system: [] });
      const req = { sessionID: s, system: [], messages: [], tools: {}, options: {} };
      for (const cb of rec.hooks.context ?? []) await cb(req);
      return req.system.map((p) => p.text).join("\n");
    };
    const alicePid = await stand("s-alice");
    assert.match(await rulesOf("s-alice"), /Правило alice/);
    writeFileSync(tokenFile, "PAT_B\n", { mode: 0o600 });
    assert.match(await rulesOf("s-alice"), /Правило alice/, "Alice's live bridge is still Alice");
    const before = sent(files.calls).length;
    const bobPid = await stand("s-bob");
    assert.notEqual(bobPid, alicePid, "Bob's session has a bridge of its own");
    const bob = await rulesOf("s-bob");
    assert.match(bob, /Правило bob/, bob);
    assert.doesNotMatch(bob, /Правило alice/, "never Alice's rules");
    const asked = readFileSync(files.calls, "utf8")
      .trim()
      .split("\n")
      .slice(before)
      .map((l) => JSON.parse(l))
      .filter((c) => c.name === "iskron_me");
    assert.ok(
      asked.some((c) => c.pid === bobPid),
      `Bob's bridge is asked its own whoami: ${JSON.stringify(asked)}`,
    );
  } finally {
    await rec.stop();
    rmSync(tokenFile, { force: true });
  }
});

test(
  "a root seated by its cover reads the human's rules beside its seating word",
  { timeout: 90_000 },
  async (t) => {
    const s = await setup(t);
    const project = realpathSync(s.cwd);
    writeAgents(project);
    await s.fake.control({
      mind: { rules: [{ seq: 31, name: "Итог — одной строкой", text: "Фрагмент правила" }] },
    });
    const oc = await rootPlugin(s, project);
    try {
      oc.create("root");
      const r = await oc.turn("root", "go");
      assert.ok(r.system.includes(BLOCK), `${r.told}\n${oc.said()}`);
    } finally {
      await oc.stop();
    }
  },
);

test("the plugin uses strict production reads only for compaction and retries a refused read", async () => {
  const { files, env } = lay("compact-refused");
  writeFileSync(`${files.reply}.iskron_me`, "__ERROR__READ_REFUSED");
  writeFileSync(`${files.reply}.iskron_realm`, REALMS);
  writeFileSync(`${files.reply}.iskron_search`, SEARCH);
  const rec = await plugin(env);
  try {
    await until(() => rec.tools().has("iskron_channel"), "the server's tools", 8000);
    await rec.call("iskron_channel", { action: "connect" }, "s-refused");
    const pid = Number(readFileSync(files.log, "utf8").trim().split(/\s+/)[1]);
    appendFileSync(
      `${files.events}.${pid}`,
      JSON.stringify({ kind: "held", automatic: false, key: "k-refused", place: PLACE }) + "\n",
    );
    await until(() => rec.said().includes("мост держит место k-refused"), "held");
    const run = async (hook, req) => {
      for (const cb of rec.hooks[hook] ?? []) await cb(req);
    };
    await run("compaction", { sessionID: "s-refused", system: [] });
    const first = { sessionID: "s-refused", system: [], messages: [] };
    await assert.rejects(run("context", first), /READ_REFUSED/);
    assert.deepEqual(first.system, []);
    writeFileSync(`${files.reply}.iskron_me`, READINESS);
    const retry = { sessionID: "s-refused", system: [], messages: [] };
    await run("context", retry);
    assert.ok(retry.system.some((p) => p.text.includes(BLOCK)));
    assert.deepEqual(
      sent(files.calls)
        .filter((c) => c.name !== "iskron_channel")
        .map((c) => c.name),
      ["iskron_me", "iskron_me", "iskron_realm", "iskron_search"],
    );
  } finally {
    await rec.stop();
  }
});

test("a root start keeps a refused production mind read as a soft diagnostic", async (t) => {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  writeAgents(project);
  await s.fake.control({ mind: { refuse: "READ_REFUSED" } });
  const oc = await rootPlugin(s, project);
  try {
    oc.create("soft-root");
    const r = await oc.turn("soft-root", "go");
    assert.ok(r.system.includes(W.unread("READ_REFUSED")), `${r.system}\n${oc.said()}`);
  } finally {
    await oc.stop();
  }
});
