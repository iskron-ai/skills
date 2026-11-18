// The push and merge lines of a dsh session (graph @nks/nks-dev, node #11071): after a call of
// dsh's shell tool the outcome is judged by the rule OpenCode's and Claude Code's deliveries use
// (shared/ritenotes.ts, shared/ritualjudge.ts) — a visible refusal vetoes, a quiet push is judged
// by git's state in the session's directory, a push of tags only wakes nothing — and the lines
// reach the live session as one next-turn message (plugin.ts). The call's form — exec.name
// "bash", exec.arguments.command, a foreground result.value with exitCode, stdout.text and
// stderr.text — is read from the types and code of the installed @deepseek-ai/dsh 0.2.2-rc.1
// (dsh-tools events.d.ts, dsh-tool-bash), not observed live.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK objects without a schema */
import { shellNotes } from "../shared/ritenotes.ts";
import { ritualCover } from "../shared/ritualcover.ts";
import type { ShellCall } from "../shared/ritualjudge.ts";

/** dsh's shell tools by their model-facing name. */
const SHELLS = new Set<unknown>(["bash"]);

const textOf = (s: any): string => (typeof s?.text === "string" ? s.text : "");

/** The shell call a finished tool call shows; another tool, a failure, a background job — null. */
export function shellCall(exec: any, result: any): ShellCall | null {
  if (!SHELLS.has(exec?.name) || !result || result.isError) return null;
  const command: unknown = exec?.arguments?.command;
  const v = result.value;
  if (typeof command !== "string" || !v || typeof v !== "object") return null;
  if (v.kind !== undefined && v.kind !== "foreground") return null; // still running: no outcome
  const exit = typeof v.exitCode === "number" ? v.exitCode : null;
  return { command, output: `${textOf(v.stdout)}\n${textOf(v.stderr)}`, exit };
}

/** The lines the call calls for in the session's directory dir; none — null. */
export function riteLines(exec: unknown, result: unknown, dir: string): string | null {
  const call = shellCall(exec, result);
  const cover = call ? ritualCover(dir) : null;
  if (!call || !cover) return null;
  return shellNotes(cover, call, dir).join("\n\n") || null;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
