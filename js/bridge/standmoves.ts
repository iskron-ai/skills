// Refusals of the stand tool that name the move that works (graph @nks/nks-dev, node #5036
// p. 8; counterexamples #7552–#7556): an api rule in the surface's words, a call in full.
import { STAND_MOVES, type StandMovesWords, tool } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { type Answer, short } from "./call.ts";
import { extraIn } from "./places.ts";
import { sameRealm } from "./realms.ts";
import { sw } from "./standwords.ts";
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
