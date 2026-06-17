# Test Mastery — Incidents & Manual Review
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. `incident_continuation` decision branches are entirely untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/incident_continuation.rs:71-297
- **Current test state**: none
- **Scenario**: `continue_resolved_incidents` is the path that *re-runs blocked work after a human resolves an incident* — i.e. it spawns NEW real executions that can take irreversible actions (send email, write data, hit APIs). It carries four hand-rolled safety guards: (a) refuse continuation of `is_simulation` runs, (b) refuse when `input_data` is NULL/blank/unparseable ("contextless continuation"), (c) the `team_assignments` branch that skips when there are no failed steps, (d) the claim-then-act ordering. None of these is exercised by a test. A regression that, say, drops the `is_simulation` guard, or lets an empty `input_data` fall through to `Some(serde_json::Value)`, would silently spawn a real autonomous run off a hallucinated reconstruction — and every log line still says "re-ran blocked work … successfully".
- **Root cause**: The module has no `#[cfg(test)]` block. The function is `async` and takes `&Arc<ExecutionEngine>` + `AppHandle`, so it *looks* hard to unit-test, which is why it was skipped — but the guard decisions themselves are pure predicates trapped inside the loop.
- **Impact**: An irreversible real-world action taken off a dry-run or off no input context; the worst class of regression in an autonomous agent. Highest blast radius in this context.
- **Fix sketch**: Extract the per-incident guard logic into a pure decision function, e.g. `fn continuation_decision(incident, blocked_exec, persona_exists) -> Continue | Skip(reason)` taking owned/plain data, and unit-test it: simulation-origin → Skip; NULL `input_data` → Skip; blank/whitespace `input_data` → Skip; unparseable JSON `input_data` → Skip; valid JSON + non-simulation → Continue; missing blocked execution → Skip; `team_assignments` with zero failed steps → Skip. Assert the *reason* string too (not just Skip vs Continue) so a regression that skips for the wrong reason is caught. The remaining async glue (create_retry + start_execution) can stay covered by an integration test or be left as the thin shell.

## 2. Open-duplicate dedup guard (`normalize_title_key` / `strip_counter_suffix`) has no direct tests
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/execution/audit_incidents.rs:88-138, 167-187
- **Current test state**: none (the repo test module covers `dedup_key` idempotency but never the *title-key* open-duplicate collapse)
- **Scenario**: This is the logic that stopped the live "22 open copies of 'Transient process failure'" inbox-flood and the per-cycle "PR #4 stuck (cycle 4)/(cycle 5)" re-raise spam. It must (a) collapse `(cycle 4)` vs `(cycle 5)` to the same key, (b) NOT collapse distinct digits like "PR #4 stuck" vs "PR #7 stuck", (c) only strip a trailing `(<label> <int>)` for the known label set, (d) cap at 64 chars. A regression that re-introduces the old "collapse every digit run to `#`" behaviour silently swallows the second of two genuinely-different blockers as a false duplicate — a real incident never surfaces — and nothing fails.
- **Root cause**: The functions are pure and `pub`, but the existing test module jumped straight to `promote()` round-trips and never asserts the normalizer's contract in isolation.
- **Impact**: Either inbox noise (guard too loose) or a swallowed real incident (guard too tight). Both are silent.
- **Fix sketch**: Add focused unit tests on the pure functions: `normalize_title_key("PR #4 stuck (cycle 4)") == normalize_title_key("PR #4 stuck (cycle 5)")`; `normalize_title_key("PR #4 stuck") != normalize_title_key("PR #7 stuck")`; `strip_counter_suffix` leaves `"Build (legacy)"` and `"Foo (cycle bar)"` (non-numeric) intact; 64-char cap holds; each LABEL is recognized case-insensitively. Plus one `promote()` integration assertion that a second open incident with a per-cycle-variant title returns `Ok(None)` for the same persona but inserts for a different persona/kind.

## 3. `apply_verdict` CAS supersession (human-wins race) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/auto_triage.rs:378-456
- **Current test state**: exists-but-weak — auto_triage has good *pure-helper* coverage (prompt build, verdict parse, principles extract) but zero coverage of the stateful finalize path.
- **Scenario**: The async evaluator runs while a human may concurrently resolve the same review. The guard at :385-404 explicitly only applies a verdict when the row is still `Pending`, "so the human decision wins". If that early-return is dropped, the LLM verdict (Approved/Rejected) clobbers a human's resolution — the agent's auto-decision silently overrides a person on a review they deliberately acted on. There is no test asserting "verdict on an already-resolved review is a no-op."
- **Root cause**: The finalize functions take `&SpawnedEvaluatorContext` (which only needs a `DbPool` + ids) and call the real `review_repo` — perfectly testable against `init_test_db()`, but no test was written for them.
- **Impact**: Human review override silently reversed by the auto-triage LLM; a trust/consent violation, not just a data bug.
- **Fix sketch**: Using `init_test_db()`, insert a manual_review row, transition it to a human verdict, then call `apply_verdict` with the opposite verdict and assert the status is unchanged + an info-level supersession path was taken. Add the happy path too: Pending + Approve → Approved with the right `note`/policy_event. Also cover `apply_fallback` landing `Resolved`.

## 4. No frontend tests for the incident/manual-review pure libs (LLM-generatable batch)
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/overview/sub_incidents/libs/incidentDetail.ts:47-139; libs/groupIncidents.ts:34-122; src/features/overview/sub_manual-review/libs/reviewHelpers.ts:44-58
- **Current test state**: none — `sub_incidents` and `sub_manual-review` contain zero test files, though the project has a real vitest setup used widely elsewhere.
- **Scenario**: `normalizeIncidentDetail` decides whether a backend `detail` payload renders as safe prose, a labelled fact grid, or raw JSON — the thing that keeps a raw `{"status":403,...}` blob off a non-technical user's screen. `groupIncidents` decides inbox ordering (worst-severity-first, no-agent bucket sinks last) — the at-a-glance triage signal. `stripPersonaPrefix` cleans titles. All are pure, branch-heavy, and currently unverified; the JSON-vs-prose-vs-kv classification has subtle bail-out rules (`KV_PART` regex, "sentence with an `=`" → prose) that are easy to regress.
- **Root cause**: The libs were written test-ready (pure, exported) but no batch was generated for them.
- **Fix sketch**: LLM-generatable. **Invariants to assert (not snapshots):** for `normalizeIncidentDetail` — valid JSON object → `kind:'facts'` with `rawJson` set and facts only for non-empty values; a prose sentence containing `=` → `kind:'prose'` (NOT misparsed as kv); clean `"a=1, b=2"` → two facts; empty/null/whitespace → `kind:'empty'`; never throws on malformed input. For `groupIncidents` — output is a permutation of the input (no incident lost or duplicated across groups); `worstSeverity` equals the max `severityRank` in each group; the `__none__` agent bucket is always last; `mode:'none'` yields exactly one group in recency order. For `stripPersonaPrefix` — strips only when the title starts with the persona name + a separator, re-capitalizes, and is a no-op otherwise.

## 5. Cross-source promotion-rule fan-out (4 of 7 promoters) lacks rule-boundary tests
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/audit_incidents_promoter.rs:141-304
- **Current test state**: exists-but-weak — tests cover env-gate, fired_alert, tool (error-only), policy (drop-only), and idempotency, but `promote_credential_audit`, `promote_healing_audit`, `promote_provider_audit`, and `promote_healing_issue` have NO test of their selection predicate.
- **Scenario**: Each promoter encodes a *business filter*: credential rows promote only when the operation string contains `failure`/`error`/`denied` (and at elevated `high` severity — credential issues block downstream work); healing rows promote only on `*_error` / `ai_heal_unknown_*` / `ai_heal_section_missing`; provider rows promote only on `was_failover`; healing-issues only on `open` + severity ≥ medium. A regression in any predicate either floods the inbox with routine successes or, worse, *stops surfacing real credential failures* — and the existing suite wouldn't notice.
- **Root cause**: The test module covered the representative few and stopped; the four with the most nuanced predicates were left out.
- **Fix sketch**: Mirror the existing `tool_audit_only_promotes_errors` pattern for the remaining four — for credential: a `success` op → no incident, a `decrypt_failure`/`denied` op → one incident at severity `high`; for healing: a routine `ai_heal_ok` → none, an `*_error` → one; for provider: `was_failover=false` → none, `true` → one at `low`; for healing-issue: `status='closed'` or severity `low` → none, `open`+`high` → one. These are cheap, deterministic, and close real risk.

## 6. Time-dependent helpers (`isStaleIncident`, `relativeTime`) are determinism traps and untested
- **Severity**: medium
- **Category**: flaky-nondeterministic
- **File**: src/features/overview/sub_incidents/libs/incidentTaxonomy.ts:128-153
- **Current test state**: none
- **Scenario**: Both call `Date.now()` directly. `isStaleIncident` gates the "this work is rotting unseen" age cue and the 3-day threshold; `relativeTime` formats every incident age. Untested today, and if someone tests them naively with a fixed ISO string they'll get an order-/clock-dependent test that flakes in CI or near day boundaries. The business risk is the stale-cue silently breaking (stops firing) after a refactor of the threshold math.
- **Root cause**: Direct wall-clock reads with no injected clock or `vi.useFakeTimers()` discipline; no test ever pinned the clock.
- **Fix sketch**: Add deterministic tests using `vi.useFakeTimers()` / `vi.setSystemTime(...)`: an incident created 4 days ago with status `open` → stale; same age but `resolved`/`dismissed` → not stale (the early-out); exactly at `STALE_THRESHOLD_MS` → stale (`>=`); `NaN` timestamp → not stale. For `relativeTime`, pin the clock and assert `<1m → just_now`, `45m → "45m"`, `2h → "2h"`, `3d → "3d"`, and a bad ISO returns the raw string. This both adds coverage and codifies the no-real-clock rule for this area.

## 7. No per-area quality gate / new-code ratchet on the untested UI surface
- **Severity**: low
- **Category**: quality-gate
- **File**: vitest.config.ts (and the two zero-test feature dirs sub_incidents/, sub_manual-review/)
- **Current test state**: none — the repo has broad vitest usage but (from the config) no coverage threshold protecting this observability surface, so new untested code in these dirs sails through.
- **Scenario**: The whole incidents + manual-review frontend has zero tests and nothing prevents the next change from also shipping untested. A blanket high global threshold would get bypassed; the right tool is a narrow ratchet on the pure libs once findings #4/#6 land.
- **Root cause**: Coverage is advisory/absent for new feature code; no ratchet exists.
- **Fix sketch**: After adding the lib tests (#4, #6), set a *scoped, advisory-then-blocking* coverage floor for `src/features/overview/sub_incidents/libs/**` and `sub_manual-review/libs/**` (e.g. 80% lines/branches on those globs only) via a vitest `coverage.thresholds` per-path entry — calibrated to the now-covered pure functions so it fires on a real regression without forcing a giant backfill of the React components.
