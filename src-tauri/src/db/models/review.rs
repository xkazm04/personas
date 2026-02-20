use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Manual Reviews
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaManualReview {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub title: String,
    pub description: Option<String>,
    pub severity: String,
    pub context_data: Option<String>,
    pub suggested_actions: Option<String>,
    pub status: String,
    pub reviewer_notes: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateManualReviewInput {
    pub execution_id: String,
    pub persona_id: String,
    pub title: String,
    pub description: Option<String>,
    pub severity: Option<String>,
    pub context_data: Option<String>,
    pub suggested_actions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateManualReviewInput {
    pub status: Option<String>,
    pub reviewer_notes: Option<String>,
    pub resolved_at: Option<String>,
}

// ============================================================================
// Design Reviews
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaDesignReview {
    pub id: String,
    pub test_case_id: String,
    pub test_case_name: String,
    pub instruction: String,
    pub status: String,
    pub structural_score: Option<i32>,
    pub semantic_score: Option<i32>,
    pub connectors_used: Option<String>,
    pub trigger_types: Option<String>,
    pub design_result: Option<String>,
    pub structural_evaluation: Option<String>,
    pub semantic_evaluation: Option<String>,
    pub test_run_id: String,
    pub had_references: Option<bool>,
    pub suggested_adjustment: Option<String>,
    pub adjustment_generation: Option<i32>,
    pub use_case_flows: Option<String>,
    pub reviewed_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CreateDesignReviewInput {
    pub test_case_id: String,
    pub test_case_name: String,
    pub instruction: String,
    pub status: String,
    pub structural_score: Option<i32>,
    pub semantic_score: Option<i32>,
    pub connectors_used: Option<String>,
    pub trigger_types: Option<String>,
    pub design_result: Option<String>,
    pub structural_evaluation: Option<String>,
    pub semantic_evaluation: Option<String>,
    pub test_run_id: String,
    pub had_references: Option<bool>,
    pub suggested_adjustment: Option<String>,
    pub adjustment_generation: Option<i32>,
    pub use_case_flows: Option<String>,
    pub reviewed_at: String,
}

// ============================================================================
// Design Patterns
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaDesignPattern {
    pub id: String,
    pub pattern_type: String,
    pub pattern_text: String,
    pub trigger_condition: String,
    pub confidence: i32,
    pub source_review_ids: String,
    pub usage_count: i32,
    pub last_validated_at: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}
