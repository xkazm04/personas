# Test Mastery — Self-Healing & Auto-Rollback
> Total: 7 findings (2 critical, 2 high, 2 medium, 1 low)

## 1. `auto_rollback_tick` decision logic is entirely untested — the highest-blast-radius path in the context
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/auto_rollback.rs:34-395
- **Current test state**: none
- **Scenario**: The whole auto-rollback decision pipeline (weighted error-rate compute, current/previous version selection by `production` tag, date-window partitioning of daily points, the `2x`-or-`0.1` threshold, the "is the target genuinely healthier?" guard at lines 302-318, and the min-3-executions gate) has zero tests. A regression that flips a comparison, drops the production-tag selection back to highest-version-number (re-introducing the documented infinite-rollback loop, lines 114-119), or weakens the `ROLLBACK_TARGET_MAX_ERROR_RATE` ceiling would silently ship. Auto-rollback rewrites a persona's production prompt automatically with no human in the loop — a wrong rollback degrades a customer's live agent.
- **Root cause**: `auto_rollback_tick` mixes DB calls and `app.emit` in one function, so it was never refactored into testable pure pieces the way `healing.rs`/`healing_orchestrator.rs` were. Only `compute_weighted_error_rate` is pure today, and even it is untested.
- **Impact**: Silent regression auto-demotes a healthy production prompt, or fails to roll back a broken one, or oscillates every 5-minute tick — directly hurting the running fleet and eroding trust in the Pro auto-rollback feature.
- **Fix sketch**: Extract the per-persona decision into a pure function, e.g. `fn decide_rollback(versions: &[PromptPerformancePoint/version], perf: &PromptPerformance, now) -> RollbackDecision { RollBack{to}, WithinThreshold, SkipNotHealthier, SkipInsufficientData }`, then unit-test: (a) current 2x previous → RollBack; (b) current above threshold but previous error-rate >= current → SkipNotHealthier (the line 303 guard — the "80%→90% lands on still-broken" case); (c) previous error-rate > 0.5 ceiling → Skip; (d) <3 current executions → SkipInsufficientData; (e) noise floor: previous=0%, current=5% must NOT roll back (threshold floored at 0.1). Invariant to assert: **a rollback fires only when the target version is strictly healthier AND below the 50% ceiling AND the 2x/0.1 threshold is cleared.**

## 2. `perform_rollback` (auto) has diverged from the manual `rollback_prompt_version` it claims to mirror — and the atomic/anti-Frankenstein guarantee is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/auto_rollback.rs:405-473
- **Current test state**: none (the manual sibling in `prompt_lab.rs:82` has tests; the auto path does not)
- **Scenario**: `perform_rollback`'s doc says it "mirrors the logic in observability.rs rollback_prompt_version," but they now behave differently: the auto path writes **both** `structured_prompt` and `system_prompt` atomically (NULLing absent fields) and **aborts** if the target version has neither field (lines 416-425); the manual `rollback_prompt_version` uses `if let Some(...)` guards and only writes present fields — producing exactly the mixed-version "Frankenstein" prompt the auto path was hardened against. With no test pinning the auto contract, a future "consistency" refactor could silently re-align it to the weaker manual behavior. There is also no test that the demote-all-production-then-promote sequence (lines 457-468) leaves exactly one `production` row.
- **Root cause**: Two rollback implementations exist with a stale "mirrors" comment and no test enforcing the stronger invariant on the automated one. The behavior is DB-mutating, so it needs an in-memory rusqlite fixture rather than a pure unit test, which is why it was skipped.
- **Impact**: A persona whose rollback target has only one prompt field gets a prompt half from the new version and half from the old — undefined agent behavior on a live, paying persona — or two versions both tagged `production`, breaking the next tick's current-version selection.
- **Fix sketch**: Add `#[cfg(test)]` tests using an in-memory SQLite pool: (a) version with only `system_prompt` → persona `structured_prompt` ends NULL (no leftover from prior version); (b) version with neither field → returns `AppError::Validation` and persona row unchanged; (c) after rollback, `SELECT count(*) WHERE tag='production'` == 1 and it is the target. Invariant: **after a rollback both prompt fields originate from exactly one version, and exactly one version is tagged production.** (Also worth flagging the stale "mirrors" comment, but the test is the load-bearing fix.)

## 3. `run_healing_analysis` auto-fix gate (orphan-retry & dedup paths) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/healing_timeline.rs:142-301
- **Current test state**: none (the pure `diagnose`/`evaluate` it calls are well tested; the orchestration around them is not)
- **Scenario**: This function decides which failures become auto-scheduled retries vs manual issues. Key business rules live ONLY here: the `is_usage_limit_retry` carve-out that bypasses the `consecutive < 3` gate (lines 258-267), the "only schedule one retry per analysis pass" `retry_scheduled` latch (line 279), and the guard that skips `auto_fixed += 1` when `mark_auto_fix_pending` fails so no orphaned retry is scheduled (lines 270-275). None are pinned. A regression that increments `auto_fixed`/pushes a retry despite a failed `mark_auto_fix_pending`, or that schedules N retries in one pass, would over-spend the CLI fleet (cost/usage impact) and corrupt the auto_fixed counter the UI displays.
- **Root cause**: The function takes a `&DbPool` and fans out to many repos, so it needs a seeded in-memory DB; that friction left it untested while the extracted pure functions got coverage.
- **Impact**: Runaway or orphaned retries (cost + provider-usage burn), or an `auto_fixed` count that overstates what was actually repaired (success theater in the analysis-complete banner).
- **Fix sketch**: In-memory-DB tests: (a) two auto-fixable failures → exactly one `HealingRetryRequest` returned (latch); (b) usage-limit `RetryAt` failure with `consecutive_failures >= 3` → still scheduled (carve-out); (c) simulate `mark_auto_fix_pending` failure → `auto_fixed` not incremented and no retry pushed; (d) duplicate persona+execution → `dedup_skipped` audit row and `issues_created` not incremented. Invariant: **`auto_retried <= 1` per pass and `auto_fixed` counts only successfully-pended fixes.**

## 4. `build_healing_timeline` outcome-status and knowledge-matching logic untested (and feeds the UI directly)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/healing_timeline.rs:317-506
- **Current test state**: none
- **Scenario**: The outcome-status derivation (lines 426-437: `circuit_breaker` > `auto_healed` > `resolved` > `retrying` > `open`) and the knowledge-entry category-matching (lines 469-499, including the `pattern_key.split(':')` prefix match) are pure-enough mapping logic that the `HealingTimeline.tsx` component renders verbatim. A wrong precedence (e.g. an auto-fixed-but-still-pending issue showing "auto healed") misreports resilience health to operators. The retry-event filter `exec.retry_count > 0` and the chronological newest-first sort are also unpinned.
- **Root cause**: Sits behind repo calls; the genuinely pure sub-logic (status precedence, KB matching, sort) was never factored out for direct unit testing.
- **Impact**: The healing/resilience timeline — the operator's primary self-healing observability surface — silently misclassifies outcomes, undermining incident triage.
- **Fix sketch**: Extract the outcome-status decision into a pure `fn outcome_status(issue: &PersonaHealingIssue) -> &'static str` and unit-test all five branches plus precedence (circuit_breaker beats resolved). Extract KB category-match into a pure predicate and test the `service_type` exact-match AND the `pattern_key` prefix-before-`:` match. Invariant: **status precedence is total and ordered; a KB entry surfaces iff its service_type or pattern-prefix appears in the persona's issue categories.**

## 5. Healing-timeline grouping/sorting in `HealingTimeline.tsx` is pure, business-meaningful, and untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/overview/sub_observability/components/HealingTimeline.tsx:212-254
- **Current test state**: none (no `src/**/*.test.tsx` exist, but `src/test/setup.ts` + `tauriMock` infra is in place and vitest is configured for jsdom)
- **Scenario**: The `useMemo` reducer groups events by `chainId`, orders events within a chain by a fixed `{trigger,classify,retry,ai_heal,outcome}` rank, splits out knowledge events, and sorts chains newest-trigger-first. If chain grouping or the intra-chain ordering breaks, the resilience narrative renders out of order (retry shown before trigger), but nothing would catch it. This is exactly the kind of pure transform a generated test batch closes cheaply.
- **Root cause**: The transform is inlined in the component, and the project has zero component/unit tests under `src/features`, so no precedent existed to add one.
- **Fix sketch**: Extract the grouping reducer to a pure helper (`groupHealingChains(events)`) and LLM-generate a vitest batch. Assert business invariants (not snapshots): events within a chain are ordered trigger→classify→retry→outcome; knowledge events are separated; chains are sorted by trigger timestamp descending; an event with an unknown `eventType` lands at the retry rank (the `?? 2` default). Invariant: **chain ordering is stable and rank-correct regardless of input order.**

## 6. `formatTimestamp` uses `Date.now()` with no injectable clock — determinism risk for any test that touches it
- **Severity**: medium
- **Category**: flaky-nondeterministic
- **File**: src/features/overview/sub_observability/components/HealingTimeline.tsx:32-38
- **Current test state**: none
- **Scenario**: `formatTimestamp` computes age from `Date.now()` and branches on `<1h`/`<24h`/days. Any future test of the timeline that doesn't freeze the clock will be time-of-day dependent and flaky (a fixture timestamp crosses an hour boundary mid-CI-run). Boundary behavior (exactly 1h, exactly 24h, future timestamps yielding negative age → "just now"?) is also unspecified and untested.
- **Root cause**: Wall-clock read embedded in a formatter with no seam for a fixed `now`.
- **Impact**: Flaky timeline tests get muted/skipped, masking real regressions; negative-age (clock-skew) inputs may render nonsense like "-2h ago".
- **Fix sketch**: When adding the finding-#5 batch, freeze time via `vi.setSystemTime(...)` in the test, and add boundary cases (0h, 59m, 1h, 23h, 24h, and a future timestamp). Longer-term, accept an optional `now` arg. Invariant: **for a fixed clock, age buckets are exact at the boundaries and future timestamps never render a negative age.**

## 7. `AiHealingCounters` phase→label/dot mapping has no test
- **Severity**: low
- **Category**: llm-generatable
- **File**: src/features/agents/sub_executions/detail/AiHealingCounters.tsx:13-37
- **Current test state**: none
- **Scenario**: Small pure mapping: `phase` → i18n label (with the `completed && fixCount>0 && shouldRetry` composite branch and the singular/plural `fixCount !== 1` pluralization) and `phase` → dot color. The composite "completed with fixes + retrying" branch (line 22-24) is the only non-trivial bit; a regression there would mislabel a successful heal as "no fixes" or drop the retrying suffix. Low blast radius (display only) but cheap to lock.
- **Root cause**: No component tests in the feature tree.
- **Fix sketch**: LLM-generate a vitest batch over a mock `useTranslation` asserting: each phase yields the right label key; `completed` with `fixCount=0` → no-fixes label; `completed, fixCount=2, shouldRetry=true` → plural fixes label + retrying suffix; dot color is `bg-red-400` for `failed`, `bg-emerald-400` for `completed`, pulsing violet otherwise. Invariant: **the retrying suffix appears iff `phase==='completed' && fixCount>0 && shouldRetry`.**
