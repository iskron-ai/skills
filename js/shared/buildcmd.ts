// The build commands refused on a nearly full disk — one list for OpenCode and Claude Code
// (graph @nks/nks-dev, node #11288). Everything else, cleanup included (rm, git worktree remove,
// cargo clean, make clean, du, df), is never refused: it is how the disk is cleared. The line is
// read by shellwords.ts; prefixes (env, nice, time, command, exec, nohup) and assignments are
// looked through with their own options; a flag's value is skipped in every form it takes.
import { shellCommands } from "./shellwords.ts";

const set = (...s: string[]): ReadonlySet<string> => new Set(s);

/** A prefix's options: the ones taking the next word, the one whose value is the command (env
 * -S), the ones that make it name rather than run (command -v). Any other flag stands alone. */
interface Prefix {
  valued: ReadonlySet<string>;
  split?: ReadonlySet<string>;
  names?: ReadonlySet<string>;
}
const PREFIXES: Readonly<Record<string, Prefix>> = {
  env: { valued: set("-u", "--unset", "-C", "--chdir"), split: set("-S", "--split-string") },
  nice: { valued: set("-n", "--adjustment") },
  time: { valued: set("-o", "--output", "-f", "--format") },
  command: { valued: set(), names: set("-v", "-V") },
  exec: { valued: set("-a") },
  nohup: { valued: set() },
};
/** Words of the shell's grammar before a command: `if make; then`, `! make`, `{ make; }`. */
const RESERVED = set("!", "{", "}", "if", "then", "else", "elif", "do", "while", "until");
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A flag and its value when written in the one word: `--flag=value`, `-Xvalue`. */
function split(o: string, takes: (name: string) => boolean): [string, string | undefined] {
  const eq = o.indexOf("=");
  if (o.startsWith("--") && eq > 0) return [o.slice(0, eq), o.slice(eq + 1)];
  if (!o.startsWith("--") && o.length > 2 && takes(o.slice(0, 2)))
    return [o.slice(0, 2), o.slice(2)];
  return [o, undefined];
}

/** The command under its prefixes and assignments; [] when it only names a program. */
function unwrap(words: string[]): string[] {
  let w = words;
  for (;;) {
    const head = w[0] ?? "";
    if (ASSIGN.test(head) || RESERVED.has(head)) {
      w = w.slice(1);
      continue;
    }
    const p = PREFIXES[head.split("/").pop() ?? ""];
    if (!p) return w;
    w = w.slice(1);
    while ((w[0] ?? "").startsWith("-") && w[0] !== "-") {
      const o = w[0] ?? "";
      if (o === "--") {
        w = w.slice(1);
        break;
      }
      const [name, value] = split(o, (n) => p.valued.has(n) || !!p.split?.has(n));
      if (p.names?.has(name)) return [];
      if (p.split?.has(name)) {
        const command = value ?? w[1] ?? "";
        w = [...command.split(/\s+/).filter(Boolean), ...w.slice(value === undefined ? 2 : 1)];
        break;
      }
      w = w.slice(value === undefined && p.valued.has(name) ? 2 : 1);
    }
    if (w[0] === "-") w = w.slice(1); // env's `-` is -i
  }
}

/** The words that are not flags, a flag's value (any form) left out with it. */
function positionals(words: string[], valued: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "";
    if (!w.startsWith("-") || w === "-") out.push(w);
    else if (split(w, (n) => valued.has(n))[1] === undefined && valued.has(w)) i++;
  }
  return out;
}

const CARGO = set("build", "test", "check", "clippy", "run", "bench");
const NODE_PM = set("ci", "install", "i", "test", "build");
const CLEAN = set("clean", "distclean", "mostlyclean");
const PM_VALUED: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: set("--prefix", "-C", "-w", "--workspace"),
  pnpm: set("-C", "--dir", "--filter", "-F"),
  yarn: set("--cwd"),
};
const MAKE_VALUED = set(
  ...["-C", "--directory", "-f", "--file", "--makefile", "-I", "--include-dir"],
  ...["-o", "--old-file", "--assume-old", "-W", "--what-if", "--new-file", "--assume-new"],
  ...["-E", "--eval"],
);
/** -j and -l take a number, attached or as the next word (`-l 0.5`, `-j8`, `--load-average=2`). */
const MAKE_NUMERIC = set("-j", "-l");
const MAKE_NUMERIC_LONG = set("--jobs", "--load-average", "--max-load");
const NUMBER = /^(?:\d+\.?\d*|\.\d+)$/;

/** make's targets: a flag's value is left out, a number only right after -j or -l (alone they
 * mean no limit, so the next word is theirs only when it is a number); an assignment is a
 * variable. Anywhere else a number is a target. */
function makeTargets(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] ?? "";
    const numeric = MAKE_NUMERIC.has(w) || MAKE_NUMERIC_LONG.has(w);
    if (!w.startsWith("-") || w === "-") out.push(w);
    else if (MAKE_VALUED.has(w) || (numeric && NUMBER.test(words[i + 1] ?? ""))) i++;
  }
  return out.filter((t) => !ASSIGN.test(t));
}

/** make's short flags run together, as getopt reads them: `-sC js` is -s and -C js. */
function getopt(words: string[]): string[] {
  return words.flatMap((w) => {
    if (!/^-[^-]./.test(w)) return [w];
    const out: string[] = [];
    for (let k = 1; k < w.length; k++) {
      const f = `-${w.charAt(k)}`;
      if (MAKE_VALUED.has(f) || MAKE_NUMERIC.has(f)) return [...out, f + w.slice(k + 1)];
      out.push(f);
    }
    return out;
  });
}
const CARGO_VALUED = set("--manifest-path", "--config", "-Z", "--color", "-C");
const DOCKER_VALUED = set("-H", "--host", "-c", "--context", "--config", "-l", "--log-level");

function heavy(words: string[]): boolean {
  const program = (words[0] ?? "").split("/").pop() ?? "";
  const args = words.slice(1);
  switch (program) {
    case "cargo":
      return CARGO.has(positionals(args, CARGO_VALUED)[0] ?? "");
    case "make":
    case "gmake": {
      const targets = makeTargets(getopt(args));
      return !targets.every((t) => CLEAN.has(t)) || !targets.length;
    }
    case "npm":
    case "pnpm":
    case "yarn": {
      const [sub = "", script = ""] = positionals(args, PM_VALUED[program] ?? set());
      return NODE_PM.has(sub) || ((sub === "run" || sub === "run-script") && NODE_PM.has(script));
    }
    case "go":
      return set("build", "test").has(positionals(args, set("-C"))[0] ?? "");
    case "docker": {
      const [sub = "", then = ""] = positionals(args, DOCKER_VALUED);
      return sub === "build" || (set("buildx", "image", "builder").has(sub) && then === "build");
    }
    default:
      return false;
  }
}

/** The first build command of a shell line, as its words, or null. */
export function buildCommand(line: string): string | null {
  for (const words of shellCommands(line)) if (heavy(unwrap(words))) return words.join(" ");
  return null;
}
