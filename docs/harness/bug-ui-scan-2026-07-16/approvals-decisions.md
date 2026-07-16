# Approvals & Decisions — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 4, Low: 0)

## 1. Approval stuck in `running` forever if the app dies mid-execution — no recovery sweep
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/companion/approvals.rs:686 (pending→running in `load_pending`), :708-734 (`finalize_approval`)
- **Scenario**: User clicks Approve on a long executor (e.g. `run_persona`, `assign_team`, any `await`ing action). `load_pending` flips the row to `running`, then the app crashes, is force-quit, or the process is killed before `finalize_approval` runs. On next launch the approval is invisible: `companion_list_pending_approvals` selects `status = 'pending'` only, and re-approving fails in `load_pending` with "approval is `running`, not pending". Same terminal state when `auto_resolve_if_allowed` errs between load and finalize (the doc comment at :402 explicitly admits "the approval is left in 'running' status").
- **Root cause**: The pending→running→final state machine assumes the process survives the executor. A grep across `src-tauri` shows zombie-recovery sweeps exist for `persona_executions` and automation runs (`engine/background.rs:2535,2702`) but none for `companion_approval` — `running` is an absorbing state with no owner after restart.
- **Impact**: The user's consent decision silently vanishes (success theater: they clicked Approve, nothing happened, no card, no error). Athena's proposal is lost and cannot be retried by any UI path; the row is permanent DB litter.
- **Fix sketch**: On startup (or in the existing background sweep), reset `companion_approval` rows with `status='running'` older than a small grace window back to `pending` (they'll still be freshness-gated), or finalize them as `approved_failed` with a "process interrupted" note and log an episode.

## 2. After `approved_failed`, the ApprovalCard re-enables Approve/Reject on an already-finalized approval
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/companion/ApprovalCard.tsx:104-107, :184-206
- **Scenario**: User clicks Approve; the executor fails, backend finalizes the row as `approved_failed` and returns `status: 'approved_failed'`. The card shows the amber failure banner, sets `busy` back to `null` — and both buttons become clickable again (`disabled={busy !== null}` is false). The user, reasonably retrying, clicks Approve (or Reject to dismiss): `load_pending` now throws `AppError::Internal("approval `<id>` is `approved_failed`, not pending")`, which the card renders raw in the rose error box.
- **Root cause**: The card treats `approved_failed` as a transient, retryable UI state, but the backend treats it as terminal (`finalize_approval` already ran; the row can never be pending again). Frontend and backend disagree about whether the decision is still open.
- **Impact**: A dead-end interaction: actionable-looking buttons on a resolved consent surface, and any click produces a developer-facing internal error string instead of a UX message. The only escape is `onResolved` never firing, so the stale card also lingers in the chat until refetch.
- **Fix sketch**: On `approved_failed`, call `onResolved(approval.id, 'approved_failed')` (or keep the banner but permanently disable/hide both buttons and offer only "Dismiss"). Never re-enable Approve after the backend has finalized the row.

## 3. Athena reaction declines are never persisted — the same signal is re-sent to the CLI on every wake
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/companion/athena_reaction.rs:128-205 (`find_athena_reaction_signals`), :317-334 (decline path)
- **Scenario**: `autonomous_athena_reactions` is on. An assignment parks in `awaiting_review` (no lookback bound on that branch) and Athena decides `react: false` — restraint, the documented default. The decline is only `tracing::info!`ed; the per-team cursor is `MAX(created_at)` of her *posted* channel messages, so the signal is still "newer than her last post" at the next detection tick and is re-submitted to the headless Claude CLI, again and again until she either posts or the row leaves `awaiting_review`.
- **Root cause**: The debounce cursor conflates "Athena considered this" with "Athena posted about this". Restraint — the outcome the prompt explicitly optimizes for — advances nothing.
- **Impact**: A retry storm of paid headless CLI calls (180 s subprocess each) re-deciding an already-declined moment every tick; each re-ask is also a fresh coin-flip, so sustained restraint is structurally unlikely (eventually she posts just to stop the loop). Multi-team parks multiply the spend.
- **Fix sketch**: Persist declines — e.g. insert a `team_assignment_events` row (kind `athena_reaction_decline` with the signal's `occurred_at`) or a per-team "last considered" cursor, and exclude signals at or before it in the detection query.

## 4. `uncheck_todos` bidirectional substring match can uncheck unrelated goal items and double-decrement progress
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/companion/athena_reaction.rs:1288-1335 (abort_retry / goal_shelve rollback)
- **Scenario**: Athena resolves a parked review as `abort_retry` and returns `uncheck_todos: ["Add tests", "tests for exporter"]`. The matcher accepts `t == want || t.contains(want) || want.contains(t)` against every still-checked item: a short/generic title ("tests") unchecks *every* checked to-do containing it. Worse, `goal.items` is an immutable snapshot — an item unchecked by the first want still shows `done=true` for the second want, so the same item is "unchecked" twice and `unchecked` is incremented twice; `new_progress = (done_now - unchecked) * 100 / len` then undershoots (saturating_sub hides it at 0 but mid-range goals get a wrong, too-low percentage).
- **Root cause**: Fuzzy containment in both directions on LLM-provided free text, applied against a stale snapshot with a per-match counter instead of a per-item set.
- **Impact**: Goal-state corruption on the autonomous path: genuinely delivered to-dos flip back to undone and the goal's progress number diverges from its items — which then feeds the next attempt's directive and the human's Goals board.
- **Fix sketch**: Match exact (normalized) titles only, falling back to `contains` in one direction at most; track unchecked item ids in a `HashSet` so an item counts once, and recompute progress from the post-update DB state rather than snapshot arithmetic.

## 5. Decision-bubble option chips have no in-flight state — double-activation runs the action twice and toasts a false failure
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/companion/orb/OrbDecisionBubble.tsx:265-290 (option buttons), src/features/plugins/companion/decision/resolveDecision.ts:37-55
- **Scenario**: A decision surfaces on the orb; the user double-clicks option 1 (or clicks, sees no feedback for a slow `run()` like an approval executor, and clicks again). `runDecisionOption` awaits `option.run()` but nothing disables the chips or marks an in-flight run, so the second click fires `option.run()` concurrently. For approval-backed options the backend's atomic pending→running check makes the loser throw — and the loser's catch shows the error toast "Could not complete that decision — please try again" even though the first click succeeded; for non-approval-gated runs (e.g. sending a message/input) the action simply executes twice.
- **Root cause**: The consent surface assumes one activation per decision, but neither the bubble (unlike `ApprovalCard`, which has `busy` + `loading`) nor the shared resolver guards re-entry; the same gap applies to the `;`-leader key and voice paths that share `runDecisionOption`.
- **Impact**: Duplicate side effects on fast double-input, and a misleading failure toast on the common race — the user is told their decision failed right after it succeeded, on a surface whose whole point is trustworthy resolution. Also a polish gap: no spinner/pressed state during a multi-second `run()`.
- **Fix sketch**: Add a `decisionResolving` flag (store or local) set before `await option.run()`; disable all chips + show a loading state on the picked one while set, and make `runDecisionOption` a no-op when already resolving. This covers click, keyboard, and voice in one place.
