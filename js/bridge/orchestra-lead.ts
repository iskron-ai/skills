// The leading half of one tact (graph @nks/nks-dev, nodes #7513, #5042, #9957; decisions of
// case №4050): fold the raised tape into the registry, read the complete demands snapshot, settle
// closed stops, extinguish empty compositions of our own launches, raise what the human's
// launcher descriptions answer. An incomplete snapshot acts on nothing; without the machine's
// consent nothing is raised or extinguished.
import { ORCHESTRA, type OrchestraWords } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { readDemands } from "./orchestra-demands.ts";
import { readLaunchers } from "./orchestra-launchers.ts";
import { expireLaunches, foldTape, quench, settleStops } from "./orchestra-quench.ts";
import { raiseRows } from "./orchestra-raise.ts";
import { readRuns, writeRuns } from "./orchestra-runs.ts";
import { readTape, type TactAct } from "./orchestra-tact.ts";

const w = (): OrchestraWords => words(ORCHESTRA);

export function leadAct(
  authDir: string,
  base: string,
  token: string,
  mcpUrl: string,
  admitted: boolean,
): TactAct {
  return async (reads, boundary, gone) => {
    if (!admitted) return [w().leadNotAdmitted()];
    const runs = readRuns(authDir);
    for (const r of reads) foldTape(r.realm, r.signals as Record<string, unknown>[], runs);
    const said = expireLaunches(runs);
    try {
      const demands = await readDemands(base, token, boundary, boundary);
      if (!demands.complete) {
        said.push(
          w().leadIncomplete(demands.errors.map((e) => `${e.source}:${e.code}`).join(", ")),
        );
        return said;
      }
      settleStops(runs, demands.stop, boundary);
      const cursorOf = (realm: string): string | null =>
        reads.find((r) => r.realm === realm)?.cursor ?? null;
      said.push(
        ...(await quench(
          base,
          token,
          runs,
          (realm) => readTape(base, token, realm, cursorOf(realm)),
          gone,
        )),
      );
      if (gone?.gone) return said;
      let launchers;
      try {
        launchers = await readLaunchers(mcpUrl, token);
      } catch (e) {
        said.push(w().leadNoLaunchers((e as Error).message));
        return said;
      }
      for (const r of launchers.refused) said.push(w().leadDescription(r.what, r.code));
      said.push(...(await raiseRows(authDir, demands.start, launchers, runs, gone)));
      return said;
    } finally {
      writeRuns(authDir, runs);
    }
  };
}
