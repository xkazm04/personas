# tauri:companion/proactive — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 2 medium / 4 low)
> Context group: Plugins & Companion | Files read: 9 | Missing: 0

## 1. dev_goal_nudges runs an N+1 query loop over all projects on every proactive tick
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/companion/proactive/triggers.rs:218
- **Scenario**: Every 5-minute proactive tick (plus every manual "evaluate now") calls `dev_goal_nudges`, which calls `dt::list_projects` and then `dt::list_goals_by_project` once per project inside the loop. A workspace with 20+ projects issues 21+ separate SQLite queries per tick just to find a handful of stale/due goals.
- **Root cause**: The scan iterates the project list in Rust instead of letting SQLite filter: `for proj in &projects { let goals = dt::list_goals_by_project(...) }` fetches every goal of every project (including `done` ones, filtered afterward in Rust).
- **Impact**: Steady-state per-tick query count and row volume scale with project × goal count on a hot recurring path; all other evaluators here are single-query or in-process. Bounded but pure waste that grows with fleet size.
- **Fix sketch**: Add one repo function that JOINs `dev_goals` to projects with `WHERE status NOT IN ('done','completed') AND (target_date IS NOT NULL OR status IN ('in-progress','in_progress','blocked'))`, returning all candidate rows in a single query; keep the date math and message templating in Rust. This also stops pulling completed goals only to skip them.

## 2. Triage-envelope parser duplicated verbatim across execution_review and message_triage
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/proactive/execution_review.rs:451
- **Scenario**: `parse_exec_triage` (execution_review.rs:451-470) and `parse_message_triage` (message_triage.rs:175-194) are the same ~20-line tolerant "find marker → rfind '{' → match_braces → deserialize, last occurrence wins" loop, differing only in the marker string and the envelope type. Both comments say "same tolerant brace-matching as the channel-reaction parser", implying a third sibling in `athena_reaction`.
- **Root cause**: Each new headless-Athena protocol copy-pasted the extraction loop instead of extracting a generic helper next to `match_braces`.
- **Impact**: Three copies of subtle parsing logic (last-wins semantics, `search_from` advancement, brace matching) that must be fixed in lockstep; a future protocol will mint copy #4. This exact loop already has edge cases worth centralizing (e.g. `rfind('{')` before the marker).
- **Fix sketch**: Add `pub fn parse_last_envelope<T: DeserializeOwned>(blob: &str, marker: &str) -> Option<T>` in `companion::athena_reaction` (where `match_braces` already lives), returning the last successfully-deserialized envelope. Reduce both parsers to `parse_last_envelope::<ExecTriageEnvelope>(blob, "\"athena_exec_triage\"").map(|e| e.athena_exec_triage)`. Existing unit tests in both files pin the behavior for the swap.

## 3. collect_candidates pulls full error/output blobs for up to 200 rows, then truncates to 600 chars in Rust
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/companion/proactive/execution_review.rs:196
- **Scenario**: The exec-review scan selects `e.error_message` and `e.output_data` for every terminal execution after the cursor (up to `SCAN_LIMIT = 200`). `output_data` is the persona's full output and can be tens of KB per row; only ≤24 rows become candidates and each keeps a 600-char tail via `truncate_tail`.
- **Root cause**: Truncation happens in Rust after materializing the full column instead of in SQL at read time.
- **Impact**: A busy backlog pass can materialize megabytes of strings to keep ~14 KB — transient allocation spike on the tick path, worst exactly when the app is behind (saturated window after downtime).
- **Fix sketch**: Truncate in the query: select `substr(e.error_message, -600)` / `substr(e.output_data, -600)` (byte-based is fine as a pre-cap; keep the char-accurate `truncate_tail` on the result). Rows that fail the flag predicate never carry a large payload.

## 4. effective_kind_cap re-runs a 30-day aggregate scan on every budget claim inside the transaction
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src-tauri/src/companion/proactive/budget.rs:197
- **Scenario**: `DailyBudget::try_consume` calls `effective_kind_cap` → `engagement_30d` on every claim attempt, inside the write transaction. A single evaluate pass claiming several cards of the same kind re-runs the identical `SUM(CASE...)` aggregate over 30 days of `companion_proactive_message` each time, holding the write tx open while it scans.
- **Root cause**: The engagement modulation is recomputed per claim rather than once per pass (it cannot change between claims in the same pass — status transitions come from later user actions).
- **Impact**: Bounded (≤12 successful claims/day plus failed attempts), but each claim adds an aggregate scan whose cost grows with the proactive-message table, and it lengthens the write-lock hold on the shared user DB. Cheap to eliminate.
- **Fix sketch**: Compute effective caps once per evaluation pass (e.g. a small `HashMap<String, u32>` cached on `DailyBudget`, filled lazily per kind on first claim) and read the map inside `try_consume`. Alternatively run `engagement_30d` before opening the transaction. Verify `companion_proactive_message` has an index covering `(trigger_kind, created_at)` for this and the cadence-dedupe queries.

## 5. parse_hhmm and the weekday→"mon" mapping duplicated between quiet.rs and triggers.rs
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/proactive/quiet.rs:122
- **Scenario**: `parse_hhmm` exists identically in quiet.rs:122 and triggers.rs:626; the Weekday→short-label mapping exists as `weekday_short` (quiet.rs:126) and inverted as `day_matches` (triggers.rs:401), plus two more copies in the two files' prop-test modules (`weekday_from_idx` / `local_at` helpers are triplicated across quiet.rs, triggers.rs cadence tests, and ambient tests).
- **Root cause**: The cadence evaluator and the quiet-window evaluator each grew their own schedule-DSL parsing primitives instead of sharing a small module, even though they interpret the same DSL (module docs in both files cross-reference each other's semantics).
- **Impact**: The schedule DSL's primitives can drift between the trigger side and the guardrail side (e.g. one gaining `%H:%M:%S` tolerance); test helpers are copied 3×. Maintenance hazard, no runtime cost.
- **Fix sketch**: Add a tiny `proactive/schedule.rs` (or a `mod schedule` in `mod.rs`) with `parse_hhmm`, `weekday_short`, `day_matches`, and a shared `#[cfg(test)]` `local_at`/`weekday_from_idx` helper; import from quiet.rs and triggers.rs. Pure move — the property tests pin behavior.

## 6. Engagement cap formula duplicated inside budget.rs (effective_kind_cap vs modulations_summary)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/proactive/budget.rs:106
- **Scenario**: The expression `((base as i64 + adj).clamp(1, base as i64 + 2)) as u32` appears verbatim at budget.rs:106 (the enforcement path) and budget.rs:153 (the transparency surface). If the clamp bounds ever change in one place, the "what Athena adapts" UI silently reports caps that enforcement doesn't apply.
- **Root cause**: `modulations_summary` recomputes the effective cap inline instead of calling a shared helper.
- **Impact**: Small but user-visible-drift-prone: the pair exists precisely so the summary matches enforcement, and the one test that pins agreement (`dismiss_heavy_kind_is_throttled`) only covers a `-1` case.
- **Fix sketch**: Extract `fn clamp_effective(base: u32, adj: i64) -> u32` and call it from both `effective_kind_cap` and `modulations_summary`. Two-line change, zero behavior delta.
