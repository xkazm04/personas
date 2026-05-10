# Bug Hunt — Inbox & Messages

> Group: Overview & Observability
> Files scanned: 9 (brief listed paths InboxPage.tsx / MessageList.tsx / MessageDetail.tsx do not exist; the actual triage surface is InboxTriagePage.tsx + components/hooks. Scoped scan covers the real files plus the listed snoozeStore.ts / messageSlice.ts / messages.rs.)
> Total: 2C / 6H / 4M / 1L = 13 findings

---

## 1. snoozeStore `getSnapshot` returns a stale cached reference whenever any other API path mutates storage

- **Severity**: critical
- **Category**: silent-failure
- **File**: `src/features/overview/sub_inbox/libs/snoozeStore.ts:48-51`
- **Scenario**: `useSyncExternalStore` calls `getSnoozeMap()` which returns `cachedSnapshot`. `cachedSnapshot` is only refreshed inside `write()`. But `isSnoozed` (line 54), `snoozeItem` (line 61), `unsnoozeItem` (line 66), and `pruneExpired` (line 74) all call `read()` directly — bypassing the cache. If localStorage is mutated by another browser tab, by `read()` returning a fresh object (different from `cachedSnapshot`), the cache silently diverges from storage. Even worse: on first ever render, `cachedSnapshot` is set from `read()`, then a `snoozeItem` call constructs `next = { ...read(), [id]: until }` and `write(next)` replaces the snapshot — but in `pruneExpired` the comparison `Date.parse(until) > now` uses the freshly-read storage, not the cache, so the snapshot the React tree sees can lag what `pruneExpired` computed.
- **Root cause**: two sources of truth — module-level `cachedSnapshot` and `read()` — never reconciled.
- **Impact**: snooze state ghosts; items stay in the Snoozed lane even after `pruneExpired`/`unsnooze`, or disappear from the Today lane that no longer matches storage. Hard-to-repro, will be filed as "snooze sometimes does nothing."
- **Fix sketch**: every mutator must call `getSnoozeMap()` (cache-aware), or invalidate `cachedSnapshot = null` at the start of every mutator and let the next `getSnoozeMap()` reload. Add a `storage` event listener that resets the cache and notifies subscribers for cross-tab consistency.

---

## 2. Snoozed items never auto-leave the Snoozed lane — UI does not rerender when snooze elapses

- **Severity**: critical
- **Category**: silent-failure
- **File**: `src/features/overview/sub_inbox/hooks/useSnoozeMap.ts:16-25`, `libs/swimlane.ts:40`
- **Scenario**: user snoozes an item for 60 minutes. `partitionSwimlanes` decides "snoozed vs today" by comparing `Date.parse(snoozeUntil) > now` (line 40 of swimlane.ts). `now` is captured at `partitionSwimlanes` call time — i.e. at render time. There is no timer/interval that re-runs the partition when wall-clock crosses the snooze deadline. `pruneExpired` runs only inside a `useEffect` with empty deps (mount only). Result: a user who snoozes at 13:00 and leaves the page open will still see the item in the Snoozed lane (and missing from Today) at 14:30 until they click something that triggers a rerender.
- **Root cause**: time-driven UI state with no time-driven rerender source.
- **Impact**: silent loss of action items; the user believes nothing has happened.
- **Fix sketch**: add a `setInterval(60_000)` in `useSnoozeMap` that calls `pruneExpired()` and notifies subscribers; clear on unmount. Or, on snooze, schedule a one-shot `setTimeout(durationMs)` that calls `pruneExpired`.

---

## 3. `markMessageAsRead` rolls back into a deleted message, resurrecting it

- **Severity**: high
- **Category**: mark-read-race
- **File**: `src/stores/slices/overview/messageSlice.ts:120-143`
- **Scenario**: user clicks "Mark read" on message A → optimistic update fires → in flight, another tab/process deletes message A from DB. `mark_as_read` repo (messages.rs repo line 352) returns `NotFound` because `rows == 0`. The frontend rollback path (line 122) maps over `state.messages` and "restores" A via `m.id === id ? { ...m, is_read: false }`. But A is still in `state.messages` (delete did not propagate yet via `deleteMessage`/event), so the rollback flips A back to unread and increments `unreadMessageCount`. When the next `fetchMessages` runs, A is gone, but `unreadMessageCount` was incremented from a phantom message → drift.
- **Root cause**: rollback unconditionally undoes the optimistic state without distinguishing "real failure" from "row gone."
- **Impact**: persistent off-by-one in the unread badge. Compounds across multiple races.
- **Fix sketch**: distinguish error kinds (`NotFound` → drop the message locally, do not re-increment); or always call `fetchUnreadMessageCount()` after a rollback.

---

## 4. `fetchMessages` pagination cursor uses `messages.length` — duplicates / skips after deletions

- **Severity**: high
- **Category**: pagination-stale
- **File**: `src/stores/slices/overview/messageSlice.ts:56-79`
- **Scenario**: user has 100 messages loaded (offset cursor = 100). User deletes 3 messages — store now has 97 in `messages`, `messagesTotal` becomes 97. User scrolls to load more → `fetchMessages(false)` → `offset = get().messages.length = 97` → backend returns rows 97–146 of the table. But the rows the user has in memory are the original 0–99 minus the three deleted IDs; rows 97/98/99 (the tail of the original page) are still in memory. New fetch will return rows 97/98/99 (unless they are the deleted ones), causing **duplicates**. If they are the deleted ones, offset 97 actually points further down the list — causing **skips**.
- **Root cause**: offset-based pagination with mutable list; the offset assumption is "I have N consecutive rows from row 0," which the delete violates.
- **Impact**: visible duplicates in the message list; quietly missing messages further down.
- **Fix sketch**: track an explicit `loadedCount` cursor that is only incremented by `fetchMessages` (not by mutations), or switch to keyset pagination (`WHERE created_at < lastCreatedAt ORDER BY created_at DESC`).

---

## 5. `markAllMessagesAsRead` snapshot count then `await fetch` — pending optimistic decrements lose

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/overview/messageSlice.ts:146-173`
- **Scenario**: user clicks "Mark all read" while three individual `markMessageAsRead` calls are in flight (their optimistic updates already applied; `_pendingReadIds` still contains the 3 ids). markAllMessagesRead succeeds in DB. The store recomputes `unreadMessageCount = updatedMessages.filter(!is_read).length` — that's `0`. Then the three pending calls finish: their success branch (line 115) only removes from `_pendingReadIds`, no count change → fine. But if any of the three FAILS, the rollback (line 139) does `state.unreadMessageCount + 1` → unread count becomes 1 even though the DB has 0 unread. Worse, the rollback also flips `is_read: false` on a row that mark-all already flipped to true on the server → permanent drift until next reload.
- **Root cause**: in-flight optimistic state is not invalidated when a "mark all" overrides it.
- **Impact**: stale unread badge; visually inconsistent state until full reload.
- **Fix sketch**: on `markAllMessagesAsRead` success, clear `_pendingReadIds` (the in-flight calls' rollback should be a no-op — track a per-call generation token).

---

## 6. `handleResolveAll` and `handleSnoozeAll` fire N parallel mutations without backpressure or partial-failure tracking

- **Severity**: high
- **Category**: idempotency-gap
- **File**: `src/features/overview/sub_inbox/InboxTriagePage.tsx:126-138`
- **Scenario**: user selects 30 approval items and hits "Resolve all". `handleResolveAll` iterates and fires 30 `void wrappedActions.resolve(item)` calls in parallel. There is no concurrency limit, no awaiting, and `clearSelection()` runs immediately. If the backend rate-limits or any single call fails, the failures are buried in `reportError` → user sees the toolbar disappear and assumes success. Worse, on slow networks the user may double-click the same selected set during the in-flight window — the second click hits the same items because `clearSelection` ran but selection state could be re-built.
- **Root cause**: fire-and-forget parallel mutations + immediate selection clear masks per-item failures.
- **Impact**: silent partial failures across bulk actions; users complete the task believing all approvals went through.
- **Fix sketch**: serialize via `for/await` with a small concurrency pool (3-5), collect errors, and surface a "X of Y completed" toast. Disable the toolbar while in flight.

---

## 7. `recordResolved` runs unconditionally after `await actions.approve` even when the action failed

- **Severity**: high
- **Category**: silent-failure
- **File**: `src/features/overview/sub_inbox/InboxTriagePage.tsx:62-83`
- **Scenario**: `wrappedActions.approve` does `await actions.approve(item); recordResolved(item);`. The underlying `updateManualReview` (called inside the slice) catches errors via `reportError` and does NOT rethrow — so `await` resolves normally on failure. The Resolved lane therefore shows a snapshot of the item even though the approval was rejected by the backend.
- **Root cause**: error swallowing at the slice layer combined with an unconditional record.
- **Impact**: user thinks an approval went through when it did not; the item will reappear after the next fetch causing confusion.
- **Fix sketch**: have the slice rethrow / return a Result; only `recordResolved` on confirmed success.

---

## 8. `fetchMessages(reset=true)` clobbers optimistic `_pendingReadIds` state and never re-applies it

- **Severity**: high
- **Category**: race-condition
- **File**: `src/stores/slices/overview/messageSlice.ts:56-73`
- **Scenario**: user marks message M as read (optimistic: `is_read: true`, `_pendingReadIds` contains M). Before the markRead RPC returns, a tab switch or websocket event triggers `fetchMessages(true)`. The fresh server response has `is_read: false` for M (RPC hasn't committed yet). `set({ messages: rawMessages })` replaces the array → M is now visibly unread again, but `_pendingReadIds` still contains M. The user re-clicks → guard at line 86 (`_pendingReadIds.has(id)`) silently no-ops → user can no longer mark M as read until the original RPC settles (or fails). If the RPC was actually a network drop, the pending guard never clears.
- **Root cause**: optimistic state and authoritative state managed independently with no reconciliation step.
- **Impact**: messages stuck "un-readable" until app reload; user reports "the read button doesn't work."
- **Fix sketch**: after `fetchMessages` re-set, re-apply the `_pendingReadIds` set as `is_read: true`. Also add a per-id timeout that clears `_pendingReadIds` after N seconds.

---

## 9. `deleteMessage` orphans thread replies when a thread root is deleted

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/stores/slices/overview/messageSlice.ts:175-218` and `src-tauri/src/db/repos/communication/messages.rs:382-388`
- **Scenario**: thread T has root R and 5 replies. User deletes R. The repo `delete` simply runs `DELETE FROM persona_messages WHERE id = ?1` — no cascade and no FK to thread_id. The 5 replies remain in DB with `thread_id = R` (a row that no longer exists). The slice removes R from messages, removes the thread summary entry where `ts.threadId === id`, but leaves the 5 replies inside `threadReplies.get(R)` because the loop at line 181 only filters out the deleted ID, not the whole thread. Next `getThreadSummaries` query (`MIN(created_at)` over thread group) computes a new "first" reply as the parent → UI renders a thread whose "root" was actually a reply.
- **Root cause**: no DB-side cascade; frontend treats root deletion as a single-row removal.
- **Impact**: corrupted thread display; "this message has 5 replies" with the wrong root.
- **Fix sketch**: in repo `delete`, if the deleted id is its own thread root, either delete all `WHERE thread_id = ?` or reparent to next-oldest reply. In the slice, drop `threadReplies.get(R)` entirely on root delete.

---

## 10. `seed_mock_message` always passes `thread_id = &id` after the borrow has been moved into params

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/commands/communication/messages.rs:158-170`
- **Scenario**: the comment says "self-referencing thread", but `thread_id = &id` is passed into the params slice as `?8` while `id` is also passed as `?1`. This compiles, but the seeded mock messages all have `thread_id = id` — so each mock seed creates a separate single-message thread. The "thread summaries" list will show every mock as its own thread, never producing realistic multi-message thread rows for testing the threaded view. (This is a test-fidelity bug rather than a runtime bug, but the file is in scope and the seed misleads QA into thinking threading works when only single-row threads are exercised.)
- **Root cause**: mock seed never picks an existing thread_id; always self-references.
- **Impact**: threaded view never tested with real data via the seed path; bugs in `getThreadSummaries` aggregation slip through.
- **Fix sketch**: when `t > 0`, randomly pick an existing message from the DB and reuse its `thread_id`.

---

## 11. `get_bulk_delivery_summaries` silently drops duplicate message IDs across chunks

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/db/repos/communication/messages.rs:396-439` (per chunk SQL with `GROUP BY message_id`), and `messageSlice.ts:230-242`
- **Scenario**: `fetchDeliverySummaries` is called with `rawMessages.map(m => m.id)`. If two pages of fetched messages contain the same id (see Bug #4 — pagination duplicates), the array contains the id twice. The Rust code chunks at 500 — the duplicate is split across chunks (or both in one chunk; SQL GROUP BY de-dupes). Frontend `Map` overwrites the first with the second. Not catastrophic but the chunked path produces N rows where N is `distinct(messageIds)` while the call site assumed `messageIds.length`.
- **Root cause**: caller does not de-dupe; backend silently dedupes via GROUP BY without surfacing the count mismatch.
- **Impact**: small — but combined with Bug #4 you can have a delivery badge on a duplicated message id show stale data.
- **Fix sketch**: dedupe in `fetchDeliverySummaries` before chunking: `const uniq = [...new Set(messageIds)]`.

---

## 12. `markAllMessagesRead` SQL has no execution_id / approval-pending scoping

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/db/repos/communication/messages.rs:360-380`
- **Scenario**: `mark_all_as_read` flips every unread message for a persona to `is_read = 1`, including messages that the unified inbox surfaces as "approval kind" (manual reviews are unread persona_messages with metadata pointing to a review). After mark-all, those approvals vanish from the inbox even though the user has not actually approved/rejected them — they only "marked them read." The unified-inbox query in `useUnifiedInbox` filters by `is_read = 0` for the message lane, so approval items are silently hidden.
- **Root cause**: "read" and "actioned" are conflated at the schema level; mark-all has no carve-out for approval-kind messages.
- **Impact**: pending approvals are dismissed without action; user-visible "loss" of action items.
- **Fix sketch**: scope mark-all by `WHERE ... AND metadata IS NULL OR metadata NOT LIKE '%manual_review%'` or, better, separate the approval surface from `persona_messages` entirely.

---

## 13. `snoozeItem` overflow / negative-time path silently writes "Invalid Date"

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/overview/sub_inbox/libs/snoozeStore.ts:59-63`
- **Scenario**: caller passes a giant or negative `durationMinutes` (e.g. a future "snooze for 30 days" preset typo, or a clock-skew negative value). `new Date(Date.now() + durationMinutes * 60_000)` can produce an Invalid Date when the resulting ms is outside the ±100M-day range. `.toISOString()` on Invalid Date throws → silentCatch swallows it → the snooze entry is never written but UI assumes it was. Negative `durationMinutes` produces a past timestamp → `isSnoozed` immediately returns false → snooze button visually does nothing.
- **Root cause**: no input validation on the public API.
- **Impact**: minor — only triggered by programmer-error inputs, but contributes to "snooze sometimes does nothing" reports.
- **Fix sketch**: clamp `durationMinutes` to `[1, 60*24*30]` and bail with a logged error otherwise.
