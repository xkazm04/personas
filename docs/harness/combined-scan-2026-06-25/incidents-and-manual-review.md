# Incidents & Manual Review — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: incidents-and-manual-review | Group: Observability & Analytics
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Open-duplicate guard silently drops distinct concurrent blocked-execution incidents → abandoned work, no continuation
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / lost incident
- **File**: src-tauri/src/db/repos/execution/audit_incidents.rs:167-187 (open-dup guard); interacts with src-tauri/src/engine/dispatch.rs:732 (persona_blocker promote) and src-tauri/src/engine/incident_continuation.rs:163-164 (`source_id` == blocked execution id)
- **Scenario**: Persona P has two distinct executions, E1 and E2 (two separate tasks), both blocked on the same thing, e.g. title "Missing API credential for Stripe". E1 calls `raise_incident` → `promote()` inserts an OPEN incident (`source_id = E1`). E2 calls `raise_incident` → the open-duplicate guard finds an OPEN incident for persona P whose `normalize_title_key` matches → returns `Ok(None)` and drops E2's incident entirely. dispatch logs "deduped". A human resolves the one visible incident → continuation re-runs E1 only. E2 stays blocked forever: no incident row, no continuation candidate, nothing in the inbox.
- **Root cause**: The guard compares only `normalize_title_key(title)` scoped by `persona_id`, ignoring `source_table`/`source_id`. But for `persona_blocker` incidents the continuation loop keys recovery on `source_id = execution_id`; each blocked execution needs its OWN incident to ever be continued. The dedup was built precisely because "personas re-discovered the same blocker every run" (lines 163-166), so same-title-across-executions is the COMMON case — making this collapse high-likelihood, not a corner case. Only 1 of N identically-blocked executions is ever recoverable.
- **Impact**: Distinct queued work is silently and permanently abandoned, with zero operator visibility (the deduped execution has no inbox row at all).
- **Fix sketch**: Exclude continuable source tables (`persona_blocker`, `team_assignments`) from the title-based open-dup guard (rely on the per-`source_id` `dedup_key` UNIQUE for their idempotency), or include `source_id` in the comparison so every blocked execution always gets its own continuable incident.
- **Value**: impact=8 effort=3

## 2. team_assignments resume swallows a DB error as "no failed steps" AFTER claiming → parked assignment never resumes
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: swallowed error / lost continuation
- **File**: src-tauri/src/engine/incident_continuation.rs:110-133 (failed_steps query + `if failed_steps.is_empty()` skip), claim at :92
- **Scenario**: A human resolves an Athena review-resolution incident (`source_table = "team_assignments"`). The continuation tick wins the atomic `claim_continuation` (stamps `continued_at`). The very next step — `SELECT id FROM team_assignment_steps WHERE ... status='failed'` — hits a transient `SQLITE_BUSY`/lock. The chained `.ok() ... .unwrap_or_default()` turns that error into an empty `Vec`, so the code logs "assignment has no failed steps (already resumed/done); skipping" and `continue`s. Because `continued_at` is already stamped, the incident never reappears as a candidate. The parked assignment is never un-parked.
- **Root cause**: `failed_steps` collapses "query error" and "genuinely zero failed steps" into the same empty result (lines 110-125), and the claim is taken BEFORE this fallible lookup. A transient error is therefore misclassified as success and made permanent by the prior claim.
- **Impact**: After the human fixes the blocker, the assignment silently stays parked forever — the exact "no machine path back to running" failure this module was written to close (line 105-107) reopens under DB contention.
- **Fix sketch**: Make the failed-steps lookup return `Result` and, on `Err`, log and skip WITHOUT a permanent claim — either claim only after the lookup succeeds, or reset `continued_at` to NULL on any abort so the next tick retries.
- **Value**: impact=7 effort=3

## 3. claim_continuation stamps `continued_at` before fallible/aborting steps; aborted continuations look identical to successful ones and are never surfaced
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: ambiguity → silent abandonment / missing tribal-knowledge mechanism
- **File**: src-tauri/src/engine/incident_continuation.rs:92 (claim) vs abort `continue`s at :126-133, :192-199, :209-230, :282-289
- **Scenario**: A `persona_blocker` incident is resolved; the blocked run's `input_data` was NULL/empty (a legitimate state for a contextless trigger). The continuation claims it, then aborts at lines 222-229 ("refusing contextless continuation"). The incident remains `status='resolved'` with `continued_at` set — byte-identical to a successfully-continued incident. Same for an `is_simulation` abort (192-199) and a `start_execution` failure (282-289, possibly transient).
- **Root cause**: The atomic claim is placed before all validation/abort paths. The code comment claims it leaves the row "claimed-but-not-continued for human attention" (lines 206-208), but there is NO backing mechanism: no distinct status, no flag, no `policy_event`, no reopen. The human gets no signal, and the loop will never retry it.
- **Impact**: Blocked work is silently never re-run while the inbox falsely implies it was continued; a transiently-failed `start_execution` is also lost permanently. Undocumented threshold/contract — "for human attention" is aspirational.
- **Fix sketch**: Claim only after the guards pass (right before `start_execution`), OR on any abort path reset `continued_at = NULL` (so human-fixable conditions retry) and emit a distinct `policy_event` / reopen the incident so aborted continuations are visible and distinguishable.
- **Value**: impact=6 effort=4

## 4. Backlog group caps at 100 with a misleading count badge — pending ideas beyond 100 are hidden and un-actionable
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: grouping hides items / uncovered edge case
- **File**: src/features/overview/sub_manual-review/components/BacklogInboxGroup.tsx:32 (`listPendingIdeas(100)`), :66-68 (badge shows `ideas.length`), :29-39 (`load` runs only on mount)
- **Scenario**: 150 ideas are pending across projects. The inbox group loads the first 100, and the count badge renders `ideas.length` = 100 — presenting "100 pending" as if that were the whole backlog. The remaining 50 are invisible and cannot be accepted/rejected from this surface. Because `load` only fires on mount, clearing the visible 100 never pulls the hidden 50 into view; an operator believes the backlog is fully triaged.
- **Root cause**: Hard cap of 100 with no offset/pagination, no total-count query, and no "showing X of N" affordance; the displayed count is the truncated loaded length, not the true total.
- **Impact**: Silent under-triage of the backlog; hidden work that the human-review inbox was specifically built to surface.
- **Fix sketch**: Fetch a separate total count and render "100 of N", add "load more"/pagination (offset), and re-`load()` after a batch of accept/reject actions so previously-truncated items surface.
- **Value**: impact=5 effort=3

## 5. Open-duplicate dedup discards severity escalation of a recurring blocker
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented dedup behavior → wrong-priority triage
- **File**: src-tauri/src/db/repos/execution/audit_incidents.rs:182-187 (returns `Ok(None)` on title match, discarding the new row's severity/detail)
- **Scenario**: A persona raises "Database connection failing" at `medium` (open). The condition worsens and is re-raised at `critical`. `promote()` finds the open `medium` row by normalized title → returns `Ok(None)`, dropping the critical signal. The inbox keeps showing `medium`; the operator triages and prioritizes at the wrong (lower) severity while the situation is actually critical.
- **Root cause**: The open-dup guard matches on title only and, on a match, drops the incoming row entirely — it never updates the existing incident's severity, detail, or a recurrence/last-seen marker. Escalation and recurrence are invisible. The "compare on normalized title" rule (lines 158-187) is an undocumented threshold with this lossy side effect.
- **Impact**: Worsening incidents are under-prioritized; recurrence frequency is unobservable. Affects every source that re-fires (the same path that legitimately dedups same-severity noise).
- **Fix sketch**: On an open-dup match, instead of dropping, update the existing open incident to `severity = max(old, new)`, refresh `detail`/a `last_seen_at`, and/or bump a recurrence counter — surfacing escalation and recurrence without stacking rows.
- **Value**: impact=5 effort=4
