use std::sync::LazyLock;

/// Wake signal for the event-bus subscription (push fan-out).
///
/// The CDC drain task fires this on every `persona_events` INSERT
/// (`db/cdc.rs`), so event→execution dispatch runs immediately instead of
/// waiting for the 2s-active / 10s-idle poll. The poll is RETAINED unchanged as
/// the degraded-mode heartbeat: a missed signal (CDC channel overflow, startup
/// blackout, any future signal gap) delays dispatch by at most one poll
/// interval instead of dropping it.
///
/// `Notify::notify_one` stores a permit when no waiter is parked, so a signal
/// that lands while the event-bus tick is mid-flight is not lost — the next
/// `notified().await` completes immediately and re-runs the tick.
/// Double-dispatch is impossible regardless of how many wakes fire:
/// `event_repo::claim_pending` atomically flips pending→processing, so racing
/// signal- and poll-driven ticks can never claim the same event twice.
static EVENT_BUS_WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);

/// The event-bus wake signal. Producers (the CDC drain task) call
/// `.notify_one()`; the event-bus subscription loop awaits `.notified()`
/// alongside its poll interval.
pub fn event_bus_wake_signal() -> &'static tokio::sync::Notify {
    &EVENT_BUS_WAKE
}

/// Wake signal for the persona attention loop.
///
/// Fired by `set_persona_enabled` when a persona is switched OFF→ON, so an
/// App Master starts reconciling within seconds instead of waiting out the
/// 300 s active / 900 s idle poll. Same durability posture as the event-bus
/// signal above: the poll is RETAINED unchanged as the degraded-mode
/// heartbeat, and the SIGNAL IS NOT THE REQUEST — the request itself is a
/// durable row (`settings_keys::ATTENTION_WAKE_REQUESTS`), so a wake that
/// fires while no loop is listening (another instance holds leadership, the
/// app is restarting) is honoured on the next tick rather than lost. Losing
/// the signal costs latency, never the pass.
static ATTENTION_WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);

/// The attention-loop wake signal. Producers call `.notify_one()`; the
/// subscription runner awaits it alongside the poll interval.
pub fn attention_wake_signal() -> &'static tokio::sync::Notify {
    &ATTENTION_WAKE
}
