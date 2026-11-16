//! What the WHOLE machine did, minute by minute, and where a standup plan's
//! items are expected to land on it (spark app-standup, WP0 contract freeze;
//! WP2 owns the sampler, the repo and the forecast that fill these).
//!
//! [`crate::models::RunResourceSummary`] says what one run consumed; nothing
//! said what the host as a whole was doing between runs, which is the only
//! place an idle CPU or GPU (a "dead spot") is visible. One
//! [`HostUtilizationPoint`] is one row of the system-DB table
//! `host_utilization` (migration `e73_host_utilization`): a 1-minute rollup of
//! 10-second samples, kept 14 days.
//!
//! Shares follow the run-resources convention: fractions of this device's
//! capacity in `0.0..=1.0`. A share is `None` (key omitted) when the minute has
//! no reading for that axis - GPU off Windows, or a minute the sampler missed
//! that axis - never `0.0`, because "no reading" and "idle" are different facts.
//! Millisecond timestamps are `i64` pinned to TS `number` (epoch ms stay far
//! under 2^53); counts are `i32`.
//!
//! These live in `core` (not `app_lib`) because the repo that reads and writes
//! `host_utilization` sits in `db/src/repos/resources/`, beside
//! `run_resources`, and `db` cannot reach `app_lib`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One minute of the host: CPU / RAM / GPU shares and the fleet's load.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HostUtilizationPoint {
    /// Start of the minute, epoch ms, aligned to a whole minute.
    #[ts(type = "number")]
    pub minute_ms: i64,
    /// Mean CPU share over the minute's samples.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub cpu_avg: Option<f64>,
    /// Highest CPU sample in the minute.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub cpu_max: Option<f64>,
    /// Mean resident-RAM share over the minute's samples.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub ram_avg: Option<f64>,
    /// Mean GPU engine share (PDH `_Total`); `None` off Windows.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub gpu_avg: Option<f64>,
    /// Highest GPU sample in the minute; `None` off Windows.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[ts(optional)]
    pub gpu_max: Option<f64>,
    /// Fleet sessions running at the minute's last sample.
    pub fleet_running: i32,
    /// Fleet sessions queued at the minute's last sample.
    pub fleet_queued: i32,
}

/// Where one standup plan item is expected to run, from the item's measured
/// profile and its median duration. Deterministic for the same inputs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ForecastSlot {
    /// The `StandupItem.id` this slot places.
    pub item_id: String,
    /// Expected start, epoch ms.
    #[ts(type = "number")]
    pub start_ms: i64,
    /// Expected end, epoch ms.
    #[ts(type = "number")]
    pub end_ms: i64,
    /// Machine-load units the item is charged (the responsibility quanta
    /// 1 / 2 / 4 / 8).
    pub machine_units: i32,
    /// Whether the item needs the exclusive GPU token.
    pub gpu: bool,
    /// How much measured history backs the slot, `0.0..=1.0` (0 = declared
    /// profile only, no runs measured).
    pub confidence: f64,
}
