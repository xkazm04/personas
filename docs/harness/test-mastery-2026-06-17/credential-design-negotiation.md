# Test Mastery — Credential Design & Negotiation
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. credential_recipes::upsert MERGE-not-clobber has zero tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/credential_recipes.rs:51-97 (also increment_usage 100-114, delete_by_connector 117-130)
- **Current test state**: none
- **Scenario**: The `upsert` `ON CONFLICT(connector_name) DO UPDATE` deliberately MERGES enrichment columns (`setup_instructions`, `summary`, `docs_url`) via `COALESCE(NULLIF(excluded.x, ''), x)` so a later negotiator/autocred stub (empty instructions → NULL/'') does NOT wipe a richer Design recipe. The code comment explicitly says this guards a real past bug ("downgrade a verified recipe to a stub"). Nothing tests this. A future refactor that drops the `NULLIF`/`COALESCE`, reorders columns, or "simplifies" to `excluded.*` would silently re-introduce credential-setup data loss across every connector, and the suite would stay green.
- **Root cause**: The whole `resources` recipe repo module is untested; the merge logic lives in a raw SQL string where Rust's type checker can't catch a semantic regression.
- **Impact**: Users lose AI-discovered setup instructions / docs URLs for connectors; the negotiator and AutoCred then re-run expensive AI discovery (token cost) and may present worse guidance — directly degrading the credential-binding funnel this whole context exists to serve.
- **Fix sketch**: Add a `#[cfg(test)]` module using an in-memory SQLite pool (mirror the pattern other repo tests use). Tests asserting the invariants: (a) first upsert inserts with `usage_count = 0`; (b) second upsert for the same `connector_name` with empty `setup_instructions`/`summary`/`docs_url` PRESERVES the previously-stored non-empty values (the core anti-clobber invariant); (c) second upsert with NEW non-empty values overwrites; (d) `source` and the non-enrichment columns (label/category/color/oauth_type/fields) always overwrite; (e) `increment_usage` raises count by exactly 1 and is a no-op (returns Ok) for an unknown connector; (f) upsert never resets `usage_count` back to 0 on the conflict path.

## 2. simulateRevocation business metrics (revenue/executions lost, failover) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:246-318
- **Current test state**: exists-but-weak (credentialGraph.test.ts covers only buildCredentialGraph edge-dedupe + analyzeBlastRadius via-label; `simulateRevocation` has no test)
- **Scenario**: `simulateRevocation` computes the numbers the revocation simulator shows operators: `estimatedDailyExecutionsLost` (`Σ round(recentExecutions/7)`), `estimatedDailyRevenueLost` (`Σ dailyBurnRate`, rounded to cents), `failoverSuggestions` (same `service_type`, excluding self), and severity. A regression in the `/7` daily-amortization, the cents rounding, the self-exclusion filter, or the health-map lookup would mis-state blast-radius impact and the suite wouldn't notice — the only existing tests touch a different function.
- **Root cause**: Tests were written for the graph-builder dedupe bug fix only; the simulator's arithmetic and failover selection were never back-filled even though they drive a user-facing $ figure.
- **Impact**: Operators see wrong "you'll lose $X/day and N executions" impact when deciding whether to rotate/revoke a credential — either false alarm (over-rotation) or under-estimated outage (ignored a high-blast credential). Failover mis-suggestions could point users at the wrong fallback credential.
- **Fix sketch**: Unit tests on `simulateRevocation` with a fixed graph + health signals: assert (a) `estimatedDailyExecutionsLost` equals the rounded weekly/7 sum for known inputs; (b) `estimatedDailyRevenueLost` is the burn-rate sum rounded to 2 decimals; (c) failover list excludes the revoked credential and includes only same-`service_type` ones with correct `healthOk`; (d) personas missing from `healthSignals` default to grade `unknown`, 0 burn, 0 executions; (e) severity matches `severityForAgentCount`. Pure function, deterministic — good llm-generatable batch.

## 3. severityForAgentCount thresholds + fromAgentNodeId invariant not asserted
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:69-81 (thresholds), 32-46 (fromAgentNodeId), 412-423 (buildCredentialGraph invariant guard)
- **Current test state**: exists-but-weak (severity is exercised only incidentally with 1 agent; the throw-paths and exact boundary counts are untested)
- **Scenario**: `BLAST_RADIUS_THRESHOLDS` (HIGH=3, MEDIUM=1) is the single source of truth shared by the panel color AND the simulator. The exact boundaries (0→low, 1-2→medium, 3+→high) are never asserted, so a one-off edit (`>` vs `>=`, or bumping HIGH to 5) would silently miscolor "rotate now" credentials. Separately, `fromAgentNodeId` and `buildCredentialGraph` were hardened to THROW on a malformed agent-node id (the comment: previously "produced 'unknown' health grades and zero burn-rate, under-reporting blast radius") — that loud-failure invariant has no test, so a regression back to a silent fallback would pass.
- **Root cause**: Threshold and invariant-guard code carry detailed bug-history comments but no corresponding regression test was added when they were introduced.
- **Impact**: Mis-bucketed severity → wrong urgency signaling on credential rotation; a silent agent-id fallback → systematically under-reported blast radius (the exact bug the throw was added to prevent).
- **Fix sketch**: Table-test `severityForAgentCount` at counts 0,1,2,3,4 → low/medium/medium/high/high. Test `fromAgentNodeId` throws on a raw UUID (no `agent:` prefix) and on `'agent:'` with empty suffix, and round-trips `toAgentNodeId`/`fromAgentNodeId`. Test `buildCredentialGraph` does not throw for well-formed deps. Invariant to assert: "an id that violates the agent-node contract fails loudly, never silently degrades."

## 4. extract_healthcheck_config_result skip-path / OR-key semantics untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/credential_design.rs:102-104 (extractor); consumed at src-tauri/src/commands/credentials/credential_design.rs:142-161
- **Current test state**: none (credential_design.rs engine tests cover `extract_credential_design_result` thoroughly but never the healthcheck extractor)
- **Scenario**: `extract_healthcheck_config_result` keys on `&["skip", "endpoint"]` (OR semantics in `extract_json_by_key`). The healthcheck command branches on `config.skip == true` to short-circuit before any SSRF-validated HTTP call. If the extractor stopped matching a `{"skip": true, "endpoint": null}` block (e.g. a future change requires `endpoint` to be present), `test_credential_design_healthcheck` would treat "Claude said skip" as an extraction failure and surface a confusing error, OR worse, fall through and attempt a request with a null endpoint. The OR-discriminant + the skip short-circuit are both untested at the unit level.
- **Root cause**: The healthcheck prompt/extractor pair was added without a matching test, unlike its sibling `extract_credential_design_result`.
- **Impact**: Silent breakage of the "no safe test endpoint → skip gracefully" UX, or a malformed request slipping past the extractor into the SSRF-validated request builder.
- **Fix sketch**: Engine unit tests: (a) fenced `{"skip":true,"reason":"no endpoint"}` extracts (matches on `skip` alone); (b) `{"endpoint":"https://api.x/me","method":"GET"}` extracts (matches on `endpoint` alone); (c) a block with neither key returns `None`. Optionally a command-level test asserting `skip:true` returns `success:false` with the reason echoed, without performing a network call. Invariant: the skip-discriminant must keep working independently of `endpoint`.

## 5. build_credential_design_prompt: non-Google OAuth + duplicate-avoidance rules unasserted
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/credential_design.rs:9-52 + schema rules 11/1 in CREDENTIAL_DESIGN_OUTPUT_SCHEMA
- **Current test state**: exists-but-weak (tests cover Google guidance presence/absence and existing-connector listing, but not the schema's load-bearing instruction content)
- **Scenario**: The prompt is the entire business logic here — it tells Claude (rule 1) to set `match_existing` to avoid duplicate connectors, and (rule 11) how non-Google OAuth providers must include `client_id`/`client_secret`/`access_token` and set `oauth_type`. Existing tests assert the Google branch but never assert these always-present rules survive prompt edits. A refactor that drops the `match_existing` instruction would let the design path spawn duplicate connectors; dropping rule 11 would produce broken non-Google OAuth connectors. Both pass today.
- **Root cause**: Prompt content is treated as a string blob; only the conditional Google section has assertions.
- **Impact**: Duplicate connector proliferation in the catalog; mis-shaped OAuth connectors for Microsoft/GitHub/Slack/etc. that fail later at auth time — degrading the connector-binding flow.
- **Fix sketch**: Assert the base prompt always contains the `match_existing` duplicate-avoidance instruction and the non-Google OAuth `client_id`/`client_secret`/`access_token` + `oauth_type` guidance. Keep assertions to load-bearing phrases (avoid brittle full-string snapshots). llm-generatable. Invariant: "core schema rules that gate connector shape are always present regardless of the Google branch."

## 6. instruction_mentions_google substring false-positive risk
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/credential_design.rs:111-127
- **Current test state**: exists-but-weak (test_google_heuristic_case_insensitive covers true positives + a couple negatives, but no false-positive / word-boundary cases)
- **Scenario**: Detection is a naive case-insensitive `contains`. Any instruction whose text happens to contain a keyword as a substring — e.g. a service literally described as "Googly Eyes API" won't match, but "googlebot analytics" or a company name embedding "gcloud"/"gdrive" — flips the connector design into Google-OAuth-priority mode, forcing `client_id`/`client_secret`/`refresh_token` onto a service that uses a plain API key. The existing test never probes a near-miss.
- **Root cause**: Heuristic chosen for simplicity; no adversarial/negative test pins the intended boundary, so it's unclear whether substring matching is intended or a latent bug.
- **Impact**: Wrong credential field set proposed for non-Google services that incidentally contain a keyword → user confusion and a non-functional connector.
- **Fix sketch**: Add negative cases that document the intended contract (e.g. assert a service description containing an unrelated word that embeds `"gcloud"` does/does-not trigger). If word-boundary matching is the intent, the test will force the fix; if substring is intentional, the test documents it. Invariant: the Google branch fires only for genuine Google-family services.

## 7. build_step_help_prompt 1-based step number not asserted
- **Severity**: low
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/credential_negotiator.rs:84-116; test at 316-322
- **Current test state**: exists-but-weak
- **Scenario**: The prompt renders `step {step_index + 1}` to show the user a 1-based step number from a 0-based index. The existing test passes index `1` and asserts the title/question appear, but never asserts the rendered number is "2" — so an off-by-one regression (dropping the `+ 1`, or double-incrementing) would show "step 1" for the second step and the test stays green.
- **Root cause**: Test checks substrings that don't include the computed display number.
- **Impact**: Minor UX confusion (user told the wrong step number while provisioning credentials).
- **Fix sketch**: Extend the existing test to assert the prompt contains the human-facing "step 2" string for `step_index = 1`, and add a case for `step_index = 0` asserting "step 1". Invariant: displayed step number is `index + 1`.
