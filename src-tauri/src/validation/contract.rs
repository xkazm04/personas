use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppError;

/// A single field-level validation error with machine-readable identifiers
/// and a human-friendly message. Exported to the frontend via ts-rs so
/// client-side validation can produce identical error shapes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    /// The field that failed validation (e.g. "name", "timeout_ms").
    pub field: String,
    /// Machine-readable rule identifier (e.g. "required", "max_length", "range").
    pub rule: String,
    /// User-facing error message.
    pub message: String,
}

impl ValidationError {
    pub fn new(field: impl Into<String>, rule: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            rule: rule.into(),
            message: message.into(),
        }
    }
}

/// Collect multiple validation errors and convert to `AppError::Validation`
/// with a combined message. Returns `Ok(())` if the list is empty.
pub fn check(errors: Vec<ValidationError>) -> Result<(), AppError> {
    if errors.is_empty() {
        return Ok(());
    }
    if errors.len() == 1 {
        return Err(AppError::Validation(errors[0].message.clone()));
    }
    let combined = errors
        .iter()
        .map(|e| format!("{}: {}", e.field, e.message))
        .collect::<Vec<_>>()
        .join("; ");
    Err(AppError::Validation(combined))
}

/// Describes a single validation rule in the catalog — exported so the
/// frontend can build matching client-side checks.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ValidationRule {
    /// Domain this rule belongs to (e.g. "persona", "trigger", "memory").
    pub domain: String,
    /// The field this rule applies to.
    pub field: String,
    /// Machine-readable rule identifier.
    pub rule: String,
    /// Human-readable description of the constraint.
    pub description: String,
    /// Optional minimum value (for numeric range rules).
    pub min: Option<f64>,
    /// Optional maximum value (for numeric range rules).
    pub max: Option<f64>,
    /// Optional list of allowed values (for enum/whitelist rules).
    #[ts(optional)]
    pub allowed_values: Option<Vec<String>>,
}

impl ValidationRule {
    pub fn new(
        domain: impl Into<String>,
        field: impl Into<String>,
        rule: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            domain: domain.into(),
            field: field.into(),
            rule: rule.into(),
            description: description.into(),
            min: None,
            max: None,
            allowed_values: None,
        }
    }

    pub fn with_range(mut self, min: f64, max: f64) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self
    }

    pub fn with_max(mut self, max: f64) -> Self {
        self.max = Some(max);
        self
    }

    pub fn with_min(mut self, min: f64) -> Self {
        self.min = Some(min);
        self
    }

    pub fn with_allowed(mut self, values: Vec<String>) -> Self {
        self.allowed_values = Some(values);
        self
    }
}

/// Returns the complete validation rule catalog across all domains.
pub fn all_rules() -> Vec<ValidationRule> {
    let mut rules = Vec::new();
    rules.extend(super::chat::rules());
    rules.extend(super::persona::rules());
    rules.extend(super::trigger::rules());
    rules.extend(super::memory::rules());
    rules
}
