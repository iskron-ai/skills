// The lead subagents of the OpenCode plugin under probe (opencode-leadend.test.mjs,
// opencode-leadseat.test.mjs): a root holding a seat and its child on a satellite of that
// seat — the plugin of opencode-kit.mjs against the stand-in bridge (fake-bridge.mjs) — and
// the words a probe reads: the end in the parent, a turn handed in. Each test file is its own
// process, so each gets its own sandbox (opencode-kit.mjs).
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { plugin, SANDBOX, until } from "./opencode-kit.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");

export function bridgeEnv(name, extra = {}) {
  const log = join(SANDBOX, `${name}.log`);
  const reply = join(SANDBOX, `${name}.reply`);
  const events = join(SANDBOX, `${name}.events`);
  writeFileSync(reply, "");
  writeFileSync(events, "");
  return {
    log,
    reply,
    events,
    env: {
      ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
      FB_LOG: log,
      FB_REPLY: reply,
      FB_EVENTS: events,
      ...extra,
    },
  };
}

export const pidsOf = (log) =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => Number(l.split(/\s+/)[1]));
export const pidOf = (log) => pidsOf(log)[0];
export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ASKING = ["iskron_case", "iskron_channel", "iskron_stand"];
const fakeTools = (names) =>
  JSON.stringify(
    names.map((name) => ({
      name,
      description: "Тул.",
      inputSchema: ASKING.includes(name)
        ? { type: "object", properties: { action: { type: "string" } } }
        : { type: "object" },
    })),
  );
const LEAD_NAMES = ["iskron_stand", "iskron_channel", "iskron_case", "iskron_look"];
export const LEAD_TOOLS = fakeTools(LEAD_NAMES);
export const ROOT_PLACE = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
// №1237: the ended review agent and its successor stood under the same name …sub-5.
export const SUB = "host.repo.opus-5.sub-5";
export const SUB_PLACE = { ...ROOT_PLACE, name: SUB };

// Synthetic held events here model an explicit caller.
export const event = (kind, extra) =>
  JSON.stringify({ kind, ...(kind === "held" ? { automatic: false } : {}), ...extra }) + "\n";

// The parent's and the child's folders of №1237: different locations, two plugin instances —
// the child's turn events reach the deciding instance only if it is the child's own, and the
// probe emits by hand the ones that did arrive (the started did not).
export const PARENT_DIR = "/work/nks-methodology";
export const CHILD_DIR = "/work/skills-review-1237-en";

/** The sessions of the №1237 shape: the root in the parent's folder, its child in another. */
export const SESSIONS = [
  { id: "root", location: { directory: PARENT_DIR } },
  { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
];

/** The end record of a session as leadends.ts lays it next to the grant — read by every instance. */
export const endMark = (session) =>
  join(
    process.env.ISKRON_BRIDGE_AUTH_DIR,
    `opencode-ended.${createHash("sha256").update(session).digest("hex").slice(0, 16)}.json`,
  );

/** `childPlace` — the seat the child's «held» names (another role than the root's, if a probe asks). */
export async function leadChild(name, env = {}, sessions, childPlace = SUB_PLACE) {
  const b = bridgeEnv(name, { FB_TOOLS: LEAD_TOOLS, ...env });
  const rec = await plugin(b.env, {
    sessions: sessions ?? [
      { id: "root", location: { directory: PARENT_DIR } },
      { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
    ],
  });
  try {
    await until(() => rec.tools().has("iskron_case"), "the tools", 8000);
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "#931" }, "root");
    const rootPid = pidOf(b.log);
    appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place: ROOT_PLACE }));
    await until(() => rec.said().includes("мост держит место k-root"), "the root's held word");
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child");
    const childPid = pidsOf(b.log)[1];
    appendFileSync(
      `${b.events}.${childPid}`,
      event("held", { key: "k-sub", incarnation: "inc-sub", place: childPlace }),
    );
    await until(() => rec.said().includes("мост держит место k-sub"), "the child's held word");
    return { b, rec, rootPid, childPid };
  } catch (e) {
    await rec.stop();
    throw e;
  }
}

/** One whole turn of the child: started, its text, ended. */
export function turn(rec, text, sessionID = "child") {
  rec.emit({ type: "session.execution.started", data: { sessionID } });
  if (text) rec.emit({ type: "session.text.ended", data: { sessionID, ordinal: 0, text } });
  rec.emit({ type: "session.execution.succeeded", data: { sessionID } });
}

export const ends = (rec) => rec.synthetics.filter((s) => / КОНЧЕН —/.test(s.text));
export const turnWords = (rec) =>
  rec.synthetics.filter((s) => /сдал ход, не поручение/.test(s.text));
export const callsIn = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
