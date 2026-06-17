# Test Mastery — Connector Catalog
> Total: 7 findings (1 critical, 2 high, 3 medium, 1 low)

## 1. `simulateRevocation` is entirely untested — revenue/executions-loss numbers shown to users carry zero assertions
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:246-318
- **Current test state**: none (credentialGraph.test.ts covers only `buildCredentialGraph` edge dedupe + `analyzeBlastRadius` via-labels; `simulateRevocation` is never imported)
- **Scenario**: The revocation simulator is the vault's "what breaks if I rotate this credential" decision surface. It computes `estimatedDailyExecutionsLost` (`Math.round(recentExecutions / 7)` summed), `estimatedDailyRevenueLost` (sum of `dailyBurnRate`, rounded to cents), `totalAffectedPersonas`, the severity bucket, and `failoverSuggestions` (other vault creds with the same `service_type`). A regression that double-counts an agent, sums burn rate wrong, rounds incorrectly, or includes the revoked credential itself in failover suggestions would silently mislead a user into rotating a credential they think is safe — or scare them off rotating one that is. None of that math is asserted today.
- **Root cause**: The component (`CredentialRelationshipGraph.tsx`) wires this in via `useMemo`, but the pure function was never given direct tests; the only test file stops at blast-radius.
- **Impact**: Users make rotation/revocation decisions off fabricated-but-plausible impact numbers. Wrong revenue-loss/executions-loss is a credibility and operational-safety failure (rotate the wrong key → outage; skip rotating a leaked key → security exposure).
- **Fix sketch**: LLM-generatable batch against `simulateRevocation`. Assert business invariants, not snapshots: (a) each affected persona counted exactly once even across multiple link_types; (b) `estimatedDailyExecutionsLost === Σ round(recentExecutions/7)` for a known fixture; (c) `estimatedDailyRevenueLost` is the burn-rate sum rounded to 2 decimals; (d) `failoverSuggestions` excludes the revoked credentialId and includes only same-`service_type` creds, carrying their `healthcheck_last_success`; (e) returns `null` for a non-credential / missing node; (f) `severity` matches `severityForAgentCount(affectedPersonas.length)`. Reuse the fixtures already in credentialGraph.test.ts plus a `PersonaHealthSignal[]` builder.

## 2. `credential_is_usable` — the gate that decides whether a persona executes blind — has no direct test for last-failed / staleness / empty-fields demotion
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/connector_readiness.rs:446-531 (`credential_is_usable`, `resolve_ready_credential`, `parse_credential_ts`)
- **Current test state**: exists-but-weak — `connector_readiness` has an excellent suite, but every Credential-class test inserts only `(id, service_type)` into a stub schema that lacks the `credential_fields` and `metadata` columns these functions read. So `credential_connector_needs_a_vault_row` actually exercises `resolve_one_credential`, NOT the readiness refinement; the "ready only if usable" branch is never hit with real field/ledger data.
- **Scenario**: A credential that exists and binds uniquely but is (a) zero-field (`data:{}`), (b) last-healthcheck-failed (`healthcheck_last_success == Some(false)`), or (c) stale (fields edited after the last success) must demote the persona to NeedsSetup — the explicit fix for bug-hunt 2026-06-07 #4 ("executes blind"). If a refactor regresses any of these three branches, a persona promotes to Ready and runs with an empty/broken/stale credential, failing every run.
- **Root cause**: The in-memory test schema omits `credential_fields` and `persona_credentials.metadata`, so the usable-credential refinement and `parse_credential_ts` are structurally unreachable from the existing tests.
- **Impact**: The "ready" badge lies; autonomous/scheduled personas burn runs (and tokens) executing against unusable credentials with no surfaced blocker — the exact silent-failure class the resolver was built to kill.
- **Fix sketch**: Extend `test_db()` with `credential_fields(credential_id, encrypted_value, updated_at)` and a `metadata` column on `persona_credentials`. Add cases: empty-fields → NeedsSetup; `healthcheck_last_success=false` → NeedsSetup; fields edited after last success (both RFC3339 and SQLite `%Y-%m-%d %H:%M:%S` timestamps) → NeedsSetup; never-probed (`None`) with a real field value → Ready; unparseable timestamp keeps the success-based verdict (fail-safe, not over-reject). Also unit-test `parse_credential_ts` directly on both formats + garbage.

## 3. `analyzeBlastRadius` severity bucketing and `severityForAgentCount` thresholds untested — the "rotate now" urgency signal
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:74-81, 154-202
- **Current test state**: exists-but-weak — the blast-radius test asserts agent dedupe + `via` label only; it never asserts `severity`, never crosses the 1/3 thresholds, and never exercises `affectedEvents` collection.
- **Scenario**: `severityForAgentCount` maps 0→low, 1-2→medium, 3+→high, and both `analyzeBlastRadius` and `simulateRevocation` route their UI urgency through it (documented as the single source of truth so the two surfaces can't drift). An off-by-one or threshold-constant edit silently downgrades a 3-agent credential from "high / rotate now" to "medium / degraded" — exactly the ops-feedback distinction the constants encode.
- **Root cause**: Severity is a derived field nobody asserted; the threshold constants (`BLAST_RADIUS_THRESHOLDS`) have no test pinning their behavioral meaning.
- **Impact**: Mis-bucketed severity changes the color/urgency the operator sees, leading to delayed rotation of high-blast-radius credentials.
- **Fix sketch**: LLM-generatable. Table-test `severityForAgentCount` at boundaries (0,1,2,3,4) → low/medium/medium/high/high. Add `analyzeBlastRadius` cases for 0/1/3 affected agents asserting `severity` AND that `affectedEvents` dedupes (the Set guard at line 181). Assert the two functions agree on the same count.

## 4. Connector `create`/`update` persist `fields`/`metadata`/`services`/`events`/`healthcheck_config` as raw strings with no JSON-validity check or test
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/connectors.rs:71-204
- **Current test state**: adequate for name/label validation + defaults + CRUD round-trip; none for the JSON blob columns.
- **Scenario**: A custom connector created via `create_connector` (privileged command) can store a structurally-broken `fields` array or `metadata` object. It persists fine, then breaks downstream: `classify_connector` falls back to `Credential` on unparseable metadata (silent misclassification), and the vault form / `llm_usage_hint` injection chokes at runtime. Nothing asserts whether the layer accepts or rejects this — so the current (accept-anything) behavior is undocumented and any future "validate JSON" change has no guard either way.
- **Root cause**: The blob columns are pass-through `TEXT`; tests only cover the scalar validation paths.
- **Impact**: A bad custom-connector definition silently degrades classification/readiness and runtime prompt assembly for every persona that binds it.
- **Fix sketch**: Decide the contract and pin it: either (a) add a test asserting malformed `fields`/`metadata` JSON is rejected with `AppError::Validation` (preferred — fail at write time), or (b) if accept-anything is intentional, add a test documenting that `classify_connector` degrades a malformed-metadata connector to `Credential` rather than panicking, so the fallback is a tested guarantee.

## 5. `StrategyRegistry::get` resolution priority (metadata `oauth_type` override, substring fallback) is only partially covered
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/connector_strategy.rs:187-264
- **Current test state**: exists-but-weak — `registry_routes_gcp_cloud_to_gcp_strategy` covers exact-match only; the metadata-override and substring tiers are untested.
- **Scenario**: `get` resolves a strategy in 4 tiers: exact name → `metadata.oauth_type` override (`google`/`microsoft`) → service_type substring (`google`/`clickup`) → default. The strategy chosen decides the auth header shape (Bearer vs `Circle-Token` vs Basic vs query-param). A regression in tier ordering (e.g. substring matching before an exact registration, or a metadata-override miss) sends the wrong auth header → every API proxy call and healthcheck for that connector 401s.
- **Root cause**: Only the exact-match tier was tested; the precedence between tiers is the part most likely to break on edit and is unguarded.
- **Impact**: Mis-routed OAuth/Atlassian/Buffer/CircleCI/ClickUp credentials authenticate with the wrong scheme → silent connector death across a whole service family.
- **Fix sketch**: LLM-generatable. After `init_registry()`, assert: a connector whose name has no exact match but `metadata={"oauth_type":"google"}` resolves to a strategy reporting `is_oauth==true`; `service_type="mygoogleapp"` (substring) routes to google-oauth; `service_type="clickup_v2"` routes to ClickUp's raw-Authorization `apply_auth`; an unknown service_type falls to default (Bearer). Assert exact-match wins over a conflicting substring.

## 6. `is_revocation_error` (OAuth grant-revoked detection) has no test
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src-tauri/src/engine/connector_strategy.rs:491-505
- **Current test state**: none.
- **Scenario**: This pure function decides whether a failed token refresh is a permanent revocation (`AppError::OAuthRevoked` → tell the user to re-authorize) versus a transient error (retry). Miss a revocation indicator and the refresh engine retries a dead grant forever, burning calls and never surfacing "re-connect"; over-match and a transient blip wrongly marks a healthy credential as revoked.
- **Root cause**: Pure string-matcher added without a test; the indicator list is the kind of thing that silently loses an entry on refactor.
- **Impact**: Either zombie-retry loops on permanently-revoked OAuth credentials, or false re-auth prompts for transient failures.
- **Fix sketch**: LLM-generatable; assert the business invariant "classifies a provider error body as revoked iff it carries a revocation indicator." True cases: `invalid_grant`, `unauthorized_client`, `interaction_required`, `consent_required`, and the Google phrase "Token has been expired or revoked" (test case-insensitivity). False cases: `temporarily_unavailable`, `rate_limited`, empty body, a 500 HTML page.

## 7. `explore_url` advisory `notes` branching (JS-render / truncation / empty-discovery / 4xx) is untested
- **Severity**: low
- **Category**: test-structure
- **File**: src-tauri/src/engine/connector_explorer/mod.rs:150-181
- **Current test state**: adequate for the pure scan/cluster helpers (`extract_endpoints_from_html`, `cluster_endpoints`, `slugify_host`, `parameterise_path`, `extract_title` all have good tests); none for the note-assembly logic, which is buried inside the async `explore_url` and so isn't reachable without a live HTTP fetch.
- **Scenario**: The `notes` field is the human reviewer's only signal that a foraged connector draft is incomplete ("heavily JS-rendered", "body truncated", "no endpoints discovered", "HTTP 4xx"). If a refactor breaks the JS-render heuristic (`>20 <script> tags && <3 clustered endpoints`) or the empty-discovery note, a reviewer accepts a hollow draft as complete.
- **Root cause**: Note assembly is inlined in the network-bound async fn; the testable decision logic isn't extracted into a pure helper.
- **Impact**: Low — advisory text only, not a data-integrity or auth path; but a hollow connector draft that looks complete wastes reviewer trust.
- **Fix sketch**: Extract a pure `fn build_notes(body: &str, clustered_len: usize, status: i32, truncated: bool, total_bytes: usize, max_bytes: usize) -> Vec<String>` and unit-test each branch (JS-render heuristic fires/doesn't, truncation note, 4xx note, empty-discovery note). No network needed; keeps `explore_url` a thin wrapper.
