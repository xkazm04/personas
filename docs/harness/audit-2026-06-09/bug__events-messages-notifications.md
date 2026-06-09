# Bug Hunter — events-messages-notifications
> Total: 6
> Severity: 2 critical, 3 high, 1 medium

## 1. Outbound webhook watermark advances even when every delivery fails — notifications silently dropped forever
- **Severity**: critical
- **Category**: recovery-gap
- **File**: src-tauri/src/engine/webhook_notifier.rs:481-498
- **Scenario**: A user configures a Slack subscription for `execution.*`. Slack (or the network) is briefly down — every `dispatch_to_url` returns `ok: false`. The tick still computes `newest_at` from the events it processed and calls `set_watermark(pool, &at)` unconditionally at line 496-498. On the next tick `get_recent_after(watermark)` returns only newer events; the failed ones are now permanently behind the watermark and are never re-attempted.
- **Root cause**: The watermark is a "seen" cursor, but the loop conflates *seen* with *successfully delivered*. `delivered` is counted but never gates watermark advancement, and there is no per-subscription delivery cursor or failed-delivery queue. Unlike `persona_events`' own retry/DLQ machinery (events.rs `increment_retry_or_dead_letter`, `get_retry_eligible`), the webhook path has zero retry.
- **Impact**: data loss — every outbound notification that fails during a transient channel/network outage is dropped with no retry and no surfacing beyond the subscription's `last_error` field.
- **Fix sketch**: Make the watermark per-subscription and advance it only past events that were *delivered or permanently abandoned*. Persist failed (event_id, sub_id) pairs to a delivery table (or reuse `persona_message_deliveries`-style rows) with a status + attempt count, and drain pending/failed deliveries each tick with capped retries → DLQ. Never move a cursor past an undelivered event.

## 2. Crash / leadership handoff between POST and set_watermark re-delivers the whole batch — no idempotency
- **Severity**: critical
- **Category**: race-condition
- **File**: src-tauri/src/engine/webhook_notifier.rs:472-498
- **Scenario**: A tick matches 40 events against an enabled subscription and successfully POSTs all 40 (line 481). Before `set_watermark` runs (line 496), the process is killed, OR `is_engine_leader` flips and a follower wins leadership (run_dispatcher line 551). The new tick re-reads `get_watermark` (still the old value), re-fetches the same 40 events, and POSTs all 40 again. Slack/Discord/Teams have no dedup, so the user gets 80 messages.
- **Root cause**: At-least-once delivery with no idempotency key. The HTTP POST and the watermark commit are not atomic, and nothing on the request (no `X-Idempotency-Key`, no per-event delivery record consulted before sending) lets the receiver or the sender detect a replay. The leader-only guard reduces but does not eliminate the window — a mid-tick leadership change or crash still double-sends.
- **Impact**: data corruption / UX degradation — duplicate user-visible notifications; for `generic` webhooks that trigger downstream side effects, duplicate actions.
- **Fix sketch**: Record a delivery row keyed `(event_id, subscription_id)` *before* POSTing and skip any pair already marked delivered (consult-before-send). Include a stable `Idempotency-Key: {event_id}:{sub_id}` header so cooperative receivers dedup. Advance the watermark from persisted delivery state, not from the in-memory loop variable.

## 3. record_delivery failures swallowed — delivery bookkeeping is success theater
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/engine/webhook_notifier.rs:153, 178, 536
- **Scenario**: `WebhookProcessor::process` POSTs successfully, then calls `sub_repo::record_delivery(pool, &sub.id, "success", None)` with the result discarded via `let _ =`. If that UPDATE fails (pool exhausted, DB locked under burst), the subscription's `last_delivery_at` / `last_delivery_status` / `last_error` silently keep stale values. The reverse is worse: a *failed* delivery whose `record_delivery("failed", …)` write is dropped leaves the UI showing the previous "success".
- **Root cause**: The trait contract (lines 106-109) *requires* both paths to record delivery, but every call site ignores the `Result`, so the contract is unenforceable and DB write failures are invisible. There is no log on the discarded error either.
- **Impact**: UX degradation — the subscriptions table and any health/alerting built on `last_delivery_status` misrepresent reality; an operator cannot tell a channel is failing.
- **Fix sketch**: Stop using `let _ =`; at minimum `tracing::warn!` on the discarded error, and fold the record-delivery failure into the returned `DispatchOutcome` so the caller/UI sees that bookkeeping failed. Better: write the delivery record in the same transaction that advances the cursor.

## 4. One slow/failing channel stalls the whole tick and gets hammered every 5s — no isolation or backoff (retry storm)
- **Severity**: high
- **Category**: recovery-gap
- **File**: src-tauri/src/engine/webhook_notifier.rs:472-485, 544-560
- **Scenario**: Two subscriptions match a burst of 200 events (MAX_EVENTS_PER_TICK). Subscription A's endpoint hangs and eats the full 8s `DELIVERY_TIMEOUT` (line 44) on every event. The inner loop `await`s each `process` serially (line 481), so A's hangs serialize ahead of B — B's notifications are delayed by up to 200 × 8s within a single tick. Separately, a persistently 500-ing endpoint is re-POSTed on every 5s tick (DISPATCH_TICK_INTERVAL) with no exponential backoff and no circuit breaker, so a dead channel receives unbounded retry traffic.
- **Root cause**: Fully sequential per-(event × subscription) dispatch with a fixed poll cadence and no per-channel health state (consecutive-failure count, cooldown, or disable-on-repeated-failure). The 8s timeout bounds a single call but not the aggregate tick, and nothing throttles a known-bad endpoint.
- **Impact**: UX degradation — head-of-line blocking delays healthy channels; retry storm hammers a failing/removed endpoint and wastes the tick budget.
- **Fix sketch**: Track consecutive failures per subscription; apply exponential backoff / a circuit-breaker cooldown before re-attempting a failing channel, and auto-disable after a threshold (surfaced via `last_error`). Bound or parallelize per-channel dispatch (e.g. `join_all` with a concurrency cap) so one hung endpoint can't serialize the rest.

## 5. Message "dedup" is a same-day title heuristic with a TOCTOU race — drops distinct messages and still admits duplicates under concurrency
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/db/repos/communication/messages.rs:166-216
- **Scenario**: Two legitimately different messages happen to share a persona_id + title on the same calendar day (e.g. two real "Build failed" alerts hours apart for different commits) — the second is silently swallowed and the caller is handed the *first* message's row (line 191), so the new content is lost. Conversely, two concurrent `create` calls with the same title both run the SELECT (lines 176-183), both find no existing row, and both INSERT — the dedup misses entirely (classic check-then-act race; there is no UNIQUE constraint backing it).
- **Root cause**: Dedup is implemented as a best-effort SELECT-then-INSERT on a fuzzy natural key (`persona_id + title + date(created_at)`) rather than a producer-supplied idempotency key enforced by a UNIQUE index. It is neither sound (drops real distinct messages) nor atomic (races under burst — exactly the cascade-fired scenario it was added to fix).
- **Impact**: data loss (distinct messages dropped) and duplicate delivery (race admits dupes) — both, depending on timing.
- **Fix sketch**: Give callers an optional `dedup_key` / `idempotency_key` column with a UNIQUE index and use `INSERT … ON CONFLICT DO NOTHING RETURNING` so dedup is atomic and intentional. Reserve title-based collapse for sources that explicitly opt in, not all messages.

## 6. Event payload decrypt failure silently nulls the payload sent to webhooks
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/communication/events.rs:117-131; src-tauri/src/engine/webhook_notifier.rs:366-382
- **Scenario**: An event row's payload fails to decrypt (key rotation, corruption). `row_to_event` (events.rs lines 120-127) sets `payload = None` and appends a decrypt note to `error_message`. The webhook notifier's `event_to_json` (webhook_notifier.rs line 367-370) maps `None` → `JsonValue::Null`, so the template renders missing fields as empty strings and the POST still goes out as a "success" — a notification with a blank/incomplete body, and the receiver has no signal that data was lost.
- **Root cause**: The decrypt-failure sentinel (payload nulled, note in `error_message`) is invisible to the dispatch path, which treats a `None` payload identically to a legitimately empty one and proceeds to deliver.
- **Impact**: UX degradation / data loss — outbound notifications fire with hollow content while reporting success; downstream automations act on empty payloads.
- **Fix sketch**: Have `event_to_json` / the dispatcher detect the decrypt-failure marker (non-empty `error_message` with null payload where ciphertext existed) and either skip delivery (record it failed) or include an explicit `payload_error` field so the receiver/template can react rather than silently rendering blanks.
