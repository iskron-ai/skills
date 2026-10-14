// Refusals of the stand tool that name the move that works (graph @nks/nks-dev, node #5036
// p. 8; counterexamples #7552–#7556): an api rule in the surface's words, a call in full.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { STAND_MOVES, type StandMovesWords, tool } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { sessionCwd } from "../shared/scope.ts";
import { standingsDirOf } from "../shared/standings.ts";
import { type Answer, callTool, short } from "./call.ts";
import { CFG } from "./config.ts";
import { type HoldRecord, sessionOfBridge } from "./holdrecord.ts";
import { extraIn } from "./places.ts";
import { sameRealm } from "./realms.ts";
import { sw } from "./standwords.ts";
import { type StatusMiss } from "./status.ts";
import { type Standing, state } from "./transport.ts";

const mw = (): StandMovesWords => words(STAND_MOVES);

/** The stand call that takes this seat, every argument named. */
export const standCall = (realm: string, karta: string | number, name: string): string =>
  `${tool("stand")}(realm="${realm}", karta=${karta}${name ? `, name="${name}"` : ""})`;

/** The seat this bridge leads in the graph (main or beside), if any. */
function ledIn(realm: string): Standing | undefined {
  const prim = state.standing;
  return prim && sameRealm(prim.realm, realm) ? prim : extraIn(realm)?.standing;
}

const STANDS_IN_REALM = "channel_already_stands_in_realm";

const slugOf = (realm: string): string => realm.replace(/^@[^/]+\//, "");

/** The seat this session's former bridge held in the graph, by the hold records of its directory (newest). */
function formerSeat(realm: string): Standing | null {
  const dir = standingsDirOf(CFG.authDir);
  const cwd = sessionCwd();
  const me = sessionOfBridge();
  let best: HoldRecord | null = null;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".hold"));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (!rec?.realm || rec.karta == null || rec.cwd !== cwd) continue;
      if (slugOf(String(rec.realm)) !== slugOf(realm)) continue;
      if (me && rec.session && rec.session !== me) continue;
      if (!best || (rec.at ?? 0) > (best.at ?? 0)) best = rec;
    } catch {
      /* a broken file names no seat */
    }
  }
  return best ? { realm: best.realm, karta: best.karta, name: best.name } : null;
}

/**
 * A status call without karta that set no busy line, on a seat that went from under the
 * bridge (plugin restart, eviction, leave): the refusal names the full call that takes it
 * back — with karta and the former name (#7554); none known — the bare refusal.
 */
export function standAgainWord(realm: string, miss: StatusMiss | null): string {
  if (!realm || !miss || !["none", "parked", "elsewhere"].includes(miss.why)) return "";
  const seat = "seat" in miss ? miss.seat : formerSeat(realm);
  return seat ? ` ${mw().standAgain(standCall(seat.realm, seat.karta, seat.name ?? ""))}` : "";
}

/**
 * take=true onto another seat of the same graph moves the session, it does not add a seat:
 * the seat this bridge led before is revoked, or cases ask for from_standing on every call
 * (#7553). The note after the answer's header.
 */
export async function releasePrior(realm: string, prior: Standing): Promise<string> {
  const name = prior.name ?? "";
  const args = { action: "revoke", realm, karta: String(prior.karta), standing: name };
  const r = await callTool(tool("channel"), args);
  if (!r.isError) return mw().priorReleased(name);
  const revoke = `${tool("channel")}(action="revoke", realm="${realm}", karta="${prior.karta}", standing="${name}")`;
  return mw().priorKept(name, short(r.text, 160), revoke);
}

/** The refusal of connect or register as the agent reads it: a known api rule with its move, else as is. */
export function refusedWord(what: string, r: Answer, realm: string): string {
  if (r.refusal?.rule === STANDS_IN_REALM || r.text.includes(STANDS_IN_REALM)) {
    const led = ledIn(realm);
    const call = led ? standCall(realm, led.karta, led.name ?? "") : "";
    const board = `${tool("channel")}(action="list", realm="${realm}")`;
    const leave = `${tool("channel")}(action="revoke", realm="${realm}", karta, standing=<${led?.name ?? "name"}>)`;
    return mw().standsInRealm(realm, call, board, leave);
  }
  return sw().refused(what, short(r.text));
}
