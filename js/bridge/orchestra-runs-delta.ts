// A tact owns its delta, not the registry read before its awaits (#9256).
import type { Run } from "./orchestra-runs.ts";

type Runs = Record<string, Run>;
const snapshots = new WeakMap<Runs, { authDir: string; rows: Runs }>();

/** Retain the caller's view, not latest: a second write must not replay untouched stale fields. */
export function rememberRuns(authDir: string, runs: Runs, existingOnly = false): Runs {
  if (existingOnly && snapshots.get(runs)?.authDir !== authDir) return runs;
  snapshots.set(runs, { authDir, rows: structuredClone(runs) });
  return runs;
}

/** A replacement launch at the same key must never inherit another client's close. */
export const runIdentity = (r: Run): string =>
  JSON.stringify([
    r.realm,
    r.room,
    r.invite,
    r.standing_id,
    r.terminal,
    r.runtime,
    r.harness,
    r.at,
  ]);

/** Plain, untracked records still mean explicit replacement; readRuns snapshots mean a delta. */
export function mergeRuns(authDir: string, runs: Runs, latest: Runs): Runs {
  const snapshot = snapshots.get(runs);
  if (!snapshot || snapshot.authDir !== authDir) return runs;
  const base = snapshot.rows;
  const merged = { ...latest };
  for (const key of new Set([...Object.keys(base), ...Object.keys(runs)])) {
    const before = base[key],
      after = runs[key],
      current = latest[key];
    if (!before) {
      if (after && !current) merged[key] = structuredClone(after);
      continue;
    }
    // A deleted or replaced identity cannot receive any old transition, patch or deletion.
    if (!current || runIdentity(current) !== runIdentity(before)) continue;
    if (!after) {
      delete merged[key];
      continue;
    }
    const row = { ...current };
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const k = field as keyof Run;
      if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
      if (after[k] === undefined) delete row[k];
      else Object.assign(row, { [k]: after[k] });
    }
    if (runIdentity(after) !== runIdentity(before)) delete row.closed;
    merged[key] = row;
  }
  return merged;
}
