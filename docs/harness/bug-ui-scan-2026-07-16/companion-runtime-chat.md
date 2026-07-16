# Companion Runtime & Chat — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Reset during an in-flight turn is silently undone (session pointer resurrected, wiped transcript repopulated)
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/companion/chat.rs:378 (companion_reset_conversation), src-tauri/src/companion/session.rs:2016
- **Scenario**: If the user clicks the header Reset button while a turn is streaming (very common: reset is exactly the "make this stuck turn go away" reflex, and turns can run up to 25 min), `companion_reset_conversation` runs immediately — it takes neither the per-conversation turn lock nor interrupts the running turn. It NULLs `claude_session_id` and wipes the transcript, but the in-flight `run_cli` still finishes: `persist_stream_progress` and `send_turn` append interim + final assistant episodes into the just-wiped transcript, and `run_cli`'s exit path (`upsert_claude_session_id`, session.rs:2016, also on the interrupt/error paths at :1949/:1966/:2001) re-writes the old Claude CLI session id over the cleared pointer.
- **Root cause**: Reset assumes no turn is in flight. Turn mutual exclusion exists (`turn_lock_for`) but the reset command bypasses it, and the end-of-turn session-pointer upsert has no "was a reset issued after this turn started?" check (no generation token, unlike the autonomy scheduler which learned this exact lesson).
- **Impact**: The user's explicit "start fresh / forget this" is reverted: the next turn `--resume`s the old Claude session with its full prior context (a privacy/expectation break — "wiped" conversation content still steers replies), and orphan assistant episodes (a reply with no user message) reappear in the supposedly blank transcript when the frontend refetches in `send()`'s finally.
- **Fix sketch**: In `companion_reset_conversation`, first interrupt any active turn for that conversation (reuse the `ACTIVE_BUILD_TURNS`-style registry or track live chat turn ids) or acquire the turn lock; additionally guard `upsert_claude_session_id`/episode persistence with a per-conversation reset-generation counter bumped by reset, so a stale turn can never restore the pointer or write into a wiped transcript.

## 2. Stop button dies permanently if the interrupt IPC fails — optimistic clear with no rollback
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1199-1211
- **Scenario**: If the user clicks Stop on a long turn and `companionInterruptTurn` rejects (IPC auth hiccup, transient invoke failure), the handler has already run `s.patchLiveTurn(conversationId, { turnId: null })` before awaiting, and the rejection lands in `silentCatch` — nothing restores `turnId` and no error is surfaced.
- **Root cause**: Optimistic state clear treats the IPC call as infallible; the "prevent double-fire" goal was implemented by destroying the only handle needed to retry. (Backend side compounds it: `request_interrupt` on an already-finished turn leaves the id in `INTERRUPTED_TURNS` forever since only `run_cli` clears entries.)
- **Impact**: Every subsequent Stop click is a no-op (`if (!turnId) return`), so the user is locked into watching a turn run for up to the 25-minute TURN_TIMEOUT with a dead Stop button and no feedback. Mid-turn "stop"-classified composer messages (`sendOrQueue` → `handleInterrupt`) silently queue instead of stopping.
- **Fix sketch**: Don't null `turnId` optimistically — set a transient `interrupting` flag for double-click protection, clear `turnId` only when the interrupt resolves (or on the stream `finished`/`error` event), and restore + surface a toast on rejection.

## 3. Background-job state is listen-only and never reconciled — phantom "running" tasks stick forever after the panel closes
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1189-1197; src/features/plugins/companion/ActivityTray.tsx:21-33
- **Scenario**: If the user starts a connector call or other background job with the panel open (job appears in the ActivityTray as running), then closes/minimizes the panel while it runs, the `companion://job` listener unmounts with `Body` — the job's terminal `completed`/`failed` event is dropped. On reopening the panel, `jobsById` still holds `status: 'running'`; there is no list-jobs hydration anywhere (grep confirms `upsertJob` is fed only by this one listener).
- **Root cause**: Event-sourced UI state with no snapshot reconciliation, subscribed from a conditionally-mounted component. The approvals path learned this (always-mounted reconcile refetch at CompanionPanel.tsx:239-246); jobs never did.
- **Impact**: ActivityTray permanently shows "1 task running" (pulsing icon) and the orb's busy indicator (AthenaOrb reads the same `jobsById`) stays lit until app restart — success theater in reverse: finished work reads as stuck, eroding trust in the whole activity surface. Inversely, jobs started while the panel is closed never appear at all.
- **Fix sketch**: Move the `COMPANION_JOB_EVENT` listener up into the always-mounted `CompanionPanel` scope (like the approvals reconcile), and/or refetch active jobs (`companion_list_jobs`-style command) on Body mount and on the streaming true→false edge, replacing stale rows.

## 4. Expanded panel has a fixed 760px width with no viewport clamp — overflows and hides header controls on narrow windows
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/plugins/companion/CompanionPanel.tsx:369-371
- **Scenario**: If the user resizes the desktop window below ~800px wide (side-by-side snap with another app is the typical case) while the panel is expanded, the panel is `fixed bottom-12 left-4 w-[760px]` — height is responsibly capped (`max-h-[calc(100vh-5rem)]`) but width has no `max-w`, so the right portion of the panel, including the header's autonomous/dev/reset/close buttons, renders off-screen.
- **Root cause**: The compact/expanded design assumed a wide desktop viewport; only the vertical axis got a viewport-relative guard.
- **Impact**: Close/Reset/Stop-adjacent controls become unreachable (the close button is the rightmost element), the composer's right-side actions clip, and the page cannot scroll horizontally to reach them since the element is `fixed`. User must resize the window or know the compact toggle exists.
- **Fix sketch**: Add `max-w-[calc(100vw-2rem)]` alongside `w-[760px]` (and `w-[350px]`), letting inner flex content wrap; optionally auto-flip `panelCompact` when `window.innerWidth` drops below a threshold.

## 5. Day-separator "Yesterday" computed as now − 86,400,000 ms — mislabels around DST transitions
- **Severity**: Low
- **Category**: ui
- **File**: src/features/plugins/companion/CompanionPanel.tsx:110, 144-154
- **Scenario**: If the user opens the transcript shortly after midnight on the day following a spring-forward transition (23-hour day), `new Date(now - ONE_DAY_MS)` lands two calendar days back (e.g. now = Mar 10 00:30 EDT → minus 24h = Mar 8 23:30 EST). Messages from the actual yesterday show a weekday/date label instead of "Yesterday", while two-day-old messages can be labeled "Yesterday".
- **Root cause**: "Yesterday" is derived by fixed-duration arithmetic on epoch time, but calendar days are not uniformly 24h in local time — the same class of bug `sameLocalDay` was written to avoid.
- **Impact**: Twice a year, for users in DST timezones, the transcript's temporal anchors lie for the first hour(s) after midnight — low stakes but exactly the polish this separator exists to provide.
- **Fix sketch**: Compute yesterday calendrically: `const y = new Date(now); y.setDate(y.getDate() - 1);` then `sameLocalDay(d, y)` — `setDate` handles month/DST boundaries in local time.
