// Session-scoped machine inventory (graph @nks/nks-dev, nodes #7495, #6478).
import { runIn } from "../shared/scope.ts";
import { safePlace, type SessionSnapshot } from "../shared/snapshot.ts";
import { harnessName, notifiedClient } from "./client.ts";
import { doors, heldPlaces, holdsChannel } from "./hold.ts";
import { sessionOfBridge } from "./holdrecord.ts";
import { placeFields } from "./placefields.ts";
import { extraPlaces } from "./places.ts";
import { type BridgeSession } from "./session.ts";
import { state } from "./transport.ts";

export function sessionSnapshot(
  local_id: string,
  engine: BridgeSession,
  thin_pid: number,
  attached: boolean,
  build: string,
): SessionSnapshot {
  const inspect = (): SessionSnapshot => ({
    local_id,
    thin_pid,
    attached,
    build,
    cwd: engine.origin?.cwd ?? "",
    harness: harnessName(),
    harness_session: sessionOfBridge(),
    places: heldPlaces().map((p) => {
      const standing = p.primary
        ? state.standing
        : extraPlaces().find((x) => x.door.key === p.key)?.standing;
      const door = doors().find((d) => d.key === p.key);
      const fields = placeFields(standing ?? {});
      const last = engine.lastWork();
      return safePlace({
        name: standing?.name,
        realm: standing?.realm,
        karta: standing?.karta,
        primary: p.primary,
        satellite_of: fields.attrs.satellite_of,
        listening: holdsChannel() && (notifiedClient() ? attached : !!door?.clients.size),
        ...(last ? { last_work_at: new Date(last).toISOString() } : {}),
        usage: fields.attrs.usage,
      });
    }),
  });
  return engine.scope ? runIn(engine.scope, inspect) : inspect();
}
