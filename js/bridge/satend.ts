// A satellite's end (graph @nks/nks-dev, nodes #11362, #6593): reported by the one end call by its
// socket's token (endreport.ts); the seats its ended[] names are ended, the rest — and every seat
// on an api without the route — go by the revoke by name, the path before it. A token another
// holder took (moved) revokes nothing: that seat is not this run's any more.
import { type SeatKey } from "../shared/seat.ts";
import { type Revokes, revokeSatellitePlaces } from "./caseexit.ts";
import { type EndEvent, reportEnd } from "./endreport.ts";
import { standingIdIn } from "./hold.ts";
import { normKarta } from "./names.ts";
import { canonRealm } from "./realms.ts";
import { log } from "./streams.ts";
import { type Standing } from "./transport.ts";

const keyOf = (s: Standing): SeatKey => ({
  realm: canonRealm(s.realm),
  karta: normKarta(s.karta),
  name: s.name ?? "",
});

/** `socket` — the satellite's own socket address while it held one; `ids` — seat ids by name. */
export async function endSatellite(
  places: Standing[],
  socket: string | null,
  event: EndEvent,
  ids: Map<Standing, string | null> = new Map(places.map((s) => [s, standingIdIn(s.realm)])),
): Promise<Revokes> {
  const none: Revokes = { failed: [], revoked: [], probably: [] };
  if (!places.length) return none;
  if (!socket) return revokeSatellitePlaces(places);
  const absent = async () => ({ how: "absent" as const, why: "no end-event route", ended: [] });
  const r = await reportEnd(socket, event, null, absent);
  if (r.how === "moved") {
    log(`the satellite's token is not current — another holder took it or it ended; not revoked`);
    return none;
  }
  if (r.how !== "stopped") return revokeSatellitePlaces(places);
  const done = places.filter((s) => {
    const id = ids.get(s);
    return !!id && r.ended.includes(id);
  });
  const rest = places.filter((s) => !done.includes(s));
  for (const s of done) log(`${s.name} ended by the end event (${event}) — the server's word`);
  const end = rest.length ? await revokeSatellitePlaces(rest) : none;
  return { ...end, revoked: [...done.map(keyOf), ...end.revoked] };
}
