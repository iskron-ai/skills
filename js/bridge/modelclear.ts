// A satellite's seat the harness named no model for (graph @nks/nks-dev, node #7591): register
// without model keeps the earlier one (#4032), so the bridge clears it by its own call —
// PATCH /standings/{id} {"model": null} with the key that opened the seat (api 0.123.0).
import { apiBase } from "../shared/channel.ts";
import { standingIdIn } from "./hold.ts";
import { H } from "./holdstate.ts";
import { headers, TIMEOUT_MS } from "./orderack.ts";
import { satelliteWithoutModel } from "./placefields.ts";
import { log } from "./streams.ts";

/** After a satellite's register: no model known — none on the seat. A failure goes to the log only. */
export async function clearSeatModel(realm: string): Promise<void> {
  if (!satelliteWithoutModel()) return;
  const id = standingIdIn(realm);
  const url = H.currentUrl;
  if (!id || !url) return log(`seat model in ${realm} not cleared: no seat id or channel`);
  try {
    const res = await fetch(`${apiBase(url)}/standings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ model: null }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 160);
      log(`seat model of ${id} not cleared (${res.status}) — ${body}`);
    }
  } catch (e) {
    log(`seat model of ${id} not cleared: ${(e as Error).message}`);
  }
}
