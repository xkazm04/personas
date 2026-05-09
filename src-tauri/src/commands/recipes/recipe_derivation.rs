//! Stage B Phase 1b — derive recipes from a template's `payload.use_cases[]`.
//!
//! Given a template ID and its raw `payload` JSON, walk every use case and
//! either create a new recipe (with provenance pointing back to
//! `(template_id, use_case_id)`), update an existing derived recipe whose
//! content drifted, or report no-op when content is unchanged. The
//! `(source_template_id, source_use_case_id)` pair has a partial unique
//! index, so re-running this command is idempotent.
//!
//! See `docs/concepts/recipe-from-template-migration.md` for the design
//! and stable-key justification.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::db::models::{
    CreateRecipeInput, DeriveAction, DeriveResult, RecipeDefinition, UpdateRecipeInput,
};
use crate::db::repos::resources::recipes as recipe_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Bump a semver-shaped string by incrementing the last numeric segment.
/// "1.0.0" → "1.0.1", "2.4.9" → "2.4.10". Falls back to "1.0.0" for
/// unparseable input. Recipes derived for the first time start at "1.0.0".
fn bump_version(version: &str) -> String {
    if let Some(last_dot) = version.rfind('.') {
        if let Ok(n) = version[last_dot + 1..].parse::<u32>() {
            return format!("{}.{}", &version[..last_dot], n + 1);
        }
    }
    "1.0.0".to_string()
}

/// Extract a UC's display name with a sensible fallback chain.
fn extract_uc_name(uc: &Value) -> Option<String> {
    uc.get("name")
        .and_then(|v| v.as_str())
        .or_else(|| uc.get("id").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
}

/// Extract a UC's description, truncated to 500 chars to fit recipe shape.
fn extract_uc_description(uc: &Value) -> Option<String> {
    uc.get("description")
        .or_else(|| uc.get("capability_summary"))
        .and_then(|v| v.as_str())
        .map(|s| {
            if s.len() > 500 {
                format!("{}…", &s[..499])
            } else {
                s.to_string()
            }
        })
}

/// Extract a UC's tool list as a JSON string (for `recipe.tool_requirements`).
fn extract_uc_tools_json(uc: &Value) -> Option<String> {
    uc.get("tools").and_then(|v| serde_json::to_string(v).ok())
}

/// Extract the first category from `template.payload.persona.category` or
/// `template.category` if either is present. Used to inherit the category
/// onto derived recipes so the catalog UI can group them sensibly.
fn extract_category(payload: &Value) -> Option<String> {
    payload
        .get("persona")
        .and_then(|p| p.get("category"))
        .or_else(|| payload.get("category"))
        .and_then(|c| {
            if let Some(s) = c.as_str() {
                Some(s.to_string())
            } else if let Some(arr) = c.as_array() {
                arr.first().and_then(|v| v.as_str()).map(|s| s.to_string())
            } else {
                None
            }
        })
}

/// Synthesize the recipe's `prompt_template` from a UC.
///
/// For Stage B Phase 1b we serialize the entire UC JSON into this field —
/// a misuse of the `prompt_template` semantic that future Phase 2 work will
/// fix when the parser learns to round-trip a recipe row back into an
/// inline UC shape at adoption time. Storing the full UC payload here means
/// no information is lost in the migration; Phase 2 has everything it needs
/// to reconstruct.
///
/// Once Phase 2 ships and recipes carry their canonical fields properly,
/// this function should be replaced with one that synthesizes the *real*
/// LLM prompt from the UC's operating instructions.
fn synthesize_prompt_template(uc: &Value) -> String {
    serde_json::to_string(uc).unwrap_or_else(|_| "{}".to_string())
}

/// Derive recipes from a template's payload. Returns one `DeriveResult` per
/// use case found. Re-running with unchanged input produces all-Unchanged
/// results.
pub fn derive_recipes_from_template_inner(
    state: &Arc<AppState>,
    template_id: &str,
    template_payload_json: &str,
) -> Result<Vec<DeriveResult>, AppError> {
    if template_id.trim().is_empty() {
        return Err(AppError::Validation(
            "template_id cannot be empty".into(),
        ));
    }

    let payload: Value = serde_json::from_str(template_payload_json).map_err(|e| {
        AppError::Validation(format!("template_payload_json parse error: {e}"))
    })?;

    let use_cases = payload
        .get("use_cases")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            AppError::Validation(
                "template payload has no use_cases[] array — nothing to derive".into(),
            )
        })?;

    let category = extract_category(&payload);
    let mut results: Vec<DeriveResult> = Vec::with_capacity(use_cases.len());

    for uc in use_cases.iter() {
        let uc_id = uc
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "template '{template_id}' has a use_case with no id field"
                ))
            })?
            .to_string();

        let uc_name = extract_uc_name(uc);
        let uc_description = extract_uc_description(uc);
        let uc_tools = extract_uc_tools_json(uc);
        let synthesized_prompt = synthesize_prompt_template(uc);

        // Look up existing derived recipe for this (template_id, uc_id).
        let existing: Option<RecipeDefinition> =
            recipe_repo::find_by_source(&state.db, template_id, &uc_id)?;

        match existing {
            None => {
                // Created — fresh derivation.
                let input = CreateRecipeInput {
                    credential_id: None,
                    use_case_id: None,
                    name: uc_name.clone().unwrap_or_else(|| uc_id.clone()),
                    description: uc_description.clone(),
                    category: category.clone(),
                    prompt_template: synthesized_prompt,
                    input_schema: None,
                    output_contract: None,
                    tool_requirements: uc_tools,
                    credential_requirements: None,
                    model_preference: None,
                    sample_inputs: None,
                    tags: serde_json::to_string(&[template_id, "derived"]).ok(),
                    icon: None,
                    color: None,
                    source_template_id: Some(template_id.to_string()),
                    source_use_case_id: Some(uc_id.clone()),
                    source_use_case_name: uc_name.clone(),
                    source_version: Some("1.0.0".to_string()),
                };
                let created = recipe_repo::create(&state.db, input)?;
                results.push(DeriveResult {
                    use_case_id: uc_id,
                    use_case_name: uc_name,
                    recipe_id: created.id,
                    action: DeriveAction::Created,
                    source_version: "1.0.0".to_string(),
                });
            }
            Some(prev) => {
                // Compare current UC against stored recipe. We compare against
                // prompt_template since that holds the serialized UC JSON for
                // Phase 1b. If a future Phase 2 field becomes the canonical
                // representation, change this comparison accordingly.
                let prev_prompt = &prev.prompt_template;
                let current_prompt = synthesize_prompt_template(uc);
                if prev_prompt == &current_prompt
                    && prev.source_use_case_name.as_deref() == uc_name.as_deref()
                {
                    // Unchanged — nothing to write.
                    results.push(DeriveResult {
                        use_case_id: uc_id,
                        use_case_name: uc_name,
                        recipe_id: prev.id,
                        action: DeriveAction::Unchanged,
                        source_version: prev
                            .source_version
                            .unwrap_or_else(|| "1.0.0".to_string()),
                    });
                } else {
                    // Updated — bump version and rewrite mutable fields.
                    let new_version = bump_version(
                        prev.source_version.as_deref().unwrap_or("1.0.0"),
                    );
                    let update = UpdateRecipeInput {
                        name: uc_name.clone(),
                        description: uc_description,
                        category: category.clone(),
                        prompt_template: Some(current_prompt),
                        input_schema: None,
                        output_contract: None,
                        tool_requirements: uc_tools,
                        credential_requirements: None,
                        model_preference: None,
                        sample_inputs: None,
                        tags: None,
                        icon: None,
                        color: None,
                        source_use_case_name: uc_name.clone(),
                        source_version: Some(new_version.clone()),
                    };
                    let _updated = recipe_repo::update(&state.db, &prev.id, update)?;
                    results.push(DeriveResult {
                        use_case_id: uc_id,
                        use_case_name: uc_name,
                        recipe_id: prev.id,
                        action: DeriveAction::Updated,
                        source_version: new_version,
                    });
                }
            }
        }
    }

    tracing::info!(
        template_id = %template_id,
        total = results.len(),
        created = results.iter().filter(|r| matches!(r.action, DeriveAction::Created)).count(),
        updated = results.iter().filter(|r| matches!(r.action, DeriveAction::Updated)).count(),
        unchanged = results.iter().filter(|r| matches!(r.action, DeriveAction::Unchanged)).count(),
        "derive_recipes_from_template completed"
    );

    Ok(results)
}

/// Tauri command wrapper. Migration scripts invoke this via the
/// test-automation HTTP server (`tools/test-mcp/server.py`-style harnesses).
#[tauri::command]
pub async fn derive_recipes_from_template(
    state: State<'_, Arc<AppState>>,
    template_id: String,
    template_payload_json: String,
) -> Result<Vec<DeriveResult>, AppError> {
    require_auth(&state).await?;
    derive_recipes_from_template_inner(&state, &template_id, &template_payload_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bump_version_basic() {
        assert_eq!(bump_version("1.0.0"), "1.0.1");
        assert_eq!(bump_version("2.4.9"), "2.4.10");
        assert_eq!(bump_version("0.0.0"), "0.0.1");
    }

    #[test]
    fn bump_version_falls_back_on_garbage() {
        assert_eq!(bump_version(""), "1.0.0");
        assert_eq!(bump_version("nonsense"), "1.0.0");
        assert_eq!(bump_version("1.x"), "1.0.0");
    }

    #[test]
    fn extract_category_from_array() {
        let payload = serde_json::json!({
            "category": ["content", "marketing"]
        });
        assert_eq!(extract_category(&payload), Some("content".to_string()));
    }

    #[test]
    fn extract_category_from_string() {
        let payload = serde_json::json!({ "category": "infrastructure" });
        assert_eq!(extract_category(&payload), Some("infrastructure".to_string()));
    }

    #[test]
    fn extract_category_from_persona_nested() {
        let payload = serde_json::json!({
            "persona": { "category": "research" }
        });
        assert_eq!(extract_category(&payload), Some("research".to_string()));
    }

    #[test]
    fn extract_uc_description_truncates() {
        let long = "x".repeat(600);
        let uc = serde_json::json!({ "description": long });
        let result = extract_uc_description(&uc).unwrap();
        assert_eq!(result.chars().count(), 500); // 499 chars + ellipsis
    }
}
