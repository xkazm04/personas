---
subject: realtime-events
evidence:
  - src/lib/eventRegistry.ts                          # TS side of the mirrored registry: EventName constants + EventPayloadMap + compile-time exhaustiveness assertions + typedListen/typedEmit
  - src-tauri/core/src/events.rs                      # Rust authority: event_names! macro, compile-time constants, ALL_EVENT_NAMES
  - scripts/check-event-registry.mjs                  # the parity gate — fails the build when the two registries' name sets diverge
  - src/hooks/realtime/createSingletonListener.ts     # singleton native listener + fanned-out subscriber set + bounded early-arrival buffer (50) with counted drops + per-frame coalescing + last-out teardown
  - src/hooks/useTauriEvent.ts                        # cancelled-flag subscription lifecycle (both halves: teardown sets, handshake continuation checks)
  - src-tauri/db/src/cdc.rs                           # storage change hook → bounded channel with drop counter (loud first drop, per-1000 heartbeat) + startup-blackout watermark replay
  - src-tauri/engine/src/bus.rs                       # subscription matching: self-scoping default, cross-team wildcard bleed guard, capability-scoped dedupe
  - src-tauri/src/engine/webhook_notifier.rs          # outbound leg: durable watermark advanced only past settled deliveries, forward-only seeding, per-tick cap, circuit breaker
  - src/stores/slices/overview/eventSlice.ts          # push-with-reconcile consumer: dedupe by id, bounded list, authoritative fetch path retained
counter_evidence:
  - src-tauri/db/src/cdc.rs                           # ALSO the key counter-example: table_to_event mints six event names as string literals outside both registries — invisible to the parity gate, which only compares the two registry files
deviations:
  - w2-realtime-events   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Realtime Events - evidence

How this codebase measures against the [`realtime-events`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
