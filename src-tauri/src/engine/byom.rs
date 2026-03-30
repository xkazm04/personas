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

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::provider::EngineKind;

/// Settings key for the BYOM policy JSON.
pub const BYOM_POLICY_KEY: &str = "byom_policy";

// =============================================================================
// Policy validation types
// =============================================================================

/// Severity level for a policy validation warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum PolicyWarningSeverity {
    /// Critical misconfiguration that will be blocked from saving.
    Error,
    /// Non-critical issue shown as a dismissible alert.
    Warning,
    /// Informational note shown as a tooltip.
    Info,
}

/// A structured policy validation warning with severity.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PolicyWarning {
    /// Severity of this warning.
    pub severity: PolicyWarningSeverity,
    /// Human-readable message describing the issue.
    pub message: String,
}

// =============================================================================
// Policy types
// =============================================================================

/// Top-level BYOM policy configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export)]
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoutingRule {
    /// Human-readable name for this rule.
    pub name: String,
    /// Task complexity level that triggers this rule.
    pub task_complexity: TaskComplexity,
    /// Provider to route to (as engine kind string: "claude_code", "codex_cli", etc.).
    pub provider: String,
    /// Optional model override (e.g., "claude-haiku-4-5-20251001").
    pub model: Option<String>,
    /// Whether this rule is active.
    pub enabled: bool,
}

/// Task complexity levels for cost-optimized routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum TaskComplexity {
    /// Simple tasks: formatting, linting, small edits.
    Simple,
    /// Standard tasks: feature implementation, refactoring.
    Standard,
    /// Critical tasks: architecture changes, security-sensitive work.
    Critical,
}

impl TaskComplexity {
    /// The default complexity used when callers do not specify one.
    ///
    /// `Standard` is chosen because it represents the middle tier — safe for
    /// cost routing (not as cheap as Simple, not as expensive as Critical) and
    /// appropriate for the majority of unclassified tasks.
    pub const DEFAULT: Self = Self::Standard;
}

/// A compliance rule that restricts providers for specific workflow tags.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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
    ///
    /// Returns `Ok(None)` when no policy row exists. Returns `Err` when the row
    /// exists but the JSON is malformed or schema-incompatible — callers **must
    /// not** silently downgrade to open-access on parse failure.
    pub fn load(pool: &crate::db::DbPool) -> Result<Option<Self>, crate::error::AppError> {
        let json = match crate::db::repos::core::settings::get(pool, BYOM_POLICY_KEY)? {
            Some(v) => v,
            None => return Ok(None),
        };
        let policy: Self = serde_json::from_str(&json).map_err(|e| {
            tracing::error!(
                key = BYOM_POLICY_KEY,
                error = %e,
                "BYOM policy JSON is corrupt — refusing to fall back to open-access"
            );
            crate::error::AppError::Validation(format!(
                "BYOM policy is corrupt and cannot be loaded. \
                 Reset the policy or fix the stored JSON. Parse error: {e}"
            ))
        })?;
        Ok(Some(policy))
    }

    /// Save the BYOM policy to the settings DB.
    ///
    /// Runs validation before saving. Error-level warnings block the save.
    /// Warning and Info level issues are logged but do not prevent saving.
    pub fn save(&self, pool: &crate::db::DbPool) -> Result<(), crate::error::AppError> {
        let warnings = self.validate();
        let mut error_messages = Vec::new();
        for w in &warnings {
            match w.severity {
                PolicyWarningSeverity::Error => {
                    tracing::error!(warning = %w.message, "BYOM policy validation error");
                    error_messages.push(w.message.clone());
                }
                PolicyWarningSeverity::Warning => {
                    tracing::warn!(warning = %w.message, "BYOM policy validation warning");
                }
                PolicyWarningSeverity::Info => {
                    tracing::info!(warning = %w.message, "BYOM policy validation info");
                }
            }
        }
        if !error_messages.is_empty() {
            return Err(crate::error::AppError::Validation(
                format!("Policy has blocking errors: {}", error_messages.join("; ")),
            ));
        }
        let json = serde_json::to_string(self)
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to serialize BYOM policy: {}", e)))?;
        crate::db::repos::core::settings::set(pool, BYOM_POLICY_KEY, &json)
    }

    /// Validate policy consistency and return structured warnings with severity.
    ///
    /// **Severity assignment:**
    /// - `Error`: Provider is explicitly blocked — contradictory config that will never work.
    /// - `Warning`: Provider is not in the allowed list — the rule has no effect currently.
    /// - `Info`: References an unknown provider — may be a typo or future provider.
    ///
    /// **Precedence rule**: `allowed_providers` is the ceiling — compliance rules
    /// can only *narrow* within it, never expand beyond it. If a compliance rule
    /// references a provider not in the top-level `allowed_providers`, that
    /// provider will be silently blocked and the compliance rule has no effect
    /// for it.
    ///
    /// Similarly, routing rules that target a blocked/non-allowed provider will
    /// never take effect.
    pub fn validate(&self) -> Vec<PolicyWarning> {
        let mut warnings = Vec::new();
        if !self.enabled {
            return warnings;
        }

        let mut allowed_set: HashSet<EngineKind> = HashSet::new();
        for s in &self.allowed_providers {
            match s.parse::<EngineKind>() {
                Ok(kind) => { allowed_set.insert(kind); }
                Err(_) => warnings.push(PolicyWarning {
                    severity: PolicyWarningSeverity::Info,
                    message: format!(
                        "Top-level allowed_providers contains unknown provider '{}' — \
                         it will be ignored (check for typos)",
                        s,
                    ),
                }),
            }
        }

        let mut blocked_set: HashSet<EngineKind> = HashSet::new();
        for s in &self.blocked_providers {
            match s.parse::<EngineKind>() {
                Ok(kind) => { blocked_set.insert(kind); }
                Err(_) => warnings.push(PolicyWarning {
                    severity: PolicyWarningSeverity::Info,
                    message: format!(
                        "Top-level blocked_providers contains unknown provider '{}' — \
                         it will be ignored (check for typos)",
                        s,
                    ),
                }),
            }
        }

        // Check compliance rules
        for rule in &self.compliance_rules {
            if !rule.enabled {
                continue;
            }
            for provider_str in &rule.allowed_providers {
                if let Some(kind) = provider_str.parse().ok() {
                    if blocked_set.contains(&kind) {
                        warnings.push(PolicyWarning {
                            severity: PolicyWarningSeverity::Error,
                            message: format!(
                                "Compliance rule '{}' allows provider '{}' which is explicitly blocked — \
                                 the block takes precedence and this provider will never be available",
                                rule.name, provider_str,
                            ),
                        });
                    } else if !allowed_set.is_empty() && !allowed_set.contains(&kind) {
                        warnings.push(PolicyWarning {
                            severity: PolicyWarningSeverity::Warning,
                            message: format!(
                                "Compliance rule '{}' allows provider '{}' which is not in the top-level \
                                 allowed_providers list — this provider will be blocked regardless",
                                rule.name, provider_str,
                            ),
                        });
                    }
                } else {
                    warnings.push(PolicyWarning {
                        severity: PolicyWarningSeverity::Info,
                        message: format!(
                            "Compliance rule '{}' references unknown provider '{}'",
                            rule.name, provider_str,
                        ),
                    });
                }
            }
        }

        // Check routing rules
        for rule in &self.routing_rules {
            if !rule.enabled {
                continue;
            }
            if let Some(kind) = rule.provider.parse().ok() {
                if blocked_set.contains(&kind) {
                    warnings.push(PolicyWarning {
                        severity: PolicyWarningSeverity::Error,
                        message: format!(
                            "Routing rule '{}' targets provider '{}' which is explicitly blocked",
                            rule.name, rule.provider,
                        ),
                    });
                } else if !allowed_set.is_empty() && !allowed_set.contains(&kind) {
                    warnings.push(PolicyWarning {
                        severity: PolicyWarningSeverity::Warning,
                        message: format!(
                            "Routing rule '{}' targets provider '{}' which is not in the top-level \
                             allowed_providers list",
                            rule.name, rule.provider,
                        ),
                    });
                }
            } else {
                warnings.push(PolicyWarning {
                    severity: PolicyWarningSeverity::Info,
                    message: format!(
                        "Routing rule '{}' references unknown provider '{}'",
                        rule.name, rule.provider,
                    ),
                });
            }
        }

        warnings
    }

    /// Returns true if the policy has any Error-level validation warnings.
    pub fn has_blocking_errors(&self) -> bool {
        self.validate().iter().any(|w| w.severity == PolicyWarningSeverity::Error)
    }

    /// Evaluate the policy for a given execution context.
    ///
    /// **Precedence** (applied in order, each layer can only narrow, never expand):
    /// 1. `blocked_providers` — always blocked, highest priority.
    /// 2. `allowed_providers` — the ceiling; everything not listed is blocked.
    /// 3. `compliance_rules` — further restrict within the allowed set.
    /// 4. `routing_rules` — select a preferred provider/model (must still be allowed).
    ///
    /// - `persona_tags`: tags/categories associated with the persona (for compliance matching).
    /// - `complexity`: the task complexity level (for cost routing). When `None`, defaults
    ///   to [`TaskComplexity::DEFAULT`] (`Standard`) so that routing rules still apply.
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
        let mut blocked: HashSet<EngineKind> = self
            .blocked_providers
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect();

        // 2. If allowed_providers is non-empty, block everything not in the allowed list
        if !self.allowed_providers.is_empty() {
            let allowed_set: HashSet<EngineKind> = self
                .allowed_providers
                .iter()
                .filter_map(|s| s.parse().ok())
                .collect();
            for kind in EngineKind::ALL {
                if !allowed_set.contains(&kind) {
                    blocked.insert(kind);
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
                    .any(|wt| tag.eq_ignore_ascii_case(wt))
            });
            if matches {
                // This compliance rule applies: only its allowed providers are permitted
                let compliance_allowed: HashSet<EngineKind> = rule
                    .allowed_providers
                    .iter()
                    .filter_map(|s| s.parse().ok())
                    .collect();
                for kind in EngineKind::ALL {
                    if !compliance_allowed.contains(&kind) {
                        blocked.insert(kind);
                    }
                }
                compliance_rule_name = Some(rule.name.clone());
                break; // first match wins
            }
        }

        // 4. Evaluate routing rules (first matching complexity wins).
        //    When no complexity is provided, default to Standard so that
        //    routing rules still apply rather than silently producing no match.
        let effective_complexity = complexity.unwrap_or(TaskComplexity::DEFAULT);
        let mut preferred_provider = None;
        let mut preferred_model = None;
        let mut routing_rule_name = None;
        for rule in &self.routing_rules {
            if !rule.enabled {
                continue;
            }
            if rule.task_complexity == effective_complexity {
                preferred_provider = rule.provider.parse().ok();
                preferred_model = rule.model.clone();
                routing_rule_name = Some(rule.name.clone());
                break;
            }
        }

        PolicyDecision {
            preferred_provider,
            preferred_model,
            blocked_providers: blocked.into_iter().collect(),
            routing_rule_name,
            compliance_rule_name,
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================


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
            blocked_providers: vec!["codex_cli".into()],
            ..Default::default()
        };
        let decision = policy.evaluate(&[], None);
        assert!(decision.blocked_providers.is_empty());
    }

    #[test]
    fn test_blocked_providers() {
        let policy = ByomPolicy {
            enabled: true,
            blocked_providers: vec!["codex_cli".into()],
            ..Default::default()
        };
        let decision = policy.evaluate(&[], None);
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
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
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
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
        let decision = policy.evaluate(&["hipaa".into()], None);
        assert!(!decision.blocked_providers.contains(&EngineKind::ClaudeCode));
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
        assert_eq!(decision.compliance_rule_name.as_deref(), Some("HIPAA"));
    }

    #[test]
    fn test_compliance_rule_case_insensitive_exact_match() {
        let policy = ByomPolicy {
            enabled: true,
            compliance_rules: vec![ComplianceRule {
                name: "HIPAA".into(),
                workflow_tags: vec!["hipaa".into()],
                allowed_providers: vec!["claude_code".into()],
                enabled: true,
            }],
            ..Default::default()
        };

        // Exact match with different casing should match
        let decision = policy.evaluate(&["HIPAA".into()], None);
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
        assert_eq!(decision.compliance_rule_name.as_deref(), Some("HIPAA"));

        let decision = policy.evaluate(&["Hipaa".into()], None);
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
        assert_eq!(decision.compliance_rule_name.as_deref(), Some("HIPAA"));
    }

    #[test]
    fn test_compliance_rule_rejects_substring_false_positives() {
        let policy = ByomPolicy {
            enabled: true,
            compliance_rules: vec![ComplianceRule {
                name: "HIPAA".into(),
                workflow_tags: vec!["hipaa".into()],
                allowed_providers: vec!["claude_code".into()],
                enabled: true,
            }],
            ..Default::default()
        };

        // Substring matches must NOT trigger the rule
        let decision = policy.evaluate(&["hipaa-workflows".into()], None);
        assert!(decision.blocked_providers.is_empty());
        assert!(decision.compliance_rule_name.is_none());

        let decision = policy.evaluate(&["non-hipaa".into()], None);
        assert!(decision.blocked_providers.is_empty());
        assert!(decision.compliance_rule_name.is_none());
    }

    #[test]
    fn test_compliance_rule_rejects_generic_substring() {
        let policy = ByomPolicy {
            enabled: true,
            compliance_rules: vec![ComplianceRule {
                name: "Test restriction".into(),
                workflow_tags: vec!["test".into()],
                allowed_providers: vec!["claude_code".into()],
                enabled: true,
            }],
            ..Default::default()
        };

        // "test" should NOT match "attest" or "internal-testing"
        let decision = policy.evaluate(&["attest".into()], None);
        assert!(decision.blocked_providers.is_empty());
        assert!(decision.compliance_rule_name.is_none());

        let decision = policy.evaluate(&["internal-testing".into()], None);
        assert!(decision.blocked_providers.is_empty());
        assert!(decision.compliance_rule_name.is_none());

        // But exact "test" should match
        let decision = policy.evaluate(&["test".into()], None);
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
        assert_eq!(decision.compliance_rule_name.as_deref(), Some("Test restriction"));
    }

    #[test]
    fn test_validate_compliance_rule_outside_allowed() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude_code".into()],
            compliance_rules: vec![ComplianceRule {
                name: "HIPAA".into(),
                workflow_tags: vec!["hipaa".into()],
                // Codex is NOT in allowed_providers
                allowed_providers: vec!["claude_code".into(), "codex_cli".into()],
                enabled: true,
            }],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].severity, PolicyWarningSeverity::Warning);
        assert!(warnings[0].message.contains("HIPAA"));
        assert!(warnings[0].message.contains("codex_cli"));
        assert!(warnings[0].message.contains("not in the top-level"));
    }

    #[test]
    fn test_validate_compliance_rule_blocked_provider() {
        let policy = ByomPolicy {
            enabled: true,
            blocked_providers: vec!["codex_cli".into()],
            compliance_rules: vec![ComplianceRule {
                name: "DataSov".into(),
                workflow_tags: vec!["eu".into()],
                allowed_providers: vec!["codex_cli".into()],
                enabled: true,
            }],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].severity, PolicyWarningSeverity::Error);
        assert!(warnings[0].message.contains("explicitly blocked"));
    }

    #[test]
    fn test_validate_routing_rule_outside_allowed() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude_code".into()],
            routing_rules: vec![RoutingRule {
                name: "Cheap simple".into(),
                task_complexity: TaskComplexity::Simple,
                provider: "codex_cli".into(),
                model: None,
                enabled: true,
            }],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].severity, PolicyWarningSeverity::Warning);
        assert!(warnings[0].message.contains("Routing rule"));
        assert!(warnings[0].message.contains("codex_cli"));
    }

    #[test]
    fn test_validate_routing_rule_blocked_provider_is_error() {
        let policy = ByomPolicy {
            enabled: true,
            blocked_providers: vec!["codex_cli".into()],
            routing_rules: vec![RoutingRule {
                name: "Blocked route".into(),
                task_complexity: TaskComplexity::Simple,
                provider: "codex_cli".into(),
                model: None,
                enabled: true,
            }],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].severity, PolicyWarningSeverity::Error);
        assert!(warnings[0].message.contains("explicitly blocked"));
    }

    #[test]
    fn test_validate_unknown_provider_is_info() {
        let policy = ByomPolicy {
            enabled: true,
            routing_rules: vec![RoutingRule {
                name: "Unknown route".into(),
                task_complexity: TaskComplexity::Simple,
                provider: "nonexistent_provider".into(),
                model: None,
                enabled: true,
            }],
            compliance_rules: vec![ComplianceRule {
                name: "Unknown compliance".into(),
                workflow_tags: vec!["test".into()],
                allowed_providers: vec!["also_unknown".into()],
                enabled: true,
            }],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 2);
        assert!(warnings.iter().all(|w| w.severity == PolicyWarningSeverity::Info));
    }

    #[test]
    fn test_validate_clean_policy_no_warnings() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude_code".into(), "codex_cli".into()],
            compliance_rules: vec![ComplianceRule {
                name: "HIPAA".into(),
                workflow_tags: vec!["hipaa".into()],
                allowed_providers: vec!["claude_code".into()],
                enabled: true,
            }],
            routing_rules: vec![RoutingRule {
                name: "Use Claude for critical".into(),
                task_complexity: TaskComplexity::Critical,
                provider: "claude_code".into(),
                model: None,
                enabled: true,
            }],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_has_blocking_errors() {
        let policy = ByomPolicy {
            enabled: true,
            blocked_providers: vec!["codex_cli".into()],
            compliance_rules: vec![ComplianceRule {
                name: "Bad".into(),
                workflow_tags: vec!["test".into()],
                allowed_providers: vec!["codex_cli".into()],
                enabled: true,
            }],
            ..Default::default()
        };
        assert!(policy.has_blocking_errors());

        let clean_policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude_code".into()],
            ..Default::default()
        };
        assert!(!clean_policy.has_blocking_errors());
    }

    // =========================================================================
    // None-complexity edge cases
    // =========================================================================

    #[test]
    fn test_none_complexity_defaults_to_standard() {
        let policy = ByomPolicy {
            enabled: true,
            routing_rules: vec![
                RoutingRule {
                    name: "Haiku for simple".into(),
                    task_complexity: TaskComplexity::Simple,
                    provider: "claude_code".into(),
                    model: Some("claude-haiku-4-5-20251001".into()),
                    enabled: true,
                },
                RoutingRule {
                    name: "Sonnet for standard".into(),
                    task_complexity: TaskComplexity::Standard,
                    provider: "claude_code".into(),
                    model: Some("claude-sonnet-4-20250514".into()),
                    enabled: true,
                },
                RoutingRule {
                    name: "Opus for critical".into(),
                    task_complexity: TaskComplexity::Critical,
                    provider: "claude_code".into(),
                    model: Some("claude-opus-4-20250514".into()),
                    enabled: true,
                },
            ],
            ..Default::default()
        };
        // None complexity should match the Standard rule
        let decision = policy.evaluate(&[], None);
        assert_eq!(decision.preferred_provider, Some(EngineKind::ClaudeCode));
        assert_eq!(decision.preferred_model.as_deref(), Some("claude-sonnet-4-20250514"));
        assert_eq!(decision.routing_rule_name.as_deref(), Some("Sonnet for standard"));
    }

    #[test]
    fn test_none_complexity_no_standard_rule_returns_no_preferred() {
        let policy = ByomPolicy {
            enabled: true,
            routing_rules: vec![
                RoutingRule {
                    name: "Haiku for simple".into(),
                    task_complexity: TaskComplexity::Simple,
                    provider: "claude_code".into(),
                    model: Some("claude-haiku-4-5-20251001".into()),
                    enabled: true,
                },
                RoutingRule {
                    name: "Opus for critical".into(),
                    task_complexity: TaskComplexity::Critical,
                    provider: "claude_code".into(),
                    model: Some("claude-opus-4-20250514".into()),
                    enabled: true,
                },
            ],
            ..Default::default()
        };
        // No Standard rule exists — preferred_provider should be None
        let decision = policy.evaluate(&[], None);
        assert!(decision.preferred_provider.is_none());
        assert!(decision.preferred_model.is_none());
        assert!(decision.routing_rule_name.is_none());
    }

    #[test]
    fn test_none_complexity_with_no_routing_rules() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude_code".into()],
            ..Default::default()
        };
        // No routing rules at all — should still produce a valid decision
        let decision = policy.evaluate(&[], None);
        assert!(decision.preferred_provider.is_none());
        assert!(decision.blocked_providers.contains(&EngineKind::CodexCli));
    }

    #[test]
    fn test_none_complexity_same_as_explicit_standard() {
        let policy = ByomPolicy {
            enabled: true,
            routing_rules: vec![RoutingRule {
                name: "Standard route".into(),
                task_complexity: TaskComplexity::Standard,
                provider: "codex_cli".into(),
                model: None,
                enabled: true,
            }],
            ..Default::default()
        };
        let none_decision = policy.evaluate(&[], None);
        let explicit_decision = policy.evaluate(&[], Some(TaskComplexity::Standard));
        assert_eq!(none_decision.preferred_provider, explicit_decision.preferred_provider);
        assert_eq!(none_decision.preferred_model, explicit_decision.preferred_model);
        assert_eq!(none_decision.routing_rule_name, explicit_decision.routing_rule_name);
    }

    #[test]
    fn test_default_complexity_constant_is_standard() {
        assert_eq!(TaskComplexity::DEFAULT, TaskComplexity::Standard);
    }

    #[test]
    fn test_validate_unknown_top_level_allowed_provider_warns() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["claude-code".into(), "claude_code".into()],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].severity, PolicyWarningSeverity::Info);
        assert!(warnings[0].message.contains("allowed_providers"));
        assert!(warnings[0].message.contains("claude-code"));
    }

    #[test]
    fn test_validate_unknown_top_level_blocked_provider_warns() {
        let policy = ByomPolicy {
            enabled: true,
            blocked_providers: vec!["cladue_code".into()],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].severity, PolicyWarningSeverity::Info);
        assert!(warnings[0].message.contains("blocked_providers"));
        assert!(warnings[0].message.contains("cladue_code"));
    }

    #[test]
    fn test_validate_all_unknown_allowed_providers_warns_for_each() {
        let policy = ByomPolicy {
            enabled: true,
            allowed_providers: vec!["bad1".into(), "bad2".into()],
            ..Default::default()
        };
        let warnings = policy.validate();
        assert_eq!(warnings.len(), 2);
        assert!(warnings.iter().all(|w| w.severity == PolicyWarningSeverity::Info));
        assert!(warnings[0].message.contains("bad1"));
        assert!(warnings[1].message.contains("bad2"));
    }
}
