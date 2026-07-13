# iskron skills setup (agent-executable)

You are a coding agent setting up the **iskron** skills for your user. Execute the steps
below autonomously, in order — the graph server authenticates via **OAuth** (browser
login), so on the default path you ask the user for nothing. Only the headless/no-OAuth
fallback needs their **graph token** — never invent, guess, or reuse one. Report the
result of each step.

This is two parts:

1. **Skills** — plain-markdown method bundles from this repo (readable before install).
2. **Graph MCP server** — the remote NKS reasoning graph at `mcp.iskron.ru`, exposed as `nks_*` tools.

## 0. Detect your harness

Identify which agent you are running as — Claude Code, Cursor, Codex, or other — and
follow that path below. If you cannot tell, ask the user.

## 1. Install the skills

**Claude Code** (preferred — namespaced, collision-proof):

```sh
claude plugin marketplace add iskron/skills
claude plugin install iskron@iskron
```

(Inside an interactive session: `/plugin marketplace add iskron/skills` then
`/plugin install iskron@iskron`.)

**Cursor / Codex / any other agent** (flat install, ~70 harnesses supported):

```sh
npx skills add iskron/skills --all
```

Add `--agent codex` (or `-a cursor`, …) to target a specific harness explicitly.

## 2. Connect the graph server

The server speaks **OAuth**: an interactive harness pointed at the URL opens a browser
login on first contact — no pre-shared token, nothing to paste. The endpoint is
`https://mcp.iskron.ru/`.

> **Claude Code + plugin (step 1): nothing to configure.** The plugin bundles this
> server (`.mcp.json` in the plugin root); the first `nks_*` call (or `/mcp`) opens
> the OAuth login. Skip the rest of this step.

**Claude Code without the plugin:**

```sh
claude mcp add --transport http nks https://mcp.iskron.ru/
```

**Cursor** — merge into `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{ "mcpServers": { "nks": { "url": "https://mcp.iskron.ru/" } } }
```

OAuth login triggers on first use in both.

**Fallback — headless agents and harnesses without MCP-OAuth support** (Codex-style
configs, CI, autonomous VMs): use a personal access token instead. Ask the user for
it (it comes with the early-access invite) — never invent one — and pass it as a
Bearer header, e.g.:

```sh
npx add-mcp https://mcp.iskron.ru/ --header "Authorization: Bearer ${ISKRON_TOKEN}"
```

```toml
# Codex ~/.codex/config.toml
[mcp_servers.nks]
url = "https://mcp.iskron.ru/"
bearer_token_env_var = "ISKRON_TOKEN"
```

Store the token where your harness expects env vars; do not hard-code it into files
that get committed. The token never goes into the URL.

## 3. Restart

Tell the user installation is done and ask them to restart the session so the new
skills and connection are picked up. This is the end of what you can do here.

## 4. First session: align

In the fresh session, the user says `align` (or `/iskron:align` with the Claude Code
plugin). The agent then verifies the connection (`nks_orient` returns a realm list),
brings the repo to the iskron standard (`AGENTS.md` + session rituals), and seeds the
graph with the structure the codebase already shows.

## Troubleshooting

- **401 / auth error** → on the OAuth path, re-run the login (`/mcp` → authenticate,
  or restart the session). On the token fallback the token is wrong or expired —
  re-ask the user; do not retry
  with variations.
- **`nks_*` tools not visible** → the MCP config loads on session start: restart the
  session (or reload MCP config) and verify again.
- **Skill name collision on flat installs** → another skill pack already uses a bare
  name like `design`. Rename that directory, or use the Claude Code plugin channel,
  which namespaces everything under `iskron`.
