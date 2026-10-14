// The stop orders' journal on the daemon's disk (graph @nks/nks-dev, node #7510): one file per
// order beside the grant, written before any act — accepted before the stop, the outcome before
// its answer — so a repeated order gives the same outcome and an unanswered outcome is
// answered again, by this process or the next daemon.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { CFG } from "./config.ts";

export type OrderState = "accepted" | "stopped" | "failed" | "unknown" | "refused";

export interface OrderEntry {
  id: string;
  standing: string;
  state: OrderState;
  reason?: string;
  /** the api the answer goes to: the channel's origin under /api */
  base: string;
  /** the api took the answer of `state` (or said the order is closed) */
  acked: boolean;
  at: number;
}

/** A journal entry outlives any window the api keeps an order open in. */
const KEEP_MS = 24 * 3600_000;

const dir = (): string => join(CFG.authDir, "orders");
const SAFE = /^[A-Za-z0-9_-]{1,80}$/;
const fileOf = (id: string): string | null => (SAFE.test(id) ? join(dir(), `${id}.json`) : null);

export function readOrder(id: string): OrderEntry | null {
  const f = fileOf(id);
  if (!f) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as OrderEntry;
  } catch {
    return null;
  }
}

/** Written whole and renamed: a reader never meets half an entry. false — the disk refused. */
export function writeOrder(e: OrderEntry): boolean {
  const f = fileOf(e.id);
  if (!f) return false;
  try {
    mkdirSync(dir(), { recursive: true, mode: 0o700 });
    const tmp = `${f}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(e), { mode: 0o600 });
    renameSync(tmp, f);
    return true;
  } catch {
    return false;
  }
}

export const isTerminal = (s: OrderState): boolean => s !== "accepted";

/** Outcomes the api has not taken yet; entries past their term go. */
export function unanswered(now = Date.now()): OrderEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir()).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: OrderEntry[] = [];
  for (const n of names) {
    const e = readOrder(n.slice(0, -".json".length));
    if (!e) continue;
    if (now - e.at > KEEP_MS) {
      try {
        unlinkSync(join(dir(), n));
      } catch {}
      continue;
    }
    if (isTerminal(e.state) && !e.acked) out.push(e);
  }
  return out;
}
