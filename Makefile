.PHONY: check deps validate check-bundles check-surface lint format format-check typecheck test test-coverage test-watchdog test-extension test-opencode test-codex test-stand test-update build build-js build-release check-js check-frozen surface widgets check-widgets hooks plugin

# Run the full CI gate locally: frontmatter contract + bundle sync + surface lint
# + the JS ladder (lint → format → types → shipped outputs in sync → the
# behavioural suites of the shipped code). Needs `make deps` once per clone.
check: validate check-bundles check-surface check-widgets lint format-check typecheck check-js check-frozen test

# The dev toolchain for js/ — typescript, esbuild, eslint, prettier, and pi's
# own types, which the extension is checked against. Nothing here ships: the
# outputs under skills/ and extensions/ are dependency-free single files. It
# lives in js/, never at the root: Claude Code runs `npm ci` on any plugin
# whose root carries a lockfile, and that would install all of this into every
# user's plugin cache.
deps:
	@cd js && npm ci --no-fund --no-audit

# Validate every skill's frontmatter contract. Pure Node, no deps.
validate:
	@node scripts/validate-skills.mjs

# Verify committed .skill bundles match their source skills/<name>/.
check-bundles:
	@bash scripts/check-bundles.sh

# Lint the corpus against the committed surface snapshot (offline, pure Node).
check-surface:
	@node scripts/check-surface.mjs

# --- the JS ladder, over js/ (the single source of every shipped executable) ---
lint:
	@cd js && npm run -s lint

format:
	@cd js && npm run -s format

format-check:
	@cd js && npm run -s format:check

# Strict TypeScript over every source, the pi extension against pi's real types.
typecheck:
	@cd js && npm run -s typecheck

# Every behavioural suite, on one floor: the shipped file claims Node 22 (it
# takes the global WebSocket), and CI holds the run there so the claim stays
# proven. Suites run against the dev build of js/ in dist/dev (js/tests/built.mjs),
# rebuilt first — the committed outputs are the release build, not this tree's.
# ISKRON_BRIDGE_NO_UPDATE: под пробами мост не выравнивает настоящий дом и не
# ходит к релизам; проба самообновления снимает выключатель сама, на подставном
# доме и подставных релизах.
test: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test --test-timeout=300000 js/tests/*.test.mjs

test-coverage: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test --test-timeout=300000 --experimental-test-coverage js/tests/*.test.mjs

# One suite at a time, for the red-probe discipline (see AGENTS.md).
test-watchdog: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test --test-timeout=120000 js/tests/standing.test.mjs

test-extension: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test js/tests/extension.test.mjs

test-opencode: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test js/tests/opencode.test.mjs

# Probes for the bridge's own tool iskron_stand and for the self-update.
test-stand: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test --test-timeout=120000 js/tests/stand.test.mjs

test-update: build-js
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test --test-timeout=120000 js/tests/update.test.mjs

# Probe for the Codex delivery — the plugin manifest and the repo marketplace.
# Its heavy half runs Codex's own on-disk ingestion validator, which needs
# python3 with pyyaml and a machine where Codex is installed; without either it
# skips by name and the structural half still runs.
test-codex:
	@ISKRON_BRIDGE_NO_UPDATE=1 node --test js/tests/codex-plugin.test.mjs

# Build the shipped JS from js/: one file for the bridge, both watchdogs and
# doctor, the OpenCode plugin, the pi extension, and the roadmap template with
# its renderer inlined — as the dev build, into dist/dev (outside the index):
# probes and live runs take it. Every install channel takes main, so the
# committed outputs are the release build, written only by build-release
# (the release job, bundle-sync), never by a working copy (#6650).
build-js:
	@node js/build.mjs

build-release:
	@ISKRON_BUILD_CHANNEL=release node js/build.mjs
	@bash scripts/build-skills.sh

# The committed outputs are the release build: no dev mark, the bridge marked release
# (the bytes of releases up to 7.2.7, unmarked, pass as their legacy).
check-js:
	@node js/build.mjs --check

# The lock on them: a branch other than the release job's must leave them as its base has them.
BASE ?= origin/main
check-frozen:
	@bash scripts/check-outputs-frozen.sh $(BASE)

# Refresh fixtures/surface.json from the live server (network + authorized grant).
surface:
	@node scripts/export-surface.mjs

# Refresh fixtures/widgets.json from the widget nodes in the graph (network + grant),
# then render skills/widgets/SKILL.md from it.
widgets:
	@node scripts/export-widgets.mjs
	@node scripts/render-widgets.mjs

# The committed widgets skill matches its snapshot (offline, pure Node).
check-widgets:
	@node scripts/render-widgets.mjs --check

# The dev build of the shipped JS, then the <name>.skill bundles from skills/
# (they carry the committed — release — outputs).
build: build-js
	@bash scripts/build-skills.sh

# Build the claude.ai plugin archive (dist/iskron.zip). CI attaches it to each GitHub Release.
plugin:
	@bash scripts/build-plugin.sh

# Enable the repo's pre-commit hook (lint-staged + rebuild of every derived artifact).
hooks:
	@git config core.hooksPath .githooks
	@echo "core.hooksPath -> .githooks"
