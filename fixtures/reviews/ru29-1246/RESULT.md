# RU29 — independent observations for case 1246

**Technical recommendation: correct the finding below** on `c67f15b9727a06f4e5927433136f7b7a22d6b4cf`, against integration base `42da4024`. This is a technical verification handoff, **not the required cold-review approval**. Case 1246 [15] acknowledges the assignment error and assigns the permitted-tier cold review separately; no APPROVE is issued here.

## Finding

**P2 — contradictory absence rule remains in the shipped reference.**
`skills/minding/references/personal-realm.md:161` still instructs maintainers that `Realm not found` is read by `SKILL.md §1` as “not bootstrapped”. This is false under the new entry at `skills/minding/SKILL.md:24–30`: only readiness `missing` with `mind_realm` in `lacks` establishes absence; denial, unknown and ambiguous responses do not permit creation. The same checklist at line 158 still checks the old handle surface instead of the newly required readiness contract. A future surface recheck following this shipped checklist validates the superseded entry and misses a broken personal-ownership source. Replace these obsolete checklist requirements with the current identity/readiness/link/absence distinctions; do not restore address construction. No implementation fix was made by this reviewer.

## Procedural limits

- This session was assigned as GPT-6 Astra. Repository `AGENTS.md` and `delegation-2.md:106` restrict the cold-review tier to Opus / GPT-6.1 Sol and exclude Astra. These observations are deliverable, but this session **does not satisfy that reviewer-tier requirement**. The parent was informed in case 1246. It must not be counted as the prescribed cold-review round without an authorized exception.
- The brief disclosed the author's prior sibling failure and an archive location. Under `reviewer.md:17` this is a contaminated brief. The author's reports and archive conclusions were not used as evidence. Findings below are direct diff/file readings and newly executed observations.

## Scope and preservation

- Base `42da4024` is an ancestor of the candidate (`git merge-base --is-ancestor`, exit 0).
- After substantive head `0035d579`, exactly one commit changes the review index and adds four `.tar.gz` archives; no source/config/test change. `post-content-delta.stdout` records the names.
- `git diff --quiet 42da4024 HEAD -- js/bridge js/opencode js/shared js/cli js/extension js/watchdog js/delivery js/tests/opencode-siblings.test.mjs` exited 0. Production bridge/plugin implementation and the sibling regression test are byte-identical to the base.
- The seven roles, including base-wave `weaver`, remain. All seven Claude bodies and OpenCode bodies equal their corresponding source blocks in `delegation-1.md` / `delegation-2.md`.
- RU source description, body and repository stamp are 29. EN5 is the agreed neighbouring number, not a claim of observed EN delivery. No neighbouring repository was read.
- Subject-level repository discovery and `repository` bindings remain in onboarding/iskronify. No instruction to delete these objects was introduced; the open owner choice was not decided here.
- The new primary mind/onboarding entry uses current readiness `personal_mind.artifact.ref`, distinguishes absent realm from missing roles and denied/unknown state, rejects a foreign-only mind, avoids stored mind locators, separates runtime persona from progress, and requires provenance before legacy cleanup. This is a **text-contract observation**, not proof that a model executes it or that the API implements it.
- Modified assertion plumbing in `stand.test.mjs` compares structured output with the response for that exact request, rather than a mutable last-response slot. The watchdog test waits for the tested client's attachment instead of a sleep. Deep equality/count assertions remain; timeouts were not raised and no assertions were loosened by this reviewer.

## Fresh runs

| Observation | Exact carrier/command | Result |
|---|---|---|
| Full default local gate | `make check BASE=42da4024`, Node 26.12.0 | exit 0; 1881 tests, 1880 pass, 1 skip, 0 fail; `full-gate.log` |
| Full CI-floor gate | `env PATH=/Users/dmitry/.nvm/versions/node/v22.23.3/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin make check BASE=42da4024` | exit 0; 1881 tests, 1879 pass, 2 skip, 0 fail; `full-gate-node22.log` |
| Old guard negative control | candidate `memory-paths.test.mjs` with `MEMORY_GUARD_ROOT` pointing to base files extracted with `git archive` | expected exit 1: 16 failures, 20 passes; old Windows backslash paths returned 0 instead of 2; `negative-memory.stdout` |
| Old personal entry negative control | candidate `personal-entry.test.mjs`, `MINDING_ENTRY_ROOT` pointing to base files | expected exit 1: 25 failures, 3 passes; `negative-personal.stdout` |
| Real CLI ingestion | OpenCode 2.0.32, isolated HOME/XDG, owned `serve`, authenticated `opencode api --server … get /api/agent?location[directory]=…` | all 7 full bodies and provider/model pins exactly equal checked-in projections; executable comparison exit 0 in `verified-cli.log` |

Node22 repeats the complete gate because the first invocation used the machine default Node26, not the repository's CI floor. This is not retry-until-green. The skipped cases are the existing five-real-minute login test and, on Node22, `--use-env-proxy` requiring Node24.5+. Existing lint warnings are unchanged. Both full runs preserve the sibling assertion; neither run reproduces the historical failure. **Two green runs do not establish the cause or resolution of the earlier `[zombie,zombie]` failure.** No core fix is claimed. That unresolved causal question remains with case 1225.

The new guard's declared Windows disk/UNC/mixed-case/parent-traversal strings were executed by the canonical shell hook and its repository projection in the full gate. This is path parsing under POSIX, **not native Windows harness execution**. Native Windows was not imposed as an extra release barrier.

## Re-alignment and actual loading

The candidate repository already carries the projected RU29 AGENTS memory slot, Claude guard, OpenCode refusal and seven roles. The review compares their outputs with sources and exercises the hooks; an isolated consumer receives those role files, then the real new CLI reads their entire bodies and pins. No global user config was edited.

The isolated consumer has a synthetic provider catalogue so pin parsing can be observed without credentials or model calls. The provider URL is loopback port 1 and provider use is denied. No prompt/model endpoint was called. Real paid-model behaviour (including GLM-5.3) is outside this review and remains in case 1241.

This does **not** witness a model executing the whole iskronify procedure from an old stamp, nor live reload of the current session's hooks. File projection, fresh-loader ingestion, and live reload are distinct. The latter two full behavioural claims are not promoted from the former. On the readable graph, #2119/#8004 still describe the new contract prospectively and #8043 retains old API observations; neither was treated as live proof of the new API.

## Reproduce / raw records

Run from the candidate tree (or an evidence-only descendant with identical product files):

```sh
node fixtures/reviews/ru29-1246/independent.mjs
node fixtures/reviews/ru29-1246/cli.mjs
node fixtures/reviews/ru29-1246/serve.mjs
node fixtures/reviews/ru29-1246/verify-records.mjs
```

`commands.json`, stdout/stderr records and both gate logs preserve observations. `serve-cli-agents.json` is the real CLI response; `verified-cli.log` is the assertion result. `serve.stdout` redacts the ephemeral server password. The disposable HOME is named by `scratch-path.txt` and retained until transfer acknowledgement.

Early probe errors are retained, not hidden: the first wrapper assumed TAP while Node26 used its spec reporter (`probe-reporter-error.log`); the first isolated CLI attempted the fixed managed-service port (`cli-agents.stderr`). Private `debug agents` also returned an empty list even while its config-source output named the consumer. The explicit owned-server API with a location supplied the independent second observation and is the accepted ingestion carrier; empty debug output was not called a pass. The temporary-home service setting affects only that disposable home.

## Integration handoff

- Read nodes: #1506, #931, #4057, #1921, #8200, #8043, #2119, #8004, #947, #6553, #8166; forward/backward traces from #1921, #8004 and #947.
- Boundaries: RU delivery #1506 / executable carrier #4057, role #931; common method #844; onboarding #7914 and API #48.
- New API readiness and EN delivery: **unknown here**, not inferred ready from text. Model behaviour: **unknown here**, assigned separately.
- Parent should pass the checklist correction to the author, preserve the sibling causal question in #1225, and use a permitted reviewer tier for formal acceptance. No new human decision or foreign-repository change was requested.
