// Case reads use the same authenticated orchestrator identity as invites and raised (#10995).
import { getJson } from "./orchestra-tact.ts";

export async function readCaseHistory(
  base: string,
  token: string,
  room: string,
  since?: number,
): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams({ advance: "false" });
  if (since !== undefined) {
    if (!Number.isSafeInteger(since) || since < 1) throw new Error("invalid_cursor");
    query.set("since", String(since));
  }
  const response = await getJson(
    base,
    token,
    `/rooms/${encodeURIComponent(room)}/history?${query}`,
  );
  if (!Array.isArray(response)) throw new Error("history_not_list");
  for (const entry of response) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("invalid_entry");
    const n = Number(entry.line?.entry_id ?? entry.entry_id);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("invalid_entry_number");
  }
  return response as Record<string, unknown>[];
}
