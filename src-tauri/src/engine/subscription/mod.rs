//! Unified reactive subscription model.
//!
//! All background reactivity loops follow the same abstract pattern:
//!   1. **Source** -- poll an external condition (DB rows, HTTP endpoints, etc.)
//!   2. **Predicate** -- evaluate whether the condition warrants action
//!   3. **Action** -- dispatch the side-effect (publish event, start execution, etc.)
//!
//! The [`ReactiveSubscription`] trait captures this pattern. Each subscription
//! declares its own poll interval, and the unified [`run_subscriptions`] loop
//! schedules all subscriptions through a single `tokio::select!` loop.
//!
//! Adding a new reactivity source (e.g., file-watch, WebSocket) only requires
//! implementing the trait -- no new `tokio::spawn` block needed.
//!
//! ## Layout
//!
//! Split out of the former single-file `subscription.rs` (3,540 lines) along
//! the seams the code already had — the abstraction, its runner, and the
//! families of implementors:
//!
//! - [`traits`] — the [`ReactiveSubscription`] trait itself and the
//!   `spawn_blocking` helper its implementors use for DB-heavy ticks.
//! - [`wake`] — the event-bus push fan-out `Notify` signal.
//! - [`runner`] — `run_single` (generation gating, panic backoff, health
//!   reporting) and `spawn_subscriptions`.
//! - [`builtin`] — the always-present subscriptions: event bus, trigger
//!   scheduler, polling, cleanup, rotation, composite, OAuth refresh,
//!   healthchecks, relays, digest, scraper schedule.
//! - [`desktop`] — the `desktop`-gated ambient/OS signal sources: file watcher,
//!   clipboard, app focus, ambient context + its SQL eviction, context rules.
//! - `autonomy_*` — the opt-in autonomous spend loops, grouped by what they
//!   steer: [`autonomy_goals`], [`autonomy_reviews`], [`autonomy_backlog`],
//!   [`autonomy_coaching`], [`autonomy_kpi`].
//! - [`watchdogs`] — the always-on, spend-free stall detectors.
//!
//! Everything stays reachable as `crate::engine::subscription::X`; the glob
//! re-exports below preserve the pre-split surface exactly.

mod autonomy_backlog;
mod autonomy_coaching;
mod autonomy_goals;
mod autonomy_kpi;
mod autonomy_reviews;
mod builtin;
mod desktop;
mod runner;
mod traits;
mod wake;
mod watchdogs;

#[cfg(test)]
mod tests;

pub use autonomy_backlog::*;
pub use autonomy_coaching::*;
pub use autonomy_goals::*;
pub use autonomy_kpi::*;
pub use autonomy_reviews::*;
pub use builtin::*;
pub use desktop::*;
pub use runner::*;
pub use traits::*;
pub use wake::*;
pub use watchdogs::*;
