# Bug Hunter — Webhooks & Channel Pollers

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: webhooks-channel-pollers | Group: Triggers & Events

## 1. Outbound webhook delivery failures are silently dropped — watermark advances past them
- **Severity**: Critical
- **Category**: 💀 Silent failure / dropped events
- **File**: `src-tauri/src/engine/webhook_notifier.rs:482`
- **Scenario**: A subscription points at a Slack/Discord/Teams/generic endpoint. During one `tick`, the destination is briefly down (5xx, timeout, DNS blip — common for external webhooks). `processor.process()` returns `outcome.ok == false`. The loop only does `if outcome.ok { delivered += 1 }`, then unconditionally advances `newest_at` to the newest event's `created_at` and calls `sub_repo::set_watermark()` (lines 487–498). Next tick, `get_recent_after(watermark, …)` selects `created_at > watermark` (events.rs:397), so the failed event is never seen again.
- **Root cause**: The dispatch watermark is global and time-based, advanced per-tick regardless of per-(event, subscription) delivery success. Failure is recorded only as `last_delivery_status`/`last_error` on the *subscription* row (`record_delivery`) — there is no per-event retry queue and no dead-letter path for outbound notifications. The DLQ infrastructure (`DeadLetterTab`) only covers *inbound* `persona_events`, not outbound notification deliveries.
- **Impact**: Any transient endpoint outage permanently loses every notification that was due during the outage. "Success theater": the UI shows the relay/dispatcher as healthy and only the subscription's `last_error` hints at loss; no event is recoverable. Multi-subscription amplifies it — one slow/broken subscription's failures vanish while another's succeed under the same advanced watermark.
- **Fix sketch**: Decouple delivery from the watermark. Either (a) only advance the watermark to the highest `created_at` for which *all* matching subscriptions succeeded (track per-subscription cursors), or (b) on failure, enqueue the (event_id, subscription_id) into a retry table with bounded attempts + backoff, mirroring the inbound DLQ. At minimum, do not advance past an event that any subscription failed to deliver.

## 2. Slack/Discord pollers silently skip messages when a burst exceeds FETCH_LIMIT between ticks
- **Severity**: High
- **Category**: 🕳️ Edge case / missed messages
- **File**: `src-tauri/src/engine/slack_poller.rs:352` (and `discord_poller.rs:359`)
- **Scenario**: More than `FETCH_LIMIT` (50) user messages land in a channel within one 5s tick (a burst, or the first poll after the app was asleep/offline for a while). Slack `conversations.history?oldest={cursor}&limit=50` returns the *most recent* 50 messages in the window (Slack returns newest-first and caps at `limit`); Discord `?after={cursor}&limit=50` returns the *oldest* 50 after the cursor. In the Slack case the cursor is then advanced to the newest `ts` seen (lines 205–211, 289–291), jumping over the 51st-and-older messages that were never fetched. They are never dispatched.
- **Root cause**: Single-page fetch per tick with no pagination loop and a cursor that advances to the newest item regardless of whether the full gap was drained. The module docstring even concedes "a burst of more than `FETCH_LIMIT` messages between two ticks can outrun the cursor." Discord's `after` ordering makes it advance only by 50 (slower drain, less data loss) but Slack's `oldest`+newest-50 window actively skips the middle.
- **Impact**: User messages to a persona are silently ignored — the persona never replies, with no error surfaced anywhere. Worst after restart/sleep, exactly when a backlog is most likely. Looks like the bot "missed" or "ignored" the user.
- **Fix sketch**: Page until the response is shorter than `FETCH_LIMIT` (Slack `has_more`/`response_metadata.next_cursor`; Discord keep requesting `after=lastSeen` until <50 returned), bounded by a per-tick page cap. For Slack specifically, fetch oldest-first within the window or loop on `next_cursor` so the cursor only advances over messages actually processed.

## 3. webhook_notifier watermark uses strict `created_at >` — events sharing the boundary timestamp are dropped
- **Severity**: High
- **Category**: ⚡ Cursor race / 🕳️ boundary edge case
- **File**: `src-tauri/src/db/repos/communication/events.rs:397` (consumed by `webhook_notifier.rs:457` + `:497`)
- **Scenario**: The dispatcher fetches `WHERE created_at > ?1 ORDER BY created_at ASC, id ASC` and then sets the watermark to the newest event's `created_at` only (no `id` component). If two events share the same `created_at` string (same producer batch, or coarse timestamp resolution), and the tick's `MAX_EVENTS_PER_TICK` page boundary or the watermark lands on that timestamp, the next query's strict `>` excludes *all* events with that exact `created_at` — including any not yet processed. The query orders by `(created_at, id)` but the watermark is `created_at`-only, so the `id` tiebreaker that made the page deterministic is discarded when persisting the cursor.
- **Root cause**: Composite ordering key `(created_at, id)` but a scalar `created_at` watermark. Strict `>` + non-unique `created_at` = lost rows at the boundary; the watermark cannot express "this created_at, but only ids after X."
- **Impact**: Under bursty event production (engine + scheduler + smee relay all publishing in the same millisecond) some events are never dispatched to any subscription. Silent and timing-dependent — invisible in normal low-volume testing, surfaces only under load.
- **Fix sketch**: Make the watermark a composite `(created_at, id)` and query `WHERE (created_at, id) > (?, ?)`, or guarantee `created_at` uniqueness, or page with `created_at >=` plus a processed-id set within the boundary timestamp. The cloud relay already moved to per-trigger watermarks for a related reason; apply the same rigor here.

## 4. Slack/Discord cursor advances over messages whose dispatch errored, and the reply pass excludes them — input lost, no retry
- **Severity**: Medium
- **Category**: 💀 Silent failure / dropped input
- **File**: `src-tauri/src/engine/slack_poller.rs:259` (and `discord_poller.rs:253`)
- **Scenario**: `execute_persona_inner` fails (rate limit, model error, transient DB error). The poller logs the inbound row with `execution_id = NULL, error = Some(...)` (lines 264–274), but still advanced `newest_ts`/`newest_id` over this message (the cursor tracking at lines 205–211 runs before the dispatch and is unconditional). The message is now permanently behind the cursor. The reply pass `list_pending_replies` filters `execution_id IS NOT NULL AND error IS NULL` (slack_poller.rs:611, discord_poller.rs:603), so an errored row is never retried and never replied to.
- **Root cause**: Cursor advancement is decoupled from successful dispatch, and a dispatch error is treated as terminal (written to the log row) with no requeue. `message_already_logged` (which uses `INSERT OR IGNORE`) will then also treat the errored message as "handled" if the cursor ever re-presented it.
- **Impact**: A transient failure (e.g. a momentary rate-limit on `execute_persona_inner`) silently swallows a user's message — the persona never runs and never replies, and the only trace is an `error` column no UI surfaces. The user sees the bot ignore them.
- **Fix sketch**: Do not advance the cursor past a message whose dispatch errored (or write the row without an error and re-attempt next tick by NOT advancing the cursor over un-dispatched-but-eligible messages); alternatively add a bounded retry: include `error IS NOT NULL AND execution_id IS NULL AND attempts < N` rows in a re-dispatch sweep before advancing.

## 5. Self-reply / loop guard relies only on the bot author flag; a second persona bot in the same channel can ping-pong
- **Severity**: Low
- **Category**: 💀 Infinite reply loop / trust boundary
- **File**: `src-tauri/src/engine/discord_poller.rs:212` (and `slack_poller.rs:216`)
- **Scenario**: The pollers skip a message only when `author_is_bot` (Discord) / `bot_id` present (Slack) is true. This correctly stops a bot replying to *its own* posts. But two Personas-driven personas configured to poll the *same* channel with *different bot credentials* will each see the other's reply. Each reply is posted via `post_reply` as a normal bot message; Persona A's reply is authored by bot A, which is not bot B, so Persona B treats it as a human message, dispatches an execution, and replies — and vice versa. `allowed_mentions: {parse: []}` (discord_poller.rs:453) suppresses pings but not the content-triggered execution.
- **Root cause**: Loop prevention is "is the author a bot?" rather than "is the author *one of our* personas' bots / did we generate this message?" There is no record that an outbound reply (its `replied_message_id`/`ts`) should be excluded from future inbound processing for other personas, and bot-authored messages are skipped wholesale only by the single `author_is_bot` flag — which is per-message, not per-channel-topology aware.
- **Impact**: Unbounded reply storm between two personas in a shared channel — token burn, rate-limit exhaustion, and channel spam. `MAX_REPLIES_PER_TICK` (25) throttles but does not stop it; the loop simply runs at 25 replies/tick indefinitely. Low likelihood (requires two polling personas in one channel) but high blast radius if it occurs.
- **Fix sketch**: Track the bot user-id of each persona's own credential and skip messages whose author id matches *any* known Personas bot in that channel; and/or record every outbound reply message id and short-circuit inbound processing for ids we authored. Surface a warning when two enabled personas poll the same `channelId`.
