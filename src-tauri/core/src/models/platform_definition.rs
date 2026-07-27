use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlatformFormat {
    Json,
    Yaml,
}

// ============================================================================
// Platform Definition -- config-driven platform rules for workflow import
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
    pub format: PlatformFormat,
    /// Node-type to connector service mapping
    pub node_type_map: Vec<NodeTypeMapping>,
    /// Credential consolidation rules (many-to-one mapping)
    pub credential_consolidation: Vec<CredentialConsolidationRule>,
    /// Node role classification patterns
    pub node_role_classification: Vec<NodeRolePattern>,
    /// Credential types that should NOT be mapped (built-in LLM, etc.)
    pub excluded_credential_types: Vec<String>,
    /// Protocol mapping rules (platform-specific patterns -> Persona protocols)
    pub protocol_map_rules: Vec<ProtocolMapRule>,
    /// Whether this is a built-in (non-deletable) definition
    pub is_builtin: bool,
}

/// Maps platform-specific node types to normalized connector names.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTypeMapping {
    /// Source pattern -- matched against the node type identifier.
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
// Prompt composition helpers
//
// These live here rather than in `engine::platform_rules` (where they were
// written) because `PlatformDefinition` moved into `personas-core` with the
// rest of `db::models` in crate-split step 3, and Rust only allows an inherent
// `impl` in the crate that defines the type.

#[allow(dead_code)]
impl PlatformDefinition {
    /// Generate the credential consolidation rules section for the AI prompt.
    pub fn format_credential_rules_prompt(&self) -> String {
        if self.credential_consolidation.is_empty() {
            return String::new();
        }

        let mut lines = vec![
            format!("## Credential Mapping Rules (CRITICAL for tool generation)"),
            format!("{} uses separate credential types per service feature, but Personas consolidates them under", self.label),
            "a single OAuth connector per provider. You MUST map accordingly:\n".into(),
            "Consolidation rules:".into(),
        ];

        for rule in &self.credential_consolidation {
            let sources = rule
                .source_patterns
                .iter()
                .map(|s| format!("\"{s}\""))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!(
                "- {} -> single connector \"{}\"",
                sources, rule.target_connector
            ));
        }

        if !self.excluded_credential_types.is_empty() {
            let excluded = self
                .excluded_credential_types
                .iter()
                .map(|s| format!("\"{s}\""))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!(
                "- {excluded} -> NOT mapped (Personas has built-in LLM)"
            ));
        }

        lines.push(
            "- For other credential types, map to the closest connector by service name".into(),
        );
        lines.join("\n")
    }

    /// Generate the node role classification section for prompts.
    pub fn format_node_roles_prompt(&self) -> String {
        if self.node_role_classification.is_empty() {
            return String::new();
        }

        let mut lines = vec![format!("\n## {} Node Classification", self.label)];

        let mut roles: std::collections::HashMap<&str, Vec<&str>> =
            std::collections::HashMap::new();
        for nrp in &self.node_role_classification {
            roles.entry(&nrp.role).or_default().push(&nrp.pattern);
        }

        for (role, patterns) in &roles {
            let pats = patterns
                .iter()
                .map(|p| format!("/{p}/i"))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("- **{role}** nodes: {pats}"));
        }

        lines.join("\n")
    }

    /// Generate the protocol mapping section for prompts.
    pub fn format_protocol_rules_prompt(&self) -> String {
        if self.protocol_map_rules.is_empty() {
            return String::new();
        }

        let mut lines = vec![format!("\n## {} -> Persona Protocol Mapping", self.label)];

        for rule in &self.protocol_map_rules {
            lines.push(format!(
                "- {} -> `{}` ({})",
                rule.platform_pattern, rule.target_protocol, rule.condition
            ));
        }

        lines.join("\n")
    }

    /// Serialize to JSON for DB storage.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from JSON (DB storage).
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Resolve a node type to its target service name using node_type_map.
    pub fn resolve_node_type(&self, node_type: &str) -> Option<&str> {
        let lower = node_type.to_lowercase();
        // Strip platform prefix (e.g., "n8n-nodes-base.gmailTrigger" -> "gmailtrigger")
        let name = lower.rsplit('.').next().unwrap_or(&lower);
        // Remove common suffixes
        let cleaned = name.trim_end_matches("trigger").trim_end_matches("node");

        for mapping in &self.node_type_map {
            if cleaned.starts_with(&mapping.source_pattern) || cleaned == mapping.source_pattern {
                return Some(&mapping.target_service);
            }
        }
        None
    }

    /// Resolve a credential type to its consolidated connector name.
    pub fn resolve_credential(&self, cred_type: &str) -> Option<&str> {
        let lower = cred_type.to_lowercase();

        // Check excluded first
        for excluded in &self.excluded_credential_types {
            if excluded.ends_with('*') {
                let prefix = &excluded[..excluded.len() - 1].to_lowercase();
                if lower.starts_with(prefix) {
                    return None; // Excluded
                }
            } else if lower == excluded.to_lowercase() {
                return None;
            }
        }

        // Check consolidation rules
        for rule in &self.credential_consolidation {
            for pattern in &rule.source_patterns {
                if pattern.ends_with('*') {
                    let prefix = pattern[..pattern.len() - 1].to_lowercase();
                    if lower.starts_with(&*prefix) {
                        return Some(&rule.target_connector);
                    }
                } else if lower == pattern.to_lowercase() {
                    return Some(&rule.target_connector);
                }
            }
        }

        None
    }

    /// Classify a node's role based on node_role_classification patterns.
    pub fn classify_node_role(&self, node_type: &str) -> &str {
        let lower = node_type.to_lowercase();
        for nrp in &self.node_role_classification {
            if lower.contains(&nrp.pattern.to_lowercase()) {
                return &nrp.role;
            }
        }
        "tool" // default role
    }
}
