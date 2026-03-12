//! BYOM (Bring Your Own Model) -- Enterprise provider policy engine.
//!
//! Allows organizations to configure:
//! - **Allowed providers**: restrict which LLM providers can be used
//! - **Compliance rules**: block specific providers for sensitive workflows
//! - **Cost routing**: map task complexity levels to specific providers/models
//! - **Audit logging**: record which provider handled each execution
//!
//! The BYOM policy is stored as a JSON blob in `app_settings` under the key
//! `byom_policy`. When no policy is configured, all providers are allowed
//! (backwards-compatible default).

use serde::{Deserialize, Serialize};

use super::provider::EngineKind;

/// Settings key for the BYOM policy JSON.
pub const BYOM_POLICY_KEY: &str = "byom_policy";

// =============================================================================
// Policy types
// =============================================================================

/// Top-level BYOM policy configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ByomPolicy {
    /// Whether BYOM policy enforcement is enabled.
    pub enabled: bool,
    /// Providers that are allowed for use. Empty = all allowed.
    pub allowed_providers: Vec<String>,
    /// Providers that are explicitly blocked (takes precedence over allowed).
    pub blocked_providers: Vec<String>,
    /// Cost-based routing rules. Evaluated in order; first match wins.
    pub routing_rules: Vec<RoutingRule>,
    /// Compliance restrictions keyed by workflow tag.
    pub compliance_rules: Vec<ComplianceRule>,
}

/// A cost-based routing rule that maps task characteristics to a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    /// Human-readable name for this rule.
    pub name: String,
    /// Task complexity level that triggers this rule.
    pub task_complexity: TaskComplexity,
    /// Provider to route to (as engine kind string: "claude_code", "gemini_cli", etc.).
    pub provider: String,
    /// Optional model override (e.g., "claude-haiku-4-5-20251001").
    pub model: Option<String>,
    /// Whether this rule is active.
    pub enabled: bool,
}

/// Task complexity levels for cost-optimized routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskComplexity {
    /// Simple tasks: formatting, linting, small edits.
    Simple,
    /// Standard tasks: feature implementation, refactoring.
    Standard,
    /// Critical tasks: architecture changes, security-sensitive work.
    Critical,
}

/// A compliance rule that restricts providers for specific workflow tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceRule {
    /// Human-readable name (e.g., "HIPAA Workflows").
    pub name: String,
    /// Tags that trigger this rule. Matched against persona tags/categories.
    pub workflow_tags: Vec<String>,
    /// Only these providers are allowed when this rule matches.
    pub allowed_providers: Vec<String>,
    /// Whether this rule is active.
    pub enabled: bool,
}

// =============================================================================
// Provider audit log entry
// =============================================================================

/// A single provider audit log entry recording which provider handled an execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderAuditEntry {
    pub id: String,
    pub execution_id: String,
    pub persona_id: String,
    pub persona_name: String,
    pub engine_kind: String,
    pub model_used: Option<String>,
    pub was_failover: bool,
    pub routing_rule_name: Option<String>,
    pub compliance_rule_name: Option<String>,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<i64>,
    pub status: String,
    pub created_at: String,
}

// =============================================================================
// Policy evaluation
// =============================================================================

/// Result of evaluating the BYOM policy for a specific execution context.
#[derive(Debug, Clone)]
pub struct PolicyDecision {
    /// The preferred provider (from routing rules), if any.
    pub preferred_provider: Option<EngineKind>,
    /// The preferred model (from routing rules), if any.
    pub preferred_model: Option<String>,
    /// Providers that are explicitly blocked by policy.
    pub blocked_providers: Vec<EngineKind>,
    /// Name of the routing rule that matched, if any.
    pub routing_rule_name: Option<String>,
    /// Name of the compliance rule that matched, if any.
    pub compliance_rule_name: Option<String>,
}

impl ByomPolicy {
    /// Load the BYOM policy from the settings DB.
    /// Returns `None` if no policy is configured or parsing fails.
    pub fn load(pool: &crate::db::DbPool) -> Option<Self> {
        let json = crate::db::repos::core::settings::get(pool, BYOM_POLICY_KEY)
            .ok()
            .flatten()?;
        serde_json::from_str(&json).ok()
    }

    /// Save the BYOM policy to the settings DB.
    pub fn save(&self, pool: &crate::db::DbPool) -> Result<(), crate::error::AppError> {
        let json = serde_json::to_string(self)
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to serialize BYOM policy: {}", e)))?;
        crate::db::repos::core::settings::set(pool, BYOM_POLICY_KEY, &json)
    }

    /// Evaluate the policy for a given execution context.
    ///
    /// - `persona_tags`: tags/categories associated with the persona (for compliance matching).
    /// - `complexity`: the task complexity level (for cost routing).
    pub fn evaluate(
        &self,
        persona_tags: &[String],
        complexity: Option<TaskComplexity>,
    ) -> PolicyDecision {
        if !self.enabled {
            return PolicyDecision {
                preferred_provider: None,
                preferred_model: None,
                blocked_providers: Vec::new(),
                routing_rule_name: None,
                compliance_rule_name: None,
            };
        }

        // 1. Build blocked set from top-level blocked_providers
        let mut blocked: Vec<EngineKind> = self
            .blocked_providers
            .iter()
            .filter_map(|s| parse_engine_kind(s))
            .collect();

        // 2. If allowed_providers is non-empty, block everything not in the allowed list
        if !self.allowed_providers.is_empty() {
            let allowed_set: Vec<EngineKind> = self
                .allowed_providers
                .iter()
                .filter_map(|s| parse_engine_kind(s))
                .collect();
            for kind in all_engine_kinds() {
                if !allowed_set.contains(&kind) && !blocked.contains(&kind) {
                    blocked.push(kind);
                }
            }
        }

        // 3. Evaluate compliance rules (first matching rule wins)
        let mut compliance_rule_name = None;
        for rule in &self.compliance_rules {
            if !rule.enabled {
                continue;
            }
            let matches = persona_tags.iter().any(|tag| {
                rule.workflow_tags
                    .iter()
                    .any(|wt| tag.to_lowercase().contains(&wt.to_lowercase()))
            });
            if matches {
                // This compliance rule applies: only its allowed providers are permitted
                let compliance_allowed: Vec<EngineKind> = rule
                    .allowed_providers
                    .iter()
                    .filter_map(|s| parse_engine_kind(s))
                    .collect();
                for kind in all_engine_kinds() {
                    if !compliance_allowed.contains(&kind) && !blocked.contains(&kind) {
                        blocked.push(kind);
                    }
                }
                compliance_rule_name = Some(rule.name.clone());
                break; // first match wins
            }
        }

        // 4. Evaluate routing rules (first matching complexity wins)
        let mut preferred_provider = None;
        let mut preferred_model = None;
        let mut routing_rule_name = None;
        if let Some(complexity) = complexity {
            for rule in &self.routing_rules {
                if !rule.enabled {
                    continue;
                }
                if rule.task_complexity == complexity {
                    preferred_provider = parse_engine_kind(&rule.provider);
                    preferred_model = rule.model.clone();
                    routing_rule_name = Some(rule.name.clone());
                    break;
                }
            }
        }

        PolicyDecision {
            preferred_provider,
            preferred_model,
            blocked_providers: blocked,
            routing_rule_name,
            compliance_rule_name,
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

/// Parse a settings string into an EngineKind.
fn parse_engine_kind(s: &str) -> Option<EngineKind> {
    match s {
        "claude_code" => Some(EngineKind::ClaudeCode),
        "codex_cli" => Some(EngineKind::CodexCli),
        "gemini_cli" => Some(EngineKind::GeminiCli),
        "copilot_cli" => Some(EngineKind::CopilotCli),
        _ => None,
    }
}

/// Return all known engine kinds.
fn all_engine_kinds() -> Vec<EngineKind> {
    vec![
        EngineKind::ClaudeCode,
        EngineKind::CodexCli,
        EngineKind::GeminiCli,
        EngineKind::CopilotCli,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_policy_allows_all() {
        let policy = ByomPolicy::default();
        let decision = policy.evaluate(&[], None);
        assert!(decision.blocked_providers.is_empty());
        assert!(decision.preferred_provider.is_none());
    }

    #[test]
    fn test_disabled_policy_allows_all() {
        let policy = ByomPolicy {
            enabled: false,
            blocked_providers: vec!["gemini_cli".into()],
            ..Default::default()
        };
        let decision = policy.evaluate(&[], None);
        assert!(decision.blocked_providers.is_empty());
    }

    #[test]
    fn test_blocked_providers() {
        let policy = ByomPolicy {
            enabled: true,
            blocked_providers: vec!["gemini_cli".into(), "copilot_cli".into()],
            ..Default::default()
        };
        let decision = policy.evaluate(&[], None);
        assert!(decision.blocked_providers.contains(&EngineKind::GeminiCli));
        assert!(decision.blocked_providers.contains(&EngineKind::CopilotCli));
        assert!(!decision.blocked_providers.contains(&EngineKind::ClaudeCode));
    }

    #[test]
    fn test_allowed_providers_blocks_rest() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude_code".into()],
            ..Default::default()
        };
        let decision = policy.evaluate(&[], None);
        assert!(!decision.blocked_providers.contains(&EngineKind::ClaudeCode));
        assert!(decision.blocked_providers.contains(&EngineKind::GeminiCli));
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
        assert!(decision.blocked_providers.contains(&EngineKind::CopilotCli));
    }

    #[test]
    fn test_routing_rule_matches_complexity() {
        let policy = ByomPolicy {
            enabled: true,
            routing_rules: vec![
                RoutingRule {
                    name: "Use Haiku for simple".into(),
                    task_complexity: TaskComplexity::Simple,
                    provider: "claude_code".into(),
                    model: Some("claude-haiku-4-5-20251001".into()),
                    enabled: true,
                },
                RoutingRule {
                    name: "Use Opus for critical".into(),
                    task_complexity: TaskComplexity::Critical,
                    provider: "claude_code".into(),
                    model: Some("claude-opus-4-20250514".into()),
                    enabled: true,
                },
            ],
            ..Default::default()
        };
        let decision = policy.evaluate(&[], Some(TaskComplexity::Simple));
        assert_eq!(decision.preferred_provider, Some(EngineKind::ClaudeCode));
        assert_eq!(decision.preferred_model.as_deref(), Some("claude-haiku-4-5-20251001"));
        assert_eq!(decision.routing_rule_name.as_deref(), Some("Use Haiku for simple"));
    }

    #[test]
    fn test_compliance_rule_restricts_providers() {
        let policy = ByomPolicy {
            enabled: true,
            compliance_rules: vec![ComplianceRule {
                name: "HIPAA".into(),
                workflow_tags: vec!["hipaa".into(), "healthcare".into()],
                allowed_providers: vec!["claude_code".into()],
                enabled: true,
            }],
            ..Default::default()
        };
        let decision = policy.evaluate(&["hipaa-workflow".into()], None);
        assert!(!decision.blocked_providers.contains(&EngineKind::ClaudeCode));
        assert!(decision.blocked_providers.contains(&EngineKind::GeminiCli));
        assert_eq!(decision.compliance_rule_name.as_deref(), Some("HIPAA"));
    }
}
