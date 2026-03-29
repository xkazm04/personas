//! Configurable quality-gate patterns for dispatch filtering.
//!
//! Extracts the hardcoded string patterns from `dispatch.rs` into a
//! serialisable `QualityGateConfig` that can be persisted in `app_settings`
//! and exposed in the Settings UI.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What happens when a quality-gate pattern matches.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FilterAction {
    /// Silently discard the item.
    Reject,
    /// Accept the item but tag it for later review.
    Tag,
    /// Accept the item and emit a warning log.
    Warn,
}

/// A single filter rule: a substring pattern with optional case-sensitivity
/// and an action to take when matched.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct QualityGateRule {
    /// Human-readable label for this rule.
    pub label: String,
    /// Substring pattern to match against combined title+content.
    pub pattern: String,
    /// Whether the match is case-sensitive. Default: false (case-insensitive).
    #[serde(default)]
    pub case_sensitive: bool,
    /// Action when the pattern matches.
    pub action: FilterAction,
}

/// Top-level quality-gate configuration for both memory and review filters.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct QualityGateConfig {
    /// Rules applied to AgentMemory submissions.
    pub memory_rules: Vec<QualityGateRule>,
    /// Category values that cause AgentMemory rejection (lowercase match).
    pub memory_reject_categories: Vec<String>,
    /// Rules applied to ManualReview submissions.
    pub review_rules: Vec<QualityGateRule>,
}

impl Default for QualityGateConfig {
    fn default() -> Self {
        Self {
            memory_reject_categories: vec![
                "error".to_string(),
                "failure".to_string(),
            ],
            memory_rules: vec![
                // Stack traces and raw dumps
                rule("Stack traces", "traceback"),
                rule("Stack trace keyword", "stack trace"),
                rule("Execution blocked", "execution blocked"),
                // Credential leak patterns
                rule("API key leak", "api_key="),
                rule("Access token leak", "access_token="),
                // Auth failure patterns
                rule("No credentials", "no credentials"),
                rule("Credentials missing", "credentials missing"),
                rule("No API credentials", "no api credentials"),
                rule("Credential not found", "credential not found"),
                rule("Not configured in env", "not configured in the environment"),
                rule("Unable to authenticate", "unable to authenticate"),
                rule("Authentication failed", "authentication failed"),
            ],
            review_rules: vec![
                // Operational / infrastructure errors
                rule("Execution blocked", "execution blocked"),
                rule("Credential missing", "credential missing"),
                rule("Missing credentials", "missing credentials"),
                rule("API error", "api error"),
                rule("API key reference", "api_key"),
                rule("Configuration required", "configuration required"),
                rule("Not configured", "not configured"),
                rule("Unable to connect", "unable to connect"),
                rule("Access token reference", "access_token"),
                // Data unavailability
                rule("No pages shared", "no pages shared"),
                rule("No page access", "no page access"),
                rule("Cannot proceed", "cannot proceed"),
                rule("Audit cannot", "audit cannot"),
                rule("Cannot be performed", "cannot be performed"),
                rule("Audit blocked", "audit blocked"),
                rule("No data available", "no data available"),
                rule("No results found", "no results found"),
                rule("Workspace is empty", "workspace is empty"),
                rule("Has no resources", "has no"),
                rule("Not shared with", "not shared with"),
                rule("Integration has no", "integration has no"),
            ],
        }
    }
}

/// Helper to create a default reject rule (case-insensitive).
fn rule(label: &str, pattern: &str) -> QualityGateRule {
    QualityGateRule {
        label: label.to_string(),
        pattern: pattern.to_string(),
        case_sensitive: false,
        action: FilterAction::Reject,
    }
}

impl QualityGateConfig {
    /// Check whether the combined text matches any of the given rules.
    /// Returns the first matching rule label, or None.
    pub fn check_rules(rules: &[QualityGateRule], combined: &str) -> Option<(String, &FilterAction)> {
        for r in rules {
            let haystack: String;
            let needle: String;
            if r.case_sensitive {
                haystack = combined.to_string();
                needle = r.pattern.clone();
            } else {
                haystack = combined.to_lowercase();
                needle = r.pattern.to_lowercase();
            }
            if haystack.contains(&needle) {
                return Some((r.label.clone(), &r.action));
            }
        }
        None
    }
}

/// Load quality-gate config from DB, falling back to defaults.
pub fn load(pool: &crate::db::DbPool) -> QualityGateConfig {
    use crate::db::repos::core::settings;
    use crate::db::settings_keys::QUALITY_GATE_CONFIG;

    match settings::get(pool, QUALITY_GATE_CONFIG) {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => QualityGateConfig::default(),
    }
}

/// Save quality-gate config to DB.
pub fn save(pool: &crate::db::DbPool, config: &QualityGateConfig) -> Result<(), crate::error::AppError> {
    use crate::db::repos::core::settings;
    use crate::db::settings_keys::QUALITY_GATE_CONFIG;

    let json = serde_json::to_string(config)
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    settings::set(pool, QUALITY_GATE_CONFIG, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_expected_rules() {
        let cfg = QualityGateConfig::default();
        assert!(!cfg.memory_rules.is_empty());
        assert!(!cfg.review_rules.is_empty());
        assert!(cfg.memory_reject_categories.contains(&"error".to_string()));
    }

    #[test]
    fn check_rules_matches_case_insensitive() {
        let rules = vec![rule("test", "stack trace")];
        let result = QualityGateConfig::check_rules(&rules, "Found a STACK TRACE in output");
        assert!(result.is_some());
        assert_eq!(result.unwrap().0, "test");
    }

    #[test]
    fn check_rules_no_match() {
        let rules = vec![rule("test", "stack trace")];
        let result = QualityGateConfig::check_rules(&rules, "everything is fine");
        assert!(result.is_none());
    }

    #[test]
    fn roundtrip_serde() {
        let cfg = QualityGateConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: QualityGateConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg.memory_rules.len(), parsed.memory_rules.len());
        assert_eq!(cfg.review_rules.len(), parsed.review_rules.len());
    }
}
