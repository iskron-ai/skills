# Iskron for OpenCode: npm distribution

The package contains the OpenCode plugin, its bridge and the full skills tree.
Use OpenCode 1.x. OpenCode 2's plugin API is a separate compatibility target.

## Build

From the repository root, install development dependencies with `make deps`, then
run `make build` and `make check`. A stable `make npm-package` is fail-closed: it
only produces a tarball from a clean commit whose exact `vVERSION` tag matches the
release metadata. For a test artifact from a working tree:

```sh
node js/pack-opencode.mjs VERSION-test.ID
```

Replace `VERSION` with the current `.claude-plugin/plugin.json` version and `ID`
with a unique test identifier. The script accepts only prereleases of that version.
It does not publish anything. Inspect the archive before publishing it with
`npm publish ./dist/iskron-opencode-VERSION-test.ID.tgz --tag test --registry=REGISTRY`.
Keep registry credentials outside the package and repository.

## Publish

Publish stable bytes only after the release PR has merged and release-please has
created the matching tag. Use a clean checkout of that tag so a prerelease or newer
working tree cannot be published as the stable version:

```sh
git switch --detach vVERSION
make deps
make check
make npm-package
npm publish ./dist/iskron-opencode-VERSION.tgz --ignore-scripts --access public --tag latest --registry="$REGISTRY"
```

Use the established Forgejo npm registry URL for `REGISTRY`; let npm read credentials
from its existing user configuration, never from a command argument. Before publish,
inspect `tar -tzf` and `npm publish --dry-run --ignore-scripts` output. Afterwards,
read `version`, `dist.tarball` and `dist.integrity` with `npm view`, then download the
reported tarball without authorization and compare its SHA-256 to the local archive.
An existing version is immutable: a refusal must not be bypassed with another tag.

## Install

Add a pinned npm specifier to the existing OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@iskron/opencode@VERSION"]
}
```

For a private registry configure the `@iskron` scope using npm/Bun's normal registry
configuration. Alternatively use the immutable tarball URL returned by
`npm view @iskron/opencode@VERSION dist.tarball --registry=REGISTRY` as the plugin
specifier. Preserve other plugins. Remove the old auto-discovered `iskron.js`
copy and redundant native Iskron MCP entry when migrating; do not load both.

The plugin appends its own skills directory to `skills.paths`, preserving existing
paths and URLs. No skills repository clone, lifecycle install script or separate
copy of the bridge is needed. Writable credentials and tool cache remain in
`ISKRON_BRIDGE_AUTH_DIR` (default `~/.iskron-bridge`), outside the npm package.

For unattended operation supply `ISKRON_BRIDGE_TOKEN` through the process's secret
environment before starting OpenCode. Optional ordinary environment:
`ISKRON_BRIDGE_URL`, `ISKRON_BRIDGE_AUTH_DIR`, `ISKRON_BRIDGE_NO_BROWSER=1`.
Do not embed token values in plugin options or configuration returned by an API.

The npm package owns the bridge version. Its child bridges disable home-copy
replacement and automatic updates. An explicit `ISKRON_BRIDGE_PATH` override is
still available for diagnostics. Update the package specifier and restart OpenCode
to change the installed version; secret rotation likewise requires a process restart.
Removing the specifier and restarting disables the plugin, but does not erase credentials.

When this machine also uses a separately updated bridge (Claude Code, Codex or pi),
set a dedicated `ISKRON_BRIDGE_AUTH_DIR` for the npm plugin before its first launch
and authorize it separately. Sharing an OAuth store across independently pinned
bridge versions is not supported by this recipe. A VM using a PAT does not rotate
an OAuth grant. Run the packaged bridge's `doctor`, using that same auth directory,
instead of diagnosing this installation through a standalone home bridge.

The archive includes tracked files under `skills/`, not the development toolchain
or local untracked files. The only external runtime dependency is `@opencode-ai/plugin`.

## Acceptance

A listening HTTP server does not prove that a plugin loaded. Check actual
`iskron_*` tools and bundled skills first, then open two root sessions and let each
take its own standing. Send distinct channel messages after both become idle:
each session must run and answer only its own message, with no external prompt
request to wake it. Repeat after idle; delete one session and repeat for the other.
Repeat on a second clean machine/cache. Invalid credentials, missing packages and
import failures must not be mistaken for readiness of Iskron.

Local acceptance (actual OpenCode and bridge, fixture MCP/WebSocket and model):

```sh
node js/tests/opencode-npm-live.mjs dist/iskron-opencode-VERSION.tgz /absolute/path/to/opencode
```

Set `ISKRON_NPM_PROBE_MODE=registry` to exercise pinned `name@version` resolution
through a scoped fixture registry instead of a direct tarball URL.

This runs with isolated HOME and caches under `dist/`, fetching the packed artifact
through OpenCode's normal npm loader. It checks A/B wakeups after idle and deletion
isolation. It does not certify the real graph service or fresh dark VM provisioning.
Dependencies are fetched from the configured/public npm registry; this is not an
offline-install test. The printed `dist/npm-live-*` directory retains diagnostic
logs and fixture caches; remove that specific run directory after inspecting it.
