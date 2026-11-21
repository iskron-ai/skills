// The table of shell lines the disk floor judges (graph @nks/nks-dev, node #11288; list —
// js/shared/buildcmd.ts): below the floor each REFUSED line is refused with its build named, each
// PASSED line passes — cleanup is never refused. Shared by opencode-disk-floor.test.mjs and
// rituals-disk-floor.test.mjs, so both plugins are judged by the one table.

/** [line, the build the word names]. */
export const REFUSED = [
  ["cd js && cargo build --release", "cargo build --release"],
  ["make test", "make test"],
  ["make", "make"],
  ["npm ci", "npm ci"],
  ["pnpm run build", "pnpm run build"],
  ["go test ./...", "go test ./..."],
  ["docker build .", "docker build ."],
  ["RUSTFLAGS=-Dwarnings env CI=1 cargo clippy", "RUSTFLAGS=-Dwarnings env CI=1 cargo clippy"],
  ["npm --prefix js ci", "npm --prefix js ci"],
  ["npm --prefix=js ci", "npm --prefix=js ci"],
  ["pnpm -C js install", "pnpm -C js install"],
  ["git status && make check", "make check"],
  // a flag's value is no target, in each of its forms
  ["make --directory js", "make --directory js"],
  ["make --directory=js test", "make --directory=js test"],
  ["make -Cjs", "make -Cjs"],
  ["make -j 8", "make -j 8"],
  // a number is make's flag value only right after -j or -l; anywhere else it is a target
  ["make clean 1.2", "make clean 1.2"],
  ["make -f - clean 1.2", "make -f - clean 1.2"],
  ["make 2", "make 2"],
  ["make -j 4 clean 3", "make -j 4 clean 3"],
  ["cargo --color always build", "cargo --color always build"],
  ["go -C js build", "go -C js build"],
  // prefixes are looked through with their own options
  ["nice -n 10 cargo build", "nice -n 10 cargo build"],
  ["nice -n10 cargo build", "nice -n10 cargo build"],
  ["env -u RUSTFLAGS cargo build", "env -u RUSTFLAGS cargo build"],
  ["env -i FOO=1 cargo build", "env -i FOO=1 cargo build"],
  ["env -C js make", "env -C js make"],
  ['env -S "cargo build"', "env -S cargo build"],
  ["time -p make", "time -p make"],
  ["command -p make", "command -p make"],
  ["exec cargo build", "exec cargo build"],
  // the shell's own grammar
  ["(cd js && make)", "make"],
  ["if make test; then echo ok; fi", "if make test"],
  ["make test 2>&1 | tail -5", "make test"],
  // a redirection never decides: it leaves the command with its target, wherever it stands
  ["2>/dev/null cargo build", "cargo build"],
  ["cargo build > log 2>&1", "cargo build"],
  [">out make", "make"],
  ["2> err.log make test", "make test"],
  ["make >>build.log -j4", "make -j4"],
  ["cargo build &>/dev/null", "cargo build"],
  ["cargo build &>> log", "cargo build"],
  ["make 1>&2 check", "make check"],
  ["npm ci </dev/null", "npm ci"],
  ["make>log", "make"],
  // a backslash before a newline continues the line: the words join across it
  ["cargo \\\nbuild --release", "cargo build --release"],
  ["make \\\n-j4", "make -j4"],
  ['make "\\\ntest"', "make test"],
];

export const PASSED = [
  "cargo clean",
  "ls -la",
  "rm -rf target",
  "git worktree remove .worktrees/x",
  "du -sh .",
  "df -h",
  "make clean",
  "npm view x",
  // cleanup under a flag's value or a prefix stays cleanup
  "make --directory js clean",
  "make --directory=js clean",
  "make -Cjs clean",
  "make -C js clean distclean",
  "nice -n 10 cargo clean",
  "env -u RUSTFLAGS cargo clean",
  "time -p make clean",
  "command -v cargo",
  // a build named inside quotes or a comment is no build
  "printf 'clean; make clean'",
  "printf 'make test'",
  'echo "cargo build && make"',
  'git commit -m "fix: make test green; cargo build"',
  'grep -r "make test" .',
  "# make test",
  // cleanup under a redirection stays cleanup; a target named build is a file, not a command
  "make clean 2>&1",
  "make clean > /dev/null",
  "cargo clean &>/dev/null",
  "make clean >> log 2>&1",
  "2>/dev/null make clean",
  "echo 'make' > f",
  "echo hi > make",
  "cat < Makefile",
  "cat <<< 'make test'",
  "cat <<EOF\nmake test\ncargo build\nEOF",
  "cat <<-'END'\n\tmake test\n\tEND",
  // make's flag values — a load limit, a file, an expression — are never targets
  "make -j 4 clean",
  "make -j4 clean",
  "make --jobs 8 clean",
  "make -l 0.5 clean",
  "make -l0.5 clean",
  "make --load-average=2.5 clean",
  "make -o foo clean",
  "make -sC js clean",
  "make --eval 'X := 1' clean",
  // in single quotes a backslash and newline stay as written: one word for echo
  "echo 'a \\\nmake'",
];
