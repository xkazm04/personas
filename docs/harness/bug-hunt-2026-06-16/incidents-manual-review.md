# Bug Hunter — Incidents & Manual Review

> Total: 5 findings (1 C critical, 2 H high, 1 M medium, 1 L low)
> Context: incidents-manual-review | Group: Observability & Analytics

## 1. Reopened persona_blocker incident can never re-continue (continued_at is never cleared)
- **Severity**: High
- **Category**: Latent failure / state-machine integrity
- **File**: `src-tauri/src/db/repos/execution/audit_incidents.rs:427`
- **Scenario**: A persona raises a blocker → incident resolved → the continuation loop claims it (`continued_at` stamped) and re-runs the work. The user later realizes the fix was wrong, **reopens** the incident (`resolved → open`), fixes it properly, and **resolves it again**. The blocked work is never re-run a second time.
- **Root cause**: `apply_transition`'s `Open` (reopen) branch clears `acknowledged_at`, `acknowledged_by`, `resolved_at`, `resolution_note` — but NOT `continued_at`. `find_continuation_candidates` filters on `continued_at IS NULL` (line 476), so a once-continued incident is permanently excluded from re-continuation regardless of how many resolve/reopen cycles follow. `reopen()` (line 512) goes through this same branch.
- **Impact**: Silent. The human re-resolves expecting the work to resume; nothing happens, no error, no log on the resolve path. The whole reopen→re-resolve recovery affordance is dead for the continuation use case — exactly the "incident stuck forever" failure mode the loop was built to prevent.
- **Fix sketch**: Add `continued_at = NULL` to the `Open` UPDATE branch (and to `InProgress`, which also represents "work resuming"). A reopen logically un-does the prior continuation claim, so the slate should be clean.

## 2. auto_triage evaluator races GC / human resolve; LLM verdict silently lost
- **Severity**: High
- **Category**: Race condition / silent failure
- **File**: `src-tauri/src/engine/auto_triage.rs:392`
- **Scenario**: A capability with `review_policy.mode = "auto_triage"` creates a `pending` review and `spawn_evaluator_task` fires a fire-and-forget tokio task that runs Claude CLI for up to 120s (`EVALUATOR_TIMEOUT_SECS`). During that window: (a) `gc_stale_pending` (or `ManualReviewAutoTriageSubscription`) flips the row to `resolved`, OR (b) the human opens the review queue (the row is visible because it's still `pending`) and approves/rejects it. When the evaluator finally returns, `apply_verdict` calls `update_status(.., Approved/Rejected, ..)`.
- **Root cause**: `update_status` validates `Resolved → Approved` / `Approved → Rejected` via `validate_transition` (`review.rs:39`), which rejects them. The single-winner CAS (`AND status = ?6`) further guarantees the loser sees 0 rows. `apply_verdict` logs a `warn` and then attempts a `Resolved` fallback which ALSO fails (`Resolved → Resolved` is disallowed by `validate_transition`). The actual LLM verdict (approve/reject) is discarded with only a tracing::warn — no policy_event recording the real decision, no surfacing to the user.
- **Impact**: Success theater on the dispatch side (review "handled") while the genuine triage verdict evaporates. Worse, because the evaluator was also expected to be the gate that *blocks human-bypass only when compliant*, a row GC-resolved as neutral while the evaluator would have REJECTED it means a policy-violating output is silently treated as fine.
- **Fix sketch**: Before spawning, mark the review with a distinct in-flight status (e.g. `auto_triage_pending`) excluded from GC and the human queue; or in `apply_verdict`, on the CAS-loss path re-read current status and record a `review.auto_triage.superseded` policy_event instead of a bare warn, so the lost verdict is at least auditable.

## 3. raise_incident dedup is per-execution, but the open-title guard silences distinct real blockers
- **Severity**: Medium
- **Category**: Edge case / latent failure
- **File**: `src-tauri/src/db/repos/execution/audit_incidents.rs:139`
- **Scenario**: Two different executions of the same persona each hit a genuinely different blocker whose titles normalize to the same key (digits collapsed to `#`, 64-char truncation). E.g. "Cannot reach api.foo.com (attempt 3)" and "Cannot reach api.bar.com (attempt 7)" both normalize to `cannot reach api.` + collapsed runs and can collide once truncated. The second `promote()` returns `Ok(None)` and the second blocker is dropped entirely.
- **Root cause**: The OPEN-DUPLICATE guard compares `normalize_title_key` across ALL open incidents for the persona (lines 140-159) and treats any match as "already exists." Digit-collapsing + 64-char truncation is lossy; titles that differ only past char 64, or only in numeric/host detail, are treated as identical. For persona-less sources the match is scoped only by `kind`, which is even coarser.
- **Impact**: A real, distinct blocker never reaches the inbox — no incident, no continuation candidate, no human nudge. The originating execution finished (incidents are non-blocking), so the work is silently stuck with zero trace. This is the inverse of the noise problem the guard was added to fix (the 22 "Transient process failure" copies).
- **Fix sketch**: Restrict the title-collapse dedup to incidents sharing the same `kind` AND a recency window (e.g. open within last N min) rather than all-open-for-persona; or keep the per-execution `dedup_key` as the only hard idempotency and demote the title-collapse to a "linked occurrences" counter rather than a silent drop.

## 4. bulk_resolve is non-transactional; a mid-batch DB error leaves a partially-resolved set and aborts publishing
- **Severity**: Low
- **Category**: Silent failure / partial-commit
- **File**: `src-tauri/src/db/repos/execution/audit_incidents.rs:544`
- **Scenario**: User bulk-resolves 50 incidents. The 30th `resolve()` call hits a transient SQLITE_BUSY/lock. `bulk_resolve` propagates the error via `?`, so `bulk_resolve_audit_incidents` (command layer) returns `Err` to the UI.
- **Root cause**: `bulk_resolve` loops calling `resolve()` per id with no enclosing transaction. Incidents 1–29 are already committed as `resolved`, but the function returns `Err` before building the `flipped` list — so the command layer's `for id in &resolved_ids` publish loop never runs. The 29 already-resolved incidents get NO `incident_resolved` event published, meaning their `persona_blocker` continuations are only ever picked up by the 60s polling loop, not the event path, and the UI shows a failure toast implying nothing resolved.
- **Impact**: Operator sees "failed," reality is 29 silently resolved + 21 untouched. Mismatch between reported and actual state; continuation events skipped for the silently-committed rows. (The polling loop is the safety net, so impact is bounded — hence Low.)
- **Fix sketch**: Wrap the bulk loop in a single transaction, or collect `flipped` incrementally and return it alongside the error (return a partial-success struct) so the command layer can still publish for the rows that committed.

## 5. Incident continuation re-runs work even when the originating execution was a simulation / its input is gone
- **Severity**: Critical
- **Category**: Latent failure / context loss
- **File**: `src-tauri/src/engine/incident_continuation.rs:190`
- **Scenario**: A `persona_blocker` incident's `source_id` is the blocked execution id. On continuation, the loop loads the execution, parses `input_data`, and starts a fresh `create_retry` run with a generic PromptHint. If `input_data` is NULL or unparseable JSON, `input_data` silently becomes `None` (line 193 `.and_then(...ok())`) and the re-run starts with **no input context** — only the hint "pick up where the blocked run left off." The persona has no memory of what the original task was and either fabricates work or re-runs against empty input.
- **Root cause**: `blocked.input_data.as_deref().and_then(|s| serde_json::from_str(...).ok())` swallows both the NULL case and the malformed-JSON case into the same silent `None`. There is no guard that the continuation actually carries the original task context, and no check that the blocked execution was not a simulation/lab/eval run (the promote site guards `is_simulation` but `create_retry` here does not re-check the execution's origin). A retry of a continuation whose context is gone produces a plausible-looking but contextless run — success theater at the execution level.
- **Impact**: The most dangerous outcome of the whole continuation feature: a human resolves a blocker believing the exact blocked work resumes, but the agent re-runs with no task input and may take real, irreversible actions (send email, write files, call connectors) based on a hallucinated reconstruction. Cost is burned and the audit trail records a "successful continuation" that did not continue the intended work.
- **Fix sketch**: Distinguish NULL vs parse-error input; if the original `input_data` is absent/unparseable, abort the continuation (log + leave incident claimed-but-failed for human attention) rather than starting a contextless run. Also re-load and check the blocked execution's run kind, refusing continuation for simulation/lab/eval origins.
