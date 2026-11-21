// The build commands refused on a nearly full disk — one list for OpenCode and Claude Code
// (graph @nks/nks-dev, node #11288). Everything else, cleanup included (rm, git worktree remove,
// cargo clean, make clean, du, df), is never refused: it is how the disk is cleared.

/** Flags whose value is the next word, before a package manager's or make's subcommand. */
const VALUED = new Set(["--prefix", "-C", "--dir", "--filter", "-w", "--workspace", "-f"]);

const CARGO = new Set(["build", "test", "check", "clippy", "run", "bench"]);
const NODE_PM = new Set(["ci", "install", "i", "test", "build"]);
const CLEAN = new Set(["clean", "distclean", "mostlyclean"]);

/** The words after the program, flags (and their values) left out. */
function args(words: string[]): string[] {
  const out: string[] = [];
  let skip = false;
  for (const w of words) {
    if (skip) skip = false;
    else if (VALUED.has(w)) skip = true;
    else if (!w.startsWith("-") && !w.startsWith("+")) out.push(w);
  }
  return out;
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PREFIX = new Set(["env", "time", "nice", "command", "exec"]);

function heavy(words: string[]): boolean {
  while (words.length && (ASSIGN.test(words[0] ?? "") || PREFIX.has(words[0] ?? "")))
    words = words.slice(1);
  const program = (words[0] ?? "").split("/").pop() ?? "";
  const rest = args(words.slice(1));
  switch (program) {
    case "cargo":
      return CARGO.has(rest[0] ?? "");
    case "make":
    case "gmake": {
      const targets = rest.filter((t) => !t.includes("="));
      return !targets.length || !targets.every((t) => CLEAN.has(t));
    }
    case "npm":
    case "pnpm":
    case "yarn":
      return (
        NODE_PM.has(rest[0] ?? "") ||
        (rest[0] === "run" && (rest[1] === "build" || rest[1] === "test"))
      );
    case "go":
      return rest[0] === "build" || rest[0] === "test";
    case "docker":
      return rest[0] === "build";
    default:
      return false;
  }
}

/** The first build command of a shell line (split at &&, ||, ;, |, newlines), or null. */
export function buildCommand(line: string): string | null {
  for (const part of line.split(/&&|\|\||[;|\n]/)) {
    const words = part.trim().replace(/^\(+/, "").split(/\s+/).filter(Boolean);
    if (words.length && heavy(words)) return part.trim();
  }
  return null;
}
