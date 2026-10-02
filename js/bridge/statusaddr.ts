// Статусный адрес держимого канала для занятости (status.ts, engine.ts, session.ts).
import { H } from "./holdstate.ts";
import { extraIn } from "./places.ts";

/** Статусный адрес канала, ключ, id и адрес места (@handle:name, как доска; до hello — null) этого графа (без графа — основного) — для занятости. */
export function statusAddress(
  realm?: string,
): { url: string; key: string; standingId: string | null; place: string | null } | null {
  if (!H.currentStatusUrl || !H.currentKey) return null;
  const d = (realm ? extraIn(realm)?.door : undefined) ?? H.door;
  return {
    url: H.currentStatusUrl,
    key: d?.key ?? H.currentKey,
    standingId: d?.standingId ?? null,
    place: d?.address ?? null,
  };
}
