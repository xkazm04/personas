//! Standup (spark app-standup): any number of times a day, Athena recalls
//! what moved since the last standup, proposes 2-4 directions per registered
//! project plus agent changes, the operator resolves them on cards and arms
//! the plan through a go-gate. The armed plan drives the in-app machinery
//! (charters, attention loop, fleet queue) on a day/night timeline, while a
//! supervisor sweeps, checks drift, applies away rules with a real park check
//! and backfills dead spots. Standup absorbs Night Shift (`night_shift`).
//!
//! Lives in `companion/` beside `night_shift`, which it absorbs: its tables
//! are in `COMPANION_SCHEMA` (user DB) and every part reaches `AppState` /
//! the Athena engine, so it closes only in `app_lib`. The machine-wide host
//! sampler and dead-spot detector are not standup-specific and live in
//! `engine::resources` (`host_sampler`, `dead_spot`) beside the per-run
//! sampler.
//!
//! Ownership (one builder per file; the wire contract is [`model`], frozen in
//! WP0):
//! - WP1 core: [`plan`], [`arm`], [`propose`], `commands/companion/standup.rs`
//! - WP2 resources: [`forecast`], `engine::resources::{host_sampler, dead_spot}`,
//!   `commands/fleet/host_utilization.rs`
//! - WP3 supervisor: [`supervisor`], [`away_rules`], [`report`]

pub mod model;

pub mod arm;
/// `standup_decide`: Athena writes one card's decision from chat.
pub mod decide;
pub mod plan;
mod plan_import;
pub mod propose;
pub mod service;

pub mod forecast;

pub mod away_rules;
pub mod report;
pub mod supervisor;

pub use model::*;
