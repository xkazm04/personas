use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Headless LLM spend ledger (tiger finding #1)
// ============================================================================
//
// The headless LLM tier — background scanners (idea/kpi/context/standards),
// the lab/eval/evolution tooling (auto_triage, eval, genome_critique,
// test_runner), and the design-artifact spawns (smart_search, team_synthesis,
// credential_design, recipe_generation, kpi_derivation/binding) — spawned
// `claude -p` and let the stream `result` line (model / tokens /
// total_cost_usd) stream past unrecorded. This is the dedicated, append-only
// spend ledger (`dev_llm_spend`), kept separate from `companion_turn` (which
// stays companion-scoped). persona_id / project_id are SOFT references (no FK)
// so a spend row survives deletion of its persona or project.

/// One headless LLM call's usage, ready to insert. Internal (no ts-rs).
#[derive(Debug, Clone, Default)]
pub struct LlmSpendInsert {
    /// Tier: `scanner` | `evaluator` | `design` | `kpi`.
    pub source: String,
    /// Specific call site: `idea_scan` | `auto_triage` | `team_synthesis` | …
    pub trigger_kind: String,
    pub model: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<i64>,
    pub num_turns: Option<i64>,
    pub is_error: bool,
    /// Soft ref — the persona this call was about (evaluators), or None.
    pub persona_id: Option<String>,
    /// Soft ref — the project this call was about (scanners), or None.
    pub project_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Dashboard rollups (ts-rs exported for the read command)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LlmSpendTotals {
    pub calls: i64,
    pub cost_usd: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub error_calls: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LlmSpendDay {
    // `YYYY-MM-DD` (UTC).
    pub day: String,
    pub calls: i64,
    pub cost_usd: f64,
}

// A cost rollup grouped by some key (source, trigger_kind, or model).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LlmSpendGroup {
    pub key: String,
    pub calls: i64,
    pub cost_usd: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LlmSpendDashboard {
    // Window the rollups cover, in days (echoed back for the UI).
    pub window_days: i64,
    pub totals: LlmSpendTotals,
    pub daily: Vec<LlmSpendDay>,
    pub by_source: Vec<LlmSpendGroup>,
    pub by_trigger: Vec<LlmSpendGroup>,
    pub by_model: Vec<LlmSpendGroup>,
}
