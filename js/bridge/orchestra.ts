// The daemon's orchestration: the flag and the named graph boundary (graph @nks/nks-dev,
// nodes #7513, #7514, #8202). The daemon is the owner of runs: the flag lives in its hand and
// persists next to the grant, so a restarted daemon keeps it. The door these ops ride is
// orchestra-door.ts; this file is what they mean. Enabling needs the machine's consent: the
// daemon's own environment admits the orchestrator, and without it the enabling is refused
// aloud, the flag untouched. The tact (`step`) and the run registry arrive with the queue wire.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { envName, ORCHESTRA, type OrchestraWords } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { seamRunDir } from "../shared/seam-entrance.ts";
import type { OrchestraServe } from "./orchestra-door.ts";

const w = (): OrchestraWords => words(ORCHESTRA);

/** The machine's consent: the daemon's environment admits the raising of agents. */
export const ORCHESTRA_ENV = envName("ORCHESTRA");
export const orchestraAdmitted = (): boolean => {
  const v = process.env[ORCHESTRA_ENV]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
};

export interface OrchestraFlag {
  on: boolean;
  realms: string[];
}
const flagFile = (authDir: string): string => join(seamRunDir(authDir), "orchestra.json");

/** The flag as it lies next to the grant; null — none lies (a daemon never wrote one). */
export function readOrchestraFlag(authDir: string): OrchestraFlag | null {
  try {
    const f = JSON.parse(readFileSync(flagFile(authDir), "utf8")) as {
      on?: unknown;
      realms?: unknown;
    };
    if (f.on !== true && f.on !== false) return null;
    if (!Array.isArray(f.realms) || f.realms.some((x) => typeof x !== "string")) return null;
    return { on: f.on, realms: f.realms as string[] };
  } catch {
    return null;
  }
}

function writeOrchestraFlag(authDir: string, flag: OrchestraFlag): void {
  mkdirSync(seamRunDir(authDir), { recursive: true, mode: 0o700 });
  writeFileSync(flagFile(authDir), JSON.stringify({ on: flag.on, realms: flag.realms }) + "\n", {
    mode: 0o600,
  });
}

/**
 * The daemon's answers of the door's ops. `on` extends the named boundary — the human adds
 * graphs; `off` clears it; `status` reads what lies. The discovered half of the boundary (the
 * graphs of the machine's live agents) is not kept in the flag: the daemon reads it from its
 * sessions when it reads the queue.
 */
export function orchestraServe(authDir: string): OrchestraServe {
  return async (op, realms) => {
    if (op === "on") {
      if (!orchestraAdmitted()) return { ok: false, said: w().notAdmitted() };
      const prior = readOrchestraFlag(authDir);
      const named = [...new Set([...(prior?.on ? prior.realms : []), ...realms])];
      writeOrchestraFlag(authDir, { on: true, realms: named });
      return { ok: true, said: w().on(named.join(", ")) };
    }
    if (op === "off") {
      writeOrchestraFlag(authDir, { on: false, realms: [] });
      return { ok: true, said: w().off() };
    }
    const flag = readOrchestraFlag(authDir);
    return {
      ok: true,
      said: w().status(!!flag?.on, flag?.realms.join(", ") ?? ""),
    };
  };
}
