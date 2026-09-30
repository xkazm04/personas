---
subject: outbound-notifications
evidence:
  - src-tauri/src/engine/webhook_notifier.rs              # the channel layer end to end: EventProcessor trait, provider body shapes, placeholder templating, pattern matching, per-sink breaker, watermark dispatch
  - src-tauri/db/src/repos/resources/notification_subscriptions.rs   # subscriptions as user data: one validation door (label, provider vocabulary, endpoint-or-credential, ≥1 pattern), last-delivery ledger, watermark store
  - src-tauri/src/notifications.rs                        # the second outbound stack: per-persona channel specs fanned to five channel classes + test-delivery ritual with rate limit
  - src-tauri/src/engine/slack_bridge.rs                  # bidirectional binding parsed once for both lanes; is_echo — the single named loop-prevention invariant
  - src-tauri/src/engine/slack_poller.rs                  # inbound counterpart: per-channel cursor, bounded fetch + bounded drain, reply correlation, bridge fork on a discriminator
  - src-tauri/src/engine/discord_poller.rs                # the sibling poller: same shape, per-route rate budget sized in the constants' comments
  - src-tauri/src/engine/team_slack_relay.rs              # outbound half of the bridge: mirrors team-channel rows out under per-bridge flags
  - src/lib/notifications/notifyProcessComplete.ts        # the compose-at-the-locale-layer exemplar: text resolved from the live catalog at send time, durable record written outside the try
counter_evidence:
  - src-tauri/src/notifications.rs                        # ALSO the key counter-example: 31 backend send sites compose English literals on the side of the boundary that has never heard of the user's locale (52/57 across five doors, measured 2026-08)
deviations:
  - w12-outbound-notifications   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-realtime-events        # shared watermark, in-memory-only breaker strikes, no dead-letter — the fan-out-side gaps this subject inherits
  - w3-toasts-notifications   # five delivery doors / 52-of-57 hardcoded-English measurement on the OS-escalation door
---

# Outbound Notifications - evidence

How this codebase measures against the [`outbound-notifications`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
