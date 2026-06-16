# Bug Hunter — Companion Runtime & Chat

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: companion-runtime-chat | Group: Athena Companion

## 1. Stale-session retry replays the wrong text on autonomous / proactive / external turns
- **Severity**: Critical
- **Category**: 💀 Silent failure / message corruption
- **File**: `src-tauri/src/companion/session.rs:556`
- **Scenario**: A turn's `--resume <claude_session_id>` fails because the CLI session expired/was deleted (`is_stale_session_error`). `send_turn` self-heals by clearing the pointer and retrying once with a fresh session. The first `run_cli` call (line 521) is correctly fed `&effective_user_message`. The retry call (line 548–557) instead passes `&user_message`. For `TurnOrigin::User` the two are identical, so this looks fine in testing — but for `Autonomous`, the retry sends the raw sentinel `AUTONOMOUS_CONTINUATION_MARKER` (`<<athena-autonomous-continuation>>`) to the model verbatim; for `External`/`Proactive` it drops the provenance framing (`[Automated request from Fleet — not the user]` / the crafted directive) and sends the bare body.
- **Root cause**: Two parallel code paths constructing the CLI input; the retry path was written before/independently of `effective_user_message` and never updated to use it. The module doc even calls the marker a "sentinel only the persistence layer sees" — this path violates that invariant.
- **Impact**: Exactly when the system is recovering from a session failure (a state retrieval-context makes *more* likely after restarts/wipes), an autonomous tick feeds Athena a meaningless sentinel token as the user prompt — she has no directive, produces garbage or refuses, and the autonomous chain derails. External/proactive turns lose the "this isn't the user talking" guard, so Athena may treat a Fleet automated request as the operator and act on it. Both are silent: no error, a normal-looking (wrong) reply persists.
- **Fix sketch**: Change the retry `run_cli` argument from `&user_message` to `&effective_user_message`. Better: lift the single `run_cli` invocation into a closure capturing `&effective_user_message` so the two call sites can never diverge again.

## 2. `INTERRUPTED_TURNS` entries leak when an interrupt targets a turn that never runs
- **Severity**: High
- **Category**: ⚡ Race condition / 🔮 latent failure
- **File**: `src-tauri/src/companion/session.rs:110` (`request_interrupt`), cleared only at `:1377` (`clear_interrupt` inside `run_cli`)
- **Scenario**: `companion_interrupt_turn` inserts a turn id into the global `INTERRUPTED_TURNS` set. The set is only ever cleared inside `run_cli` (`clear_interrupt(turn_id)` after the stream loop). But `run_cli` is reached only after the `TURN_LOCK` is acquired and the prompt is built. If the user clicks Stop on a turn that (a) errors before `run_cli` (prompt build failure, stale-session double-timeout returning early at line 563–570), or (b) is a background turn that was skipped because `try_lock` failed (line 353–362) — the id stays in the set forever. More subtly: `request_interrupt` can be called with *any* string; nothing validates the turn id exists.
- **Root cause**: Interrupt-flag lifecycle is owned entirely by `run_cli`'s happy/streaming path; the early-return error paths in `send_turn` and the lock-skip path don't clean up the set. There is no TTL or bounded size on the `HashSet`.
- **Impact**: A leaked id is mostly benign (turn ids are random), but `short_random()` takes only 8 hex chars of a UUID — collisions are possible over a long-lived process. A stale "interrupt me" flag matching a future turn id pre-cancels that turn on its first ~200ms tick: the new turn is killed before producing any reply, persisting "_(interrupted before any reply was generated)_". User sees a turn die instantly for no reason, intermittently and unreproducibly. Unbounded growth is also a slow memory leak across a multi-day session.
- **Fix sketch**: Clear the interrupt flag in `send_turn`'s error/early-return paths (or via a guard/`Drop` keyed on `turn_id`), not just in `run_cli`. Optionally cap the set size or stamp entries with a timestamp and sweep stale ones.

## 3. Concurrent user sends both pass the `!streaming` gate and double-fire turns
- **Severity**: High
- **Category**: ⚡ Race condition / double-send
- **File**: `src/features/plugins/companion/CompanionPanel.tsx:1657` (`sendOrQueue`) + `:1548` (`send`)
- **Scenario**: `sendOrQueue` reads the React prop `streaming` to decide send-now vs queue. `streaming` is Zustand state surfaced through a selector and only flips true inside `send` via `setStreaming(true)` (line 1566). Between the user submitting and React re-rendering with the new `streaming=true`, a second submit (Enter-mashing, a QuickReply click landing in the same tick, or a programmatic preset fire) still sees the stale `streaming === false` and calls `void send(...)` again. Both `send` calls then `await companionSendMessage` concurrently. Server-side `TURN_LOCK` serializes them, but the *second* user `send` blocks on the lock for up to the first turn's full duration (up to 15 min) while the optimistic bubble and `streaming=true` are already set — and on completion both refetch/clobber transcript and quick-replies.
- **Root cause**: The send/queue decision is made against asynchronously-updated React state rather than a synchronous "is a send in flight" guard. There's no `useRef` latch flipped synchronously at the top of `send`.
- **Impact**: Two real CLI turns queue back-to-back from one user intent; the second consumes a subscription turn and 15-min-timeout-worth of UI "thinking" with no second message from the user. Quick-reply / chat-card state from the first turn is wiped by the second's reset. The non-blocking-composer design (queue vs interrupt) is bypassed entirely for the racing pair.
- **Fix sketch**: Add a synchronous in-flight ref (`sendInFlightRef`) set at the very top of `send` and checked in `sendOrQueue`/`send` before `companionSendMessage`; clear it in `finally`. Decide queue-vs-send against that ref, not the rendered `streaming` prop.

## 4. ChatSearch only searches the loaded 50-message window, silently missing older history
- **Severity**: Medium
- **Category**: 🕳️ Edge case / 💀 silent failure (success theater)
- **File**: `src/features/plugins/companion/ChatSearch.tsx:41` (filters `messages`) ← fed by `companionListRecentMessages(50)` at `CompanionPanel.tsx:840`/`1587`
- **Scenario**: The transcript store only ever holds the most recent 50 episodes (`companionListRecentMessages(50)` is the only loader; the backend command clamps to 500 but is never asked for more). ChatSearch filters that in-memory array. A user searching for something Athena said last week — well within the persisted/embedded brain — gets "No results" with full confidence, because the matching episodes were never loaded into `messages`.
- **Root cause**: Search is implemented as a client-side substring filter over the truncated live window, not a query against the persisted episode store (which has FTS — `companion_fts` — already populated). The 50-row window is a render-perf decision that search silently inherited.
- **Impact**: The search affordance lies: it presents an authoritative count ("N results") and a no-results empty state over a tiny fraction of the conversation. Users conclude information isn't there when it is. Worse the longer the relationship runs — the exact case where in-chat search matters most.
- **Fix sketch**: Back ChatSearch with a real query command (FTS over `companion_node`/`companion_fts`, or at least raise the loaded window / page on demand) instead of filtering the 50-row render buffer; or label the scope ("searching recent messages") so the empty state isn't misleading.

## 5. ActivityTray shows in-turn tool tasks that are never cleared when a turn dies via IPC rejection
- **Severity**: Low
- **Category**: 💀 Silent failure (stale UI state) / 🔮 latent
- **File**: `src/features/plugins/companion/ActivityTray.tsx:21` (reads `inTurnToolJobs`) ← populated/cleared in `CompanionPanel.tsx:1029`–`1190`
- **Scenario**: In-turn tool tasks (`inTurnToolJobs`) are upserted from `tool_use` stream lines and cleared via `clearInTurnToolJobs()` only inside the stream-event handler's `finished` and `error` branches (lines 1160, 1177) and on `started`/unmount. The `send` `finally` block (CompanionPanel:1634) resets `streaming`/phase/beat but does **not** call `clearInTurnToolJobs` or `clearToolTimers`. If a turn fails on the IPC path (the `await companionSendMessage` rejection at 1627) without the backend ever emitting a `finished`/`error` stream event — e.g. the Tauri invoke times out, or the spawn fails before any stream emit — the streaming tool rows that were already promoted stay in the tray forever (until the next turn's `started`).
- **Root cause**: Two independent teardown paths (`finally` block vs stream-event channel) with non-overlapping responsibilities; the in-turn-tool cleanup lives only in the stream channel, which isn't guaranteed to fire on every turn-failure mode.
- **Impact**: The persistent activity tray shows phantom "running" tasks (e.g. "Searching the web…") that never complete, with `data-task-count` stuck > 0 and the pulsing indicator implying live work. The orb dot mirroring this state misleads the user into thinking Athena is still busy. Self-heals only on the next send; no functional damage.
- **Fix sketch**: In `send`'s `finally`, also call `clearToolTimers()` + `clearInTurnToolJobs()` (idempotent) so every turn-completion path — stream-driven or IPC-rejection — converges on a clean tray.
