//! Lifecycle status of an evolution cycle.
//!
//! Just the status enum — the evolution engine stays put, since it depends on
//! `genome`, `genome_critique`, `test_runner` and `inflight_guard`. The repo
//! layer only ever needed to read and write this one value.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Status of an evolution cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum EvolutionCycleStatus {
    Breeding,
    Evaluating,
    Promoting,
    Completed,
    Failed,
}

impl EvolutionCycleStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Breeding => "breeding",
            Self::Evaluating => "evaluating",
            Self::Promoting => "promoting",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    #[allow(dead_code)]
    pub fn from_db(s: &str) -> Self {
        match s {
            "breeding" => Self::Breeding,
            "evaluating" => Self::Evaluating,
            "promoting" => Self::Promoting,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => Self::Failed,
        }
    }
}
