# Triggers & Event Registry — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

> Note: the context map lists `src/features/triggers/sub_shared/CatalogCard.tsx` and `src/features/triggers/sub_builder/EventCanvas.tsx`; neither exists in the main tree (CatalogCard survives only in stale `.claude/worktrees/*`; EventCanvas lives at `src/features/triggers/sub_studio/routing/EventCanvas.tsx`). Context-map drift — worth a refresh.

## 1. Impure `setEvents` updater drops live events and corrupts the dedup index under double-invocation
- **Severity**: High
- **Category**: bug
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:120-139 (same pattern in `handleResume`, :162-178)
- **Scenario**: App runs with `React.StrictMode` (enabled in src/main.tsx:239) — i.e., every dev session — and any live event arrives on the bus. React double-invokes the `setEvents(prev => ...)` updater. The first invocation adds `e.id` to `eventIdIndex.current` (a ref mutated *inside* the updater, :129) and prepends the event; the second invocation sees the id already in the index, takes the map-replace branch (:123-127), finds no matching row in `prev`, and returns `prev` unchanged. The event is now in the dedup index but not in the list — dropped, and every later status update for that id is a silent no-op. The `setTimeout` at :131 is also a side effect scheduled per invocation.
- **Root cause**: State-updater purity assumption violated — the updater mutates `eventIdIndex`/`newEventIds` refs and schedules timers, so it is not idempotent. Any re-invocation (StrictMode dev, concurrent-render rebase of the update queue) diverges the ref index from the committed array.
- **Impact**: In dev, live-stream events are permanently lost while `totalReceived` still increments (stats say events arrived, grid never shows them); the poisoned index also blocks their future status updates. In prod builds it's latent until React replays an updater queue.
- **Fix sketch**: Compute membership from `prev` itself (e.g., build a `Set(prev.map(r => r.id))` inside the updater) instead of a ref; move `eventIdIndex`/`newEventIds` maintenance and the highlight-expiry timer into a `useEffect` keyed on `events`, or reconcile the index from the committed array after flush.

## 2. Paused-stream queue is unbounded — the one buffer with no cap
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:52, :105-108
- **Scenario**: User hits Pause to inspect a row while CDC traffic keeps flowing (the file's own comments size this at 50-200 evt/s under load, :53) and walks away. Every new event is pushed to `pausedQueueRef` with no size limit — an hour paused at 100 evt/s buffers ~360k `PersonaEvent` objects (each with payload strings).
- **Root cause**: The timestamp buffer got a hard cap for exactly this failure ("STREAM_TIMESTAMP_CAP … to prevent OOM under sustained bursts", :19), but the paused event queue — which holds full event objects, not numbers — did not. Pause is assumed to be brief.
- **Impact**: Unbounded memory growth in the webview during a long pause; on Resume the drain loop walks the entire queue only to discard all but 200 (:173-176), freezing the frame. The "N queued" counter also grows into meaningless six-digit territory.
- **Fix sketch**: Cap `pausedQueueRef` at ~1000 with FIFO eviction (the resume path already keeps only the newest 200, so evicting oldest loses nothing the user could see) and show "N queued (+M dropped)" past the cap.

## 3. `list_events_in_range`/`search` validate RFC3339 but compare timestamps lexically — non-UTC offsets silently return the wrong window
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/communication/events.rs:41-44 (query: src-tauri/src/db/repos/communication/events.rs:365, :1174-1179)
- **Scenario**: A caller passes `since = "2026-07-16T12:00:00+02:00"` (= 10:00 UTC). The command only *parses* it for validity, then hands the raw string to SQL, which does `created_at >= ?1` as a string comparison against stored `Utc::now().to_rfc3339()` values (`...+00:00`). Lexically the query behaves as 12:00 UTC — a 2-hour hole. A `"...Z"`-suffixed input misorders against fractional `+00:00` rows within the same second (`'Z' > '.'`).
- **Root cause**: The validation step assumes parse-success implies comparability, but SQLite compares TEXT lexicographically; correctness requires every timestamp to be in the one canonical stored format, which the API contract never enforces or normalizes.
- **Impact**: Silently wrong event windows (missing or extra rows) for any caller that produces legal-but-non-canonical RFC3339 — no error, just quietly incorrect history/pagination. Also `since > until` is accepted and returns an empty page indistinguishable from "no events".
- **Fix sketch**: Use the already-parsed `DateTime` values: convert to UTC and re-serialize with the same formatter used at write time before binding to SQL (`dt.with_timezone(&Utc).to_rfc3339()`); reject `since > until` with a Validation error. Same normalization for `EventFilterInput.since/until`.

## 4. Subscription creation skips the event-type vocabulary guard that the publish path has — typo'd listeners die silently
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/communication/events.rs:155-175
- **Scenario**: User (or a template/NL flow) creates a subscription for `"excution_completed"`. `publish_event` runs `event_vocabulary::validate_and_warn` (:86) precisely to catch typo'd types "that would otherwise silently never match any listener" — but `create_subscription`, the other half of the same contract, performs no vocabulary check at all. The listener is persisted, shows as enabled in the routing canvas, and never fires.
- **Root cause**: The typo defense was added asymmetrically: only the emit side is guarded, on the assumption subscriptions come from pickers — but templates/NL-built triggers write free-form types. Secondary: the trigger config is built with `serde_json::to_string(&config).unwrap_or_default()` (:169), so a serialization failure would persist a trigger with an empty-string config instead of erroring.
- **Impact**: Dead listeners that look healthy; the events they should catch land as `skipped` with no pointer back to the near-miss subscription. Classic silent-failure: nothing errors, work just never happens.
- **Fix sketch**: Call `validate_and_warn` (or better, return the nearest-known suggestion in the response) in `create_subscription`/`update_subscription`; replace `unwrap_or_default()` with `?`-propagation into `AppError::Validation`.

## 5. Live-stream Time column advertises sorting but `onSort` is a no-op
- **Severity**: Low
- **Category**: ui
- **File**: src/features/triggers/sub_live_stream/LiveStreamTab.tsx:298, :421-423
- **Scenario**: User clicks the sortable "Time" header (rendered with sort affordance because `sortable: true`) expecting oldest-first; `onSort={() => { }}` discards the click, and `sortKey`/`sortDirection` are hardcoded, so the indicator can never change. Nothing happens.
- **Root cause**: DataGrid's controlled-sort API was wired for display only (fixed `created desc`), but the column was still flagged `sortable`, leaving a dead interactive affordance.
- **Impact**: Broken-feeling control on the most-watched table in the tab; erodes trust in the rest of the grid's interactivity. Adjacent polish gap in the same toolbar: the status filter option label `'Skipped'` (:33) is hardcoded English among fully i18n'd siblings, breaking the 13-locale parity the repo's i18n gate exists to protect.
- **Fix sketch**: Either drop `sortable: true` (stream is inherently newest-first) or hold sort state and implement `onSort` to flip the ordering of `filteredEvents`. Move `'Skipped'` to `t.status_tokens.event.skipped`.
