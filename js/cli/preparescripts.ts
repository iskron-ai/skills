// Hooks of `prepare` carried out to a script (graph @nks/nks-dev, node #9331): a command that calls
// a file is known by the file's text; one whose file is missing or says nothing known stays opaque,
// and prepare writes nothing beside it — the model reads it and decides.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const SCRIPT = /\.(sh|bash|zsh|js|cjs|mjs|ts|py|rb|pl)$/;
const PROJECT = /\$\{?CLAUDE_PROJECT_DIR\}?/g;

/** The files a command calls, as the harness would run it from the repository root. */
export function scriptsOf(root: string, command: string): string[] {
  return command
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, ""))
    .filter((t) => SCRIPT.test(t) || t.includes("CLAUDE_PROJECT_DIR"))
    .map((t) => t.replace(PROJECT, root))
    .map((t) => (isAbsolute(t) ? t : join(root, t)));
}

/** The text of the file, or "" when it cannot be read. */
function text(path: string): string {
  try {
    return existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

/** Whether the command, or a file it calls, reads as a hook of this kind. */
export function knownHook(root: string, command: string, known: (c: string) => boolean): boolean {
  return known(command) || scriptsOf(root, command).some((p) => known(text(p)));
}

/** Whether the command calls a file at all: then its kind cannot be told from the command. */
export const opaque = (root: string, command: string): boolean =>
  scriptsOf(root, command).length > 0;
