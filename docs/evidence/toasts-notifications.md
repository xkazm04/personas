---
subject: toasts-notifications
evidence:
  - src/stores/toastStore.ts                                          # closed three-tone vocabulary driving dwell, priority, and announcement; priority-ranked eviction (capToasts); healing dedup by issueId
  - src/features/shared/chrome/ToastContainer.tsx                     # max-visible render budget (3) + overflow chip; classifier-supplied navigate-to-fix action gated by isGlobalErrorAction
  - src/features/shared/chrome/useToastTimer.ts                       # attention pauses the clock: hover + hidden-window pause, drift-corrected resume
  - src/stores/notificationCenterStore.ts                             # durable ledger: one commit door, countUnread as the single badge derivation, capped retention
  - src/features/shared/chrome/notifications/NotificationCenter.tsx   # ledger UI: read/unread, per-entry deep-link redirects (retry, open execution, restore chat)
  - src/features/shared/chrome/sidebar/BadgeSlot.tsx                  # priority-ranked badge slot with suppressed-count overflow on stable navigation
  - src/features/shared/components/feedback/AriaLiveProvider.tsx      # persistent polite+assertive regions, single imperative writer, serial burst draining
  - src-tauri/src/notifications.rs                                    # OS + external escalation tier: per-event prefs, per-channel delivery metrics, doors that never throw into callers
  - src/lib/notifications/notifyProcessComplete.ts                    # the correct escalation door: ledger record written unconditionally outside the OS try
  - src/lib/errors/errorActionNav.ts                                  # toast actions carry full addressing; context-requiring actions excluded from global surfaces
  - src/lib/silentCatch.ts                                            # the upstream routing door (toastCatch) — error-handling decides what arrives here
counter_evidence:
  - src/features/overview/sub_observability/components/AlertToastContainer.tsx   # a second, independent toast stack with a forked tone vocabulary, no attention pause, no live region
deviations:
  - w3-toasts-notifications   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Toasts Notifications - evidence

How this codebase measures against the [`toasts-notifications`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
