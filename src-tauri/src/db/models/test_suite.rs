use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Test Suites (Reusable Test Scenario Collections)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaTestSuite {
    pub id: String,
    pub persona_id: String,
    pub name: String,
    pub description: Option<String>,
    /// JSON array of TestScenario objects
    pub scenarios: String,
    #[ts(type = "number")]
    pub scenario_count: i32,
    /// Optional: the test run ID that originally generated these scenarios
    pub source_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TestSuiteScenario {
    pub name: String,
    pub description: String,
    pub input_data: Option<serde_json::Value>,
    pub mock_tools: Vec<TestSuiteMockTool>,
    pub expected_behavior: String,
    pub expected_tool_sequence: Option<Vec<String>>,
    pub expected_protocols: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TestSuiteMockTool {
    pub tool_name: String,
    pub description: Option<String>,
    pub mock_response: serde_json::Value,
}
