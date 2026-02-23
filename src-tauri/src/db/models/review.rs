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
// Connector Counts
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorWithCount {
    pub name: String,
    pub count: i64,
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

impl CreateDesignReviewInput {
    /// Create a base input with shared fields pre-filled and all Option fields set to None.
    /// Callers override the fields that differ per branch.
    pub fn base(
        test_case_id: String,
        test_case_name: String,
        instruction: String,
        test_run_id: String,
        reviewed_at: String,
    ) -> Self {
        Self {
            test_case_id,
            test_case_name,
            instruction,
            status: "error".into(),
            structural_score: None,
            semantic_score: None,
            connectors_used: None,
            trigger_types: None,
            design_result: None,
            structural_evaluation: None,
            semantic_evaluation: None,
            test_run_id,
            had_references: None,
            suggested_adjustment: None,
            adjustment_generation: None,
            use_case_flows: None,
            reviewed_at,
        }
    }
}

// ============================================================================
// Import helper — serde-based alternative to manual JSON extraction
// ============================================================================

fn default_test_case_id() -> String { "unknown".into() }
fn default_test_case_name() -> String { "Unnamed".into() }
fn default_status() -> String { "passed".into() }
fn default_test_run_id() -> String { "imported".into() }
fn default_reviewed_at() -> String { chrono::Utc::now().to_rfc3339() }

/// Typed input for `import_design_review`, replacing manual `.get()/.as_str()` chains.
#[derive(Debug, Clone, Deserialize)]
pub struct ImportDesignReviewInput {
    #[serde(default = "default_test_case_id")]
    pub test_case_id: String,
    #[serde(default = "default_test_case_name")]
    pub test_case_name: String,
    #[serde(default)]
    pub instruction: String,
    #[serde(default = "default_status")]
    pub status: String,
    pub structural_score: Option<i32>,
    pub semantic_score: Option<i32>,
    pub connectors_used: Option<String>,
    pub trigger_types: Option<String>,
    pub design_result: Option<String>,
    pub structural_evaluation: Option<String>,
    pub semantic_evaluation: Option<String>,
    #[serde(default = "default_test_run_id")]
    pub test_run_id: String,
    pub had_references: Option<bool>,
    pub use_case_flows: Option<String>,
    #[serde(default = "default_reviewed_at")]
    pub reviewed_at: String,
}

impl From<ImportDesignReviewInput> for CreateDesignReviewInput {
    fn from(imp: ImportDesignReviewInput) -> Self {
        Self {
            test_case_id: imp.test_case_id,
            test_case_name: imp.test_case_name,
            instruction: imp.instruction,
            status: imp.status,
            structural_score: imp.structural_score,
            semantic_score: imp.semantic_score,
            connectors_used: imp.connectors_used,
            trigger_types: imp.trigger_types,
            design_result: imp.design_result,
            structural_evaluation: imp.structural_evaluation,
            semantic_evaluation: imp.semantic_evaluation,
            test_run_id: imp.test_run_id,
            had_references: imp.had_references,
            suggested_adjustment: None,
            adjustment_generation: None,
            use_case_flows: imp.use_case_flows,
            reviewed_at: imp.reviewed_at,
        }
    }
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
