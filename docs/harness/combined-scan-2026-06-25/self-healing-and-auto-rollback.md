# Self-Healing & Auto-Rollback — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: self-healing-and-auto-rollback | Group: Execution Engine
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. AI healing and auto-rollback both mutate the live persona prompt with no shared lock; healing never snapshots a version, so rollback silently reverts heals
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race condition / state corruption / success theater
- **File**: src-tauri/src/engine/ai_healing.rs:373-385 and src-tauri/src/engine/auto_rollback.rs:447-450 (invariant claimed in src-tauri/src/engine/healing_orchestrator.rs:36-43)
- **Scenario**: An AI-healing session resumes the original Claude session, diagnoses, and `apply_db_fixes` runs `UPDATE personas SET system_prompt = …` / `structured_prompt = …` on the **live persona row** (ai_healing.rs:373-385). It does NOT insert a new `persona_prompt_versions` snapshot (confirmed: no `persona_prompt_versions` write anywhere in `apply_db_fixes`). Two failure paths follow: (a) **Race** — the 5-minute `auto_rollback_tick` fires while a heal is mid-flight; `perform_rollback` runs `UPDATE personas SET structured_prompt=?, system_prompt=? …` (auto_rollback.rs:447-450) on the same two columns. Whichever commits second wins — the heal clobbers the rollback, or the rollback wipes the heal. (b) **Guaranteed, non-racy** — because the heal created no version, the version-level error-rate metrics auto-rollback consumes still attribute the persona's history to the *pre-heal* production version. A still-elevated historical rate makes a later tick roll the live prompt back to an old snapshot, silently discarding the AI heal.
- **Root cause**: The `healing_personas` lock guards only concurrent AI-healing *sessions* (orchestrator.rs:42-43; mod.rs `try_start_healing`). Auto-rollback acquires nothing. The orchestrator doc explicitly asserts the two are "safe" because healing "operates at the execution level" while rollback "operates at the prompt-version level" (orchestrator.rs:36-40) — but `apply_db_fixes` mutates persona-level prompt columns, so the claimed level separation does not exist. Healing also never versions its change, so its effect is invisible to rollback's metrics.
- **Impact**: Lost-update corruption of the recovery state; an AI heal that "completed" is silently undone, or a rollback meant to escape a bad version is overwritten — the system can land on a known-bad prompt while the UI reports success (success theater).
- **Fix sketch**: Have `apply_db_fixes` snapshot a new `persona_prompt_versions` row (tagged production) instead of mutating the live row untracked, OR make `auto_rollback_tick` acquire `try_start_healing`/skip personas with an in-flight heal, and have healing acquire a write guard around the persona prompt columns. Correct the orchestrator doc to stop claiming level-based safety.
- **Value**: impact=8 effort=5

## 2. Auto-rollback's "known-good" target has no minimum-execution floor, so it can roll back onto a version whose 0% error rate is a single lucky run
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: rollback to a version that isn't actually good / edge case
- **File**: src-tauri/src/engine/auto_rollback.rs:242-266 (and health gate 303-318)
- **Scenario**: Current production has 3+ executions (the `total_current_executions < 3` gate, line 254-263) at, say, 40% error. `previous` is the highest-numbered non-production version. Its `previous_points` window contains a single day with **one** execution that happened to succeed → `previous_error_rate = 0.0`. `threshold = max(0.0*2, 0.1) = 0.1`; current 0.40 > 0.10, and the health gate `previous_error_rate >= current_error_rate || previous_error_rate > 0.5` passes (0.0 < 0.40, 0.0 ≤ 0.5). The system rolls production back onto a version validated by a sample size of one.
- **Root cause**: The only sufficiency check on the rollback target is `previous_points.is_empty()` (line 242). The current version is gated at ≥3 executions but the *target* has no equivalent floor, so `compute_weighted_error_rate` can return a statistically meaningless rate that the health check then treats as authoritative.
- **Impact**: Rollback lands on a version with no real track record — the named "rolls back to a known-good version that isn't actually good" failure mode — while emitting a confident `auto_rollback` event.
- **Fix sketch**: Apply the same `>= 3` (or higher) minimum-execution gate to `previous_points` before trusting `previous_error_rate`; skip rollback when the target's sample is too small to be a meaningful baseline.
- **Value**: impact=6 effort=2

## 3. run_healing_analysis marks every auto-fixable issue `auto_fix_pending` and counts it as `auto_fixed`, but schedules only ONE retry per run — the rest hang in "retrying" forever (until TTL) and the count over-reports
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: success theater / silent failure
- **File**: src-tauri/src/engine/healing_timeline.rs:269-290 (UI surface: HealingTimeline outcome "retrying" at 433/452)
- **Scenario**: `get_recent_failures(pool, persona_id, 10)` returns several independently auto-fixable failures. For each, the loop calls `mark_auto_fix_pending` and increments `auto_fixed` (lines 270-277), but only pushes a retry into `retries` once, gated by `if !retry_scheduled` (lines 279-285). So if 5 failures are auto-fixable, 5 issues are flipped to `auto_fix_pending` and `auto_fixed = 5`, yet only 1 retry is ever scheduled. The other 4 sit in `auto_fix_pending` with no retry coming; the timeline renders them as "Auto-fix in progress" (healing_timeline.rs:433, 452) until `revert_stale_auto_fix_pending` reverts them at TTL.
- **Root cause**: The single-retry guard (`retry_scheduled`) was meant to avoid a retry storm, but it was not paired with the pending-mark/`auto_fixed` accounting — those still happen per issue, decoupling "marked as healing" from "actually being healed".
- **Impact**: The analysis toast reports "5 auto-fixed" when only one retry runs; users see issues stuck in a perpetual "retrying" state that silently lapses to open after the TTL — misleading recovery reporting.
- **Fix sketch**: Only `mark_auto_fix_pending` + increment `auto_fixed` for the issue whose retry is actually scheduled, OR schedule a retry for each marked issue (with proper per-chain budgeting), so the pending set matches the scheduled set.
- **Value**: impact=5 effort=3

## 4. Version error-rate attribution is day-granular and assumes `previous` is the true predecessor — same-day and post-rollback executions are misattributed across the boundary
- **Severity**: Medium
- **Lens**: bug-hunter + ambiguity-guardian
- **Category**: edge case / clock / undocumented assumption
- **File**: src-tauri/src/engine/auto_rollback.rs:136, 180-228, 231-240
- **Scenario**: Deployment dates are derived as `created_at.get(..10)` — the calendar day only (lines 181, 204). `current_points` is `date >= current_date`; `previous_points` is `previous_date <= date < current_date` (lines 231-240). A version deployed at 23:00 on day D attributes ALL of day D's executions to it — including runs that executed earlier that day under the *old* version — skewing both rates near the boundary. Separately, `previous` is just "highest-numbered non-production version" (line 136); after an earlier rollback or out-of-order versions it may not be the version that was actually live in `[previous_date, current_date)`, so the window's error rate reflects a different version entirely.
- **Root cause**: Error-rate-by-day-bucket with `>=`/`<` boundaries cannot separate executions on the deployment day, and the predecessor is chosen by version number rather than by which version was actually in production during the comparison window.
- **Impact**: Spurious rollbacks (a healthy current version judged bad from a boundary-day artifact) or suppressed rollbacks (a genuinely bad version compared against the wrong baseline) — wrong recovery decisions on aggregate metrics.
- **Fix sketch**: Attribute executions to versions by timestamp against the actual deployment instant (not truncated day), and select `previous` as the version that was production immediately before `current` (e.g., via the version-marker timeline) rather than by max non-production number. Document the day-bucket assumption if it must stay.
- **Value**: impact=5 effort=5

## 5. AI healing's `should_retry` is trusted verbatim even when zero effective fixes were applied → retry runs against unchanged state and re-fails
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: retry storm / success theater
- **File**: src-tauri/src/engine/ai_healing.rs:278-331 (and config rejection paths 459-475, 488-516)
- **Scenario**: The healer emits `{"healing_complete": {"should_retry": true, …}}` but its only proposed fixes are `update_config` values that fall outside bounds and are rejected (e.g., `timeout_ms` out of `[1000,1800000]`, lines 460-475), or section patches that miss (`ai_heal_section_missing`, lines 414-427). `applied` ends up empty, yet `process_healing_result` returns `should_retry = true` (lines 284, 326) and the engine schedules a re-attempt (mod.rs ~3590). The retry runs with identical configuration and fails the same way, repeating each cycle until the circuit breaker trips at 5 consecutive failures.
- **Root cause**: `should_retry` comes straight from the LLM and is never reconciled against whether any fix actually changed persistent state. A heal that changed nothing still claims it's worth retrying.
- **Impact**: Wasted Opus-model healing sessions and retries that cannot succeed (the underlying state is unchanged) — token burn and a misleading "retrying" narrative until the breaker disables the persona.
- **Fix sketch**: Gate the auto-retry on `should_retry && (!applied.is_empty() || a file/command fix was performed)`; when the healer wants a retry but produced no effective change, downgrade to `CreateIssue` and record an audit entry instead of looping.
- **Value**: impact=4 effort=3
