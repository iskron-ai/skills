// Read-only recipe planner (graph @nks/nks-dev, nodes #9959, #9960, #9966).
// NEVER invokes agent launch: this checks argv against Orca's declared schema only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

function text(x) {
  if (typeof x !== "string" || !x.trim() || /[\r\n\0]/.test(x)) throw new Error("invalid text");
  return x.trim();
}
export function plan(snapshot, mappings, schema, version) {
  if (version !== "1.4.242") throw new Error("Orca version has not been observed for this recipe");
  if (snapshot?.schema_version !== 1 || snapshot.complete !== true || !Array.isArray(snapshot.start))
    throw new Error("a complete version 1 snapshot is required");
  if (!Array.isArray(mappings)) throw new Error("mapping must be an array");
  const launch = schema?.commands?.find((x) => x.command === "agent launch");
  if (!launch || !["agent", "worktree", "prompt", "model", "json"].every((f) => launch.flags?.includes(f)))
    throw new Error("Orca does not declare the required launch flags");
  const seen = new Set();
  const plans = snapshot.start.map((row, index) => {
    try {
      const repository = text(row.repository);
      const hits = mappings.filter((m) => m.repository === repository);
      if (hits.length !== 1) throw new Error("repository needs exactly one project mapping");
      const m = hits[0];
      const worktree = text(m.worktree);
      if (!isAbsolute(worktree)) throw new Error("worktree mapping must be an absolute path");
      const realm = text(row.realm);
      const room = text(row.room);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(room))
        throw new Error("the invitation requires its room UUID, not a case number");
      if (!Number.isSafeInteger(row.karta) || row.karta <= 0 || !Number.isSafeInteger(row.invite) || row.invite <= 0)
        throw new Error("invalid role or invite");
      const key = JSON.stringify([realm, room, row.invite]);
      if (seen.has(key)) throw new Error("duplicate invitation");
      seen.add(key);
      const spawnedFor = { invite: row.invite, room };
      // The pair and a short brief on one line (#9969): a multi-line or long --prompt the
      // terminal turns into a paste that is never sent (#9966). The root takes the seat by the
      // spawned_for pair; the brief never asks for a second stand (№4050 [55]).
      const prompt = `spawned_for: ${JSON.stringify(spawnedFor)} ` +
        `Already taken for invite ${row.invite}, role #${row.karta}: ` +
        `iskron_case(action="join", realm="${realm}", room="${room}") first.`;
      return {
        repository, spawned_for: spawnedFor,
        command: "orca",
        argv: ["agent", "launch", "--agent", text(m.agent), "--worktree", `path:${worktree}`,
          "--model", text(m.model), "--prompt", prompt, "--json"],
      };
    } catch {
      throw new Error(`start[${index}] refused: explicit repository mapping and valid role/invite are required`);
    }
  });
  return { orca_version: version, dry_run: true, executed: false, launch_verified: false,
    prerequisite: "spawned_for binding and joined must be supported and verified before execution", plans };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [snapshot, mapping, ...extra] = process.argv.slice(2);
    if (!snapshot || !mapping || extra.length) throw new Error("usage: node scripts/orca-demands-plan.mjs snapshot.json mapping.json");
    const options = { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true };
    const version = execFileSync("orca", ["--version"], options).trim();
    const schema = JSON.parse(execFileSync("orca", ["agent-context", "--json"], options));
    const json = (path) => JSON.parse(readFileSync(path, "utf8"));
    process.stdout.write(JSON.stringify(plan(json(snapshot), json(mapping), schema, version), null, 2) + "\n");
  } catch (error) {
    const row = /^start\[\d+\] refused:/.exec(error?.message ?? "")?.[0];
    process.stderr.write(`Orca plan refused${row ? ` (${row})` : ""}: check the complete snapshot, mapping and observed CLI version/schema. Nothing was launched.\n`);
    process.exitCode = 1;
  }
}
