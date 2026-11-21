// Heavy work is refused on a nearly full disk (graph @nks/nks-dev, node #11288): a subagent
// (the subagent tool) and a shell build command (shared/buildcmd.ts) throw the refusal word before
// they run; the volume is that of the session's directory. Any other call passes.
import { buildCommand } from "../shared/buildcmd.ts";
import { callRefusal } from "../shared/diskfloor.ts";
import { sessionDirectory } from "./host.ts";
import type { Context } from "./plugin.ts";

/** The subagent tool: `subagent` in OpenCode 2 (its tool renderer), `task` before. */
const SUBAGENT = new Set(["subagent", "task"]);
const SHELL = new Set(["shell", "bash"]);

export async function setupDiskFloor(ctx: Context): Promise<void> {
  const loc = (ctx as { location?: { directory?: unknown } }).location;
  const own = typeof loc?.directory === "string" && loc.directory ? loc.directory : null;
  await ctx.tool.hook("execute.before", async (t) => {
    const shell = SHELL.has(t.tool);
    const command = String((t.input as { command?: unknown } | null)?.command ?? "");
    if (shell ? !buildCommand(command) : !SUBAGENT.has(t.tool)) return;
    const dir = (await sessionDirectory(ctx, String(t.sessionID))) ?? own;
    const word = callRefusal(dir, shell ? { shell: command } : { subagent: true });
    if (word) throw new Error(word);
  });
}
