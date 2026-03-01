use serde::{Deserialize, Serialize};

// ============================================================================
// Platform Definition — config-driven platform rules for workflow import
// ============================================================================

/// A complete platform definition that replaces hardcoded rules in prompts.rs
/// and n8nParser.ts with a data-driven structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDefinition {
    /// Unique platform ID (e.g., "n8n", "zapier", "make")
    pub id: String,
    /// Display label (e.g., "n8n", "Zapier", "Make (Integromat)")
    pub label: String,
    /// File format for import (json, yaml)
    pub format: String,
    /// Node-type to connector service mapping
    pub node_type_map: Vec<NodeTypeMapping>,
    /// Credential consolidation rules (many-to-one mapping)
    pub credential_consolidation: Vec<CredentialConsolidationRule>,
    /// Node role classification patterns
    pub node_role_classification: Vec<NodeRolePattern>,
    /// Credential types that should NOT be mapped (built-in LLM, etc.)
    pub excluded_credential_types: Vec<String>,
    /// Protocol mapping rules (platform-specific patterns → Persona protocols)
    pub protocol_map_rules: Vec<ProtocolMapRule>,
    /// Whether this is a built-in (non-deletable) definition
    pub is_builtin: bool,
}

/// Maps platform-specific node types to normalized connector names.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTypeMapping {
    /// Source pattern — matched against the node type identifier.
    /// Supports prefix matching (e.g., "gmail" matches "gmailTrigger").
    pub source_pattern: String,
    /// Target connector service name in Personas
    pub target_service: String,
}

/// Consolidation rule that maps multiple platform credential types to
/// a single Personas connector.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialConsolidationRule {
    /// Glob/prefix patterns for source credential types
    pub source_patterns: Vec<String>,
    /// Single target connector name in Personas
    pub target_connector: String,
    /// Human-readable description of what this consolidation covers
    pub description: String,
}

/// Pattern for classifying nodes by their role in the workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeRolePattern {
    /// Regex pattern matched against the node type
    pub pattern: String,
    /// Role: trigger, tool, decision, llm, utility
    pub role: String,
}

/// Maps platform-specific workflow patterns to Persona protocol messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolMapRule {
    /// Description of the platform pattern being mapped
    pub platform_pattern: String,
    /// Target Persona protocol (user_message, agent_memory, manual_review, emit_event)
    pub target_protocol: String,
    /// When to apply this mapping
    pub condition: String,
}

// ============================================================================
// DB-persisted platform definition
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformDefinitionRow {
    pub id: String,
    pub label: String,
    pub format: String,
    pub definition_json: String,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlatformDefinitionInput {
    pub id: String,
    pub label: String,
    pub format: String,
    pub definition_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlatformDefinitionInput {
    pub label: Option<String>,
    pub definition_json: Option<String>,
}
