// The plugin's ritual hooks in Claude Code (hooks/hooks.json; graph @nks/nks-dev, node #9319,
// section RITUALS): one entry for every event it is wired to. SessionStart — the start word with
// the cover's addresses; PostToolUse of Bash — the push and merge words by outcome
// (shared/ritualjudge.ts). Switched on by the cover of the session's repository
// (shared/ritualcover.ts); a kind the repository's own settings hold on this event's source or
// tool (hookkinds.ts, by matcher) keeps it silent there — no word twice, none lost. The memory guard stays the repository's hook: a plugin hook's blocking
// exit was not observed on the carrier. After a compaction the onboarding hook speaks, not this.
// Local reads only; always exit 0.
import { readFileSync } from "node:fs";

import { PREPARE, RITES } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { ritualCover, startCarried } from "../shared/ritualcover.ts";
import { merged, pushed } from "../shared/ritualjudge.ts";
import { standingRites } from "./hookkinds.ts";

interface HookInput {
  hook_event_name?: unknown;
  source?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: { command?: unknown };
  tool_response?: unknown;
}

function hookInput(): HookInput {
  try {
    if (!process.stdin.isTTY) return (JSON.parse(readFileSync(0, "utf8")) as HookInput) ?? {};
  } catch {
    /* no input or not JSON */
  }
  return {};
}

/** What the call printed: stdout and stderr of the harness's answer, or its text. */
function printed(r: unknown): { output: string; exit: number | null } {
  if (!r || typeof r !== "object") return { output: String(r ?? ""), exit: null };
  const o = r as { stdout?: unknown; stderr?: unknown; exit_code?: unknown };
  const exit = typeof o.exit_code === "number" ? o.exit_code : null;
  return { output: `${String(o.stdout ?? "")}\n${String(o.stderr ?? "")}`, exit };
}

/** The words this event calls for in the session's repository. */
function riteWords(input: HookInput, dir: string): string[] {
  const cover = ritualCover(dir);
  if (!cover) return [];
  const event = input.hook_event_name;
  if (event === "SessionStart") {
    const source = typeof input.source === "string" ? input.source : "startup";
    if (source === "compact" || !startCarried(cover)) return [];
    if (standingRites(cover.root, source).has("hook.start")) return [];
    return [words(PREPARE).start({ graph: cover.graph, holon: cover.holon, role: cover.role })];
  }
  if (event !== "PostToolUse" || input.tool_name !== "Bash") return [];
  const own = standingRites(cover.root, "Bash");
  const call = {
    command: String(input.tool_input?.command ?? ""),
    ...printed(input.tool_response),
  };
  const said: string[] = [];
  if (!own.has("hook.push") && pushed(call, dir)) said.push(words(RITES).push());
  if (!own.has("hook.merge") && merged(call)) said.push(words(RITES).merge(cover.holon));
  return said;
}

try {
  const input = hookInput();
  const dir =
    typeof input.cwd === "string" && input.cwd
      ? input.cwd
      : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const said = riteWords(input, dir);
  if (said.length) {
    const hookEventName = String(input.hook_event_name);
    const additionalContext = said.join("\n\n");
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`,
    );
  }
} catch {
  /* a hook never fails the session */
}
process.exitCode = 0;
