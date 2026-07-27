use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Persisted composition workflow — a multi-agent DAG definition.
///
/// Nodes and edges are stored as JSON strings to avoid a join-heavy schema;
/// the frontend deserializes them into `WorkflowNode[]` and `WorkflowEdge[]`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompositionWorkflow {
    pub id: String,
    pub name: String,
    pub description: String,
    /// JSON-serialized array of WorkflowNode objects.
    pub nodes_json: String,
    /// JSON-serialized array of WorkflowEdge objects.
    pub edges_json: String,
    /// Optional JSON-serialized input schema hint.
    pub input_schema_json: Option<String>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a new composition workflow.
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompositionWorkflowInput {
    pub name: String,
    pub description: Option<String>,
    pub nodes_json: Option<String>,
    pub edges_json: Option<String>,
    pub input_schema_json: Option<String>,
    pub enabled: Option<bool>,
}

/// Input for updating an existing composition workflow.
#[derive(Debug, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCompositionWorkflowInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub nodes_json: Option<String>,
    pub edges_json: Option<String>,
    pub input_schema_json: Option<String>,
    pub enabled: Option<bool>,
}
