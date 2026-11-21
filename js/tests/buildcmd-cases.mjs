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
  ["make test 2>&1 | tail -5", "make test 2>&1"],
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
];
