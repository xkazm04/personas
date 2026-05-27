# Athena Async/Parallel UX — Milestone Spec

**Status:** spec (no code yet) · **Created:** 2026-05-26
**Goal:** Make Athena always-available for conversation while long work runs in parallel, with running tasks visible in-chat + on the orb. Decouple the conversation layer from task execution.

## Core reframe (the real blocker)

Long *tasks* are already async (background jobs, `tokio::spawn`, approval-on-click). The blocker is the **turn**: `session::send_turn` (`src-tauri/src/companion/session.rs:278`) is one linearized pipeline that holds the session; the user **cannot send a new message until it returns**, and the LLM call inside (`run_cli`, ~30s–5min, 15min `TURN_TIMEOUT` at session.rs:244) is the silence. So the fix is to **separate conversation (always-available, sub-second) from execution (turns + minute-long tasks)** — points ① and ④ are the same root change.

## Decisions (locked)

- **Mid-turn input → smart interrupt vs queue.** A new message classified as a redirect/"stop" **interrupts** (cancel the running CLI child); an additive "and also…" **queues**. Input is NEVER disabled.
- **Task surface → in-chat tags + activity tray.** Task tags under the spawning message AND a persistent "running tasks" tray (shows everything in flight, not turn-bound).
- Phasing: ship visibility first (tasks model → tags+tray → orb dots), then the turn-loop decoupling last (safest once "what's running" is observable).

## Current architecture (grounded)

**Blocking point:** `companion_send_message` (`commands/companion/chat.rs:51`) → `session::send_turn` (session.rs:278) is serialized per session; awaits `run_cli` fully before dispatch/persist/return.

**Existing async primitives (reusable):**
- **Background jobs:** `companion::jobs` (`jobs/mod.rs`), table `companion_background_job` (`id, kind, status queued→running→completed|failed, params_json, result_text, error_text, progress_text, project_id, started_at, completed_at`), 3s poller `worker_tick` (mod.rs:290), event channel `companion://job` (mod.rs:70), `JobProgress.report()` (mod.rs:106 — exists but handlers rarely call it), terminal result → system episode (mod.rs:318). Kinds: `connector_use` (auto-fire, dispatcher.rs:1061), `scan_codebase`, `curation_run`.
- **Approvals:** `companion_approval` table; created post-turn (dispatcher.rs:1206); exec on click → async (`commands/companion/approvals.rs`). `build_oneshot`/`enqueue_dev_job`/`assign_team` spawn work.
- **Autonomous continuation:** `schedule_autonomous_tick` (session.rs:705), `cancel_pending_autonomy` (session.rs:124 — the seam for interrupt), `MAX_AUTONOMOUS_CHAIN=20`.
- **Orb:** `orb/AthenaOrbLayer.tsx` (visible when `state==='minimized'`), `orb/AthenaOrb.tsx:197` `avatarState` = idle | thinking (streaming) | speaking. Driven by companionStore `state`/`streaming` + `jobsById`.
- **Inline cards:** `ConnectorCallCard.tsx` (one per connector_use job, reads `companionStore.jobsById` via `upsertJob` on `companion://job`). `TurnSummaryChip.tsx` (per-turn rollup).

**Missing:** per-job progress granularity (API exists, unused), task grouping / `parent_turn`, a `short_title`, a consolidated activity tray, in-chat task tags, ability to chat while a turn runs, turn interrupt.

## Target architecture: conversation ⟂ execution

- **Orchestrator/TaskRegistry** (extends `companion::jobs` + operative memory) owns task lifecycles and emits ONE unified progress channel. A **Task** = `{ id, short_title, kind, status, progress{current,total}|null, progress_text, parent_turn_id, started_at }`.
- **Conversation layer** (`session`/`dispatcher`) only *spawns* tasks and *subscribes* to their events — it NEVER awaits them. Turns become "decide + delegate" moments (seconds). Results re-enter as system episodes + update the task's tag.

## Design per point

**① Always-present chat**
- Input never disabled. Mid-turn send → classify (redirect→interrupt via `cancel`+kill CLI child; additive→queue). Add a turn-interrupt path (the autonomy-cancel + timeout already kill the child; generalize to user-initiated).
- "Delegate, don't do inline" doctrine in the prompt: anything >~5s becomes a Task; Athena replies immediately. Also wrap long **MCP tool calls** within a turn (orchestration/mcp/mod.rs — currently block the stream) as tasks when they exceed a threshold.
- Free the session the instant a task is delegated (don't hold it for the task's lifetime).

**② In-chat task tags**
- Generalize jobs → Tasks with `short_title` + `parent_turn_id`. Wire `JobProgress.report()` into `jobs/scan_codebase.rs`, `jobs/connector_use.rs`, the build/scan launchers.
- `TaskWidget.tsx` under the spawning message; flips queued→running(progress)→done/failed with a result link. companionStore: `streamingTasks` + `tasksByEpisodeId`.

**③ Orb progress dots**
- `AthenaOrb.tsx`: add `avatarState='working'`; render N perimeter dots (one per running task from `jobsById`), pulsing, vanish on completion. Click → open tray / scroll to task.

**④ Activity tray + orchestration split**
- Persistent "running tasks" tray (dock/drawer), not turn-bound — lists all in-flight tasks across turns. Reuses the Task channel.
- The orchestrator is the single owner; conversation subscribes. This is what makes ①–③ composable.

## Phased plan (each independently shippable)

1. **Task model + unified progress channel** (backend). ✅ DONE (`47db6276b`). `companion_background_job` gained `short_title` + `parent_turn_id` (CREATE + idempotent ALTER); `BackgroundJob` struct + `enqueue_task()` (back-compat `enqueue()` wrapper) + `default_title()`; `JobProgress.report_progress(current,total,msg)` (event-only structured progress on the existing `companion://job` channel — no new event needed, the row IS the task); wired `connector_use` (title + capability progress) + `curation_run` (per-scope progress); FE `BackgroundJob` TS type extended (api/companion.ts). DEFERRED: `parent_turn_id` threading (episode id unknown at dispatch — phase 2); cross-subsystem bridging of the context-scan (context_generation) + build (build_session) into the Task channel (they have their own `CONTEXT_GEN_*` events) — phase 2/4.
2. **In-chat tags + activity tray** (frontend). ✅ DONE. `TaskTag.tsx` (new — compact status-icon + short_title + determinate progress bar / live note + status label, the lightweight glance for any non-`connector_use` kind; `connector_use` keeps its richer `ConnectorCallCard`). `ActivityTray.tsx` (new — persistent, turn-independent tray mounted above the composer in `CompanionPanel.tsx`; reads `companionStore.jobsById` filtered to queued/running, running-first sort, collapsible, renders nothing when idle). `companionStore.upsertJob` pin generalized: `connector_use` always pins (auto-fires mid-turn), any other kind pins when `streaming` is true → in-chat tags under the spawning bubble; approval-click tasks (idle) surface only in the tray. `CompanionPanel.tsx` both pin sites now switch `connector_use → ConnectorCallCard` else `→ TaskTag`. i18n: `plugins.companion.task_status_{queued,running,done,failed}` + `tasks_running_{one,other}`. Tests: `__tests__/ActivityTray.test.tsx` (5). NOTE: no `parent_turn_id` backend threading needed — the existing pending-pin→attach-on-finished mechanism already pins by spawning turn. `extractStreamPhase.ts` `TASK:` parsing deferred (not needed; structured `report_progress` covers progress).
3. **Orb progress dots** (frontend, small). ✅ DONE. `orb/AthenaOrb.tsx`: a `runningTaskCount` selector over `jobsById` (queued+running, returns a primitive so the orb only re-renders when the count changes); up to 5 pulsing dots arced across the orb's top perimeter, one per in-flight task; the orb borrows the `thinking` avatar while tasks run (the "working" posture, no new clip) and announces the count via `aria-label` (reuses `tasks_running_{one,other}`). `data-testid="companion-orb-task-dots"`. Live-verified: 3 tasks → 3 dots → vanish on completion.
4. **Non-blocking conversation** ✅ DONE (frontend + prompt). The backend turn-interrupt was already built (`session.rs` `request_interrupt`/`INTERRUPTED_TURNS` + `companion_interrupt_turn` command: polls every ~200ms, kills the CLI child, finalizes the partial as `[interrupted]`) — phase 4 wired the UX on top. **Composer never disabled while streaming** (`CompanionPanel.tsx`: dropped `streaming` from the `disabled` prop). Mid-turn input routes through `sendOrQueue` → `classifyMidTurnIntent` (`midTurnIntent.ts`): a redirect/"stop" opener **interrupts** (calls the existing `handleInterrupt`) and queues; anything additive/ambiguous just **queues** (default = queue; never destroy running work on an ambiguous message). Queue lives in `companionStore` (`queuedMessages` + `enqueue/shift/remove/clear`), drained one-per-turn-completion by a streaming-edge effect (FIFO, no autonomous-chain collision). `QueuedMessages.tsx` renders pending sends above the composer (cancellable). **"Delegate, don't inline" prompt doctrine** added as an always-on addendum in `prompt.rs` (`delegation_addendum`). i18n `plugins.companion.queued_{badge,remove}`. Tests: `midTurnIntent.test.tsx` (classifier + queue store). DEFERRED: wrapping long in-turn MCP tool calls as tasks (orchestration/mcp) — separate follow-up.

## Risks / notes
- Interrupt must cleanly kill the CLI child + persist a partial/aborted episode (don't orphan state).
- Message queue ordering + the autonomy chain must not double-fire.
- Per-task progress depends on handlers actually calling `report()` — audit each.
- Tray + tags read the same Task store; keep one source of truth (the orchestrator/`jobsById`), no parallel state.
- Live-testing the companion chat is flaky (LLM latency); use `window.__TEST__` bridge helpers (`openCompanion`, `scanProject`, and add task-state getters) + DB assertions, not just DOM polling.
