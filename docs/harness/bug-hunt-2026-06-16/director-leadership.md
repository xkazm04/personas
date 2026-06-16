# Bug Hunter — Director & Leadership

> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)
> Context: director-leadership | Group: Execution Engine

## 1. Score-trend sparkline collapses to a single point — every Director cycle overwrites the SAME target execution row
- **Severity**: High
- **Category**: Latent failure / silent data loss
- **File**: `src-tauri/src/engine/director.rs:662`
- **Scenario**: The Director is run repeatedly on a persona (manual button, batch, or scheduled tick) while the target persona itself has not produced any new executions in between. Each run anchors its score to `ctx.latest_execution_id`, which is `recent.first()` — the target's *newest* execution by `created_at DESC` (`gather_context` line 793, query at `executions.rs:125`). The Director's own run creates a Director-persona execution, never a new target execution, so `latest_execution_id` is identical across every Director cycle until the target runs again.
- **Root cause**: `set_director_review` does `UPDATE persona_executions SET director_score=… WHERE id=?` on that one row. `list_score_trends` (director.rs:1262) reads one `director_score` per target execution, so the "is coaching moving the needle" sparkline and `DirectorRosterEntry.score_trend` can only ever show one point per actual target run — repeated Director evaluations silently clobber prior scores instead of accumulating a trend.
- **Impact**: The headline feature (score trend over time) is structurally unable to show a trend for a stable persona; `avg_score`/distribution reflect only the last overwrite. Users see a flat/empty sparkline and conclude coaching has no effect. Earlier scores are destroyed, not versioned.
- **Fix sketch**: Persist Director scores in their own append-only table keyed by `(target_persona_id, director_run_execution_id, created_at)` rather than overwriting the target execution column, and have `list_score_trends` read from it. At minimum, skip the overwrite when the latest target execution already carries a `director_score` from a newer Director run.

## 2. KPI cadence ignores its own catalog — `weekly`/`daily` only, every other cadence silently never auto-measures
- **Severity**: Medium
- **Category**: Silent failure
- **File**: `src-tauri/src/engine/kpi_eval.rs:112`
- **Scenario**: A KPI is created with any cadence string other than the exact literals `"daily"`, `"weekly"`, or `"manual"` (e.g. `"monthly"`, `"hourly"`, a typo like `"Daily"`, or a future cadence). `evaluate_due_kpis` matches `(kpi.cadence.as_str(), …)`; the `_ => false` arm marks it never-due, so it is silently skipped on every tick forever.
- **Root cause**: The due-check enumerates cadence literals with no validation that `cadence` is one of them and no warning on the fallthrough. There is also a subtle case-sensitivity landmine (`"Daily"` ≠ `"daily"`). The KPI looks active and configured in the UI but its `current_value` never advances.
- **Impact**: KPIs that should drive orchestration go stale indefinitely with no error, no log, and no UI signal — the dashboard shows a confident but frozen number. Classic success theater: the KPI "exists" but does nothing.
- **Fix sketch**: Validate `cadence` against the allowed set at creation time; in `evaluate_due_kpis` log a `warn!` (or treat-as-due) on the `_` arm so an unrecognized cadence is visible rather than silently inert. Normalize case.

## 3. `exec_failure_rate` divide path is fine, but `qa_bounce_rate`/`exec_failure_rate` treat NULL aggregates and zero windows identically to a "0% / healthy" KPI
- **Severity**: Medium
- **Category**: Edge case / silent default
- **File**: `src-tauri/src/engine/kpi_eval.rs:320`
- **Scenario**: A brand-new team (or a quiet 7-day window) has zero bounces and zero merges, or zero executions. `qa_bounce_rate` returns `0.0` because `bounces + merges == 0.0`; `exec_failure_rate` returns `0.0` because `total == 0.0`. These are recorded as a real measurement value of `0`.
- **Root cause**: "No data" is conflated with "0% bad outcomes." The guard `if total > 0.0 { … } else { 0.0 }` silently substitutes a perfect score when the denominator is empty, and `record_kpi_measurement` stores it as a genuine data point. A KPI gate keyed on "failure rate ≤ X%" will pass on an empty dataset — i.e., a team that has done nothing reads as a team performing flawlessly.
- **Impact**: KPI-driven decisions (goal advancement gating, dashboards, Director coaching that reads value rates) can be made on phantom "0%" measurements that actually mean "no evidence." Trend lines start at a fabricated 0 instead of null/no-data.
- **Fix sketch**: When the denominator is zero, return an explicit no-data signal (skip recording, or record with an evidence flag `samples=0`) rather than `0.0`, so consumers can distinguish "healthy" from "unmeasured."

## 4. `json_path` KPI parser walks INTO scalars and stops on missing segments without failing — returns wrong-node values
- **Severity**: Medium
- **Category**: Silent failure / edge case
- **File**: `src-tauri/src/engine/kpi_eval.rs:252`
- **Scenario**: A `json_path:total.pct` strategy is run against output whose last JSON line is `{"total": 42}` (no `.pct`), or `{"total":{"pct":{"nested":1}}}`. The walk loop does `match cur.get(seg) { Some(next) => cur = next, None => break }`. On a missing segment it `break`s but leaves `cur` pointing at the *parent* node, then tries `cur.as_f64()`. For `{"total":42}` with path `total.pct`, after the failed `.pct` lookup `cur` is still `42`, and `as_f64()` returns `42` — the wrong value is silently accepted as the metric.
- **Root cause**: A `break` on a missing key does not invalidate the accumulated `cur`; the code only checks `as_f64()` at the end, so a partial-path match against a numeric ancestor yields a confident but incorrect number. No distinction between "path fully resolved" and "path bailed early but the last good node happened to be numeric."
- **Impact**: A KPI silently measures the wrong field when the tool output shape drifts (renamed/missing key). The number looks plausible and is recorded as truth — far worse than a parse failure, which at least surfaces an error.
- **Fix sketch**: Track whether every segment resolved; only return `cur.as_f64()` when the *full* path was consumed (`segments_matched == path.split('.').count()`), otherwise treat as no-match and try the next line.

## 5. `read_brain_history` sorts vault notes lexicographically and assumes timestamped filenames — wrong "most-recent 3" when names diverge
- **Severity**: Low
- **Category**: Assumption landmine / latent failure
- **File**: `src-tauri/src/engine/director_brain.rs:60`
- **Scenario**: `read_brain_history` does `files.sort()` then `.rev().take(3)` to fetch the 3 newest notes. This silently assumes every `.md` in `Director/<persona>/` is named with the `%Y-%m-%d-%H%M%S` pattern `write_brain_note` uses (brain_brain.rs:85). If a user (the vault is user-browsable and editable per the module doc) renames a note, drops in `notes.md`, or two reviews land in the same second (the format has 1s resolution → filename collision/overwrite), lexicographic order no longer equals chronological order, and the "prior coaching" fed back into the LLM payload is the wrong/oldest notes — or a same-second second review silently overwrites the first.
- **Root cause**: Recency is inferred from filename string ordering rather than filesystem mtime or an embedded timestamp, and the write path has no collision guard at 1-second granularity. Trust-boundary gap: user-editable vault content is assumed to follow an internal naming contract.
- **Impact**: Director coaching "builds on" stale or arbitrary prior notes (degraded advice quality, repetition the feature exists to avoid); rapid back-to-back reviews can lose a note entirely. Best-effort design means all of this fails silently.
- **Fix sketch**: Sort by `fs::metadata().modified()` (fall back to name), and make the write filename collision-safe (append a short uuid/counter, or include sub-second precision).
