// `stop <seat|session id>`: a human puts down an agent of this machine by its seat (graph
// @nks/nks-dev, nodes #7518, #5085; the order's contract — case №669). The seat comes from the
// daemon's snapshot, the api from its hold record, the key is the bridge's. A stop order
// first (api 0.122+); an api without the route (404) — the seat is revoked instead.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { CFG, parseArgs, setConfig } from "../bridge/config.ts";
import { keyOf } from "../bridge/holdrecord.ts";
import { loadStore } from "../bridge/store.ts";
import { envName, STOP_CLI, type StopCliWords } from "../delivery/index.ts";
import { apiBase } from "../shared/channel.ts";
import { setLang, words } from "../shared/lang.ts";
import { type PlaceSnapshot } from "../shared/snapshot.ts";
import { defaultAuthDir, holdFilePathOf } from "../shared/standings.ts";
import { machine } from "./status.ts";

const sw = (): StopCliWords => words(STOP_CLI);
const TIMEOUT_MS = 10_000;

/** The flag's value, taken out of args. */
function take(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  return args.splice(i, 2)[1];
}

/** The seat the target names: a session id (its primary seat) or a seat name or address. */
function pick(
  sessions: { local_id: string; places: PlaceSnapshot[] }[],
  target: string,
  realm: string | undefined,
): PlaceSnapshot | string {
  const session = sessions.find((s) => s.local_id === target);
  const name = target.replace(/^@[^:]+:/, "");
  const found = session
    ? session.places.filter((p) => p.primary || session.places.length === 1)
    : sessions.flatMap((s) => s.places).filter((p) => p.name === name);
  const seats = found.filter((p) => !realm || p.realm === realm || p.realm.endsWith(`/${realm}`));
  if (!seats.length) return sw().notFound(target);
  if (seats.length > 1)
    return sw().ambiguous(target, seats.map((p) => `${p.name} (${p.realm})`).join(", "));
  return seats[0];
}

function apiOf(p: PlaceSnapshot): string | null {
  try {
    const rec = JSON.parse(
      readFileSync(holdFilePathOf(CFG.authDir, keyOf(p.realm, p.karta, p.name)), "utf8"),
    ) as { url?: unknown };
    return typeof rec.url === "string" && rec.url ? apiBase(rec.url) : null;
  } catch {
    return null;
  }
}

async function ask(
  url: string,
  method: string,
  realm: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "x-nks-realm": realm,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, text: (await res.text().catch(() => "")).slice(0, 300) };
}

/** The order (or the revoke) and its outcome in words; true — the seat goes. */
async function stopSeat(p: PlaceSnapshot, id: string, base: string, token: string) {
  const seat = `${p.name} (${p.realm})`;
  const at = `${base}/standings/${encodeURIComponent(id)}`;
  try {
    const order = await ask(`${at}/stop`, "POST", p.realm, token, {
      reason_code: "person_request",
      client_id: `stop-${randomUUID()}`,
    });
    if (order.status >= 200 && order.status < 300) {
      let orderId = "";
      try {
        const o = JSON.parse(order.text) as { id?: unknown };
        if (typeof o.id === "string") orderId = o.id;
      } catch {
        /* an answer without a body still issued the order */
      }
      return { ok: true, said: sw().ordered(seat, orderId) };
    }
    if (order.status === 410) return { ok: true, said: sw().gone(seat) };
    if (order.status !== 404)
      return { ok: false, said: sw().refused(seat, "stop", order.status, order.text) };
    const revoke = await ask(at, "DELETE", p.realm, token);
    if (revoke.status >= 200 && revoke.status < 300) return { ok: true, said: sw().revoked(seat) };
    if (revoke.status === 410) return { ok: true, said: sw().gone(seat) };
    return { ok: false, said: sw().refused(seat, "revoke", revoke.status, revoke.text) };
  } catch (e) {
    return { ok: false, said: sw().unreachable(seat, (e as Error).message) };
  }
}

export async function runStop(argv: string[]): Promise<void> {
  const args = [...argv];
  setLang(take(args, "--lang"));
  const realm = take(args, "--realm");
  const authDir =
    take(args, "--auth-dir") || process.env[envName("BRIDGE_AUTH_DIR")] || defaultAuthDir();
  const target = args.find((a) => !a.startsWith("--"));
  const fail = (text: string): void => {
    process.stderr.write(`${text}\n`);
    process.exitCode = 1;
  };
  if (!target) return fail(sw().usage().trimEnd());
  setConfig(parseArgs(["--auth-dir", authDir, ...args.filter((a) => a !== target)]));
  const snap = await machine(authDir);
  if (!snap.snapshot_available) return fail(sw().noDaemon());
  const p = pick(snap.sessions, target, realm);
  if (typeof p === "string") return fail(p);
  if (!p.standing_id) return fail(sw().noId(p.name));
  const base = apiOf(p);
  if (!base) return fail(sw().noRecord(p.name));
  const token = CFG.pat ?? loadStore().tokens?.access_token;
  if (!token) return fail(sw().noKey());
  const out = await stopSeat(p, p.standing_id, base, token);
  if (!out.ok) return fail(out.said);
  process.stdout.write(`${out.said}\n`);
}
