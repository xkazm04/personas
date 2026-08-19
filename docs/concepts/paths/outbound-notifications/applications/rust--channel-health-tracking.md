---
layer: application
subject: outbound-notifications
technique: channel-health-tracking
stack: rust
---

# Channel health tracking — the per-sink breaker, thrice, and a ledger nobody renders (Personas)

The technique's two customers — the dispatch loop and the owner — as served
by `src-tauri/src/engine/webhook_notifier.rs`, the ledger in
`src-tauri/db/src/repos/resources/notification_subscriptions.rs`, the
per-*type* metrics in `src-tauri/src/notifications.rs`, and the owner panel
`src/features/settings/sub_notifications/components/WebhookSubscriptionsPanel.tsx`.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| Delivery ledger (floor form) | `record_delivery` (`notification_subscriptions.rs:236-258`) writes `last_delivery_at`, `last_delivery_status`, `last_error` on every attempt; called from both `WebhookProcessor::process` paths (`webhook_notifier.rs:167`, `:192`) and from `test_dispatch` (`:766`) |
| Breaker protects shared dispatch state | the module comment at `webhook_notifier.rs:469-491` is the technique's argument verbatim: one dead sink pins the *global* watermark → duplicate spam to healthy subs + loss past the per-tick window; the breaker's defining rule is that a broken sub "no longer contributes to `earliest_failed`" |
| Probe failures don't pin | `BreakerAction::Probe` (`:525-527`) is excluded from `earliest_failed` alongside already-broken and just-crossed subs (`:679-692`) |
| Below-threshold stays cursor-pinning | "Healthy subs are untouched: their first `BROKEN_FAILURE_THRESHOLD - 1` consecutive failures still pin the watermark, preserving transient-outage retry" (`:489-491`) |
| Recovery cadence | `BROKEN_PROBE_EVERY = 12` (`:500`), advanced by `breaker_note_skip` so a skipped sink still walks toward its next probe |
| Placement decision written down | in-memory `LazyLock<Mutex<HashMap>>` (`:506-507`) with the reason: "State is in-memory only and resets on restart — the correct default, since a restart re-probes every sink afresh" |
| Test-delivery ritual, real path | `test_dispatch` (`:737-768`) resolves the real URL, renders the real template, uses the real provider body, writes the real ledger; the synthetic event type is honestly `test.notification` |
| Test rate limit (one stack) | `TEST_DELIVERY_RATE_LIMIT` with a 1 s window in `notifications.rs:1173-1230` for persona channels |
| Broken-channel event exists (one stack) | the legacy persona-channel loop emits `NOTIFICATION_DELIVERY` with `consecutive_failures` per attempt (`notifications.rs:583-590`) |

## Judgment calls worth copying

- **The breaker comment is a proof, not a label.** It states the shared
  resource (global watermark), the two failure modes (duplicate spam,
  loss), the exclusion rule, and why in-memory is correct. Anyone
  extending it can check their change against the argument.
- **Probe failures are handled as a distinct case.** The subtle half the
  technique warns about — probes re-pinning the cursor — is explicitly
  named and excluded (`:686-691`).
- **The test path is the production path.** No bypassed stage.

## Gaps against the technique (reported, not fixed)

- **The ledger crosses the IPC boundary and stops there.** The ts-rs
  binding carries `lastDeliveryAt` / `lastDeliveryStatus` / `lastError`
  (`src/lib/bindings/NotificationSubscription.ts:34`); the owner panel
  renders **none of them** — it shows only the *in-session* test result
  from `useState` (`WebhookSubscriptionsPanel.tsx:64-65`, `:213-233`).
  From the user's side a channel that has failed every delivery for a
  month looks identical to a healthy one until they press Test. This is
  the technique's central failure — the pipeline protected, the owner
  uninformed — with the data already one render away.
- **Breaker state is invisible everywhere.** In-memory placement is a
  fine default; showing nothing about it is not. No surface says
  "paused as broken, probing every 12 events" and no event fires when a
  subscription trips (`tick`'s `app` parameter is explicitly reserved for
  this and unused, `:601`). The persona-channel stack emits per-attempt
  events with `consecutive_failures`; the notifier stack emits nothing.
- **The breaker is copy-pasted three times.** `webhook_notifier.rs:493-566`,
  `team_slack_relay.rs:86-160`, `slack_poller.rs:364-425` — same
  thresholds, same probe cadence, same lock-poison recovery, three
  statics, and each copy's comment says "same shape and rationale as"
  one of the others. Three copies of a five-line policy is three places a
  threshold change must land; the technique's per-sink application wants
  one breaker keyed by sink identity.
- **`notifications.rs` counts per channel *type*, not per sink.**
  `ChannelMetrics.consecutive_failures` (`:140-190`) is keyed by
  `channel_type` string; two personas' chat channels share one counter,
  so one dead room ages every room of that class. Not a per-sink ledger.
- **`test_notification_subscription` has no rate limit** — the command
  (`src-tauri/src/commands/communication/notifications.rs:60-73`) calls
  `test_dispatch` unguarded, while `test_channel_delivery` for persona
  channels has the 1 s window. Same ritual, one stack guarded.
- **No dead-letter, no since-when.** Floor-form ledger only: last
  outcome, no consecutive count persisted, no last-success separate from
  last-attempt. The two-question test (nothing-matched vs. all-failed,
  and since when) is not answerable from rows. The dead-letter gap is
  registered with the fan-out owner (`#w2-realtime-events`).
