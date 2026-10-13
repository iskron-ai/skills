// Read-only local records: a file alone is not a live seat (#7494, graph @nks/nks-dev).
import { readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import { readFallbacks } from "../bridge/fallback.ts";
import { keyOf } from "../bridge/holdrecord.ts";
import { record, text } from "../shared/snapshot.ts";
import { socketPathOf } from "../shared/standings.ts";

export interface DiskPlace {
  name: string;
  realm: string;
  karta: string | number;
  left: boolean;
  kind: "record";
}
export interface FallbackSnapshot {
  pid: number;
  build: string;
  cwd: string;
}
const answers = (path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect(path);
    const done = (alive: boolean): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(alive);
    };
    const timer = setTimeout(() => done(false), 250);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
export async function diskPlaces(authDir: string): Promise<DiskPlace[]> {
  const dir = join(authDir, "standings");
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith(".hold"))
      .sort();
  } catch {
    return [];
  }
  const rows = await Promise.all(
    names.map(async (n) => {
      try {
        const p = record(JSON.parse(readFileSync(join(dir, n), "utf8")));
        if (!text(p.name) || !text(p.realm) || !["string", "number"].includes(typeof p.karta))
          return null;
        const key = text(p.key) || keyOf(text(p.realm), p.karta as string | number, text(p.name));
        if (await answers(socketPathOf(authDir, key))) return null;
        return {
          name: text(p.name),
          realm: text(p.realm),
          karta: p.karta as string | number,
          left: p.left === true,
          kind: "record" as const,
        };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((p): p is DiskPlace => p !== null);
}
export const fallbackSnapshot = (authDir: string): FallbackSnapshot[] =>
  readFallbacks(authDir).map((f) => ({ pid: f.pid, build: text(f.build), cwd: text(f.cwd) }));
