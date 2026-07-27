//! Canonical composite-score weights for lab evaluations.
//!
//! **This is the single source of truth.** The frontend mirror in
//! `src/lib/eval/evalFramework.ts` is seeded at app startup from the
//! `lab_get_score_weights` command, which returns `SCORE_WEIGHTS`.
//!
//! Extracted from `engine::eval` in crate-split step 4d: `db::repos::lab::ratings`
//! recomputes composite scores and so needs the weights, while the eval engine
//! itself pulls in `cli_process`, `parser` and `prompt`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Weights for composite scoring.
///
/// **This is the single source of truth.** The frontend used to declare these
/// values independently in `src/lib/eval/evalFramework.ts` with a "keep in
/// sync" comment; that mirror is now seeded at app startup from the
/// `lab_get_score_weights` Tauri command which returns this `SCORE_WEIGHTS`
/// const. The TS file retains hardcoded fallback defaults for unit tests and
/// the pre-fetch window, but the runtime values come from here.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ScoreWeights {
    pub tool_accuracy: f64,
    pub output_quality: f64,
    pub protocol_compliance: f64,
}

pub const SCORE_WEIGHTS: ScoreWeights = ScoreWeights {
    tool_accuracy: 0.4,
    output_quality: 0.4,
    protocol_compliance: 0.2,
};

// Field-level constants for ergonomic reuse inside this crate (test_runner.rs
// and a few others read these by name). The values are derived from
// `SCORE_WEIGHTS` so a change to the canonical const updates both surfaces.
pub const WEIGHT_TOOL_ACCURACY: f64 = SCORE_WEIGHTS.tool_accuracy;
pub const WEIGHT_OUTPUT_QUALITY: f64 = SCORE_WEIGHTS.output_quality;
pub const WEIGHT_PROTOCOL_COMPLIANCE: f64 = SCORE_WEIGHTS.protocol_compliance;
