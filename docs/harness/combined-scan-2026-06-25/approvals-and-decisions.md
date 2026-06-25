# Approvals & Decisions — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: approvals-and-decisions | Group: Athena Companion
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

> Backend note: the Rust approval gate itself is genuinely hardened — every execution path
> goes through `load_pending`'s atomic `pending→running` compare-and-swap (approvals.rs:519-537),
> reject never runs an executor, and a 24h freshness check refuses stale acts. No denied-action-
> executes / approval-bypass / double-execution defect exists in `approvals.rs`. The real exposure
> is on the **frontend decision surface**, where the gate's outcome is silently dropped.

## 1. Orb decision `run()` handlers swallow failures, defeating the documented "keep-pending-on-failure" safety net
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / swallowed error / lost decision
- **File**: src/features/plugins/companion/decision/useDecisionQueue.ts:101-111 (and 205-211, 216-225) vs src/features/plugins/companion/decision/resolveDecision.ts:37-55
- **Scenario**: Hands-free/autonomous mode is on. The user picks "Approve" (or "Reject") on the orb decision bubble. `companionApproveAction(id)` throws — the approval expired (>24h, see #5), was concurrently resolved, or an IPC/pool error. `runDecisionOption` is explicitly built so that a throwing `option.run()` keeps the decision pending and shows a "please try again" toast (resolveDecision.ts:37-48). But the `option.run()` it receives is `() => resolve(() => companionApproveAction(id))`, and `resolve` wraps the call in `try { … } catch (err) { silentCatch(...)(err) }` (useDecisionQueue.ts:108-110) — it never re-throws. So `option.run()` resolves *successfully*, `runDecisionOption` records `decision_resolved` analytics and calls `clearPendingDecision()` (resolveDecision.ts:50-54). The bubble vanishes; the user believes the action was approved/denied; it was not.
- **Root cause**: Two layers each "handle" the error. The inner `resolve`/review/incident/message wrappers all `silentCatch` and return normally, so the outer `runDecisionOption` guard — the one with the user-facing toast and the pending-retain — can never fire. The safety contract documented in resolveDecision.ts:27-35 is bypassed by its own callers.
- **Impact**: For an expired approval the decision is *lost* with a false "resolved" (the freshness filter prevents it re-listing, so it never re-surfaces). For transient failures the same approval silently re-pumps on the next queue tick with zero feedback — the user gets no error, no retry prompt, and a polluted `decision_resolved` UX signal. This is precisely "the worst class of bug" resolveDecision.ts's own docstring claims to have fixed.
- **Fix sketch**: Make the `option.run()` factories propagate failure: drop the inner `silentCatch`-and-return in `approvalToDecision`/`reviewToDecision`/`incidentToDecision`/`messageAttentionToDecision`, OR re-throw after logging, so `runDecisionOption`'s catch (the single intended failure handler) actually runs. Keep the success-only side effects (`removeApproval`, `clearPendingDecision`) on the resolved path only.
- **Value**: impact=6 effort=2

## 2. Approved `compose_dashboard` action's UI follow-up is a guaranteed no-op (stale tab name)
- **Severity**: Medium
- **Lens**: bug-hunter / ambiguity-guardian
- **Category**: silent failure / stale contract
- **File**: src-tauri/src/commands/companion/approvals.rs:2620-2622 vs src/features/plugins/companion/ApprovalCard.tsx:30,60-68
- **Scenario**: A pre-existing pending `compose_dashboard` approval row resolves through the in-chat card (the executor is kept as a fallback, approvals.rs:230-234). On Approve, `execute_compose_dashboard` saves the spec and returns `ClientAction::OpenCompanionTab { tab: "dashboard" }` with message "…opening it for you now." `ApprovalCard.applyClientAction` validates `action.tab` against `VALID_COMPANION_TABS = ['setup','memory','voice','decisions']` (ApprovalCard.tsx:30) — `"dashboard"` is not in it → early `return` (line 60-64). No navigation happens.
- **Root cause**: The companion tab set was renamed; `CompanionPluginTab` is now `setup|memory|voice|decisions` (companionPluginSlice.ts:4-8), but three stale references still say `dashboard`: the emitter (approvals.rs:2621), the `OpenCompanionTab` doc comment (approvals.rs:99-102), and the TS type in api/companion.ts:748.
- **Impact**: The backend logs "approved & executed" and tells the user the dashboard is opening, but the UI silently does nothing — an approved action's promised effect never lands. Low frequency (fallback path only), but a clean trust-eroding silent failure of a consent surface.
- **Fix sketch**: Decide the real target tab. If the dashboard view is gone, drop `compose_dashboard`'s `client_action` (return a pure message) and remove the dead executor; if it maps to `decisions`, emit `tab: "decisions"`. Reconcile the doc comment and api/companion.ts type either way.
- **Value**: impact=4 effort=2

## 3. OrbDecisionBubble option buttons have no busy/disabled guard → review double-resolution
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / double-action
- **File**: src/features/plugins/companion/orb/OrbDecisionBubble.tsx:134,264-307
- **Scenario**: `pick(opt)` fires `runDecisionOption(opt)` un-awaited and the chips carry no disabled state (contrast `ApprovalCard`, which disables both buttons via `busy !== null`, ApprovalCard.tsx:186-199). A user double-taps a chip, or taps "Approve" then a suggested-action chip, before the first call resolves. For *approvals* the backend CAS absorbs the second call (it fails "not pending"). But the *human-review* options have no such guard: `resolve('approved')` → `updateManualReviewStatus` and `carryOut(action)` → `dispatchReviewAction` (useDecisionQueue.ts:205-225) can both land, resolving the review twice and launching a persona execution to "carry out" an action on a review the user also plain-approved.
- **Root cause**: No per-decision in-flight lock on the bubble; the only idempotency is whatever each backend call happens to provide, and the manual-review path provides none equivalent to the approval CAS.
- **Impact**: Duplicate/contradictory resolution of a human review and a spurious persona execution. Combined with #1 the duplicate failure is also swallowed, so the user never sees it.
- **Fix sketch**: Add a local `busy` state (or a store-level in-flight flag keyed by `decision.id`) that disables all chips once one is picked, mirroring `ApprovalCard`. Await `runDecisionOption` before re-enabling.
- **Value**: impact=4 effort=3

## 4. Successful executor + failed `finalize_approval` orphans the row in 'running' and drops the audit episode
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: lost audit / stuck state
- **File**: src-tauri/src/commands/companion/approvals.rs:294-295 (and finalize_approval 541-567)
- **Scenario**: `companion_approve_action` runs the executor (privileged action *already executed* — persona spawned, fact written, connector called), then calls `finalize_approval(...)?`. If that UPDATE fails or matches 0 rows (DB lock, concurrent tamper), the `?` returns `Err` *before* `log_action_episode` (line 295) runs. The row stays in `status='running'`; the list query only surfaces `pending`, and nothing else transitions `running`, so the row is orphaned forever. No system episode records that the action ran.
- **Root cause**: Side effect (execute) precedes commit (finalize+log), and the early-return on finalize failure skips the audit write for an action that did complete.
- **Impact**: A privileged action executed with no audit trail and a permanently-stuck row; the user sees a scary error and cannot retry (`load_pending` now refuses the `running` row). Low likelihood, but it silently breaks the "every action is logged as an episode" invariant.
- **Fix sketch**: Log the action episode regardless of finalize outcome (move `log_action_episode` before the `?`, or run it in both arms), and/or add a recovery transition for stuck `running` rows (timeout sweep → `approved_failed`).
- **Value**: impact=4 effort=3

## 5. Undocumented 24h consent-freshness expiry — an expired decision vanishes with no surfaced deadline
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: undocumented constant / uncovered edge case
- **File**: src-tauri/src/commands/companion/approvals.rs:42 (APPROVAL_FRESHNESS_WINDOW) + load_pending 504-510
- **Scenario**: An approval older than 24h is hidden from the list and refused at act-time with `AppError::Validation("…has expired…")`. The window is a Rust-only constant with no user-facing surface: the in-chat `ApprovalCard` is rendered from a stored prop (not re-fetched), so a day-old card still shows clickable Approve/Reject; only on click does the user learn it expired. Via the orb, that thrown expiry error is swallowed (#1), so the decision simply disappears as a false "resolved."
- **Root cause**: The expiry policy exists only in backend logic; neither the card nor the orb communicates a deadline, an expired state, or a "re-issue the request" affordance.
- **Impact**: A decision the user intends to act on can be silently un-actionable; the only feedback is a raw validation error (card) or nothing (orb). Tribal-knowledge constant with no doc.
- **Fix sketch**: Surface remaining freshness in the card (e.g., "expires in N h"), render an explicit expired state instead of a live Approve button, and document the 24h window where the decision-queue/approval semantics are described.
- **Value**: impact=3 effort=3
