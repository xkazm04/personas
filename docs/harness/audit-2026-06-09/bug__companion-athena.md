# Bug Hunter — companion-athena
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. Concurrent turns race the shared Claude session id and brain — no turn serialization
- **Severity**: critical
- **Category**: race-condition / state-corruption
- **File**: src-tauri/src/companion/session.rs:404 (read_claude_session_id) + :318 (send_turn, no lock) + :833 (schedule_autonomous_tick) + :910 (spawn_proactive_turn)
- **Scenario**: Autonomous mode is on (or the 5-min proactive scheduler / execution-review fires). The user types a message while a `spawn_proactive_turn` / autonomous-continuation tick is mid-flight. Both run `send_turn` on different threads at the same time for `DEFAULT_SESSION_ID`. Each independently calls `read_claude_session_id` (line 404), spawns the Claude CLI with `--resume <same id>`, and at turn end writes its OWN new session id back over the same row.
- **Root cause**: `send_turn` has no mutual-exclusion guard. The only statics are `INTERRUPTED_TURNS` and a stderr buffer (session.rs:104, :1056) — neither serializes turns. The design assumes one turn runs at a time, but the user path (`companion_send_message`) and the two background spawners (`schedule_autonomous_tick`, `spawn_proactive_turn`) have independent entry points and only `TurnOrigin::User` calls `cancel_pending_autonomy()` (chat.rs:77) — that cancels *pending* ticks, not one already inside `send_turn`, and does nothing about the periodic proactive scheduler.
- **Impact**: corruption — two `--resume` against the same CLI session interleave; the last writer's session id clobbers the other, breaking conversation continuity. Episodes from both turns interleave into the same transcript/recall, and a proactive turn's brain write can land between a user turn's recall-read and its action, producing decisions on half-updated brain state.
- **Fix sketch**: make a turn the unit of mutual exclusion. Hold a process-wide `tokio::sync::Mutex` (keyed by session id) for the whole `send_turn` body; background spawners `try_lock` and skip/defer when a user turn holds it (autonomous work should never preempt the user). This makes "two turns mutating one brain+session" structurally impossible.

## 2. Incident "resolve" decision never tells the backend — nudge re-fires forever
- **Severity**: high
- **Category**: silent-failure / state-corruption
- **File**: src/features/plugins/companion/decision/useDecisionQueue.ts:147-157
- **Scenario**: Hands-free decisions (or autonomous mode) is on. An `incident_blocker` proactive nudge surfaces in the orb. The user picks "Resolve". The option handler navigates to Overview→Incidents and calls `useCompanionStore.getState().removeProactive(message.id)` — but never calls any backend command. `removeProactive` only mutates local Zustand state (companionStore.ts:551). The backend row stays `delivered`.
- **Root cause**: the "resolve" branch is missing the backend call its sibling "dismiss" branch has (`companionDismissProactive`, line 165) and that `ProactiveCard`'s engage path has (`companionEngageProactive`). Because `buildQueue()` re-fetches with `companionListProactiveMessages(true)` (onlyUnresolved → status IN queued/delivered, mod.rs:315), the still-`delivered` row reappears on the very next pump (any approval/proactive event, gate flip, or `pending→null`, lines 330-351).
- **Impact**: UX degradation / nudge loop — the same blocking-incident decision pops up again indefinitely; the user can never make it stop via "Resolve".
- **Fix sketch**: route every decision resolution through one shared async resolver that awaits a backend state transition before `removeX`, and make `removeProactive`/`removeApproval` private to that resolver. A local-only "remove" with no server write should not be reachable from a resolution path.

## 3. Proactive nudge is marked engaged before the chat turn is sent — lost on send failure
- **Severity**: high
- **Category**: recovery-gap
- **File**: src-tauri/src/commands/companion/proactive.rs:122 (resolve before return) ; src/features/plugins/companion/ProactiveCard.tsx:44-61 (onEngaged after resolve)
- **Scenario**: User clicks "Engage" on an "Athena reached out" card. `companion_engage_proactive` calls `proactive::resolve(.., engaged=true)` (proactive.rs:122) — transitioning the row to `engaged` — then returns the message text. The frontend only THEN calls `onEngaged(result.message)` to fire the actual chat turn. If that chat send throws (CLI busy, timeout, panel unmounted), the nudge is already `engaged` and gone from the unresolved list, but no turn ran.
- **Root cause**: the row is resolved at intent-time, not at completion-time. There's no compensating re-queue if the follow-on action fails, and `engaged` is terminal (resolve() only matches queued/delivered, mod.rs:402).
- **Impact**: data loss — the nudge silently vanishes with no conversation produced; backlog `reminded_count` was also bumped (mod.rs:421-430) on a nudge that effectively never delivered, skewing future trigger frequency.
- **Fix sketch**: resolve to `engaged` only after the chat turn is confirmed started, or make engage idempotent/reversible (keep `delivered` until the turn’s first stream event lands, then resolve). Treat "resolve" as a commit, not a reservation.

## 4. `companion_evaluate_proactive_now` announces rows as "delivered" even when mark_delivered failed
- **Severity**: medium
- **Category**: state-corruption / success-theater
- **File**: src-tauri/src/commands/companion/proactive.rs:60-77
- **Scenario**: A pass produces new messages. For each, `mark_delivered` is attempted; failures are only `tracing::warn!`-ed (line 62-63) and the loop continues. The emitted `companion://proactive` payload then unconditionally rewrites every message's status to `"delivered"` (line 73) regardless of whether its DB row actually transitioned.
- **Root cause**: the emit payload fabricates the `delivered` status from the in-memory clone rather than reflecting the persisted outcome. The frontend is told "delivered"; the DB still says `queued`.
- **Impact**: UX degradation / inconsistency — a re-fetch via `companion_list_proactive_messages` shows the row as `queued` again, and the budget unit was already consumed for a "delivery" the DB never recorded; on a multi-pass day this drifts the cap and the panel state.
- **Fix sketch**: only include a message in the emitted payload if its `mark_delivered` returned success; or perform the status transition and the read-back in one statement and emit exactly what was persisted. Never let the announced status diverge from the row.

## 5. Decision is cleared synchronously before its async approve resolves, racing the re-pump
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/plugins/companion/decision/resolveDecision.ts:30-40 ; src/features/plugins/companion/decision/useDecisionQueue.ts:99-109, 330-332
- **Scenario**: User answers an approval decision (chip / `;`-leader key / spoken number). `runDecisionOption` fires `option.run()` (which `await`s `companionApproveAction`) but then immediately calls `clearPendingDecision()` synchronously — without waiting. `pendingDecision` → null triggers the `useEffect` (line 331) → `pump()` → `buildQueue()` → `companionListPendingApprovals()`. The approve may not have reached the backend yet (only `pending` rows are listed; `load_pending` flips to `running` atomically, approvals.rs:509-514).
- **Root cause**: fire-and-forget resolution: the decision is cleared on the optimistic assumption the backend already moved the row out of `pending`. There is a TOCTOU window between the JS `await` starting and the backend `pending→running` UPDATE committing.
- **Impact**: UX degradation — the just-answered approval can momentarily re-surface as a fresh decision; a fast second answer would then hit `load_pending` and get "approval is `running`, not pending" (handled, but surfaces as a swallowed `silentCatch`). The atomic `load_pending`/`finalize_approval` guards prevent an actual double-apply, but the queue can present a resolved item again.
- **Fix sketch**: clear the pending decision only after `run()` resolves (await it inside `runDecisionOption`), and have `pump()` exclude `sourceRef`s with an in-flight resolution. Don't re-pump off `pending→null` until the resolving promise settles.

## 6. Approval payload parse failure silently yields an empty action in the pending list
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/companion/approvals.rs:149-168
- **Scenario**: `companion_list_pending_approvals` parses each row's `payload` with `serde_json::from_str(&payload).unwrap_or_default()` (line 149). A corrupt/truncated payload (partial write, manual edit, schema drift) yields `Value::Null`, so `action`/`rationale` resolve to `""` and `params_json` to `"{}"`.
- **Root cause**: parse errors are swallowed into a default value instead of surfaced. The row still renders as an approvable card with a blank action; clicking Approve then hits `load_pending`, which DOES error on the missing `action` (line 506) — but only after the user committed to approving, and the card gives no hint it's broken.
- **Impact**: UX degradation — a phantom blank approval card the user can't act on, with the failure deferred to click-time as a generic error; on the hands-free path it enters the decision queue with an empty label.
- **Fix sketch**: skip (or mark as `corrupt`) rows whose payload fails to parse rather than defaulting; log the row id. A pending approval with no decodable action should never reach the card/queue surface.
