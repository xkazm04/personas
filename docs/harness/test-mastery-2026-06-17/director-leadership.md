# Test Mastery — Director & Leadership

> Total: 8 findings (1 critical, 3 high, 3 medium, 1 low)

## 1. `advance_goal` step-building & double-advance guard is entirely untested

- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/goal_advance.rs:56-252
- **Current test state**: none (the file has no `#[cfg(test)]` module at all)
- **Scenario**: This is the initiator that turns a team goal into a *running, money-spending* assignment. Several load-bearing invariants live here with zero tests: (a) the forward-only step chain `chain_dep(idx)` — every step must `depends_on` the previous one (idx 0 → None, idx N → [N-1]); the comments record that breaking this made reviewers/security/docs run *before* the implementation existed ("reviews work that was never implemented"). (b) The implementer-pinning: any step whose title contains "implement" must be assigned to the team's `dev-clone`/"Dev Clone" engineer, overriding the LLM's persona/use-case suggestion. (c) The eligibility filter must KEEP `needs_credentials` personas (advisory, not a hard block) — a regression here silently shrinks the candidate pool and re-creates the funnel loss. (d) `mirror_todo_titles` is non-empty ONLY when there were no open items (never mirror twice). A refactor to any of these compiles cleanly and ships a silently-broken SDLC pipeline.
- **Root cause**: The step-assembly logic is inlined in one big async fn alongside DB and orchestrator calls, so it was never factored into pure, testable helpers — and the double-advance guard's race-recheck (GAP-W2, line 227) is only exercised by a live concurrent run.
- **Impact**: A regression spawns out-of-order pipelines (security/docs before code), assigns implementation to a non-engineer, drops eligible personas, or double-spawns assignments against a goal — each burns LLM/credential budget on work that can't succeed, and the partial-unique-index is the only remaining backstop.
- **Fix sketch**: Extract pure helpers (`chain_dep`, the engineer-id resolver, the eligibility predicate, the open-items→steps and decomposed→steps mappers, `mirror_todo_titles` decision) and unit-test them: (1) chain is forward-only & step 0 has no dep; (2) an "Implement auth" step → engineer id even when the decompose suggested an architect/use-case; (3) a `needs_credentials` enabled persona is eligible, a `Revoked` one is not; (4) mirror titles empty when open items exist, equal to step titles otherwise; (5) `derive_advance_title` truncates >70 chars with the ellipsis and is char-safe. The double-advance guard itself needs an integration test with a seeded `queued` assignment asserting `AlreadyAdvancing`.

## 2. `route_verdicts` (Director → manual-review writes) has no test

- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/director.rs:1110-1154
- **Current test state**: none — tests cover *parsing* verdicts but never the persistence step
- **Scenario**: This is where a parsed verdict becomes a durable `persona_manual_reviews` row — the only place the user actually sees Director coaching. The contract is load-bearing for the UI: `context_data` must carry `"source":"director"` (the exact substring `list_verdicts` filters on via `LIKE '%"source":"director"%"`), plus `category`, `rationale`, and the accept/reject tallies; `suggested_actions` must be wrapped as `{"actions":[...]}`. If the JSON shape drifts, the write succeeds but `list_verdicts` returns nothing and every coaching note vanishes from the queue — a silent, total UI breakage that no parser test catches.
- **Root cause**: `route_verdicts`/`list_verdicts` form a write→read round-trip contract, but the two are tested separately (and `route_verdicts` not at all); the marker string is duplicated as a literal in both the writer and the reader SQL with no shared constant pinning them together.
- **Impact**: Director runs cost real model spend; if routing's JSON keys silently diverge from the reader's expectations, all that coaching is written but invisible — the feature looks dead despite working.
- **Fix sketch**: Add a round-trip test against `init_test_db()`: seed a persona + one execution, call `route_verdicts` with a verdict carrying a category + rationale + two actions, then `list_verdicts(Some(pid))` and assert it returns one row with the right category, rationale, both actions, and that `feedback_accepts_so_far`/`rejects_so_far` were threaded through. Invariant: **a routed Director verdict is always retrievable by `list_verdicts`** (pins the `source` marker contract).

## 3. `director_portfolio` score-distribution / avg-score math is untested

- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/director.rs:1361-1442 (band/avg loop 1405-1430)
- **Current test state**: none
- **Scenario**: The command-center dashboard headline numbers are computed here: 6 stable score bands (0..=5 always present), `reviewed`/`unreviewed` counts, and `avg_score = score_sum / reviewed` (None when nobody reviewed). `latest_score` is `score_trend.last()` (newest), and scores are clamped 0..=5 before bucketing. Easy regressions that pass compilation: off-by-one bucketing (using `first()` instead of `last()` for "latest"), counting unreviewed personas into `avg_score`, or a divide-by-zero when `reviewed == 0`. Wrong dashboard numbers erode trust in the whole leadership surface.
- **Root cause**: The aggregation is interleaved with DB queries (`get_value_rollup`, `last_reviewed_stmt`) in one function, so the pure histogram/average step was never isolated for testing.
- **Impact**: The Director command center is the executive view of fleet value; silently wrong avg/distribution numbers mislead the user about which personas are underperforming and waste their attention.
- **Fix sketch**: Extract the band+avg computation as a pure fn over `&[DirectorRosterEntry]` (or `&[Option<i64>]`) and test: (1) distribution always has 6 bands even with empty roster; (2) a score of 7 clamps into band 5; (3) `avg_score` ignores unreviewed entries and is `None` when none reviewed; (4) `latest_score` is the LAST trend element. Invariant: **`reviewed + unreviewed == in_scope` and `sum(band counts) == reviewed`**.

## 4. KPI cadence due-logic (`hours_since` / `evaluate_due_kpis`) is non-deterministic & untested

- **Severity**: high
- **Category**: flaky-nondeterministic
- **File**: src-tauri/src/engine/kpi_eval.rs:102-142
- **Current test state**: none for the cadence path (only `parse_value` strategies are tested)
- **Scenario**: `evaluate_due_kpis` decides whether to *spend* on a measurement based on `hours_since(last_measured_at)` vs the cadence threshold (daily ≥24h, weekly ≥168h, never-measured = due, manual = never). `hours_since` parses two timestamp shapes (RFC3339 and SQLite `%Y-%m-%dT%H:%M:%S`) and — critically — returns `f64::MAX` on an unparseable timestamp, which means "always due". A regression in the parser (e.g. failing on the space-separated SQLite format that line 131 normalizes) would make *every* KPI look due and re-run codebase commands (300s coverage runs) on every tick — or, conversely, never run. The function reads `Utc::now()` directly, so any test is time-coupled.
- **Root cause**: Wall-clock is read inside the helper rather than injected, and the parse-shape coverage was never added; the `f64::MAX`-on-error fallthrough is a silent behavior that only manifests as runaway cost.
- **Impact**: Either repeated expensive measurement runs (cost/CPU) or stale KPIs that never refresh — both undermine the KPI-driven orchestration the Director leans on, with no error surfaced.
- **Fix sketch**: Refactor `hours_since` to take a `now: DateTime<Utc>` (or factor the threshold decision into a pure `is_due(cadence, last, now) -> bool`) and test: RFC3339 and SQLite space/`T` formats both parse; unparseable → due; daily not-due at 23h / due at 25h; weekly boundary at 167h/169h; `manual` cadence never due; never-measured always due. These are deterministic with an injected clock.

## 5. `parse_verdicts` does not enforce `MAX_VERDICTS_PER_RUN`; the cap lives only at the call site

- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/director.rs:278, 298-325, 651-652
- **Current test state**: exists-but-weak — `parse_verdicts` is tested for valid/malformed/no-marker, but never for the runaway-cap, and `parse_wins`/`parse_memory_archives` *do* cap internally (asymmetry)
- **Scenario**: `parse_wins` (line 405) and `parse_memory_archives` (line 94) break at their max inside the parser; `parse_verdicts` does NOT — it relies on the caller doing `verdicts.truncate(MAX_VERDICTS_PER_RUN)` at line 652. Any new caller of `parse_verdicts` (or a refactor that drops the truncate) gets an uncapped flood of verdicts written to the review queue. There is no test asserting either the parser cap or the call-site truncation, so the guardrail's absence is invisible.
- **Root cause**: The cap was bolted on at the call site rather than in the parser, inconsistent with the sibling parsers, and no test pins the "≤ N verdicts ever reach routing" invariant.
- **Impact**: A runaway model response (or a future caller) could spam dozens of manual-review rows for one persona, drowning the review queue.
- **Fix sketch**: Add a test feeding 12 valid `DIRECTOR_VERDICT` lines and asserting the *routed/truncated* result is ≤ `MAX_VERDICTS_PER_RUN`. Best long-term fix (note in the test): move the cap into `parse_verdicts` itself to match `parse_wins`. Invariant: **no single run routes more than `MAX_VERDICTS_PER_RUN` verdicts.**

## 6. `gather_context` execution-status classification has no test

- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/director.rs:775-856 (status fold 784-791, days-since 802-807)
- **Current test state**: none (`build_director_payload` is tested but with hand-set counts, not via `gather_context`)
- **Scenario**: `gather_context` maps raw execution `status` strings into success/failure tallies that feed the Director's payload and (downstream) its score: `completed|success|succeeded` → success, `failed|error|timeout` → failure, anything else → neither. It also computes `avg_cost_usd` (guarding div-by-zero on empty), `days_since_last_run` from `completed_at ?? created_at`, and tallies `director_feedback` accept/reject memories by substring. If the status whitelist drifts from what the executor actually writes (e.g. a new `"cancelled"` or renamed `"done"` state), success/failure counts silently skew and the Director coaches on wrong data.
- **Root cause**: The classification is an inline closure over DB rows; the status vocabulary is duplicated knowledge with no shared enum, and no test pins the mapping or the empty-set `avg_cost = 0.0` guard.
- **Impact**: Mis-classified runs feed wrong "success rate" into coaching prompts, producing misleading verdicts and scores — the core output of the feature, quietly wrong.
- **Fix sketch**: Extract the status→(success,failure) fold and the avg-cost guard as pure helpers and test each terminal-status string maps correctly, unknown statuses count as neither, empty input → 0.0 avg cost (no panic), and the feedback accept/reject substring tally. Invariant: **only whitelisted statuses count; everything else is neutral.**

## 7. `bridge_verdicts_to_channel` severity-rank cap is untested

- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/director.rs:1057-1108 (`severity_rank` 1057, ranking+cap 1082-1084)
- **Current test state**: none
- **Scenario**: When a coached persona is on a team, coaching is posted into the team channel — but capped at `MAX_CHANNEL_POSTS_PER_RUN` (3), and the *most severe* verdicts must win (sort by `severity_rank` descending: Error=2 > Warning=1 > Info=0). The body is also char-truncated to 400. A regression in the rank ordering or the sort direction would post low-priority Info notes and drop the Error the user most needs to see, while still respecting the count cap (so it looks correct). This is a channel-rate guardrail (the §5 rule referenced in comments).
- **Root cause**: The ranking + cap is inlined inside a function that also does DB writes, so the pure "pick the top-N by severity" decision was never isolated.
- **Impact**: The most important coaching (errors) gets silently dropped from the team channel in favor of info-level chatter, defeating the cooperation-coaching feature and the rate guardrail's intent.
- **Fix sketch**: Extract a pure `rank_and_cap(&[DirectorVerdict], n) -> Vec<&DirectorVerdict>` and test that with 2 errors + 2 warnings + 2 infos and n=3 you get exactly the 2 errors + 1 warning (no info), and that the 400-char body truncation is char-safe. Invariant: **channel posts are the top-N by severity, never more than N.**

## 8. `director.ts` IPC wrappers — only `listDirectorScoreTrends` has guard logic worth a test

- **Severity**: low
- **Category**: coverage-gap
- **File**: src/api/director.ts:155-164
- **Current test state**: none (no TS tests in `src/api/`)
- **Scenario**: Most functions in `director.ts` are thin `invoke` pass-throughs (not worth testing). The one branch with real logic is `listDirectorScoreTrends`: it short-circuits to `{}` when `personaIds.length === 0` (avoiding a needless IPC round-trip), and several functions coalesce optional args to `null` (`days ?? null`, `maxPersonas ?? null`). A regression dropping the empty-array guard fires an unnecessary backend call for every empty render; dropping the `?? null` coercion could change the Rust arg shape.
- **Root cause**: No vitest coverage exists for the API layer; the guard is trivial but the only non-pass-through behavior here.
- **Impact**: Minor — an extra IPC call on empty input, or an arg-shape mismatch surfacing as a runtime invoke error rather than a typed one.
- **Fix sketch**: One small vitest with `invokeWithTimeout` mocked: assert `listDirectorScoreTrends([])` resolves to `{}` *without* calling invoke, and that `getDirectorPortfolio()` / `runDirectorBatch()` pass `null` for the omitted optional. Low priority; bundle with any future `src/api` test batch rather than as standalone work.
