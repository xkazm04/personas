# Test Mastery — Messages & Notifications
> Total: 7 findings (2 critical, 3 high, 2 medium, 0 low)

## 1. Webhook dispatch watermark never advances past a failed delivery — untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/webhook_notifier.rs:449-535 (`tick`)
- **Current test state**: exists-but-weak — the `#[cfg(test)]` block (lines 600-728) covers only the pure helpers (`pattern_matches`, `templating`, `providers`, `NotificationProvider`). The watermark-hold logic that is the whole point of the dispatcher has **no test**.
- **Scenario**: An endpoint returns 5xx / times out / a credential is briefly undecryptable. The code is supposed to hold the watermark below the earliest-failed event (`earliest_failed`, lines 481/495-499) so a later tick re-delivers once the endpoint recovers, and to advance the composite `created_at|id` cursor exactly past the last safely-delivered event so same-millisecond siblings are not skipped. A regression that reverts to "advance to newest regardless of success" (the documented prior bug, lines 504-513) silently and permanently drops every event due during the outage — and no test fails.
- **Root cause**: `tick` needs a DB pool + seeded events + subscriptions; the existing tests only exercise leaf functions, so the watermark/fan-out branch was never wired to `init_test_db`.
- **Impact**: Silent, permanent loss of outbound notifications (Slack/Discord/Teams alerts) during any transient endpoint blip — the worst failure mode for an alerting system because no one is told it broke.
- **Fix sketch**: Add `#[cfg(test)]` tests using `init_test_db()`: seed 3 events at distinct `created_at`; create a subscription pointed at a sink that succeeds for events A,C and fails for B (inject via a test seam — e.g. refactor `dispatch_to_url` behind a trait, or assert at the watermark level by stubbing `WebhookProcessor`). Assert: after tick 1, watermark = `(A.created_at|A.id)` (held below B); after the endpoint "recovers", tick 2 re-fetches B and C and watermark advances to C. Also assert same-millisecond siblings (two events sharing `created_at`) are both delivered exactly once (composite-cursor invariant).

## 2. Shared-event relay dedup + cursor-hold (data-loss path) — zero tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/shared_event_relay.rs:59-187 (`shared_event_relay_tick`); src-tauri/src/db/repos/communication/shared_events.rs:211-229 (`update_cursor`)
- **Current test state**: none — neither the engine file nor the `shared_events` repo has any `#[cfg(test)]` module.
- **Scenario**: The relay polls a cloud feed whose cursor is a bare `fired_at` with no id tiebreaker. The tick must (a) skip firings already relayed via `exists_by_source_id` but still advance the cursor through them (lines 131-134), and (b) on a publish failure, *stop the batch* and only advance the cursor through the contiguously-published prefix (`last_published_at`, lines 121/153/160-167) so the failed firing re-polls next tick instead of being skipped forever. None of this is asserted.
- **Root cause**: The tick depends on a `CloudClient` and `AppHandle`, so it was left untested. But the two business invariants (dedup-still-advances; failure-holds-cursor) live in repo + pure logic that *can* be exercised against `init_test_db()`.
- **Impact**: A regression either re-publishes duplicate shared events into the local bus (every subscriber double-fires) or permanently drops a firing whose publish hit a transient error — both corrupt the event-driven automation fabric.
- **Fix sketch**: Two layers. (1) Repo tests against `init_test_db()`: `subscribe` → `update_cursor(sub, fired_at, n)` and assert `last_cursor`, `events_relayed += n`, `error = NULL`; `set_error` then `update_cursor` clears the error. (2) Extract the prefix-advance decision (given a list of firings + a "published-up-to index", what cursor results) into a small pure fn and unit-test: all-published → cursor = last.fired_at; failure at index k → cursor = firing[k-1].fired_at; already-exists firing advances cursor but not `sub_published`.

## 3. Message same-day title dedup — untested business rule
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/messages.rs:166-194 (`create`)
- **Current test state**: exists-but-weak — `create` is heavily tested (lines 597-672) but **every** test uses unique titles or `None`; the dedup branch is never hit.
- **Scenario**: `create` deliberately skips the insert and returns the existing row when a message with the same `persona_id` + `title` was already created *today* (the "7 identical Service Health notifications in 5 minutes" cascade fix). A regression that drops the `date(created_at) = date(?3)` clause would dedup across days (suppressing legitimately-distinct daily reports); a regression that drops the `persona_id` scope would suppress different personas' same-titled messages. Both pass today.
- **Root cause**: The dedup path needs two inserts with a controlled title/date; no existing test sets that up.
- **Impact**: Either notification spam returns (alert fatigue, OS-notification flood) or distinct messages are silently swallowed (lost reports) — a direct user-trust hit either way.
- **Fix sketch**: `init_test_db()` test: create msg with title "Daily" for persona P; create again same title same persona → assert the returned id equals the first (no new row, `get_total_count == 1`). Then create same title for a *different* persona → assert a new row. Empty/whitespace title and `None` title must NOT dedup (assert two rows). Invariant: dedup is scoped to (persona_id, non-empty title, same calendar day).

## 4. `get_thread_summaries` CTE — parent selection & reply_count math untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/messages.rs:235-340 (`get_thread_summaries`, `get_thread_count`)
- **Current test state**: none — no test creates a multi-message thread; `thread_id` is always `None` in existing tests.
- **Scenario**: The summary query picks the parent as the row whose `created_at = MIN(created_at)` of the thread, computes `reply_count = cnt - 1`, sets `latest_reply_at` only when replies exist, orders threads by `last_at DESC`, and supports persona filtering + limit/offset. A regression in the parent-join (e.g. same-millisecond parent/reply collision picking the wrong parent), the off-by-one reply math, or the persona-filter parameter indexing (`?1/?2/?3` shift, lines 251-261) silently returns wrong inbox state.
- **Root cause**: Threaded conversations were never seeded in tests; the parameter-index branching for the persona filter is exactly the kind of copy-paste hazard that needs a guard.
- **Impact**: Inbox shows wrong reply counts / wrong parent message / wrong thread for a persona — users mis-triage agent output.
- **Fix sketch**: `init_test_db()` test: create a parent + 2 replies sharing one `thread_id` (insert with explicit `thread_id`), plus a lone single-message thread. Assert: parent returned is the earliest message; `reply_count == 2` for the thread and `0` for the lone; `latest_reply_at` is `Some` only for the threaded one; ordering by latest activity. Repeat with `persona_id` filter set vs `None` to lock the parameter-index branch. Add a `get_thread_count` assertion (DISTINCT thread_id, with/without persona filter).

## 5. `get_bulk_delivery_summaries` status bucketing & chunking — untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/messages.rs:506-552 (`get_bulk_delivery_summaries`); surfaced via src-tauri/src/commands/communication/messages.rs:89-107
- **Current test state**: none — no test inserts `persona_message_deliveries` rows; only the empty-input early return is implicitly trivial.
- **Scenario**: The function buckets delivery rows into delivered / pending(+queued) / failed counts per message, chunked at 500 to stay under SQLite's variable limit. A regression that drops `'queued'` from the pending bucket, miscounts via the `SUM(CASE …)` expressions, or breaks the placeholder generation for chunk boundaries returns wrong delivery health to the UI. The empty-input guard (line 510) is the only behavior currently exercised — and only indirectly.
- **Root cause**: Deliveries are a child table never seeded in tests; the multi-status CASE logic is pure-SQL business logic that LLM-generatable tests can pin cheaply.
- **Impact**: Operators see a message as "all delivered" when some failed, or vice-versa — masks notification-delivery failures.
- **Fix sketch (llm-generatable)**: Seed one message with deliveries across statuses (delivered×2, pending×1, queued×1, failed×1), call with `[message_id]`, assert tuple `(delivered=2, pending=2, failed=1)`. Add a message with no deliveries → absent from results (not a zero-row). Invariant to assert: `queued` rolls into `pending`; counts partition the rows exactly; empty `message_ids` → `vec![]`. (A >500-id smoke test optionally proves chunking doesn't panic.)

## 6. Notification subscription validation & clear-vs-keep merge — untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/notification_subscriptions.rs:71-213 (`validate_provider`, `create`, `update`/`merge_clearable`)
- **Current test state**: none — repo has zero tests.
- **Scenario**: `create` rejects empty label, unknown provider, no-target (neither webhook_url nor credential_id), and empty event_types. `update` has the subtle three-state contract via `merge_clearable`: `Some("")` clears to NULL, `Some(v)` sets, `None` keeps current — and must reject an update that would leave the subscription with no delivery target (lines 169-173) or empty event_types (lines 175-187). A regression in `merge_clearable` (e.g. treating `Some("")` as set) would persist an empty webhook URL and the dispatcher would fail every delivery; a regression dropping the no-target guard creates an undeliverable subscription.
- **Root cause**: The clear/set/keep semantics are documented in the model (notification_subscription.rs:53-74) but only enforced in code with no test pinning them.
- **Impact**: Silently-broken subscriptions (no target, empty patterns) that never deliver, or accidental clearing of a configured webhook on an unrelated update.
- **Fix sketch (llm-generatable)**: `init_test_db()` tests covering: each `create` rejection path returns `AppError::Validation`; `validate_provider` accepts the four known providers and rejects others. For `update`: set webhook then `Some("")` clears it (assert NULL) while a `credential_id` is present (so the no-target guard passes); `None` keeps the prior value; clearing the *only* target → `Validation`; `Some(vec![])` event_types → `Validation`. Invariant: a persisted subscription always has at least one target and ≥1 event_type pattern.

## 7. `subscribe` idempotency vs UNIQUE(catalog_entry_id) — silent error path
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/communication/shared_events.rs:159-209 (`subscribe`, `unsubscribe`, `get_catalog_entry`); schema: src-tauri/src/db/migrations/initial.rs:188 (`idx_shared_subs_catalog` UNIQUE)
- **Current test state**: none.
- **Scenario**: `shared_event_subscriptions` has a UNIQUE index on `catalog_entry_id`, but `subscribe` does a plain `INSERT` (no `OR IGNORE`/upsert). Double-subscribing the same catalog entry surfaces a raw SQLite UNIQUE-constraint `AppError::Database` rather than an idempotent return or a clean validation error. Also untested: subscribing to a non-existent catalog id should return `NotFound` (via `get_catalog_entry`, lines 113-128), and `unsubscribe` of a missing id returns `NotFound` (lines 184-189).
- **Root cause**: No repo tests; the mismatch between the contract callers likely expect (idempotent toggle) and the raw DB error was never exercised.
- **Impact**: A user clicking "subscribe" twice (or two instances racing) gets an opaque DB error instead of a no-op; the UI may show a failure on an already-active subscription.
- **Fix sketch**: `init_test_db()` test: `upsert_catalog_batch` one entry, `subscribe`, assert row enabled; `subscribe` again → assert the *intended* behavior (either an idempotent success or a typed `Validation`, whichever the product wants — the test forces a decision and documents it). `subscribe` to unknown catalog id → `NotFound`. `unsubscribe` existing → ok, then again → `NotFound`. Invariant: at most one subscription per catalog entry, and duplicate attempts produce a typed (non-`Database`) error.
