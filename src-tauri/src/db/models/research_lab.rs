use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Research Project
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchProject {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub status: String,
    pub thesis: Option<String>,
    pub scope_constraints: Option<String>,
    pub team_id: Option<String>,
    pub obsidian_vault_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateResearchProject {
    pub name: String,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub thesis: Option<String>,
    pub scope_constraints: Option<String>,
    pub team_id: Option<String>,
    pub obsidian_vault_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResearchProject {
    pub name: Option<String>,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub status: Option<String>,
    pub thesis: Option<String>,
    pub scope_constraints: Option<String>,
    pub team_id: Option<String>,
    pub obsidian_vault_path: Option<String>,
}

// ============================================================================
// Research Source (literature)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSource {
    pub id: String,
    pub project_id: String,
    pub source_type: String,
    pub title: String,
    pub authors: Option<String>,
    #[ts(type = "number | null")]
    pub year: Option<i32>,
    pub abstract_text: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub pdf_path: Option<String>,
    #[ts(type = "number | null")]
    pub citation_count: Option<i32>,
    pub metadata: Option<String>,
    #[ts(type = "number | null")]
    pub relevance_score: Option<f64>,
    pub knowledge_base_id: Option<String>,
    pub status: String,
    pub ingested_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateResearchSource {
    pub project_id: String,
    pub source_type: String,
    pub title: String,
    pub authors: Option<String>,
    #[ts(type = "number | undefined")]
    pub year: Option<i32>,
    pub abstract_text: Option<String>,
    pub doi: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<String>,
}

// ============================================================================
// Research Citation
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchCitation {
    pub id: String,
    pub source_id: String,
    pub cited_source_id: Option<String>,
    pub cited_reference: Option<String>,
    pub context: Option<String>,
    pub created_at: String,
}

// ============================================================================
// Research Hypothesis
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchHypothesis {
    pub id: String,
    pub project_id: String,
    pub statement: String,
    pub rationale: Option<String>,
    pub status: String,
    #[ts(type = "number")]
    pub confidence: f64,
    pub parent_hypothesis_id: Option<String>,
    pub generated_by: Option<String>,
    pub supporting_evidence: Option<String>,
    pub counter_evidence: Option<String>,
    pub linked_experiments: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateResearchHypothesis {
    pub project_id: String,
    pub statement: String,
    pub rationale: Option<String>,
    pub generated_by: Option<String>,
}

// ============================================================================
// Research Experiment
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchExperiment {
    pub id: String,
    pub project_id: String,
    pub hypothesis_id: Option<String>,
    pub name: String,
    pub methodology: Option<String>,
    pub input_schema: Option<String>,
    pub success_criteria: Option<String>,
    pub status: String,
    pub pipeline_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateResearchExperiment {
    pub project_id: String,
    pub hypothesis_id: Option<String>,
    pub name: String,
    pub methodology: Option<String>,
    pub input_schema: Option<String>,
    pub success_criteria: Option<String>,
}

// ============================================================================
// Research Experiment Run
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchExperimentRun {
    pub id: String,
    pub experiment_id: String,
    #[ts(type = "number")]
    pub run_number: i32,
    pub inputs: Option<String>,
    pub outputs: Option<String>,
    pub metrics: Option<String>,
    #[ts(type = "number")]
    pub passed: i32,
    pub execution_id: Option<String>,
    #[ts(type = "number | null")]
    pub duration_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub cost_usd: Option<f64>,
    pub created_at: String,
}

// ============================================================================
// Research Finding
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchFinding {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    #[ts(type = "number")]
    pub confidence: f64,
    pub category: Option<String>,
    pub source_experiment_ids: Option<String>,
    pub source_ids: Option<String>,
    pub hypothesis_ids: Option<String>,
    pub generated_by: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateResearchFinding {
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    #[ts(type = "number | undefined")]
    pub confidence: Option<f64>,
    pub category: Option<String>,
    pub generated_by: Option<String>,
}

// ============================================================================
// Research Report
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReport {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub report_type: Option<String>,
    pub status: String,
    pub template: Option<String>,
    pub format: Option<String>,
    pub review_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateResearchReport {
    pub project_id: String,
    pub title: String,
    pub report_type: Option<String>,
    pub format: Option<String>,
    pub template: Option<String>,
}

// ============================================================================
// Research Report Section
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReportSection {
    pub id: String,
    pub report_id: String,
    pub section_key: String,
    pub title: Option<String>,
    pub content: Option<String>,
    #[ts(type = "number")]
    pub sort_order: i32,
    pub generated_by: Option<String>,
    pub citation_ids: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Dashboard Stats (computed, not stored)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ResearchDashboardStats {
    #[ts(type = "number")]
    pub total_projects: i32,
    #[ts(type = "number")]
    pub active_projects: i32,
    #[ts(type = "number")]
    pub total_sources: i32,
    #[ts(type = "number")]
    pub total_hypotheses: i32,
    #[ts(type = "number")]
    pub total_experiments: i32,
    #[ts(type = "number")]
    pub total_findings: i32,
    #[ts(type = "number")]
    pub total_reports: i32,
}
