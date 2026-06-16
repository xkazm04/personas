# Bug Hunter — Self-Healing & Auto-Rollback

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: self-healing-auto-rollback | Group: Execution Engine

## 1. AI healing reports "completed" and schedules a real retry even when the healing run itself failed (success theater + bad-diagnosis retry)
- **Severity**: Critical
- **Category**: Silent failure / latent failure
- **File**: `src-tauri/src/engine/mod.rs:3264` (and `3327`, `3353`)
- **Scenario**: The healer session is run via `run_execution_with_ceiling`. Its `result.success` is used only to set the *execution row's* status (line 3267). Immediately after, `process_healing_result(&pool, &persona_id, &result)` is called **unconditionally** (line 3327) and, on `Ok`, the chain emits `phase: "completed"` (line 3341) and — if the healer's self-reported `healing_complete` block says `should_retry: true` with any parsed fixes — spawns a fresh retry of the *original* task (line 3353). A healer run that timed out, was rate-limited, or crashed mid-stream can still have emitted a `{"healing_complete": {"should_retry": true}}` line earlier in its stdout. The recovery system then declares success and retries the original task off a half-finished, possibly wrong, diagnosis.
- **Root cause**: `should_retry` is trusted from LLM output rather than gated on the healing execution actually succeeding (`result.success`). There is no `if result.success` guard before `process_healing_result` / the retry spawn. The UI (`AiHealingCounters.tsx:33`) paints a green "completed" dot purely from this phase string, so the operator sees success theater.
- **Impact**: Failed/aborted healing presented as a successful repair; a retry is launched on a misdiagnosis, burning API budget and potentially applying a wrong DB fix (prompt/config mutation) that makes the persona worse. This is exactly the "recovery code that fails silently" worst case.
- **Fix sketch**: Gate fix-application and retry scheduling on `result.success` (and non-cancelled). If the healing run failed, emit `phase: "failed"` and route to `CreateIssue` instead of trusting `should_retry`. Treat a missing/contradictory `healing_complete` as no-retry.

## 2. Auto-rollback picks "previous" version by version number only — can roll back to a known-bad / corrupt baseline
- **Severity**: High
- **Category**: Latent failure (rollback to corrupt known-good)
- **File**: `src-tauri/src/engine/auto_rollback.rs:136` (selection) and `:270` (threshold)
- **Scenario**: After confirming the production version's error rate exceeds `(previous_error_rate * 2).max(0.1)`, `perform_rollback` reverts to `previous` — chosen as simply "the highest-numbered version that isn't current production" (line 136). There is **no check that the previous version's error rate is actually lower** (or even acceptable). If v3 (current) has 40% errors and v2 has 35% errors, `threshold = max(0.7, 0.1) = 0.7`, so 0.40 ≤ 0.70 and no rollback fires — but if v3 is at 90% and v2 is at 80%, it rolls back to a version that is itself failing badly. There is also no floor on `previous_error_rate`, so a noisy-but-equally-bad baseline is treated as "known-good."
- **Root cause**: The decision compares *only* current-vs-previous ratio and never validates that the rollback target is a genuinely healthier baseline. "Known-good" is assumed from recency/numbering, not measured.
- **Impact**: Auto-rollback can demote a bad version to an equally-bad or worse one, then (because the demoted version keeps a higher number but `experimental` tag) stay there. The system advertises a recovery but lands on a non-functional baseline — and emits a confident `auto_rollback` audit event saying it healed.
- **Fix sketch**: Require `previous_error_rate < current_error_rate` (and ideally `previous_error_rate <= some absolute ceiling, e.g. 0.5`) before rolling back; if no version meets the bar, create a healing issue instead of silently reverting to a bad baseline.

## 3. AI-healing retry shares the same `retry_count` as the healing execution (off-by-one budget collision)
- **Severity**: High
- **Category**: Edge case (attempt-counter accounting) / latent failure
- **File**: `src-tauri/src/engine/mod.rs:3167` vs `:3365`
- **Scenario**: `spawn_healing_chain` reads the original's `retry_count` (line 3163), creates the *healing* execution with `create_retry(..., retry_count + 1)` (line 3167), and then on success spawns the *actual task* retry with `spawn_delayed_retry(..., retry_count + 1, ...)` (line 3365) — the **same** `retry_count + 1`. The healing diagnostic run and the real follow-up retry are recorded at the identical chain depth. Meanwhile `spawn_delayed_retry` (line 3517) calls `create_retry(..., retry_count)` with no `MAX_RETRY_COUNT` guard of its own (the guard lives in `schedule_healing_retry`, which the AI path bypasses entirely).
- **Root cause**: The AI healing path increments the counter for the diagnostic session but then reuses (rather than re-deriving from the DB) the counter for the subsequent task retry, and skips the `current_retry_count >= MAX_RETRY_COUNT` check that `schedule_healing_retry` enforces (mod.rs:1428).
- **Impact**: Two executions land on the same retry depth, so the retry-chain timeline (`healing_timeline.rs:397` keys events on `retry_count`) collapses/overwrites entries, and the per-chain budget can be over- or under-spent — in the worst case an AI-heal→retry→fail→AI-heal cycle never hits the MAX gate, enabling a retry storm of paid runs.
- **Fix sketch**: Re-read `retry_count` from the freshly created retry row (or compute `retry_count + 2`) for the follow-up retry, and apply the `>= MAX_RETRY_COUNT` ceiling on the AI-healing retry path the same way `schedule_healing_retry` does.

## 4. AI healing can re-enable a persona that the circuit breaker disabled, defeating the safety valve
- **Severity**: Medium
- **Category**: Trust boundary / latent failure
- **File**: `src-tauri/src/engine/ai_healing.rs:518` (`enabled` fix) and `mod.rs:3150` (enabled re-check)
- **Scenario**: The circuit breaker disables a persona after 5 consecutive failures (`healing_orchestrator.rs:62`, `check_circuit_breaker`). AI healing explicitly forbids `enabled=false` but **permits `enabled=true`** (ai_healing.rs:521-536) as a "re-enable" fix. A healer diagnosing a failure can emit `{"healing_fix":{"type":"update_config","target":"enabled","payload":"true"}}` and flip a circuit-breaker-disabled persona back on inside `apply_db_fixes` — with no check that the disable was a deliberate breaker trip. `spawn_healing_chain` only checks `persona.enabled` at *start* (line 3150); the re-enable happens at the *end*, so the very session investigating repeated failures can revive the persona the breaker just killed.
- **Root cause**: `enabled=true` is treated as always-safe, conflating "user paused" with "breaker tripped." No flag distinguishes a breaker-disabled persona from a manually-disabled one, so healing cannot tell it must not auto-revive.
- **Impact**: The persona-level circuit breaker — described as the top-priority safety valve — can be silently overridden by the healing run, re-arming a persona into the same failure loop and resuming spend.
- **Fix sketch**: Block `enabled=true` (require human approval, like `enabled=false`) when the most recent disable was breaker-driven; or record a `disabled_reason` and refuse AI re-enable for `circuit_breaker`.

## 5. Dropped-fix detection relies on a brittle substring match and the audit write ignores errors
- **Severity**: Low
- **Category**: Silent failure
- **File**: `src-tauri/src/engine/ai_healing.rs:273` (`fix_text_was_dropped`) and `:295` / `:361` (audit inserts)
- **Scenario**: The guard that surfaces silently-dropped fixes is `parsed_fix_count == 0 && output.contains("healing_fix")` (line 274). A healer that proposes a fix using a synonym or omits the literal token `healing_fix` (e.g. prose like "I will heal the issue" plus malformed JSON) trips zero detection — the run reports completed with no fixes and no audit entry. Conversely the audit-insert helpers (`create_audit_entry` at line 295, and `tx_audit` at line 361) discard their `Result` (`let _ = ...`), so if the audit insert fails the "silent failure" record is itself silently lost.
- **Root cause**: Drop-detection keys on a single magic substring rather than on "the parser saw a JSON object it could not classify," and the audit path — the system's only visibility into healing failures — swallows its own write errors.
- **Impact**: The anti-success-theater safety net has blind spots: genuinely dropped fixes can still be invisible, and an audit-log write failure removes the only breadcrumb, returning to the exact silent-drop failure mode the audit log was built to prevent.
- **Fix sketch**: Flag a drop whenever `extract_json_objects` yields ≥1 object that deserializes to neither envelope, not on a substring; and log (don't swallow) failures of the audit inserts so audit-write failures are themselves observable.
