.PHONY: check deps validate check-bundles check-surface lint format format-check typecheck test test-coverage test-watchdog test-extension test-codex build build-js check-js surface hooks plugin

# Run the full CI gate locally: frontmatter contract + bundle sync + surface lint
# + the JS ladder (lint → format → types → shipped outputs in sync → the
# behavioural suites of the shipped code). Needs `make deps` once per clone.
check: validate check-bundles check-surface lint format-check typecheck check-js test

# The dev toolchain for js/ — typescript, esbuild, eslint, prettier, and pi's
# own types, which the extension is checked against. Nothing here ships: the
# outputs under skills/ and extensions/ are dependency-free single files.
deps:
	@npm ci --no-fund --no-audit

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
	@npm run -s lint

format:
	@npm run -s format

format-check:
	@npm run -s format:check

# Strict TypeScript over every source, the pi extension against pi's real types.
typecheck:
	@npm run -s typecheck

# Every behavioural suite, on one floor: the shipped file claims Node 22 (it
# takes the global WebSocket), and CI holds the run there so the claim stays
# proven. Suites run against the BUILT outputs — run `make build-js` first, or
# `make check-js` to be told they are stale.
test:
	@node --test js/tests/*.test.mjs

test-coverage:
	@node --test --experimental-test-coverage js/tests/*.test.mjs

# One suite at a time, for the red-probe discipline (see AGENTS.md).
test-watchdog:
	@node --test js/tests/watchdog.test.mjs

test-extension:
	@node --test js/tests/extension.test.mjs

# Probe for the Codex delivery — the plugin manifest and the repo marketplace.
# Its heavy half runs Codex's own on-disk ingestion validator, which needs
# python3 with pyyaml and a machine where Codex is installed; without either it
# skips by name and the structural half still runs.
test-codex:
	@node --test js/tests/codex-plugin.test.mjs

# Build the shipped JS from js/: one file for the bridge, both watchdogs and
# doctor (into both skills that carry it), the pi extension, and the roadmap
# template with its renderer inlined. Outputs are committed derived artifacts.
build-js:
	@node scripts/build-js.mjs

# Verify the committed outputs are byte-identical to a fresh build from js/.
check-js:
	@node scripts/build-js.mjs --check

# Refresh fixtures/surface.json from the live server (network + authorized grant).
surface:
	@node scripts/export-surface.mjs

# Regenerate every committed derived artifact: the shipped JS, then the
# <name>.skill bundles that carry it.
build: build-js
	@bash scripts/build-skills.sh

# Build the claude.ai plugin archive (dist/iskron.zip). CI attaches it to each GitHub Release.
plugin:
	@bash scripts/build-plugin.sh

# Enable the repo's pre-commit hook (lint-staged + rebuild of every derived artifact).
hooks:
	@git config core.hooksPath .githooks
	@echo "core.hooksPath -> .githooks"
