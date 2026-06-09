# Bug Hunter — reviews-incidents-audit
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Manual-review resolution is read-validate-write with no status guard — double-approval races re-resume steps & re-dispatch runs
- **Severity**: critical
- **Category**: race-condition
- **File**: src-tauri/src/db/repos/communication/manual_reviews.rs:267-299
- **Scenario**: A pending team-gating review is acted on twice nearly simultaneously — e.g. the user clicks Approve while Athena's `execute_resolve_human_review` resolves the same `review_id` (companion/approvals.rs:705-710), or two windows are open, or a double-click slips past the `isProcessing` guard before `reviewQueue.reload()`. `update_status` does `get_by_id` → `validate_transition` → `UPDATE … WHERE id = ?5`. The UPDATE has **no `AND status = <expected>` predicate**. Both callers read `Pending`, both pass `Pending→Approved` validation, both UPDATE the row (each touching 1 row, so each returns `Ok`), and each returns a non-`None` `learned` memory. The command layer then runs `react_to_review_decision` twice (commands/design/reviews.rs:1065) AND the Athena path runs it again (approvals.rs:709).
- **Root cause**: The transition guard is enforced in app code against a value read in a *separate* statement, not as a conditional in the write. Under SQLite the two transactions interleave between the SELECT and the UPDATE, so the guard is advisory, not atomic. Idempotency was never expressed at the row level (contrast `claim_continuation`/`load_pending`, which DO use `WHERE … = expected`).
- **Impact**: corruption + duplicated side effects — the same blocked team step is reset & re-run twice (`auto_resume_retryable_steps`, reviews.rs:1126), and/or a duplicate follow-up persona execution is dispatched (dispatch_review_action, reviews.rs:1196). Burns tokens, can double-apply the reviewed work, and emits `review_decision.*` / `MANUAL_REVIEW_RESOLVED` twice to every subscriber.
- **Fix sketch**: Make the flip atomic and idempotent: `UPDATE … SET status=?1, … WHERE id=?5 AND status=?old`. If `rows == 0`, the row was already moved by a concurrent caller — return early (e.g. `Ok(None)`) and have the command layer treat "no flip" as "someone else already resolved it" so it does NOT re-fire `react_to_review_decision`/`publish_review_decision`. This collapses the whole class (double-approve, user-vs-Athena, double-click) into a single winner.

## 2. `react_to_review_decision` resume is not idempotent — same held step can be re-run by both the user path and Athena
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/commands/design/reviews.rs:1082-1144
- **Scenario**: A review links a held team step (`assignment_id`/`step_id`). It is resolved on the user path (`update_manual_review_status` → react_to_review_decision) and, around the same time or shortly after, via Athena (`execute_resolve_human_review` → react_to_review_decision, approvals.rs:709). Each call independently runs the `held` SELECT (status `awaiting_review`/`paused` + step `failed`), sees it still held (the orchestrator's reset hasn't committed yet), and both call `auto_resume_retryable_steps` for the same step.
- **Root cause**: The "is it still held?" check and the resume action are not a single atomic claim. There's no `WHERE continued_at IS NULL`-style guard (which the *incident* continuation path correctly has — audit_incidents.rs:427 `claim_continuation`) to make resume fire at most once per review.
- **Impact**: corruption / wasted execution — a blocked step is reset and re-dispatched twice, doubling the work and any external side effects it performs.
- **Fix sketch**: Gate resume on an atomic claim — e.g. add a `resumed_at` (or reuse the review's terminal flip from finding #1 as the single source of truth) and only resume when the conditional UPDATE that claims the review/step returns 1 row. Fixing #1 (single winner of the status flip) largely subsumes this because only the winning caller would proceed to react.

## 3. Bulk approve/reject swallows per-item failures — success theater on partial failure
- **Severity**: high
- **Category**: silent-failure
- **File**: src/features/overview/sub_manual-review/components/ManualReviewList.tsx:219-228
- **Scenario**: The user selects N pending reviews and clicks "Approve all". `handleBulkAction` runs `Promise.allSettled(...)` over `updateManualReviewStatus(id, status)` calls and then unconditionally `setSelectedIds(new Set())` + `reviewQueue.reload()`. If some calls reject (DB busy/locked, an invalid transition because a row was already terminal, IPC auth blip), the rejections are never inspected: no toast, no log, no retry.
- **Root cause**: `allSettled` is used to "never throw," but the settled results are discarded. The handler treats "all promises settled" as "all reviews resolved." The same pattern with no result inspection appears in the cloud branch (`respondToCloudReview`).
- **Impact**: UX degradation + data integrity illusion — the operator believes M reviews were approved; some silently stayed `pending`. After reload they may even disappear from the current filter view (if others changed), masking the failures. Mirrors exactly the anti-pattern the Rust `bulk_acknowledge`/`bulk_resolve` were deliberately fixed to avoid (audit_incidents.rs:460-497), but the frontend re-introduces it.
- **Fix sketch**: Inspect the settled array: count `status === 'rejected'`, surface `addToast("X of Y could not be approved …", 'error')`, and do NOT clear the selection for the failed ids so the user can retry. Optionally route bulk reviews through a backend bulk command that returns the per-id outcome (like the incidents bulk path).

## 4. Solo-persona learning-loop memory is written on every resolution with no dedup — duplicate "Human approved" memories under retries/races
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/db/repos/communication/manual_reviews.rs:391-419
- **Scenario**: A teamless persona's review is resolved twice (the race in finding #1, or a user re-approves an already-approved review via the inbox `Approved→Resolved` allowed transition). The `home_team_id`-present branch dedups by `(team_id, title)` before inserting a `team_memory` (lines 349-356), but the **solo/no-team branch has no existence check** — it calls `memories::create` unconditionally each time `update_status` runs with an Approved/Rejected target.
- **Root cause**: Dedup was only added to the shared-team path; the per-persona fallback was left as a blind insert, so the "exactly one importance-5 learned memory" guarantee documented in the command (reviews.rs:1050-1053) doesn't actually hold for solo personas.
- **Impact**: corruption (memory bloat) — duplicated `learned` memories pollute the persona's recall and skew importance weighting; the very fleet-token-bloat the team-path dedup was introduced to fix.
- **Fix sketch**: Apply the same `(persona_id, title)` existence check to the solo branch before `memories::create`, or upsert on a natural key. Best paired with #1 so the second resolution never reaches this code at all.

## 5. Incidents detail modal acts on a stale snapshot — resolving an already-resolved/changed incident silently no-ops while claiming success
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/overview/sub_incidents/components/IncidentDetailModal.tsx:65-75 (with src-tauri/src/db/repos/execution/audit_incidents.rs:320-321)
- **Scenario**: The inbox refreshes every 30s (useIncidentsData.ts:11/58). A user opens the detail modal for an `open` incident, leaves it open while a background promoter/another window/Athena resolves the same incident, then clicks "Resolve" with a note. The IPC reaches `apply_transition`, which reads `current.status == 'resolved'`, hits the `from == target` branch and returns `Ok(false)` (idempotent no-op). The command returns `Ok(false)`; the modal's `run()` only checks for a thrown error, so it calls `onChanged?.()` + `onClose()` and shows nothing — the user's resolution note is **silently dropped** and they believe their note/decision was applied.
- **Root cause**: The boolean `changed` return is discarded by every caller (`useIncidentActions.handle` and `IncidentDetailModal.run` both ignore the resolved value), so "I made no change because the row already moved / moved differently than you saw" is indistinguishable from success. The note the user typed for the *resolve they intended* is lost.
- **Impact**: UX degradation + lost decision metadata (resolution note never persisted) when acting on a stale row; also affects acknowledge/dismiss/reopen.
- **Fix sketch**: Have the lifecycle commands return the post-mutation incident (or a `{changed, status}` shape). In the modal/`handle`, when `changed === false`, surface a toast ("This incident was already <status> elsewhere") and refresh rather than silently closing, so a dropped note is never mistaken for an applied one.

## 6. Incident promotion is globally gated by a per-call env read — a missing/typo'd `PERSONAS_INCIDENTS_PROMOTION` silently drops every flagged event
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/engine/audit_incidents_promoter.rs:43-45 (consumed by every `promote_*`)
- **Scenario**: Every promoter calls `enabled()` which reads `std::env::var("PERSONAS_INCIDENTS_PROMOTION")` and proceeds only when it equals exactly `"1"`. If the env var is unset, set to `true`/`yes`/`on`, has trailing whitespace, or the deployment forgot it, EVERY promoter returns at the top as a no-op. No alert, tool error, credential failure, healing miss, provider failover, policy drop, or open healing issue is ever promoted into the incidents inbox — the entire quality-control surface for "flagged runs that need a human" is empty, indistinguishable from "all healthy."
- **Root cause**: A hard, exact-match, fail-closed gate with no observability. The bake-in flag has no startup log of its resolved state and no value normalization, so a config mistake produces total silent suppression rather than a visible degraded mode. (Secondary: reading the env on every audit insert is also a hot-path cost, but the silent-suppression is the reliability risk.)
- **Impact**: security/operational blind spot — incidents that should reach a reviewer are silently never created; the inbox shows zero and the operator assumes nothing is wrong. A flagged run is, in effect, auto-cleared (never surfaced for review).
- **Fix sketch**: Resolve the gate once at startup, log the resolved enabled/disabled state (and warn on an unrecognized non-empty value), and normalize parsing (`"1"|"true"|"on"`, trimmed/lowercased). Better: surface the promotion-enabled state in the inbox UI so an empty inbox under a disabled gate is visibly "promotion off," not "all clear."
