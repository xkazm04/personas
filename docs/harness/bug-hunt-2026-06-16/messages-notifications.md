# Bug Hunter — Messages & Notifications

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: messages-notifications | Group: Triggers & Events

## 1. Webhook watermark advances past events that failed to deliver — permanent silent delivery gap
- **Severity**: Critical
- **Category**: Silent failure / latent data loss
- **File**: `src-tauri/src/engine/webhook_notifier.rs:472`
- **Scenario**: A persona event matches an enabled subscription. The webhook endpoint is briefly down (HTTP 500, timeout, DNS blip, or `resolve_webhook_url` fails because a credential isn't yet decryptable). `processor.process()` returns `DispatchOutcome { ok: false, .. }`. The tick records `last_delivery_status = "failed"` on the subscription, but the `for event` loop unconditionally advances `newest_at` to the newest event's `created_at` (lines 487–493) and calls `set_watermark` at line 497. Next tick, `get_recent_after` only returns events with `created_at > watermark`, so the failed event is never seen again.
- **Root cause**: The watermark is a single high-water mark over *all* events, advanced per-tick regardless of per-(event,subscription) delivery success. There is no per-subscription cursor and no retry/dead-letter path for failed webhook deliveries (unlike `persona_events` itself, which has a full DLQ in `events.rs`). Success and failure share the same advance path.
- **Impact**: Any transient webhook outage drops every Slack/Discord/Teams/generic notification fired during that window — silently. The user sees `last_delivery_status: failed` on one subscription but no retry ever happens and no record of *which* events were lost. Multi-subscriber blast radius: one slow endpoint among many can stall the 8s timeout per delivery and starve the 5s tick, compounding the window of loss.
- **Fix sketch**: Only advance the watermark to the newest event for which *all* matching subscriptions reported `ok` (or no subscriptions matched). Better: give failed (event, subscription) pairs a retry queue / per-subscription delivery cursor, capped with backoff, so a recovered endpoint catches up. At minimum, do not advance past an event that had any `ok: false` delivery this tick.

## 2. Shared-event relay cursor uses bare `fired_at` timestamp with no id tiebreaker — duplicate or dropped firings
- **Severity**: High
- **Category**: Race condition / edge case (ordering)
- **File**: `src-tauri/src/engine/shared_event_relay.rs:144`
- **Scenario**: After publishing a batch, the relay advances the cursor to `firings.last().fired_at` (line 144–146) and passes it back next tick as `since` (line 108). Two failure modes depending on the cloud feed's comparison semantics: (a) if the feed treats `since` as `>=`, the boundary firing is re-fetched every tick and re-published via `event_repo::publish`, minting a brand-new `persona_event` UUID each time → duplicate downstream notifications/triage forever. (b) If `since` is `>`, any firing sharing the exact same `fired_at` value as the batch's last row but not included in this batch (e.g. truncated by the `limit=50` page, or arriving in a later page) is permanently skipped.
- **Root cause**: The local event pipeline deliberately uses a composite `(created_at, id)` cursor with an explicit `id` tiebreaker (see `events.rs:343-377`, `get_recent_after`) precisely because same-millisecond rows are common under burst. The cross-instance relay cursor is a bare timestamp string with no tiebreaker, and `SharedEventFiring` carries an `id` (client.rs:310) that is never used for ordering/dedup.
- **Impact**: Either duplicate relayed events (notification storm, duplicate triage work, inflated `events_relayed` count) or silently lost shared events at every page boundary. Worse under high feed volume where 50-row pages fill within one millisecond.
- **Fix sketch**: Track the last `firing.id` alongside `fired_at` and dedup on `firing.id` before publishing (e.g. check `source_id` already exists in `persona_events`, since the relay stores `source_id: Some(firing.id)`). Or have the cloud feed expose a monotonic opaque cursor and store that verbatim instead of `fired_at`.

## 3. Cursor advances by guessed count even on partial publish failure — corrupted relay accounting + skipped firings
- **Severity**: High
- **Category**: Silent failure / latent failure
- **File**: `src-tauri/src/engine/shared_event_relay.rs:143`
- **Scenario**: A batch of N firings is polled. Some `event_repo::publish` calls fail (e.g. payload > 64KB rejected by `validate_event_input` in events.rs:71, or invalid `event_type` chars). The failures are only `tracing::warn!`-logged (lines 134–139); the loop continues. Then line 144–147 advances the cursor to `firings.last().fired_at` regardless — so the firings that failed to publish are now behind the cursor and will never be retried. Separately, `events_relayed` is incremented by `sub_published` (or a hardcoded `1` when zero published, line 145), so the persisted count diverges from reality.
- **Root cause**: Cursor advancement is decoupled from publish success. Any per-firing publish error is swallowed and the cursor still jumps past it; the `if sub_published > 0 { .. } else { 1 }` fallback also advances the cursor even when *nothing* was published (the whole batch failed), guaranteeing the entire batch is lost.
- **Impact**: Shared events with oversized or malformed payloads (untrusted, cloud-relayed content — a trust boundary) are silently dropped with only a debug-level warning. The `events_relayed` KPI and `last_event_at` shown in the UI become inaccurate, masking the loss. No dead-letter, no surfaced error on the subscription (`set_error` is only called on poll failure, not publish failure).
- **Fix sketch**: Only advance the cursor to the `fired_at` of the *last successfully published* firing (stop at the first publish failure, or skip-and-record). Set the subscription `error` when publishes fail. Don't increment `events_relayed` for firings that didn't actually publish, and never advance the cursor when zero firings published.

## 4. Same-day title dedup is non-transactional and content-blind — distinct messages silently swallowed
- **Severity**: Medium
- **Category**: Edge case / silent failure (success theater)
- **File**: `src-tauri/src/db/repos/communication/messages.rs:174`
- **Scenario**: `create()` does a SELECT for an existing row with the same `persona_id` + `title` created today (lines 176–193), and if found returns that row instead of inserting — logging at info level and returning `Ok`. Two problems: (1) the match is on `title` only, ignoring `content`, so two genuinely different messages that happen to share a title today (e.g. "Service Health" with different bodies / different `execution_id` / different `use_case_id`) collapse into one — the caller gets `Ok(existing_row)` and believes its message was delivered. (2) The check-then-insert is not in a transaction; two concurrent `create()` calls (e.g. cascade-fired listeners on different pool connections) can both pass the SELECT and both INSERT, defeating the dedup it was added for.
- **Root cause**: Dedup implemented as a best-effort read-then-write on a non-serialized pooled connection, keyed on a coarse field (title) rather than a content hash or idempotency key. There is no unique index backing it.
- **Impact**: Legitimate distinct notifications are silently dropped (the caller's `Ok` is success theater); under concurrency the duplicate it was meant to prevent still slips through. Hard to debug because the only trace is an `info!` log.
- **Fix sketch**: Key dedup on `(persona_id, title, content_hash)` or an explicit caller-supplied idempotency key, and enforce it with a partial unique index + `INSERT OR IGNORE` so the dedup is atomic rather than a TOCTOU read. Or scope dedup to `execution_id` so distinct executions never collapse.

## 5. Unbounded message growth — no retention/cleanup for persona_messages
- **Severity**: Low
- **Category**: Latent failure (resource exhaustion)
- **File**: `src-tauri/src/db/repos/communication/messages.rs:482`
- **Scenario**: `persona_events` and executions both have time-based retention sweeps (`events.rs:454` `cleanup`, `EVENT_RETENTION_DAYS` / `EXECUTION_RETENTION_DAYS` in settings_keys.rs, run from background.rs). `persona_messages` has only manual `delete(id)` and `delete_all()` — no age-based purge anywhere in the codebase. Agents continuously emit messages (engine/runner, director three-way routing, healing surfacing), so on a long-lived install the table grows without bound, and `persona_message_deliveries` grows with it.
- **Root cause**: Messages were given full CRUD + dedup but no retention policy, unlike sibling event/execution tables.
- **Impact**: Slow, monotonic DB bloat. Queries like `get_thread_summaries` (a CTE with `GROUP BY thread_id` over the full table) and `get_unread_count` (full-table COUNT) degrade over time; the notification bell and thread list get progressively slower. Eventually disk pressure on the SQLite file. Not acute, hence Low, but it is real on multi-month installs.
- **Fix sketch**: Add a `MESSAGE_RETENTION_DAYS` setting and a `cleanup(older_than_days)` mirroring `events::cleanup` (delete read messages older than the window; deliveries cascade), wired into the existing background retention sweep. Optionally cap per-persona message count with an LRU-style trim.
