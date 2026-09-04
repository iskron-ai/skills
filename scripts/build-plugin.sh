#!/usr/bin/env bash
# Build the plugin archive for the claude.ai channel: dist/iskron.zip carrying
# a top-level iskron/ dir with the plugin manifest and the skills tree.
#
# Why it exists: claude.ai has no marketplace and no auto-delivery (org sync
# requires a private repo; this one is public by decision), so that channel is
# manual upload of exactly this archive. CI builds it on every release and
# attaches it as an asset (.github/workflows/release-please.yml); a consumer
# updates by re-uploading a newer release's asset — the same plugin name
# overwrites the installed copy.
set -euo pipefail
cd "$(dirname "$0")/.."

out="$PWD/dist/iskron.zip"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# Of .claude-plugin/ only plugin.json goes in — marketplace.json describes the
# repo-as-marketplace, and the claude.ai loader (the one surface known to be
# stricter than our own gate) has never been tested against a marketplace
# manifest nested inside a plugin dir.
#
# .mcp.json DOES go in, at the plugin root, because it is what makes the graph
# server arrive with the plugin — but not the repo's copy. That one runs the
# bridge over stdio from ${CLAUDE_PLUGIN_ROOT}, and claude.ai spawns no local
# process; the archive gets the http record instead, generated from the
# canonical resource identifier the surface snapshot carries (the exact string
# the server prints — a hand-written URL once diverged by a trailing slash).
# Leaving the record out made the same plugin behave differently on claude.ai —
# no server at all, and nothing on the Connectors tab to authorize, against a
# SETUP.md that promises exactly that.
mkdir -p "$staging/iskron/.claude-plugin" dist
cp .claude-plugin/plugin.json "$staging/iskron/.claude-plugin/"
node -e '
  const r = JSON.parse(require("fs").readFileSync("fixtures/surface.json", "utf8")).resource;
  if (!r) { console.error("fixtures/surface.json carries no resource identifier"); process.exit(1); }
  process.stdout.write(JSON.stringify({ mcpServers: { iskron: { type: "http", url: r } } }, null, 2) + "\n");
' > "$staging/iskron/.mcp.json"
cp -R skills "$staging/iskron/"

rm -f "$out"
(cd "$staging" && zip -X -q -r "$out" iskron -x "*.DS_Store")

# What the archive must carry is a promise SETUP.md makes to a human who cannot
# see inside a zip, so it is checked here rather than trusted: this file IS the
# claude.ai channel, and its first real run is at release time. The executable
# files are the js-bundle of the delivery (graph nks-dev, holon #4057): an
# archive without them installs skills that tell the agent to run what it has not.
# The listing is taken once: `unzip | grep -q` under pipefail is a race — grep
# quits on the first match, unzip dies of SIGPIPE, and the pipeline reads as
# "missing" for a file that is there.
listing="$(unzip -Z1 "$out")"
for want in \
  iskron/.claude-plugin/plugin.json \
  iskron/.mcp.json \
  iskron/skills/establish-mcp/SKILL.md \
  iskron/skills/establish-mcp/scripts/iskron-bridge.mjs \
  iskron/skills/standing/references/watchdog.mjs \
  iskron/skills/standing/references/watchdog-exit.mjs \
  iskron/skills/product-roadmap/references/roadmap-template.html; do
  grep -qxF "$want" <<<"$listing" || { echo "archive is missing $want" >&2; exit 1; }
done
echo "built dist/iskron.zip"
