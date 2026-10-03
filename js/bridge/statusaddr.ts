// Статусный адрес держимого канала для занятости (status.ts, engine.ts, session.ts).
import { H } from "./holdstate.ts";
import { extraIn } from "./places.ts";
import { state } from "./transport.ts";

/**
 * Статусный адрес канала, ключ, id и адрес места (@handle:name, как доска; derived — выведен
 * мостом, hello его не называл; ни того, ни другого — null) этого графа (без графа — основного), с именем места — для занятости.
 */
export function statusAddress(realm?: string): {
  url: string;
  key: string;
  standingId: string | null;
  place: string | null;
  derived: boolean;
  name: string;
} | null {
  if (!H.currentStatusUrl || !H.currentKey) return null;
  const extra = realm ? extraIn(realm) : undefined;
  const d = extra?.door ?? H.door;
  return {
    url: H.currentStatusUrl,
    key: d?.key ?? H.currentKey,
    standingId: d?.standingId ?? null,
    place: d?.address ?? null,
    derived: d?.addressDerived ?? false,
    name: (extra?.standing ?? state.standing)?.name ?? "",
  };
}
