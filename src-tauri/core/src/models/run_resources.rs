//! What a run ACTUALLY consumed of this machine: CPU, RAM and GPU, sampled over
//! the run's whole process tree (the agent plus every child it spawned - a
//! `cargo build` a session starts is charged to that session).
//!
//! Every share is a fraction of THIS DEVICE's capacity in `0.0..=1.0`: CPU of
//! all logical cores, resident RAM of total RAM, GPU engine utilisation. The
//! dominant axis is the one with the largest share, so "this agent is GPU-bound"
//! is a measurement rather than a declaration. The declared side is
//! [`crate::models::ResourceProfile`]; the profile loop (engine
//! `responsibility`) folds these summaries back into it as
//! [`crate::models::ProfileSource::Measured`].
//!
//! Absent-value convention: GPU is `None` (TS `null`) when the platform cannot
//! read per-process GPU engines, never `0.0` - "no GPU reading" and "used no
//! GPU" are different facts. Millisecond fields are `f64` so they bind to
//! TypeScript `number`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One of the three measured resource axes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ResourceAxis {
    Cpu,
    Ram,
    Gpu,
}

impl ResourceAxis {
    pub fn as_str(self) -> &'static str {
        match self {
            ResourceAxis::Cpu => "cpu",
            ResourceAxis::Ram => "ram",
            ResourceAxis::Gpu => "gpu",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "cpu" => Some(ResourceAxis::Cpu),
            "ram" => Some(ResourceAxis::Ram),
            "gpu" => Some(ResourceAxis::Gpu),
            _ => None,
        }
    }

    /// The axis with the largest share. Ties resolve CPU > RAM > GPU so the
    /// answer is a total function of its inputs; a `None` GPU never wins.
    pub fn dominant(cpu: f64, ram: f64, gpu: Option<f64>) -> ResourceAxis {
        let mut best = (ResourceAxis::Cpu, cpu);
        if ram > best.1 {
            best = (ResourceAxis::Ram, ram);
        }
        if let Some(g) = gpu {
            if g > best.1 {
                best = (ResourceAxis::Gpu, g);
            }
        }
        best.0
    }
}

/// Which kind of run a measurement belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum RunKind {
    /// A fleet session (`fleet_sessions.id`).
    Fleet,
    /// A persona execution (`persona_executions.id`).
    Execution,
}

impl RunKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RunKind::Fleet => "fleet",
            RunKind::Execution => "execution",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "fleet" => Some(RunKind::Fleet),
            "execution" => Some(RunKind::Execution),
            _ => None,
        }
    }
}

/// One finished run's resource footprint. One row of the append-only
/// `run_resource_summaries` table, written once when the run ends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RunResourceSummary {
    pub run_kind: RunKind,
    pub run_id: String,
    pub persona_id: Option<String>,
    pub responsibility_id: Option<String>,
    /// 95th-percentile CPU share over the run's samples.
    pub cpu_p95_share: f64,
    /// Peak resident-RAM share over the run's samples.
    pub ram_peak_share: f64,
    /// 95th-percentile GPU share; `None` when the platform cannot read it.
    pub gpu_p95_share: Option<f64>,
    pub dominant: ResourceAxis,
    /// How many samples the summary was computed from.
    pub samples: u32,
    pub started_at_ms: f64,
    pub ended_at_ms: f64,
}

/// The latest sample of one LIVE run, as the `fleet:resource-sample` event and
/// `resource_live_samples` carry it. Latest-wins, never persisted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LiveResourceSample {
    pub run_kind: RunKind,
    pub run_id: String,
    pub persona_id: Option<String>,
    pub cpu_share: f64,
    pub ram_share: f64,
    pub gpu_share: Option<f64>,
    pub dominant: ResourceAxis,
    pub at_ms: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dominant_is_the_largest_share_and_none_gpu_never_wins() {
        assert_eq!(ResourceAxis::dominant(0.4, 0.1, None), ResourceAxis::Cpu);
        assert_eq!(
            ResourceAxis::dominant(0.1, 0.4, Some(0.2)),
            ResourceAxis::Ram
        );
        assert_eq!(
            ResourceAxis::dominant(0.1, 0.1, Some(0.9)),
            ResourceAxis::Gpu
        );
        // Ties resolve CPU > RAM > GPU.
        assert_eq!(
            ResourceAxis::dominant(0.3, 0.3, Some(0.3)),
            ResourceAxis::Cpu
        );
    }

    #[test]
    fn tokens_round_trip() {
        for a in [ResourceAxis::Cpu, ResourceAxis::Ram, ResourceAxis::Gpu] {
            assert_eq!(ResourceAxis::parse(a.as_str()), Some(a));
            assert_eq!(
                serde_json::to_value(a).expect("serializes"),
                serde_json::json!(a.as_str())
            );
        }
        for k in [RunKind::Fleet, RunKind::Execution] {
            assert_eq!(RunKind::parse(k.as_str()), Some(k));
        }
    }
}
