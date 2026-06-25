# Messages & Notifications — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: messages-and-notifications | Group: Triggers & Events
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

> Scope note: the two listed command modules (`communication/notifications.rs`, `communication/messages.rs`) are thin auth+delegate wrappers; the delivery/relay logic that owns the risk lives in their implementation engines/repos (`engine/webhook_notifier.rs`, `engine/shared_event_relay.rs`, `db/repos/communication/messages.rs`, `db/repos/communication/events.rs`). Findings are reported against those.

## 1. One persistently-failing webhook subscription pins the global watermark → unbounded duplicate re-delivery to healthy subscriptions + eventual loss of new notifications
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / duplicate delivery / notification loss
- **File**: src-tauri/src/engine/webhook_notifier.rs:483-532 (watermark math 504-531; failure tracking 495-501; `record_delivery` at notification_subscriptions.rs:236-258)
- **Scenario**: User has two enabled subscriptions A (healthy Slack) and B (a Discord webhook whose channel was deleted → HTTP 404 forever). Events E1<E2<E3 all match both. Each tick: B fails on the earliest matching event Ek, so `earliest_failed = Ek.created_at` *every* tick. The watermark is advanced only to the max event strictly *before* `earliest_failed` (lines 520-531), so it is pinned just below Ek permanently.
- **Root cause**: The dispatch watermark is a single global cursor shared by every subscription, held below the earliest event that had ANY failed delivery this tick. There is no per-subscription cursor, no consecutive-failure circuit breaker, and `record_delivery` only overwrites `last_delivery_*` — it never counts failures or disables a dead endpoint. So a single dead webhook poisons the whole outbound pipeline.
- **Impact**: (a) Every event from Ek onward is re-fetched and re-POSTed to the *healthy* subscription A every `DISPATCH_TICK_INTERVAL` (5s) indefinitely → relentless duplicate-notification spam. (b) Because `get_recent_after` is capped at `MAX_EVENTS_PER_TICK = 200` oldest-first, once >200 events accumulate after Ek, newer events never enter the window → genuinely new notifications are delayed/never delivered while the stuck prefix is reprocessed forever. Both duplicate spam and notification loss from a single, very common operator condition (rotated/deleted webhook, expired credential).
- **Fix sketch**: Track delivery per `(event, subscription)` (a delivery ledger or per-subscription cursor) so one bad sink can't pin the shared watermark; OR add a consecutive-failure counter on the subscription and skip/auto-disable it after N failures (and stop letting it set `earliest_failed`). The code comment at 511-513 already names "a per-(event,subscription) retry cursor is the deeper fix."
- **Value**: impact=8 effort=5

## 2. First notification subscription (or any created after a no-subscription gap) is flooded with the entire historical event backlog
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: undefined onboarding semantics → notification flood
- **File**: src-tauri/src/engine/webhook_notifier.rs:451-467, 530-531 (watermark seed); db/repos/communication/events.rs:379-437 (`get_recent_after` None branch)
- **Scenario**: App runs for weeks accumulating thousands of `persona_events` with no enabled notification subscription. `tick()` returns early at 452-454 whenever `subscriptions.is_empty()`, so `set_watermark` is *never* reached and the watermark stays `None`. The user then creates their first Slack subscription. Next tick: `get_watermark` → `None` → `get_recent_after(None, None, 200)` returns the 200 *oldest* events and POSTs them all; each subsequent tick advances 200 at a time, replaying the whole history as if brand-new.
- **Root cause**: The watermark is only ever seeded *inside* `tick` after a successful dispatch, and `tick` short-circuits when there are zero subscriptions. There is no "initialize watermark to now on startup / on first subscription" step, and no documented contract for what a freshly-created subscription should receive.
- **Impact**: A flood of hundreds-to-thousands of stale notifications dumped to the channel the moment the first subscription is created (and again after any window where all subscriptions were disabled/deleted). Looks like a runaway bot; users disable the integration. Same hazard for "delete last sub → events accumulate → recreate sub."
- **Fix sketch**: Seed the watermark to `now` at startup (or when the first subscription is created) so subscriptions are forward-looking by contract; alternatively, when watermark is `None`, jump it to the newest event without dispatching. Document the "subscriptions only receive events created after they are enabled" semantics.
- **Value**: impact=6 effort=3

## 3. Shared-event relay status is hardcoded green even when every feed poll fails — broken feeds and dropped shared events never surface
- **Severity**: Medium
- **Lens**: bug-hunter (+ ambiguity)
- **Category**: silent failure / observability gap
- **File**: src-tauri/src/engine/shared_event_relay.rs:170-176, 181-198
- **Scenario**: A subscribed feed's `shared_events_poll_feed` errors every tick (auth expired, slug removed server-side). The per-sub branch logs a warn and calls `repo::set_error` (170-176), but the loop continues and at the end (181-186) the aggregate state sets `st.last_error = None` unconditionally, and `emit_status` hardcodes `connected: true` (190-197). The frontend's relay indicator stays "connected, N active feeds, no error."
- **Root cause**: Aggregate status is computed without inspecting whether any per-feed poll failed this tick; `last_error` is reset to `None` after a loop that may have set per-sub errors, and `connected`/`error` are not derived from the loop outcome. (The early `list_enabled_subscriptions` failure path at 87-91 also returns without `emit_status`, leaving a stale banner.)
- **Impact**: Shared-event notifications can be silently dropping (poll failing → no events relayed) while the UI shows a healthy relay. The user has no signal that a feed is broken; the only trace is the per-sub `error` column, which the status surface ignores.
- **Fix sketch**: Track `failed_feeds`/`first_error` during the loop; set `st.last_error = Some(...)` and emit `connected:false` (or a degraded flag with feed-error count) when any feed errored. Emit status on the list-failure early-return too.
- **Value**: impact=5 effort=2

## 4. Thread summaries duplicate a thread and show a nondeterministic "parent" when two messages share the MIN(created_at)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: message ordering corruption / duplicate listing
- **File**: src-tauri/src/db/repos/communication/messages.rs:288-292 (JOIN), 234 (`get_by_thread` ordering)
- **Scenario**: A thread's parent message and its first reply (or two cascade-fired messages) are inserted in the same millisecond, so two rows share `created_at == MIN(created_at)`. The summary query joins `persona_messages pm ON pm.thread_id = ta.thread_id AND pm.created_at = ta.first_at` (290-291), which now matches *both* rows → the same thread is emitted twice, each with a different `parent`.
- **Root cause**: The "pick the parent" join keys solely on `created_at = MIN(created_at)` with no `id` tiebreaker / `LIMIT 1`. Unlike `persona_events` (which adopted a composite `(created_at, id)` cursor exactly to fix same-millisecond collisions — see events.rs:343-352, 1023-1027), the messages thread query never got that tiebreaker. `get_by_thread` (234) has the same no-tiebreaker `ORDER BY created_at ASC`, giving nondeterministic in-thread order for same-ms messages.
- **Impact**: Duplicate thread cards in the inbox; the displayed "parent" can be a reply instead of the true first message; the outer result can exceed the CTE `LIMIT`, throwing off pagination (a page silently contains fewer distinct threads than requested). Same-millisecond inserts are realistic under cascade/burst dispatch.
- **Fix sketch**: Resolve the parent deterministically — e.g. correlate a subquery that picks `MIN((created_at, id))` (lowest id among earliest), or `ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at, id) = 1`. Add `, id ASC` to `get_by_thread`'s ORDER BY.
- **Value**: impact=5 effort=4

## 5. Shared-event relay can permanently drop a firing on a same-timestamp boundary after a publish failure (bare-timestamp cursor) + dedup not scoped to source_type
- **Severity**: Medium
- **Lens**: ambiguity-guardian (+ bug-hunter)
- **Category**: lost event / undocumented cursor semantics
- **File**: src-tauri/src/engine/shared_event_relay.rs:121-168; db/repos/communication/events.rs:454-462 (`exists_by_source_id`)
- **Scenario**: A poll returns firings F1,F2 with identical `fired_at`. F1 publishes OK (or is deduped), advancing `last_published_at` to that timestamp; F2's `event_repo::publish` fails (transient DB error) → loop `break`s and the cursor is set to the shared `fired_at` (166-168). If the remote feed applies strict `>` on the bare-`fired_at` cursor, the next poll excludes F2 (its `fired_at` is not `>` the cursor) → F2 is lost forever. The inline comment (126-131) acknowledges this is unrecoverable client-side.
- **Root cause**: The relay cursor is a bare `fired_at` with no id tiebreaker (the same class of bug fixed for `persona_events` with a composite cursor), so any same-timestamp boundary plus a mid-batch publish failure can skip an event. Separately, the dedup check `exists_by_source_id` (events.rs:454-462) matches on `source_id` across ALL event types/sources — it is not scoped to `source_type = 'shared_catalog'`, so a firing id colliding with any other subsystem's `source_id` would be falsely deduped (low likelihood with UUIDs, but undocumented).
- **Impact**: Rare but silent loss of a relayed shared event (no DLQ, no surfaced error since Finding 3 hides feed health). Publish failures are uncommon, so likelihood is low; impact is a quietly dropped cross-instance notification.
- **Fix sketch**: Have the cloud feed expose a composite `(fired_at, id)` cursor and persist both; on a held batch, record the last-safe composite so the next poll resumes exactly after it. Scope `exists_by_source_id` to `source_type` for the relay dedup, or add a UNIQUE(source_type, source_id) partial index so publish is idempotent.
- **Value**: impact=5 effort=5
