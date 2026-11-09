// The raising half of the tact (graph @nks/nks-dev, nodes #5042, #7517, #9968–#9970, #4920;
// decisions of case №4050): a start row of a complete demands snapshot is raised only when its
// invite's attrs name one of this machine's launchers, a harness the launcher offers and the
// adapter knows, and a model the launcher allows; the checkout is the launcher's explicit one.
// Anything else is an outcome said aloud, nothing launched. The invite is taken by the raised
// agent's own registration with spawned_for (its first brief line) — not here; the registry
// row is written before the launch, so a crash never launches twice.
import { existsSync, statSync } from "node:fs";

import { ORCHESTRA, type OrchestraWords } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import type { Launchers } from "./orchestra-launchers.ts";
import { launchArgv, orcaLaunch, orcaReady } from "./orchestra-orca.ts";
import { LIVE, type Run, runKey, writeRuns } from "./orchestra-runs.ts";

const w = (): OrchestraWords => words(ORCHESTRA);
/** Harnesses whose launch carries spawned_for in the first brief line (the OpenCode plugin). */
const ADAPTER_HARNESSES = new Set(["opencode"]);

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Why this row is not raised, or null — or "other": another machine's launcher, not ours to say. */
function refusal(row: Row, ls: Launchers, runs: Record<string, Run>): string | null {
  const launcher = text(row.launcher);
  if (!launcher) return "launcher_missing";
  const own = ls.own.get(launcher);
  if (!own) {
    const broken = ls.refused.find((r) => r.what === launcher);
    if (broken) return broken.code;
    return ls.known.has(launcher) ? "other" : "launcher_unknown";
  }
  const harness = text(row.harness);
  if (!harness) return "harness_missing";
  const offer = own.harnesses[harness];
  if (!offer) return "harness_not_offered";
  if (!ADAPTER_HARNESSES.has(harness)) return "harness_unsupported";
  const model = text(row.model);
  if (!model) return "model_missing";
  if (!offer.models.includes(model)) return "model_not_offered";
  const repository = text(row.repository);
  const worktree = repository ? own.checkouts[repository] : undefined;
  if (!worktree) return "no_checkout";
  if (!existsSync(worktree) || !statSync(worktree).isDirectory()) return "checkout_absent";
  const live = Object.values(runs).filter(
    (r) => r.launcher === launcher && LIVE.includes(r.state),
  ).length;
  if (live >= own.limit) return "limit_reached";
  return null;
}

/** Raise what the snapshot asks of this machine; the outcomes as words, one per row said. */
export async function raiseRows(
  authDir: string,
  start: Row[],
  ls: Launchers,
  runs: Record<string, Run>,
): Promise<string[]> {
  const said: string[] = [];
  let ready: string | null | undefined;
  for (const row of start) {
    const realm = String(row.realm);
    const room = String(row.room);
    const invite = Number(row.invite);
    const key = runKey(realm, room, invite);
    if (runs[key]) continue;
    const why = refusal(row, ls, runs);
    if (why === "other") continue;
    if (why) {
      said.push(w().leadRow(realm, invite, why));
      continue;
    }
    ready = ready === undefined ? await orcaReady() : ready;
    if (ready) {
      said.push(w().leadRow(realm, invite, ready));
      continue;
    }
    const own = ls.own.get(String(row.launcher).trim())!;
    const harness = String(row.harness).trim();
    const run: Run = {
      realm,
      room,
      invite,
      karta: Number(row.karta),
      launcher: own.launcher,
      harness,
      model: String(row.model).trim(),
      repository: String(row.repository).trim(),
      worktree: own.checkouts[String(row.repository).trim()],
      state: "launched",
      at: new Date().toISOString(),
    };
    runs[key] = run;
    writeRuns(authDir, runs);
    // The first line is the launch basis the plugin reads (shared/spawned-for.ts firstLineSpawn).
    const prompt =
      `spawned_for: ${JSON.stringify({ invite, room })}\n` +
      w().brief(realm, run.karta, room, invite);
    const got = await orcaLaunch(
      launchArgv(own.harnesses[harness].agent, run.worktree, run.model, prompt),
    );
    if (got.outcome === "failed") {
      run.state = "refused";
      run.why = got.why;
    } else if (got.why) run.why = got.why;
    writeRuns(authDir, runs);
    said.push(
      w().leadRow(
        realm,
        invite,
        got.outcome === "failed" ? got.why! : `launched${got.why ? ` (${got.why})` : ""}`,
      ),
    );
  }
  return said;
}
