# Incidents & Manual Review — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. auto_triage failure fallback clobbers a human's review decision made during the evaluator window
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/auto_triage.rs:491-507 (also the nested fallback at :462-471)
- **Scenario**: A capability with `review_policy.mode = "auto_triage"` emits a manual_review. While the spawned evaluator is running (up to 120s: CLI spawn + LLM latency), the user opens the Human-Review inbox and **rejects** the review with notes. The evaluator then fails (timeout, spawn failure, or unparseable verdict) and `apply_fallback` runs.
- **Root cause**: `apply_verdict` carefully re-loads the row and drops the verdict unless it is still `Pending` ("the human decision wins"), but `apply_fallback` has no such guard — it calls `update_status(…, Resolved, Some(note))` unconditionally. The CAS inside `manual_reviews::update_status` keys on whatever status it re-reads at call time, and `validate_transition` explicitly allows `Approved/Rejected → Resolved` (db/models/review.rs:42). So the fallback is a *legal* transition over the human's decision. Additionally `reviewer_notes = COALESCE(?2, reviewer_notes)` means the non-null fallback note **replaces** the human's reviewer notes.
- **Impact**: A degraded evaluator silently flips a human `rejected` (or `approved`) row to `resolved` and overwrites the human's notes with "auto_triage evaluator failed — auto-resolved as fallback". The rejection disappears from the pending/decided views and the audit trail misattributes the outcome. The same blind `Resolved` landing exists in `apply_verdict`'s inner error branch (:462-471).
- **Fix sketch**: In `apply_fallback` (and the inner fallback of `apply_verdict`), perform the same `get_by_id` + `status == Pending` pre-check before landing `Resolved`; better, add a repo helper `update_status_if_pending` that CASes on `status = 'pending'` explicitly so all evaluator writes are single-winner against the human.

## 2. persona_blocker continuation permanently stranded when a post-claim lookup hits a transient DB error
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/incident_continuation.rs:196-218
- **Scenario**: A resolved `persona_blocker` incident is picked up by the continuation tick. `claim_continuation` stamps `continued_at`, then `exec_repo::get_by_id(&pool, &blocked_id)` (or `persona_repo::get_by_id`) returns `Err` because SQLite is momentarily locked (SQLITE_BUSY under concurrent engine writes) — not because the row is gone.
- **Root cause**: `Err(_)` is interpreted as "blocked execution no longer exists; skipping" — `NotFound` and transient `Database` errors are conflated *after* the permanent claim was taken. The module already recognizes and fixes this exact class for the `team_assignments` path (`failed_assignment_steps` returns a real `Result` and runs **before** the claim, lines 108-135), but the persona_blocker path still claims first and treats any lookup error as terminal. `create_retry`/`start_execution` failures (:266-321) similarly leave the row claimed-but-never-continued with only a `tracing::warn`.
- **Impact**: A one-tick lock blip converts "resolved, will auto-continue" into "silently never continues" — the incident shows resolved+continued (`continued_at` stamped) while the blocked work never re-ran; the safety design ("worst case is a no-op") becomes a silent broken promise with no inbox signal.
- **Fix sketch**: Mirror the team path: run the execution/persona lookups (distinguishing `AppError::NotFound` from other errors) **before** `claim_continuation`, and `continue` without claiming on non-NotFound errors so the next tick retries. Optionally un-stamp `continued_at` (or record a policy_event) when `create_retry`/`start_execution` fail post-claim.

## 3. Summary KPIs silently drop `in_progress` incidents — actively-worked incidents vanish from every count
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/execution/audit_incidents.rs:346-352 (and model src-tauri/src/db/models/audit_incident.rs:164-176)
- **Scenario**: The user (or Athena) moves an open incident to In Progress via `set_incident_in_progress` — the middle state of the app's own `open → in_progress → resolved` escalation lifecycle — then looks at the inbox header tiles.
- **Root cause**: `summary()` buckets `GROUP BY status` rows into only four matches (`open/acknowledged/resolved/dismissed`); `"in_progress"` falls into the `_ => {}` arm, and `AuditIncidentSummary` has no `in_progress` field. The status was added to the lifecycle (`IncidentStatus::InProgress`, `can_transition`) but the KPI aggregate was never extended. `open_by_severity`/`open_by_source` are `status='open'`-scoped too, so an in-progress critical also leaves the severity chips.
- **Impact**: Committing to fix an incident makes it disappear from all header KPIs — total counts shrink as if the incident were closed. The most urgent, actively-worked items are the ones uncounted; sums across tiles no longer match the list view, eroding trust in the inbox numbers.
- **Fix sketch**: Add `in_progress: i64` to `AuditIncidentSummary` (regenerating the TS binding) and a matching arm in `summary()`; surface it as its own tile or fold it into a "needs attention" aggregate. Consider including `in_progress` alongside `open` in the by-severity/by-source breakdowns since it is a non-terminal state.

## 4. BacklogInboxGroup: load failure is indistinguishable from empty, and the single-slot `acting` state re-enables an in-flight row
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/overview/sub_manual-review/components/BacklogInboxGroup.tsx:26,34,49-51,54
- **Scenario**: (a) `dev_tools_list_pending_ideas` rejects (backend hiccup) — `silentCatch` swallows it and `ideas` stays `[]`, so the whole group renders `null`: 30 pending ideas silently vanish from the inbox with no error state and no retry (the component never reloads after mount). (b) User clicks Accept on idea A, then immediately Accept on idea B: `acting` is a single string slot, so B overwrites A; when A's request finishes, its `finally { setActing(null) }` clears B's loading state while B's request is still in flight — B's Accept/Reject buttons re-enable mid-request, allowing a second conflicting action on the same idea.
- **Root cause**: Error state collapsed into the empty state ("nothing pending → render nothing" also covers "fetch failed"), and per-row in-flight tracking modeled as one shared `acting: string | null` instead of a set.
- **Impact**: Success theater — the human triage surface can silently show an empty backlog on failure; and a fast triager can double-act an idea (e.g. accept then reject), whichever backend call lands last wins, corrupting the accepted/rejected learning memory the doc-comment says these actions write.
- **Fix sketch**: Track `error` separately and render a compact inline error row with a Retry button instead of `null`; change `acting` to a `Set<string>` (add on start, delete in finally) so each row's buttons key off its own membership. A failed `act` should also surface a toast rather than `silentCatch`.

## 5. ActionZone: placeholder styled identically to entered text, and the notes field stays editable mid-submit
- **Severity**: Low
- **Category**: ui
- **File**: src/features/overview/sub_manual-review/components/ActionZone.tsx:40-47 (textarea), :22-28 (zone button)
- **Scenario**: User expands an action zone (Approve/Reject) on a manual review. The notes textarea uses `placeholder:text-foreground` — the placeholder renders in the exact same color as typed text, so at a glance a pre-filled-looking "Add a note…" reads as content already entered. After clicking Confirm (`isProcessing`), the Confirm and zone buttons disable but the textarea does not — text typed during the request is silently discarded because the mutation already captured the old `notes` value.
- **Root cause**: Placeholder color token misuse (should be a muted foreground), and the processing state applied only to buttons, not the input it governs. The expandable zone trigger also omits `aria-expanded`, unlike the sibling raw-JSON toggle in IncidentDetailBreakdown which sets it correctly.
- **Impact**: Users can't tell placeholder from entered note (risking empty notes on approve/reject), keystrokes during submission are lost without feedback, and screen-reader users get no expanded/collapsed announcement on the action zones.
- **Fix sketch**: Use `placeholder:text-foreground/50` (or the app's muted token), add `disabled={isProcessing}` to the textarea, and put `aria-expanded={active}` on the zone toggle button.
