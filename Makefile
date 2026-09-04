.PHONY: build validate check-bundles check-surface surface check test test-watchdog hooks plugin

# Run the full CI gate locally: frontmatter contract + bundle sync + surface lint
# + the behavioural suites of the shipped code.
check: validate check-bundles check-surface test test-watchdog

# Validate every skill's frontmatter contract. Pure Node, no deps.
validate:
	@node scripts/validate-skills.mjs

# Verify committed .skill bundles match their source skills/<name>/.
check-bundles:
	@bash scripts/check-bundles.sh

# Lint the corpus against the committed surface snapshot (offline, pure Node).
check-surface:
	@node scripts/check-surface.mjs

# Behavioural tests for the bundled bridge, against a local fake NKS + OAuth
# server (tests/fake-nks.mjs). Offline, no deps, touches no real token store.
# Runs on the bridge's own floor, Node 20 — that is the version it claims, and
# CI holds it there so the claim stays proven.
test:
	@node --test $(filter-out tests/watchdog.test.mjs,$(wildcard tests/*.test.mjs))

# Behavioural probe for the shipped watchdogs. Separate target because their
# floor is higher: they take the global WebSocket, so Node 22. Folding them into
# `test` ran them on the bridge's 20 and failed with "WebSocket is not defined" —
# a real mismatch of two floors, not a flaky test. CI gives each artifact a job
# on the version it claims.
test-watchdog:
	@node --test tests/watchdog.test.mjs

# Refresh fixtures/surface.json from the live server (network + authorized grant).
surface:
	@node scripts/export-surface.mjs

# Regenerate the committed <name>.skill bundles from skills/<name>/ (source of truth).
build:
	@bash scripts/build-skills.sh

# Build the claude.ai plugin archive (dist/iskron.zip). CI attaches it to each GitHub Release.
plugin:
	@bash scripts/build-plugin.sh

# Enable the repo's pre-commit hook (auto-rebuilds .skill bundles before each commit).
hooks:
	@git config core.hooksPath .githooks
	@echo "core.hooksPath -> .githooks"
