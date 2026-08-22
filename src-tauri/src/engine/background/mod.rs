//! Background scheduler: shared state, startup/shutdown, and the tick bodies
//! that the reactive subscriptions in [`crate::engine::subscription`] call.
//!
//! Split out of the former single-file `background.rs` (4,173 lines). The cut
//! follows the subsystem's own seams and moves no logic:
//!
//! - [`state`] — [`SchedulerState`], its health/stats snapshots and the Tauri
//!   event payloads the frontend consumes.
//! - [`lifecycle`] — [`start_loops`] / [`stop_loops`]: subscription assembly,
//!   the startup sweeps, the Smee relay, and the webhook server's
//!   `tokio::sync::watch` shutdown channel (the only shutdown primitive in the
//!   application).
//! - [`event_bus`] — the event gate ledger, the stuck-`processing` reaper and
//!   `event_bus_tick`.
//! - [`scheduler`] — the trigger scheduler tick and its schedule-policy
//!   helpers (hourly caps, rate limits, overlap, missed-run backfill).
//! - [`cleanup`] — retention parsing and `cleanup_tick`.
//! - [`executions`] — the zombie / silent-execution sweeps.
//!
//! Everything stays reachable as `crate::engine::background::X`; the glob
//! re-exports below preserve the pre-split surface exactly.

mod cleanup;
mod event_bus;
mod executions;
mod lifecycle;
mod scheduler;
mod state;

#[cfg(test)]
mod tests;

pub(crate) use cleanup::*;
pub(crate) use event_bus::*;
pub use executions::*;
pub use lifecycle::*;
pub use scheduler::*;
pub use state::*;
