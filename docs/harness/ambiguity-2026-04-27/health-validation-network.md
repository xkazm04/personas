# Ambiguity Audit — Health, Validation & Network

> Total: 12 findings (2 critical, 4 high, 5 medium, 1 low)
> Files read: ~17
> Scope: Agent health-check UI, health digest scheduler/prefetch, validation API surface, network bundle/discovery/identity API, and network/uiSlice store wiring (TS/React only).

## 1. Shared `networkConsecutiveFailures` counter masks per-endpoint outages

- **Severity**: high
- **Category**: trade-off-hidden
- **File**: src/stores/slices/network/networkSlice.ts:40-54, 419-525
- **Scenario**: All three pollers (`fetchDiscoveredPeers`, `fetchNetworkStatus`, `fetchNetworkSnapshot`) share one counter, and ANY success — even from one poller — resets the others' failure history. The block comment notes "a healthy snapshot every 30s will mask intermittent status-poll failures — accepted tradeoff", but only one specific poller is named. There's no recorded reasoning that defines what "intermittent" means or how often the masking is acceptable.
- **Root cause**: The "accepted tradeoff" was decided 2026-04-20 on the assumption that all three commands hit the same Rust `NetworkService`. Future divergence (different transports, different crash modes) would make the assumption silently invalid.
- **Impact**: If the snapshot endpoint succeeds while another endpoint (say `getDiscoveredPeers`) reliably fails, the user will never see a "Network backend unreachable" warning, and stale peer data could appear current indefinitely.
- **Fix sketch**:
  - Encode the "single backing service" assumption as a named invariant referenced at every call site.
  - Add a watchdog test: simulate ONE poller permanently failing and verify the warning surfaces (or accept the silent path with a recorded rationale tied to a backend invariant).
  - Consider a per-endpoint failure map keyed by command name when/if the backend service splits.

## 2. `isTimestampStale` returns `true` for `null` — collides with "never run" semantics

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/stores/slices/agents/healthCheckSlice.ts:19-22; src/features/agents/health/HealthDigestPanel.tsx:140-141, 224-238
- **Scenario**: `isTimestampStale(null)` returns `true`. In `HealthDigestPanel` the staleness banner is rendered only inside the "digest exists" branch, so a null `lastDigestAt` will never reach the banner. But `useHealthDigestPrefetch` and other call sites use the same boolean to decide whether to *trigger* a refetch — `null` and "15 minutes old" are conflated.
- **Root cause**: The function overloads two distinct concepts (never-run vs. expired) with the same return value, with no docblock explaining which callers should distinguish them.
- **Impact**: A future caller that uses `isTimestampStale` to gate a destructive operation (e.g., "if stale, drop cached digest before showing UI") would unintentionally treat a fresh-but-pending null state as expired data. The opposite mistake — assuming `false` means "fresh, run is recent" — is also possible.
- **Fix sketch**:
  - Split into `isTimestampStale(iso): boolean` (false on null) and `needsRefresh(iso): boolean` (true on null) with docs naming each call site's intent.
  - Or return a 3-state union (`'never' | 'stale' | 'fresh'`) and force callers to acknowledge the null case.

## 3. Health-fix `hc_uc_${Date.now()}` IDs collide on rapid double-apply

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/health/useApplyHealthFix.ts:47
- **Scenario**: When `ADD_USE_CASE_WITH_DATA` runs, the new use case ID is `hc_uc_${Date.now()}`. If a user clicks "Apply fix" on two issues within the same millisecond (or React strict mode double-invokes the callback), both inserted use cases have the same ID. Compare with `makeIssueId()` in useHealthCheck.ts:116-122, which deliberately uses `crypto.randomUUID()` to avoid this exact problem.
- **Root cause**: Two ID generation strategies coexist in the same feature folder; the inferior one was never updated to match.
- **Impact**: Duplicate React keys, broken update/delete by ID, possible silent overwrite when the persona is later persisted. No error surfaces — just silent corruption of the design context.
- **Fix sketch**:
  - Replace with `makeIssueId()`-style UUID (or extract a shared `makeUseCaseId` helper).
  - Add a unit test that applies the same fix twice in a tight loop and asserts unique IDs.

## 4. `inferSeverity` defined twice with subtly different fallback chains

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/agents/health/useHealthCheck.ts:125; src/stores/slices/agents/healthCheckSlice.ts:42; src/features/agents/health/healthHelpers.ts:12
- **Scenario**: Three modules each export/alias `inferSeverity = inferIssueSeverity`, with healthHelpers.ts calling itself the "shared" copy and the other two re-aliasing the same upstream symbol. There's no single import path documented as canonical, and `mapOverallStatus` is also duplicated verbatim across useHealthCheck.ts:127 and healthCheckSlice.ts:44.
- **Root cause**: A migration extracted `inferIssueSeverity` to `errorTaxonomy` but didn't delete or unify the local aliases. New contributors don't know which file to import from.
- **Impact**: A future tweak to `mapOverallStatus` (e.g., recognising "warning" as `partial`) needs to be made in both places or behaviours diverge silently between per-persona and digest views.
- **Fix sketch**:
  - Pick one canonical home (probably healthHelpers.ts), re-export `mapOverallStatus` and `inferSeverity` from there only.
  - Delete the duplicate `mapOverallStatus` in healthCheckSlice.ts.

## 5. `HEALTH_SCORING.errorPenalty = 25` makes 4 errors = 0 — but cutoff math has gaps

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/agents/health/useHealthCheck.ts:47-57
- **Scenario**: The constants are documented (4 errors → 0, 3 warnings → degraded) but the implication isn't: a persona with one error + 4 warnings yields `100 - 25 - 40 = 35` → `unhealthy`. Whether this should outrank a 2-error case (`100 - 50 = 50` → `degraded`) is unstated. The cutoffs (80, 50) are not tied to any UX research or product decision recorded in the file.
- **Root cause**: Penalty weights and cutoffs were chosen as plausible defaults, then justified post-hoc in a comment. The product-level question "does our grading match user mental models?" is not on record.
- **Impact**: When a future request comes in to "make the health score less harsh", contributors will tune numbers without understanding which scenarios the current bands were designed to catch. Tests that lock in current behaviour exist as a constraint, not a rationale.
- **Fix sketch**:
  - Add a table to the docblock: example issue counts → expected score/grade (especially boundary cases).
  - Link to the requirement/spec or an explicit "we picked these to match X heuristic" rationale.

## 6. Empty `catch {}` in digest single-persona check directly violates documented policy

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/stores/slices/agents/healthCheckSlice.ts:83-86; src/features/agents/health/useHealthCheck.ts:1-22 (policy doc)
- **Scenario**: useHealthCheck.ts's module-level docblock states **"An empty `catch {}` is never acceptable — 'healthy' must never mean 'the backend command threw and we pretended it was fine'."** Then `checkSinglePersona` in the digest slice does exactly that — swallows IPC errors with a comment "non-critical; caller aggregates via Promise.allSettled". The persona just disappears from the digest with no info-issue, no breadcrumb, no Sentry capture.
- **Root cause**: The policy was added to the per-persona path but never propagated to the aggregate digest path. The "intentional" comment justifies the swallow without acknowledging the policy contradiction.
- **Impact**: A persona whose feasibility check is consistently failing (e.g., bad design_context shape) will silently vanish from the weekly digest. The user sees "all healthy" while the broken persona is just absent. Errors never reach Sentry.
- **Fix sketch**:
  - Route through `silentCatch('healthCheckSlice:checkSinglePersona')` like the per-persona module does.
  - Either return a stub `PersonaHealthCheck` with a single info-severity "could not run" issue, or surface the count of failed personas in the digest summary.
  - Update digest UI to show "N personas could not be checked" when `checks.length < personas.length`.

## 7. `setEditorTab('settings')` after digest navigate doesn't open the Health sub-tab

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/agents/health/HealthDigestPanel.tsx:142-145
- **Scenario**: When a user clicks a persona row in the digest, the code sets the editor tab to `'settings'` with the comment `// Navigate to settings tab where health check will be accessible`. But the actual health surface lives at `editorTab='design'` + `designSubTab='design'` per the `setEditorTab` migration in uiSlice.ts:154 (`tab === "health"` → `design`/`design`). The legacy "settings" tab no longer holds the health check.
- **Root cause**: The "settings" string was either a stale name from a pre-migration layout, or a bet that the settings tab still surfaces health info. Neither is documented at the call site.
- **Impact**: Users clicking a "blocked" persona row land on an unrelated settings page — silent navigation bug that makes the digest's main affordance feel broken.
- **Fix sketch**:
  - Replace with `setEditorTab('design')` and `setDesignSubTab('design')` (or whichever sub-tab now hosts HealthCheckPanel).
  - Add a Playwright/integration test: click digest row → assert health panel is visible.

## 8. `HealthWatchToggle` interval/threshold are inline magic numbers with no docs

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/agents/health/HealthCheckPanel.tsx:273-277
- **Scenario**: `interval_hours: 6, error_threshold: 30` are hardcoded in the request body. There's no UI to configure them, no constant naming them, and no comment about why 6 hours / 30 errors. The backend reads these directly, so these are de-facto product policy.
- **Root cause**: The "watch" feature was likely shipped with sensible defaults, but the defaults are now invisible — there's no place a contributor can read to understand why agents alert at 30 errors and not 10 or 100.
- **Impact**: When a user complains "why didn't health watch alert me sooner?", the answer requires a code search. Future work to expose these as user settings will hit unstated assumptions about what "default" means.
- **Fix sketch**:
  - Extract `HEALTH_WATCH_DEFAULTS = { interval_hours: 6, error_threshold: 30 }` with a docblock explaining the rationale.
  - Surface these in the toggle's `title` tooltip or a settings page.

## 9. `useHealthDigestScheduler` retry contract is "restart the app"

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/features/agents/health/useHealthDigestScheduler.ts:67-76
- **Scenario**: A failed digest run latches `ran.current = true` to avoid retry storms. The comment explicitly says: "the user retries by restarting the app (or an explicit Settings 'Run digest now' button)". The button is referenced but no link/anchor proves it exists; if the Settings page never shipped that button, the user has no in-app recovery path.
- **Root cause**: The retry policy compromise was made without verifying the explicit fallback affordance shipped.
- **Impact**: If the digest fails on app launch (e.g., DB lock contention), the weekly digest silently never runs until the next launch. For a once-a-week feature, that could mean 14 days between digests.
- **Fix sketch**:
  - Verify the "Run digest now" Settings button exists; add a TODO/test if not.
  - Consider a one-time, exponential backoff retry within the same session (e.g., 30s after first failure) instead of full latch.

## 10. `coerceIssueText` silently drops malformed issues — no signal in score

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/agents/health/useHealthCheck.ts:211-226, 236-248
- **Scenario**: When the backend returns issues that don't match any known shape (not string, not object with description/message/text/detail), `coerceIssueText` returns `null` and the entry is silently skipped. The user sees a smaller issue list and a higher score; the dropped issues never surface anywhere.
- **Root cause**: The coercion was added defensively against a possible backend evolution, but "couldn't render this entry" is treated as "never existed" rather than "we hid one".
- **Impact**: A backend upgrade that ships richer issue objects with a non-standard key would silently degrade health scores upward — exactly the failure mode the file's own policy docblock warns against.
- **Fix sketch**:
  - When entries are dropped, append one info-severity issue: `"N raw issues could not be displayed (unknown shape)"`.
  - Log a `silentCatch` breadcrumb with `typeof entry` for telemetry.

## 11. Digest batch size 5 is a bare magic number with no concurrency rationale

- **Severity**: low
- **Category**: magic-number
- **File**: src/stores/slices/agents/healthCheckSlice.ts:131-143
- **Scenario**: `const batchSize = 5` runs personas in batches of 5 via `Promise.allSettled`. No comment explains why 5 (IPC concurrency? API rate limits? Backend thread pool size?).
- **Root cause**: A reasonable default that was never tied to a backend constraint.
- **Impact**: A user with 100 personas waits N/5 sequential rounds. Tuning this requires re-deriving the rationale from scratch.
- **Fix sketch**:
  - Either name a constant `MAX_CONCURRENT_FEASIBILITY_CHECKS = 5` with a comment about the upstream constraint, or replace with a config that the Rust side can dictate.

## 12. `auto_match_credentials` uses `service_type` as map key — first match wins silently

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/agents/health/useApplyHealthFix.ts:30-39; src/features/agents/health/useHealthCheck.ts:158-163
- **Scenario**: `AUTO_MATCH_CREDENTIALS` walks the user's credential list and links the first credential whose `service_type` matches an unlinked connector. If the user has two Google credentials (work + personal), one of them is silently chosen by list order. The "Apply fix" button says only `Auto-match all credentials` with no preview.
- **Root cause**: The proposal generator at useHealthCheck.ts:158-163 falls back to "all credentials" without recording that there can be ambiguity — and the executor blindly picks the first.
- **Impact**: A persona meant to act on the user's work account could silently get linked to their personal credential. There's no audit trail in the design_context, no toast saying which credential was chosen, no undo. This is a security/trust boundary (who the agent acts as) decided by array iteration order.
- **Fix sketch**:
  - When multiple credentials of the same `service_type` exist, refuse auto-match and prompt the user to pick.
  - Log the selected credential ID in the success toast: `Linked Google → "work@example.com"`.
  - Add a guardrail unit test: `credentials = [workGoogle, personalGoogle]` → expect ambiguity error, not silent first-match.
