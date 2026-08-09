//! Recipe parameter coverage — make the derivation gap honest.
//!
//! Adopting a capability derives the persona's editable knobs from the recipe's
//! `input_schema` (`engine::recipe_parameters`). Types with no persona
//! ParamType mapping (`source_definition`, `connector_ref`, `list[string]`) are
//! deliberately skipped rather than mis-typed — but until this command existed
//! the only trace of the skip was a `tracing::debug!` line. A recipe author
//! declared a knob that never became editable and nobody was told; a user went
//! looking for a setting the catalog promised and simply did not find it.
//!
//! This is a pure read: given a recipe id, report how many settings it declares,
//! how many become editable parameters on adoption, and exactly which ones do
//! not (with the declared type that caused the drop). The catalog adoption flow
//! calls it right after a successful adopt and turns a non-empty `skipped` into
//! a user-visible notice.
//!
//! Deliberately NOT a fix for the missing types — only for the silence.
//!
//! Source of truth: `engine::recipe_parameters::params_from_schema`. The
//! supported-type list is never mirrored in TypeScript, so it cannot drift.

use std::sync::Arc;

use tauri::State;

use crate::db::repos::resources::recipes as recipe_repo;
use crate::engine::recipe_parameters as rp;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// One `input_schema` field that will NOT become an editable persona parameter.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct SkippedParameterField {
    /// The field's `name` in the recipe's `input_schema`.
    pub key: String,
    /// Human label, matching what the parameters editor would have shown.
    pub label: String,
    /// The declared `type` token that has no persona ParamType mapping.
    pub declared_type: String,
}

/// How completely a recipe's declared settings survive adoption.
///
/// `declared == derived` means every promised knob exists. Any `skipped` entry
/// is a setting the recipe advertises that the persona will not expose.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct RecipeParameterCoverage {
    pub recipe_id: String,
    /// Total named `input_schema` fields, deduped by key.
    pub declared: u32,
    /// How many of those become editable persona parameters.
    pub derived: u32,
    /// The dropped ones, in declaration order.
    pub skipped: Vec<SkippedParameterField>,
}

/// Compute coverage from a recipe's stored `prompt_template` JSON. Pure — no
/// DB, no state — so the mapping is unit-testable without a Tauri harness.
///
/// A `prompt_template` that is not JSON, or carries no `input_schema` array,
/// yields an all-zero report: the recipe declares no settings, so nothing can
/// be missing. That is the honest answer, not an error.
pub fn coverage_from_prompt_template(
    recipe_id: &str,
    prompt_template: &str,
) -> RecipeParameterCoverage {
    let schema: Vec<serde_json::Value> = serde_json::from_str::<serde_json::Value>(prompt_template)
        .ok()
        .and_then(|tpl| tpl.get("input_schema").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();

    let (params, skipped) = rp::params_from_schema(&schema);
    let caps = vec![rp::CapabilityParams {
        capability_title: String::new(),
        params,
        skipped,
    }];
    let (declared, derived, skipped) = rp::coverage(&caps);

    RecipeParameterCoverage {
        recipe_id: recipe_id.to_string(),
        declared: declared as u32,
        derived: derived as u32,
        skipped: skipped
            .into_iter()
            .map(|s| SkippedParameterField {
                key: s.key,
                label: s.label,
                declared_type: s.declared_type,
            })
            .collect(),
    }
}

/// Report which of a recipe's declared settings become editable persona
/// parameters on adoption, and which are dropped as unsupported types.
#[tauri::command]
pub async fn get_recipe_parameter_coverage(
    state: State<'_, Arc<AppState>>,
    recipe_id: String,
) -> Result<RecipeParameterCoverage, AppError> {
    require_auth(&state).await?;
    if recipe_id.trim().is_empty() {
        return Err(AppError::Validation("recipe_id cannot be empty".into()));
    }
    let recipe = recipe_repo::get_by_id(&state.db, &recipe_id)?;
    Ok(coverage_from_prompt_template(
        &recipe.id,
        &recipe.prompt_template,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_mixed_supported_and_unsupported_schema() {
        let tpl = serde_json::json!({
            "instructions": "do a thing",
            "input_schema": [
                {"name": "timeout_hours", "type": "number", "default": 48},
                {"name": "risk", "type": "enum", "options": ["low", "high"]},
                {"name": "sources", "type": "source_definition"},
                {"name": "repo", "type": "connector_ref", "connector": "codebase"},
                {"name": "watch_paths", "type": "list[string]"}
            ]
        })
        .to_string();

        let cov = coverage_from_prompt_template("r1", &tpl);
        assert_eq!(cov.recipe_id, "r1");
        assert_eq!((cov.declared, cov.derived), (5, 2));
        let dropped: Vec<_> = cov
            .skipped
            .iter()
            .map(|s| (s.key.as_str(), s.declared_type.as_str()))
            .collect();
        assert_eq!(
            dropped,
            vec![
                ("sources", "source_definition"),
                ("repo", "connector_ref"),
                ("watch_paths", "list[string]"),
            ]
        );
        assert_eq!(cov.skipped[0].label, "Sources");
    }

    #[test]
    fn fully_supported_schema_reports_no_gap() {
        let tpl = serde_json::json!({
            "input_schema": [
                {"name": "a", "type": "number"},
                {"name": "b", "type": "boolean"}
            ]
        })
        .to_string();
        let cov = coverage_from_prompt_template("r2", &tpl);
        assert_eq!((cov.declared, cov.derived), (2, 2));
        assert!(cov.skipped.is_empty());
    }

    #[test]
    fn missing_or_unparseable_schema_is_all_zero_not_an_error() {
        for tpl in ["not json at all", "{}", r#"{"input_schema": "nope"}"#] {
            let cov = coverage_from_prompt_template("r3", tpl);
            assert_eq!((cov.declared, cov.derived), (0, 0), "for {tpl}");
            assert!(cov.skipped.is_empty(), "for {tpl}");
        }
    }
}
