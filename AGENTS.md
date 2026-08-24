# iskron/skills
Agent-facing NKS skill bundles (Claude Code skills) for the **iskron.ru** deploy, pointing at `mcp.iskron.ru`. Includes `iskronify` — the skill that bootstraps any repo to this `AGENTS.md` standard.

## What this project is
- **Nature**: `library` — reusable Claude Code skill bundles consumed by agents working on iskron. Relaxed vs production: content is prose + methodology, so for the skills there are no behavioural tests. The gates are (1) human review of the `SKILL.md` diff plus the skills' own discipline and (2) a lightweight CI that validates the frontmatter contract and bundle sync (`make check`). The one shipped **code** artifact — `iskron-bridge` — is the exception and carries a real behavioural suite (`make test`): its failures are silent for the agent and land on a human whose browser login went nowhere. Breakage is otherwise silent, not loud (see Production statement) — CI catches the mechanical classes: malformed frontmatter, drifted bundles, manifest lists out of step with the tree, and tool names / enum values that the committed surface snapshot does not carry.
- **NKS realm**: `nks-dev` — every session starts with `nks_orient` here.
- **Focus holon**: `#1506 «📦 iskron/skills (скиллы агента для iskron)»`, under the RU deploy `#1086`.
- **Agent karta**: `#931 «👨‍💻 Разработчик скилл-репозиториев агента»` — adhikarin, steward of #1506 (and of the sibling skill repo #844). Your inbox: `nks_orient(realm="nks-dev", focus="931")` at session start. No seq recorded here → the repo has not been through iskronify; run it before acting.
- **Owner karta**: `#1226 «👑 Владелец продукта»` (svatantra 主) — out-of-mandate questions go there as `posed_to` vimarshas.
- **Delivery map**: this repo advances sub-bianhua `#1516 «📦 Скилл-плагин iskron доставлен агентам»` (anga of `#1092 «🚀 Продакшн на iskron.ru»`). The build→publish→install chain lives as kriyas `#1512 → #1513 → #1514` in #1506; open work lives as anga-vimarshas on `#1516`.
- **Stack**: Markdown `SKILL.md` files under `skills/<name>/`, packaged into derived `<name>.skill` zip bundles via `make build`. Distributed as a Claude Code plugin marketplace (`iskron@iskron`), versioned by semver in `.claude-plugin/plugin.json` — bumped by **release-please**, which maintains a release PR from the Conventional Commits on `main` (feat→minor, feat!/BREAKING→major, else patch); merging that PR writes the version, tags `vX.Y.Z`, and cuts a GitHub Release with a `CHANGELOG.md` entry (`.github/workflows/release-please.yml` + `release-please-config.json`, never by hand). MCP endpoint is `https://mcp.iskron.ru/` (`.mcp.json`). No runtime, no third-party dependencies; CI is a dependency-free gate (pure Node + bash) — format, surface-consistency and the bridge's behavioural suite; see `.github/workflows/ci.yml`.
- **Production statement**: skills install into agents' `~/.claude/skills/` and shape how every agent working on iskron uses NKS via `mcp.iskron.ru`. A wrong instruction — e.g. a reference to a tool that nks-mcp has dropped — silently degrades every agent that loads the skill; there is no crash, only methodology drift. The consumer is the agent, not a human user. Keeping skills in sync with the nks-mcp tool surface is the core maintenance obligation.

## Persistence rules
State lives in the **repo** or in **NKS** — nowhere else.
- **No local agent memory.** The harness's project-memory dir is forbidden by dir, not by category — frozen at a prohibition stub; the `PreToolUse` memory-guard hook blocks any write there. Route the fact instead: repo conventions / code facts → this file; project state → NKS (`nks-dev`, #1506); a user-scoped fact no project owns → the owner's personal realm (`minding`).
- **Repo**: `skills/<name>/SKILL.md` (source of truth), the derived `<name>.skill` bundles, `README.md`, conventions.
- **NKS** (`nks-dev`): design decisions, open questions (vimarshas), hand-offs, hints — the thinking around the skills. Don't restate NKS in the repo; link to the vimarsha/holon.
- **`skills/<name>/SKILL.md` is the source of truth.** The `<name>.skill` zips are derived build artifacts (committed for download/claude.ai); the installed copy in `~/.claude/skills/` is derived too. Never treat a hand-edited bundle or installed copy as canonical — edit the source dir and run `make build`.
- Fetch state; never reconstruct it from memory.

## Session lifecycle
- **Start:** `nks_orient(realm="nks-dev", focus_holon="1506")`; orient by the ACTIVE BIANHUA map (`lens="bianhua"` for the forest) — open work lives as anga-vimarshas on transformations; a `genre=hint` seed, if any, is a pointer for what the map doesn't carry. The `iskronify` counterpart is the `entry` skill, which runs the protocol. Then open your agenda: `nks_orient(realm="nks-dev", focus="931")` — incoming `posed_to` vimarshas are your inbox; pick up or explicitly defer each before starting repo work.
- **Every push → update NKS:** thread shipped repo state into holon #1506 and advance the delivery bianhua #1516 — close (visarjana) driver vimarsha #1515 (or split it) as the repo moves toward published/installed. The skill *pipeline* (kriyas #1512–#1514) is the carrier. A thin `genre=hint` is left only for what the graph can't carry (pointer, not payload — methodology #131), never by default.
- **Shared methodology stays shared.** The skills' *substance* (kriyas «навигация», «создание узла», «приведение репо к стандарту», intake, roadmap, вахта) is common methodology modeled once under #844/methodology — do **not** duplicate it under #1506. Only when an iskron skill *diverges* from the shared version does that divergence get its own node.
- **Keep git refs out of NKS** — no SHAs, branch names, or PR numbers in nodes.
- **Skill ↔ tool sync is the recurring driver:** when nks-mcp (the server behind mcp.iskron.ru) renames or drops a tool, the matching skill edits land here, ideally in the same atomic unit of time.

### Branch discipline
One branch through to its merge — commit follow-ups into it, don't chain new branches before it merges. After merge: `git checkout main && git pull`, delete the merged branch, update NKS (#1506 + close resolved vimarshas).

## Working principles
1. **Think before editing.** Orient in nks-dev; read the bianhua map. Inspect the real source in `skills/<name>/SKILL.md` — not the derived `.skill` zip, not the installed copy, not assumptions.
2. **Surgical changes.** Touch only the skill steps the task needs. Match each bundle's existing register and terminology. Don't mass-rewrite a bundle for one fix unless asked.
3. **Sync over invention.** A skill instruction must match the live nks-mcp tool surface — verify tool names exist before writing them into a skill.
4. **Terminology is load-bearing.** Skills teach vocabulary to every downstream agent. Use the realm's current terms (`phenomenon`, not the retired `entity`); a typed primitive (target of given_as / ahara / upadhi / context) is a `phenomenon`, a generic graph object is a `node`.

## NKS ↔ repo: where things live
| Concern | Repo | NKS |
|---|---|---|
| `skills/<name>/SKILL.md` (source of truth) + derived `.skill` bundles | ✓ | |
| `.claude-plugin/marketplace.json`, build (`Makefile`, `scripts/`, `.githooks/`) | ✓ | |
| README, conventions | ✓ (AGENTS.md) | |
| Design decisions, open questions | | ✓ (vimarshas) |
| Plans, hand-offs | | ✓ (bianhua map + anga-vimarshas on #1506/#1516; thin `genre=hint` only for off-map remainder) |
| Commit history, SHAs, PRs | git | (never NKS) |

## The bootstrap template lives in the `iskronify` skill
The fill-in `AGENTS.md` skeleton for future repos is `skills/iskronify/references/agents-template.md`; the bootstrap protocol is `skills/iskronify/SKILL.md`. **This** repo's own config is `AGENTS.md` (the file you are reading). Edit the template/protocol to improve bootstrapping for all future repos — don't confuse them with this file.

## Stack
Markdown `skills/<name>/SKILL.md` (+ optional `skills/<name>/references/*.md`) per skill — **edit these directly, they are plain files and fully greppable.** Each is packed into a derived `<name>.skill` zip (top-level `<name>/` dir containing `SKILL.md`) by `make build`. No code, no lockfiles. The only "code" is the build + format-validation scripts (`scripts/*.sh`, `scripts/*.mjs`), run by `make` and CI.

## Commands
Edit the source under `skills/<name>/` directly — no unzip dance. The `<name>.skill` zips are regenerated, not hand-edited.

| Task | Command |
|---|---|
| Find / search across skills | `grep`/`Grep` over `skills/` (it's plain text) |
| Edit a skill | edit `skills/<name>/SKILL.md` |
| Rebuild the `.skill` bundles | `make build` (deterministic; or auto via the pre-commit hook) |
| Enable the auto-rebuild hook | `make hooks` (sets `core.hooksPath -> .githooks`) |
| Verify a bundle's contents | `unzip -l <name>.skill` |
| Run the CI gate locally | `make check` (= `make validate` + `make check-bundles` + `make check-surface` + `make test`) |
| Validate skill frontmatter only | `make validate` (pure Node, no deps) |
| Check committed bundles ↔ source | `make check-bundles` |
| Lint corpus ↔ surface snapshot | `make check-surface` (offline, against `fixtures/surface.json`) |
| Run the bridge's behavioural tests | `make test` (offline, against the local fake in `tests/fake-nks.mjs`) |
| Refresh the surface snapshot | `make surface` (network + authorized grant; speaks through the bundled iskron-bridge) |
| Build the claude.ai plugin archive | `make plugin` (→ `dist/iskron.zip`; CI attaches it to each release) |

The pre-commit hook (`.githooks/pre-commit`) rebuilds and stages the `.skill` bundles on every commit, so committed zips never drift from source. Run `make hooks` once per clone to enable it — **except on this owner's machine**: the `~/code/iskron/` gitconfig points `core.hooksPath` at a shared `pre-push` identity-guard (correct-user pushes), and `make hooks` would override it repo-locally and disable that guard here. On that machine, skip `make hooks` and run `make build` before committing instead (CI's `make check-bundles` catches any drift regardless). For the corpus the automated gate is **format and surface-consistency**, not behaviour: `make validate` parses each `SKILL.md` frontmatter (catching malformed YAML such as an unescaped quote in a `description`) and lints the AGENTS.md inventory line and README table against the `skills/` tree; `make check-bundles` confirms each `<name>.skill` contains a `<name>/` tree byte-identical to its source; `make check-surface` checks every `iskron_*` name and enum value in the corpus against `fixtures/surface.json` — the committed snapshot of the live tool surface, refreshed by `make surface` when nks-mcp changes. For the bridge the gate *is* behavioural: `make test` spawns `iskron-bridge` over stdio against a local fake NKS + OAuth server and drives whole flows through it. All of them run in GitHub CI on every push/PR (`.github/workflows/ci.yml`). The substance of a skill — whether its prose and tool references are right — is still gated by human review of the diff.

## Project structure
- `skills/<name>/SKILL.md` — **source of truth**, one dir per skill (`entry`, `writing`, `design`, `weaving`, `inquiry`, `assembly`, `integrity`, `intake`, `vahta`, `collaborate`, `foreman`, `feedback`, `reality-audit`, `minding`, `methodology-work`, `iskronify`, `product-roadmap`, `establish-mcp`); `references/*` optional (`iskronify`, `writing`, `product-roadmap`, `collaborate` ship them); `establish-mcp` ships `scripts/iskron-bridge.mjs` (the stdio↔https OAuth MCP bridge — code inside a skill, kept dependency-free, Node ≥20).
- `*.skill` — derived zip bundles (committed for manual / claude.ai install). Build output of `make build`; do not hand-edit.
- `.claude-plugin/marketplace.json` — plugin marketplace manifest (`iskron@iskron`); `metadata.version` and the plugin entry's `version` both mirror `plugin.json` (release-please writes all three; `make validate` fails if they diverge). No component lists — the plugin's skills auto-discover from `skills/` (`strict: true`, plugin.json authoritative).
- `.claude-plugin/plugin.json` — the `iskron` plugin manifest; its `version` is what Claude Code reads to deliver updates (bumped by release-please when the release PR merges, never by hand).
- `.mcp.json` — the iskron MCP server binding for this repo: `https://mcp.iskron.ru/`.
- `release-please-config.json` + `.release-please-manifest.json` + `.github/workflows/release-please.yml` — release-please: it maintains a release PR from the Conventional Commits on `main`; merging that PR writes the version into `plugin.json`/`marketplace.json`, tags `vX.Y.Z`, and cuts a GitHub Release with a `CHANGELOG.md` entry; the workflow's `plugin-asset` job then builds `dist/iskron.zip` at the tag and attaches it to the release — the claude.ai delivery channel (no marketplace auto-sync there: the repo is public by decision, consumers update by re-uploading a newer release's asset).
- `Makefile`, `scripts/build-skills.sh`, `scripts/build-plugin.sh`, `.githooks/pre-commit` — the build.
- `tests/bridge.test.mjs` + `tests/fake-nks.mjs` — the bridge driven over stdio against a local fake NKS + OAuth server. Offline, no deps, touches no real token store (`make test`).
- `fixtures/surface.json` — the committed snapshot of the live nks-mcp tool surface that `make check-surface` lints the corpus against; refreshed by `make surface`.
- `scripts/validate-skills.mjs` (frontmatter contract + shipped-prose guards + manifest-list lint, pure Node), `scripts/check-bundles.sh` (bundle ↔ source sync), `scripts/check-surface.mjs` + `fixtures/surface.json` (corpus ↔ tool-surface lint; refreshed by `scripts/export-surface.mjs` through the bundled bridge), `tests/bridge.test.mjs` + `tests/fake-nks.mjs` (the bridge's behavioural suite), `.github/workflows/ci.yml` — the gate.
- `README.md` — short human-facing pointer.
- `.claude/` — Claude Code settings: `settings.json` (committed — session hooks + team permissions), `settings.local.json` (gitignored, machine-local).
- `.gitignore` — ignores `.DS_Store`, `.claude/settings.local.json` and `dist/` (the plugin archive is a release asset, never committed).

## Code conventions
- **Keep the repo brand-clean.** The brand is **iskron** (`iskron@iskron`, `/iskron:<skill>`, `mcp.iskron.ru`) and the repo-bootstrap skill is **`iskronify`**. No tracked file and no git surface (commit message, PR title/body, branch name) references any other skill distribution: not its brand, not its bootstrap-skill name, not the word «upstream/апстрим», not its PR numbers — describe every change on its own merit. `make validate` fails a shipped source carrying a foreign brand token; before pushing, grep the commit message and branch name the same way. Relations between distributions live in NKS only (`nks-dev`, #844/#1506) — the shared graph may carry another brand; this repo's files and git history never do.
- **`SKILL.md` frontmatter**: `name:` (kebab, matches the skill dir) + `description:` carrying explicit trigger phrases — that description is what routes the skill, so keep triggers concrete.
- **Skill names are bare** — no `nks-`/`iskron-` prefix. The `iskron` plugin namespaces them (`/iskron:<skill>`), so a prefix would only stutter. Trade-off: flat installs (`npx skills`, manual unzip) drop skills into `~/.claude/skills/<name>/` under the bare name and can collide there — the plugin is the canonical, collision-proof channel.
- **Source of truth = `skills/<name>/SKILL.md`.** Edit it directly, then `make build` to regenerate the `<name>.skill` zip (which must contain `<name>/SKILL.md`, not a bare `SKILL.md`, or it won't install). New skill → add a `skills/<name>/` dir — it ships via plugin auto-discovery; never add component lists (`skills`, `commands`, …) to `marketplace.json`/`plugin.json` — a second copy of the truth drifts, and the format gate fails it.
- **No realm seq-references in skills.** Skills ship to users who (almost certainly) have no access to `methodology`/`nks-dev`, and seq numbers are realm-instance-specific — a `#N` or `nks_look(node_id=…, realm="methodology")` in a skill is dead weight or a wrong pointer downstream. Name concepts by name; keep syntax placeholders (`#42`, `#N`, GitHub `#123`) only. Exception: `methodology-work` may reference the methodology realm operationally (name/attr-based search, not seqs) — the skill presupposes that realm. (Seq refs in **this AGENTS.md** are fine — it never ships.)
- **Размещение уроков в скилле: в теле — то, чем шаг исполняют; в справке (`references/*`) — то, чем его чинят.** Подтверждено двумя независимыми свидетельствами (держатель nks-mcp; вахта iskron): справку при подключении не открывают, поэтому исполняющий вызов (например, `Monitor` со сторожем как `command` и `persistent: true` для держания сокета) обязан стоять в теле шага, а таблицы починки (коды закрытий, повторные register) живут в справке.
- **Tool references must be live.** Any `nks_*` tool a skill names must exist in the current nks-mcp surface behind `mcp.iskron.ru`. Dropped tools (`nks_validate`, `nks_reflect`) must not appear; shipped behavior (validate-on-create → `CHECKS:` in the create response) belongs in create-flow guidance.
- **Terminology**: `phenomenon` for the typed primitive, `node` for the generic; `kriya`/`holon`/`karta`/`vimarsha` per the realm ontology. Don't reintroduce retired terms.
- **Test discipline**: for the corpus, CI validates format and surface-consistency (`make check` — frontmatter parseability + shipped-prose guards + manifest lists + bundle sync + tool-name/enum lint against the surface snapshot); it does not check substance. For the bridge, a behavioural change belongs in `tests/bridge.test.mjs` in the same commit — and write the test so it **fails on the old code first** (`ISKRON_BRIDGE_PATH=<old copy> make test`); a bridge test that never went red proves only that it runs. Substance review is still manual: read the diffed `SKILL.md` — behavioural claims about tools are exactly what no lint sees. The skill set ships by auto-discovery from `skills/`; `make validate` fails if a manifest re-introduces a component list.
- **Frontmatter must be parseable YAML.** `description` values are double-quoted; **escape any inner quote as `\"`** (an unescaped `"` terminates the scalar early — the exact bug `make validate` guards). Keep frontmatter flat and single-line — only `name` and `description` keys, plus optional `slash: true` (typed `/name` resolution in OpenCode v2).
- **No angle brackets in `description`.** The claude.ai plugin loader rejects a description with XML-tag-shaped content, and the refusal takes down the whole plugin install. Its exact matcher is unknown, so `make validate` bans `<`/`>` outright — write placeholders as `@handle/mind`, not `@<handle>/mind` (skill *bodies* may keep angle-bracket placeholders).

## What to update when
- `AGENTS.md` — repo conventions, structure, or the skill set change.
- `README.md` — the skill table, whenever the skill set changes (new/renamed/retired skill).
- `fixtures/surface.json` — when the nks-mcp tool surface changes (rename/drop/new enum): `make surface`, review the diff, commit.
- `DERIVATION.md` — the skills ← canon re-projection map (+ the four-layer language contract): walk it after any methodology-canon change; extend it when a new canon landmark gets projected into a skill.
- `skills/iskronify/` (`SKILL.md` + `references/agents-template.md`) — when improving the bootstrap protocol/template for all future repos.
- `skills/iskronify/references/superpowers-interop.md` — when superpowers renames its skills/paths/gates (re-verify checklist inside).
- `skills/iskronify/references/delegation.md` — when Claude Code / OpenCode agent-file surfaces change (dirs, frontmatter keys, model aliases/inheritance; re-verify checklist inside).
- NKS (`nks-dev`, #1506) — every push: thread repo state into holon #1506, advance delivery bianhua #1516, close resolved vimarshas.

## Git workflow
- **Conventional commits** (`feat:`/`fix:`/`chore:`/`docs:`…). Branches `feat/…`, `fix/…`, `chore/…`; PR titles same format.
- **No co-author trailer.**
- **Format gate**: run `make check` before committing (CI runs the same on every push/PR). It catches malformed frontmatter, drifted bundles, stale manifest lists and surface drift, and it runs the bridge's behavioural suite — but not the substance of the prose; still review the `SKILL.md` diff by eye.
- **Definition of done**: change committed and merged to `main` on `github.com/iskron-ai/skills` (direct push or PR, per the user's call); the user signals the merge. On merge, update NKS #1506 — close resolved vimarshas, advance the bianhua they drive.
- **Never** `--force` or `git reset --hard` without explicit instruction.

*(iskronify: contract 2 — re-run when the installed contract is higher, or when the sources this file derives from have moved since.)*
