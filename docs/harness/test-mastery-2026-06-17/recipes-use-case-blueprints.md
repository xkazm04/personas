# Test Mastery — Recipes & Use-Case Blueprints
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

## 1. `curation_scheduler::tick()` has zero behavioral coverage — double-run / no-fire regressions slip through
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/curation_scheduler.rs:61-181
- **Current test state**: none (the `#[cfg(test)]` module only asserts the tick-interval constant and delegates to `cron::parse_cron`/`next_fire_time` — it never calls `tick()`)
- **Scenario**: `tick()` is the scheduling brain for nightly memory curation: it reads `persona_curation_schedule`, computes next-fire vs the watermark, advances `mark_run_now` **before** `persona_jobs::enqueue`, and fails-closed if the watermark can't advance. Every paid Claude CLI run flows through it. Today, a regression that (a) re-orders enqueue-before-mark, (b) drops the `next_fire > now` guard, or (c) breaks the first-fire `created_at` reference path would compile and pass the suite. `persona_jobs::enqueue` does a plain INSERT with no dedup (commands/core/persona_jobs.rs:101-118; `pop_next_queued` only dedups a single row), so a re-order silently double-charges the user for every curation cycle.
- **Root cause**: The expensive/stateful logic lives in `tick()`, but tests cover only the pure cron helpers it calls. No test stands up a `test_pool` with a seeded schedule row to assert the enqueue count and watermark transition — even though `recipe_seed.rs` in this same context already demonstrates the in-memory `test_pool` + `migrations::run` pattern.
- **Impact**: Silent double-billing (two distinct queued jobs both run), or the opposite — a schedule that never fires (the exact bug `parse_db_timestamp` was added to fix could recur undetected). Both are direct money/trust regressions in an autonomous, runs-while-you-sleep feature.
- **Fix sketch**: Add `tick()` integration tests against an in-memory pool (clone the `test_pool` helper from recipe_seed.rs): (1) seed a due schedule (cron `* * * * *`, `created_at` in the past, no `last_curation_at`) → assert `tick()` returns `1`, exactly one `persona_background_job` row exists with kind `memory_curation_run` and the right `persona_id`/`threshold`, and `last_curation_at` was advanced; (2) call `tick()` twice → second tick enqueues **zero** (idempotency / no double-run — the load-bearing invariant); (3) seed a not-yet-due schedule (`last_curation_at = now`, hourly cron) → assert zero enqueued; (4) invalid cron row → skipped, returns 0, other valid rows still fire.

## 2. `parse_db_timestamp` — the regression-prone parser that "fixed the scheduler never fires" bug — is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/curation_scheduler.rs:31-44
- **Current test state**: none
- **Scenario**: The function exists *because* `DateTime::<Utc>::from_str` is RFC3339-only and rejected SQLite's `datetime('now')` space-separated form (`2026-06-16 14:30:00`), which made every reference fall through to `now`, so `next_fire` was always `> now` and **no persona ever got a curation run**. This is a pure function with a documented historical failure, yet nothing locks the behavior: a refactor that drops the `NaiveDateTime` space-separated arm would silently reintroduce the original "scheduler never fires" outage.
- **Root cause**: Bug was fixed inline without a characterization test; the fix's value is invisible to the suite.
- **Impact**: Regression reverts the whole feature to a silent no-op — the worst kind of failure for a background scheduler (no error, just nothing happens).
- **Fix sketch**: LLM-generatable. Pure-function table test asserting the **invariant "both the SQLite space-separated form and RFC3339 parse to the same instant"**: `parse_db_timestamp("2026-06-16 14:30:00")` and `parse_db_timestamp("2026-06-16T14:30:00Z")` both `Some` and `Utc`-equal; trailing/leading whitespace tolerated; garbage (`"not a date"`, `""`) → `None`. Snapshot-of-output is not enough — assert the parsed instants are equal so the space-separated arm can't be silently dropped.

## 3. `recipe_seed` per-row failure isolation (`SeedReport.failed`) is asserted only on the happy path
- **Severity**: high
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/recipe_seed.rs:111-161
- **Current test state**: exists-but-weak (tests cover create/idempotent/repair/tier-refresh, but every test asserts `failed == 0`; the documented "one bad recipe shouldn't block 290 good ones" contract at lines 104-110 is never exercised)
- **Scenario**: The seeder's central resilience promise is that a single bad row is logged into `report.failed` and the pass continues. No test forces an `insert_one` failure, so a regression that turned a per-row error into an early `return Err(...)` (aborting the whole bundle) would pass — meaning one corrupt seed could leave a fresh install with **zero recipes**, and the user faces an empty recipe catalog with no blueprints to adopt.
- **Root cause**: The failure branch (`Err(e) => report.failed += 1`) has no driving test; it's hard to trigger via the embedded bundle (which is well-formed), so it was skipped.
- **Impact**: Silent loss of the failure-isolation guarantee → a single malformed/duplicate-PK seed bricks the entire blueprint library on first launch.
- **Fix sketch**: Seed once, then pre-insert a row with one of the bundle's `seed.id`s via a *different* `source_template_id`/`source_use_case_id` so `find_by_source` misses but `create_with_id` hits a PK conflict → re-seed and assert `report.failed >= 1` AND `report.created` accounts for the rest (the pass did not abort). Also add a test that a `recipe_count` mismatch only warns (returns Ok), not errors.

## 4. `match_intent_to_recipes` weights & threshold-clearing assertion are loose (`score > 0.3`, no precise boundary)
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/recipe_matcher.rs:114-172 (tests at :257-310)
- **Current test state**: exists-but-weak — good determinism/empty/zero-overlap coverage, but the business-critical "≥0.90 surfaces a suggestion chip" gate is asserted only via `score > 0.3` (line 273) and an identical-text case that clears 0.90 almost by construction
- **Scenario**: The product invariant (per user direction 2026-05-08) is "only surface suggestions at confidence ≥ 0.90 — conservative on purpose." The weighting (`NAME 0.6 / DESC 0.3 / TAGS 0.1`) is what makes that calibration real. A regression that re-normalized the weights or changed `score_recipe`'s combination so a *mediocre* match now clears 0.90 would pass: there is no test asserting that a **partial/near-miss** intent lands *below* threshold, nor that the weighted sum equals an expected value for a known token overlap. `above_threshold` controls whether a chip renders, so weight drift = noisy/wrong suggestions in the composer.
- **Root cause**: Tests assert "high enough" rather than the calibrated boundary; the weights are treated as constants (one test locks `SUGGESTION_THRESHOLD == 0.90` but nothing locks the weights or the combination math).
- **Fix sketch**: Add a test with hand-computable token sets asserting the exact weighted score (e.g. name jaccard 0.5, desc 0, tags 0 → `score ≈ 0.30`) so weight changes break the test; add a "realistic near-match stays below 0.90" case (partial name overlap, no tag match → `above_threshold == false`); optionally lock the three weight constants like the threshold is locked. Invariant: a name-only 50% overlap must NOT surface a chip.

## 5. Recipe seed model-tier refresh: no test that a *user prompt edit* survives the field-merge across all bundle keys
- **Severity**: medium
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/recipe_seed.rs:257-311 (test at :451-516)
- **Current test state**: exists-but-weak — `builtin_model_tier_is_refreshed_on_existing_rows` checks `title` survives, but the merge touches a stored JSON blob that may carry user edits in *other* keys, and the non-builtin guard (line 262) has no test
- **Scenario**: The merge surgically rewrites `model_override`/`model_rationale` while promising "every other `prompt_template` field (incl. user edits) is preserved untouched" (module docs lines 41-46). Only `title` preservation is asserted. A regression that did a coarse object-replace instead of key-merge would silently wipe a user's hand-edited prompt body/system text on the next app boot — and the suite wouldn't notice. Separately, the "non-builtin (user-authored) recipes are left untouched" guarantee (line 262, the line that protects user-authored content from system retiering) has no test.
- **Root cause**: The preservation test checks one incidental field; the user-content-protection guard wasn't given an adversarial case.
- **Fix sketch**: (1) Before re-seed, write a custom user key (e.g. inject `"user_notes":"keep me"` plus an edited body) into a builtin row's `prompt_template`, regress its tier, re-seed → assert tier healed AND `user_notes`/edited body unchanged. (2) Flip a row to `is_builtin = 0`, regress its tier, re-seed → assert `repaired == 0` and the tier was NOT changed (user content is sacrosanct).

## 6. `RecipeBookIllustration` is a presentational stub — leave it uncovered (do not chase a render test)
- **Severity**: low
- **Category**: test-structure
- **File**: src/features/recipes/shared/RecipeBookIllustration.tsx:1-13
- **Current test state**: none — and correctly so
- **Scenario**: This is a static `<img>` with a hardcoded src, `aria-hidden`, and fixed dimensions. No branching, no business logic, no props beyond `className`. A render/snapshot test here would be coupled-to-impl noise that fires on any cosmetic tweak.
- **Root cause**: N/A — flagged only to pre-empt a misguided "cover the only TS file in the context" reflex.
- **Impact**: None. Documenting the deliberate non-target keeps the suite honest (coverage % is a proxy; this file's 0% is correct).
- **Fix sketch**: No test. If a quality gate computes per-area coverage, exclude trivial presentational `*Illustration.tsx`/icon components from the denominator so they don't pressure teams into writing assertion-free snapshot tests.

## 7. No per-area coverage gate / new-code ratchet on the recipe engine modules
- **Severity**: low
- **Category**: quality-gate
- **File**: src-tauri/src/engine/{curation_scheduler,recipe_matcher,recipe_eligibility,recipe_seed}.rs
- **Current test state**: mixed — eligibility & matcher are well-tested; curation_scheduler (the riskiest) is not
- **Scenario**: Coverage is uneven precisely where it matters most (the scheduler that spends money is the least tested). Without a gate, a new recipe engine module or a new `dispatch_handler` job kind can ship with zero behavioral tests and nobody notices in review.
- **Root cause**: No advisory/blocking threshold tied to these business-critical engine paths; coverage is whatever each author chose to write.
- **Fix sketch**: Add a **new-code ratchet** (advisory first, not a hard backfill) on `src-tauri/src/engine/recipe_*.rs` + `curation_scheduler.rs` via cargo-llvm-cov in CI: block PRs that add lines to these files without raising covered-line count. Calibrate to "scheduling/enqueue paths must have a tick-level test" rather than a blanket %, so it fires on real risk (untested money-spending logic) without penalizing the trivial illustration component.
