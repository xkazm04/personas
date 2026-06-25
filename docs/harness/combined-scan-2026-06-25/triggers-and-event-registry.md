# Triggers & Event Registry — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: triggers-and-event-registry | Group: Triggers & Events
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

> Note on file paths: the context manifest lists `src/features/triggers/sub_builder/EventCanvas.tsx`, but that path exists only in stale worktrees. The live component is `src/features/triggers/sub_studio/routing/EventCanvas.tsx`. Findings below cite live paths. Because the named focus areas (trigger-matching, event loops) live in the matcher/dispatcher that the context's `events.rs`/`event.rs` feed, two findings cite `bus.rs` / `background.rs` / `triggers.rs` where the actual defect sits.

## 1. Live stream resets and drops its buffered events whenever the persona roster changes
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-desync / data-loss
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:61-71
- **Scenario**: The backfill effect is keyed `}, [personas])`, but its body (`listEvents(100)`) never reads `personas`. `personas` comes from `useAgentStore((s) => s.personas)`, whose array identity changes on every roster mutation — health-score refresh, status poll, add/rename/enable. Each such change re-runs the effect, which calls `setEvents(recentEvents)` and hard-resets `eventIdIndex.current = new Set(recentEvents.map(...))`. Any of the up-to-200 live events already in the buffer that are not in the freshly-fetched top-100 are discarded; the visible "in buffer" count collapses from ~200 to 100 and the row list jumps/re-animates.
- **Root cause**: Spurious dependency. Source-persona resolution (`resolveSourcePersona`) consumes `personas` reactively during render, so the fetch never needed it as a dependency. There is also a latent race: a live event ingested between the refetch dispatch and its resolution gets evicted from `eventIdIndex`, so a later status-update for that still-displayed row no longer matches the index and is re-prepended as a duplicate.
- **Impact**: The live stream visibly flickers and loses accumulated events on a frequently-firing trigger (any agent-store update), undermining the core "watch the live event stream" promise and producing occasional duplicate rows.
- **Fix sketch**: Change the dependency array to `[]` (run-once backfill) and let `useEventBusListener` carry all subsequent updates. If a personas-driven refetch is genuinely wanted, gate it on first non-empty load only, and merge into the existing buffer instead of replacing it.
- **Value**: impact=6 effort=2

## 2. Canvas-created event_listener triggers silently miss separator-variant events (matching asymmetry)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dropped-trigger / silent-failure
- **File**: src-tauri/src/db/repos/resources/triggers.rs:1489-1496 (vs src-tauri/src/engine/bus.rs:65 + src-tauri/src/db/repos/communication/events.rs:1144)
- **Scenario**: An emitter publishes `code-review.completed`. A standalone `event_listener` trigger built on the canvas stores `listen_event_type = "code_review.completed"`. The dispatch tick (`background.rs:871`) fetches listeners via `get_event_listeners_for_event_types`, whose SQL is `json_extract(config,'$.listen_event_type') IN (?, …)` — an **exact** string compare against the emitted type. The two separator spellings differ, so the trigger row is never even fetched, and `ParsedTrigger::is_eligible` (bus.rs:130-134) does no event-type re-check to recover it. The trigger silently never fires.
- **Root cause**: Two matching paths with opposite semantics. Legacy `persona_event_subscriptions` deliberately fetch the full enabled set and match by `canonical_event_type` (separator-insensitive — bus.rs:65/76, documented in events.rs:1136-1143). The unified trigger path instead pre-filters in SQL with an exact `json_extract … IN`, exactly the separator-sensitive pre-filter the subscription path was rewritten to avoid. Triggers created via `create_subscription_with_trigger` are masked because they also dual-write a legacy subscription that still matches canonically; purely canvas-created listeners (no paired subscription) have no such safety net.
- **Impact**: The headline feature — "build event-driven triggers on a canvas" — drops events whenever the listener's spelling differs from the emitter's, with zero error surfaced (event is marked `skipped`/"no consumers"). Hard to diagnose because the subscription-backed cousins work.
- **Fix sketch**: Make the trigger fetch canonical-aware: either fetch all `status='active'` event_listener triggers and let `bus::match_event` apply `canonical_event_type` (mirroring the subscription path), or expand the IN-list to all separator variants of each emitted type, or add a canonical generated column indexed for lookup.
- **Value**: impact=8 effort=3

## 3. Paused live-stream queue (`pausedQueueRef`) grows unbounded
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: memory-growth
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:94-102
- **Scenario**: While paused, every new event is `pausedQueueRef.current.push(evt)` with no cap. A user pauses to inspect a row during a CDC burst (the file itself notes "50-200 evt/s") and steps away; the queue accumulates one full `PersonaEvent` object (incl. payload up to 64 KB) per event indefinitely. On resume it is drained then sliced to 200 — but until then there is no ceiling.
- **Root cause**: The author added an explicit hard cap for the timestamp buffer (`STREAM_TIMESTAMP_CAP`, line 19/88-90) precisely to stop unbounded growth under sustained bursts, but applied no equivalent cap to `pausedQueueRef`. Display is capped at 200; the paused backlog is not.
- **Impact**: Sustained memory growth → renderer OOM for a user who pauses during high throughput. Resume also does O(n) work over the entire backlog before truncating.
- **Fix sketch**: Bound `pausedQueueRef` with FIFO eviction at a cap (e.g. 500–1000), tracking a dropped-count so the badge can read "999+ queued (oldest dropped)". Mirror the `recvTimestamps` splice pattern.
- **Value**: impact=6 effort=2

## 4. Status filter cannot select the real success state (`delivered`) — only the mock one (`completed`)
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: coverage-gap / misleading-UI
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:27-34 (vs src-tauri/src/db/models/event.rs:22-26)
- **Scenario**: `STATUS_OPTIONS` offers `completed`, `failed`, `pending`, `processing`, `skipped` — but not `delivered`. Per the model docs, `Delivered` = "Successfully dispatched to subscriber executions" (the terminal state real bus events reach via `background.rs`), whereas `Completed` is "General-purpose success terminal state (used by mocks/tests)". A user filtering for successful events picks "Completed" and sees only mock/test events; genuinely-delivered real events are invisible and unfilterable.
- **Root cause**: The dropdown enumerates a hand-written subset of `PersonaEventStatus` and omits the most common real terminal value. The `getRowAccent` logic (line 409) already treats `delivered` as success, so the omission is purely in the filter list.
- **Impact**: An operator can wrongly conclude real events never succeeded (misdiagnosis), or simply cannot narrow the stream to delivered events.
- **Fix sketch**: Add a `delivered` option (and confirm whether `dead_letter`/`discarded` belong here or are intentionally delegated to the Dead Letter tab). Ideally derive the option list from the `PersonaEventStatus` binding so it can't drift.
- **Value**: impact=3 effort=1

## 5. No self-emit / cycle guard: a persona that emits an event type it also listens for self-retriggers
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: trigger-loop
- **File**: src-tauri/src/engine/bus.rs:171-185 (+ src-tauri/src/engine/background.rs:1061-1083)
- **Scenario**: On the canvas, wire a persona's own output event (say `task.done`) to that same persona's `task.done` listener. When the persona's execution emits `task.done`, the event is persona-sourced (`source_type = "persona:<name>"`, `source_id = <persona_id>`). Self-scoping in `match_event` explicitly *allows* same-persona matches (`Some(source_pid) if source_pid != sub.persona_id() => return false` — i.e. equal source re-matches). The next tick dispatches a fresh execution, which emits `task.done` again → loop.
- **Root cause**: The only loop brakes are (a) the per-source rate limiter keyed `event:persona:<name>` (throttles rate, never stops the cycle) and (b) the cascade guard `running_count > 0 → skip` (background.rs:1066-1083), which only suppresses *concurrent* overlap. A short execution finishes before its emitted event is claimed, so `running_count` is 0 and the re-dispatch proceeds. There is no fire-depth counter, no self-emit suppression, and no cycle detection on the trigger graph.
- **Impact**: A self-sustaining execution loop bounded only by the rate-limit window — continuous, real LLM executions burning tokens/cost indefinitely, with each run looking individually legitimate. The canvas makes this footgun directly wireable with no warning.
- **Fix sketch**: Add a cycle/self-emit guard: suppress a match where `event.source_id == sub.persona_id()` AND the subscription has no explicit opt-in source_filter and the emitted type canonically equals the persona's own emitted type; or carry a bounded fire-depth/causation-chain id on events and refuse re-dispatch past a threshold. At minimum, warn on the canvas when a persona's emitter lane feeds its own listener for the same event type.
- **Value**: impact=7 effort=6
