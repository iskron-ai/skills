// The end of an agent's session, reported by one call (graph @nks/nks-dev, nodes #11362, #6593):
// the server holds the seat, the bridge only says the fact — POST <api>/channel/ws/{token}/event
// {event, session_id?}; the api ends that session's seats (all the channel's without session_id)
// and answers 200 {ended:[ids]}: ended[] is the authority. An api without the route (404 with no
// rule, 405) falls back once to the path before it — the stop by the same token (deadstop.ts), or
// the caller's own end — and says so in the log.
import { apiBase } from "../shared/channel.ts";
import { namedFetch } from "../shared/http.ts";
import { endedOf, ruleOf, type Stop, stopBySocket } from "./deadstop.ts";
import { log } from "./streams.ts";

/** How the agent's session ended, as the harness or the daemon saw it. */
export type EndEvent =
  "session_closed" | "session_deleted" | "process_died" | "run_ended" | "subagent_ended";

export const END_EVENTS: readonly EndEvent[] = [
  "session_closed",
  "session_deleted",
  "process_died",
  "run_ended",
  "subagent_ended",
];

export interface Reported {
  how: Stop;
  why: string;
  ended: string[];
}

const NOT_CURRENT = "ws_token_not_current";

/** The end event by the socket's token; `fallback` — the path before the route, called once. */
export async function reportEnd(
  socketUrl: string,
  event: EndEvent,
  session: string | null = null,
  fallback: () => Promise<Reported> = () => stopBySocket(socketUrl),
): Promise<Reported> {
  const token = new URL(socketUrl).pathname.split("/channel/ws/")[1];
  if (!token) return { how: "absent", why: "no token in the socket address", ended: [] };
  let res: Response;
  try {
    res = await namedFetch(`${apiBase(socketUrl)}/channel/ws/${token}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, ...(session ? { session_id: session } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    return { how: "unknown", why: (e as Error).message, ended: [] };
  }
  const body = (await res.text().catch(() => "")).trim();
  const why = `${res.status} ${body.slice(0, 120)}`;
  if (res.ok) {
    log(`the end (${event}) reported by the socket's token: ${why}`);
    return { how: "stopped", why, ended: endedOf(body) };
  }
  const rule = res.status === 404 ? ruleOf(body) : null;
  if (rule === NOT_CURRENT) return { how: "moved", why, ended: [] };
  if (res.status !== 405 && (res.status !== 404 || rule)) return { how: "unknown", why, ended: [] };
  log(`no end-event route on this api (${why}) — the end (${event}) goes the former way, once`);
  return fallback();
}
