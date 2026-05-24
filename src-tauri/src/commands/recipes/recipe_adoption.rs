//! Stage E.2 — recipe → persona adoption.
//!
//! Higher-level companion to the existing `link_recipe_to_persona` CRUD
//! command. Where `link_recipe_to_persona` is the raw INSERT, this
//! pipeline:
//!
//! 1. Scores the recipe's eligibility against the persona (Stage E.1).
//! 2. Refuses to adopt if the eligibility state is `Incompatible` —
//!    no setup path can resolve a tool that isn't in the catalog.
//! 3. By default refuses if the state is `AdoptableWithSetup` and
//!    returns the missing-tools list so the frontend can drive the
//!    "wire X first" guided flow. Set `auto_setup: true` to wire the
//!    missing-but-catalogued tools as part of the adoption.
//! 4. Creates the `persona_recipe_links` row.
//! 5. Returns an `AdoptionResult` with the link id, eligibility, and
//!    the list of tools auto-wired by this call (empty unless
//!    `auto_setup: true`).
//!
//! Bindings hydration is deferred. Recipes ship with empty `bindings: {}`
//! today (Phase 1b leaves them empty); when authors start populating
//! them, this command will need to resolve `{{var}}` placeholders
//! against the persona's tool surfaces. For now we just store the
//! recipe's bindings shape verbatim in `persona_recipe_links.config`
//! so the future hydration pass has somewhere to write resolved values.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::models::{CreatePersonaRecipeLinkInput, PersonaRecipeLink};
use crate::db::repos::resources::recipes as recipe_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::db::DbPool;
use crate::engine::recipe_eligibility::{
    score_recipe_eligibility, RecipeEligibility, RecipeEligibilityState,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Result of a single adoption call. The frontend uses `eligibility` to
/// render the "wire X first" path on `AdoptableWithSetup`-without-auto-
/// setup, and `auto_wired_tools` to flash a "we wired Gmail for you"
/// confirmation when `auto_setup: true` was passed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdoptionResult {
    pub link: PersonaRecipeLink,
    pub eligibility: RecipeEligibility,
    /// Tool names that were wired to the persona as part of this call.
    /// Always empty when `auto_setup: false`.
    pub auto_wired_tools: Vec<String>,
}

/// Pure-pool inner of `adopt_recipe_for_persona`. Factored out so unit
/// tests can exercise the eligibility-precheck + auto-setup state
/// machine without standing up a Tauri AppState.
pub fn adopt_recipe_for_persona_inner(
    pool: &DbPool,
    persona_id: &str,
    recipe_id: &str,
    auto_setup: bool,
) -> Result<AdoptionResult, AppError> {
    if persona_id.trim().is_empty() {
        return Err(AppError::Validation("persona_id cannot be empty".into()));
    }
    if recipe_id.trim().is_empty() {
        return Err(AppError::Validation("recipe_id cannot be empty".into()));
    }

    let recipe = recipe_repo::get_by_id(pool, recipe_id)?;
    let persona_tools = tool_repo::get_tools_for_persona(pool, persona_id)?;
    let catalog = tool_repo::get_all_definitions(pool)?;
    let eligibility =
        score_recipe_eligibility(&recipe, persona_id, &persona_tools, &catalog);

    // Hard-stop on Incompatible — no setup path resolves uncatalogued tools.
    if eligibility.state == RecipeEligibilityState::Incompatible {
        return Err(AppError::Validation(format!(
            "recipe {recipe_id} is incompatible with this persona — \
             missing uncatalogued tools: {}",
            eligibility.missing_tools_uncatalogued.join(", ")
        )));
    }

    // Soft-stop on AdoptableWithSetup unless caller opted in to auto_setup.
    let mut auto_wired_tools: Vec<String> = Vec::new();
    if eligibility.state == RecipeEligibilityState::AdoptableWithSetup {
        if !auto_setup {
            return Err(AppError::Validation(format!(
                "recipe {recipe_id} needs setup before adoption — \
                 wire these tools first: {}. Pass auto_setup=true to wire them automatically.",
                eligibility.missing_tools_addable.join(", ")
            )));
        }
        // Auto-wire each addable tool. Resolve name → definition id from the
        // catalog we already fetched, then call assign_tool. Failures abort
        // the whole adoption — partial wiring would leave the persona in a
        // half-setup state that's harder to reason about than rolling back.
        for tool_name in eligibility.missing_tools_addable.iter() {
            let def = catalog
                .iter()
                .find(|d| d.name == *tool_name)
                .ok_or_else(|| {
                    AppError::Internal(format!(
                        "auto-setup raced: tool {tool_name} disappeared from catalog mid-adoption"
                    ))
                })?;
            tool_repo::assign_tool(pool, persona_id, &def.id, None)?;
            auto_wired_tools.push(tool_name.clone());
        }
    }

    // Create the persona-recipe link. Idempotent on (persona_id, recipe_id)
    // via the existing INSERT OR IGNORE in link_to_persona.
    let link = recipe_repo::link_to_persona(
        pool,
        CreatePersonaRecipeLinkInput {
            persona_id: persona_id.to_string(),
            recipe_id: recipe_id.to_string(),
            sort_order: None,
            config: None,
        },
    )?;

    // Re-score after auto-setup so the returned eligibility reflects post-
    // wiring state (used by the frontend to show "Eligible" instead of
    // the original "AdoptableWithSetup" once auto-setup ran).
    let final_eligibility = if auto_wired_tools.is_empty() {
        eligibility
    } else {
        let updated_persona_tools = tool_repo::get_tools_for_persona(pool, persona_id)?;
        score_recipe_eligibility(&recipe, persona_id, &updated_persona_tools, &catalog)
    };

    tracing::info!(
        persona_id = %persona_id,
        recipe_id = %recipe_id,
        link_id = %link.id,
        auto_wired = auto_wired_tools.len(),
        "Recipe adopted into persona"
    );

    Ok(AdoptionResult {
        link,
        eligibility: final_eligibility,
        auto_wired_tools,
    })
}

/// Adopt a recipe into a persona. See module-level docs for the
/// state-machine semantics.
#[tauri::command]
pub async fn adopt_recipe_for_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    recipe_id: String,
    auto_setup: Option<bool>,
) -> Result<AdoptionResult, AppError> {
    require_auth(&state).await?;
    adopt_recipe_for_persona_inner(
        &state.db,
        &persona_id,
        &recipe_id,
        auto_setup.unwrap_or(false),
    )
}

/// Inverse of `adopt_recipe_for_persona`: removes the link. Existing
/// `unlink_recipe_from_persona` does the same thing — this thin
/// wrapper exists for symmetry with the adoption surface and to give
/// the frontend a single import point for both halves of the pair.
#[tauri::command]
pub async fn unadopt_recipe_from_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    recipe_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    if persona_id.trim().is_empty() {
        return Err(AppError::Validation("persona_id cannot be empty".into()));
    }
    if recipe_id.trim().is_empty() {
        return Err(AppError::Validation("recipe_id cannot be empty".into()));
    }
    recipe_repo::unlink_from_persona(&state.db, &persona_id, &recipe_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreateRecipeInput};
    use crate::db::repos::core::personas as persona_repo;

    fn make_persona(pool: &DbPool, name: &str) -> String {
        persona_repo::create(
            pool,
            CreatePersonaInput {
                name: name.to_string(),
                system_prompt: "Test".to_string(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: None,
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
            },
        )
        .unwrap()
        .id
    }

    fn make_recipe_with_tool_hints(pool: &DbPool, recipe_id: &str, hints: &[&str]) -> String {
        let uc_json = serde_json::json!({
            "id": "uc_test",
            "title": "Test UC",
            "tool_hints": hints,
        });
        let pt = serde_json::to_string(&uc_json).unwrap();
        let recipe = recipe_repo::create_with_id(
            pool,
            recipe_id,
            CreateRecipeInput {
                credential_id: None,
                use_case_id: None,
                name: "Test Recipe".to_string(),
                description: Some("test".to_string()),
                category: None,
                prompt_template: pt,
                input_schema: None,
                output_contract: None,
                tool_requirements: None,
                credential_requirements: None,
                model_preference: None,
                sample_inputs: None,
                tags: None,
                icon: None,
                color: None,
                source_template_id: None,
                source_use_case_id: None,
                source_use_case_name: None,
                source_version: None,
            },
        )
        .unwrap();
        recipe.id
    }

    /// First catalogued tool name. `init_test_db` seeds builtin tools, so
    /// any test that needs a tool that exists in the catalog can grab one
    /// off the top of this list. Uses one we *know* is seeded.
    fn first_catalogued_tool_name(pool: &DbPool) -> String {
        let cat = tool_repo::get_all_definitions(pool).unwrap();
        assert!(!cat.is_empty(), "init_test_db should seed builtin tools");
        cat[0].name.clone()
    }

    #[test]
    fn vacuous_recipe_is_eligible_and_links_immediately() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "P-A");
        // Recipe with no tool_hints → vacuously Eligible regardless of persona.
        let recipe_id = make_recipe_with_tool_hints(&pool, "rec-vacuous", &[]);

        let result = adopt_recipe_for_persona_inner(&pool, &persona_id, &recipe_id, false)
            .expect("adoption should succeed");

        assert_eq!(result.eligibility.state, RecipeEligibilityState::Eligible);
        assert!(result.auto_wired_tools.is_empty());
        assert_eq!(result.link.persona_id, persona_id);
        assert_eq!(result.link.recipe_id, recipe_id);
    }

    #[test]
    fn incompatible_recipe_is_rejected_even_with_auto_setup() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "P-B");
        // Tool that's NOT in the catalog → Incompatible → no setup path.
        let recipe_id = make_recipe_with_tool_hints(
            &pool,
            "rec-incompatible",
            &["uncatalogued_phantom_tool"],
        );

        let err = adopt_recipe_for_persona_inner(&pool, &persona_id, &recipe_id, true)
            .expect_err("incompatible recipe must hard-fail");
        let msg = err.to_string();
        assert!(msg.contains("incompatible"), "error must mention incompatibility; got: {msg}");
        assert!(
            msg.contains("uncatalogued_phantom_tool"),
            "error must name the missing tool for debugging; got: {msg}"
        );
    }

    #[test]
    fn adoptable_with_setup_blocks_without_auto_setup() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "P-C");
        let tool_name = first_catalogued_tool_name(&pool);
        let recipe_id =
            make_recipe_with_tool_hints(&pool, "rec-needs-setup", &[&tool_name]);

        let err = adopt_recipe_for_persona_inner(&pool, &persona_id, &recipe_id, false)
            .expect_err("AdoptableWithSetup must refuse without auto_setup");
        let msg = err.to_string();
        assert!(msg.contains("needs setup"), "error must mention setup; got: {msg}");
        assert!(
            msg.contains(&tool_name),
            "error must name the tool that needs wiring; got: {msg}"
        );
    }

    #[test]
    fn auto_setup_wires_missing_tools_and_links_recipe() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "P-D");
        let tool_name = first_catalogued_tool_name(&pool);
        let recipe_id =
            make_recipe_with_tool_hints(&pool, "rec-auto-setup", &[&tool_name]);

        let result = adopt_recipe_for_persona_inner(&pool, &persona_id, &recipe_id, true)
            .expect("auto_setup adoption should succeed");

        // Tool was auto-wired; final eligibility flips to Eligible.
        assert_eq!(result.auto_wired_tools, vec![tool_name.clone()]);
        assert_eq!(result.eligibility.state, RecipeEligibilityState::Eligible);

        // Persona now has the tool wired.
        let persona_tools = tool_repo::get_tools_for_persona(&pool, &persona_id).unwrap();
        assert!(
            persona_tools.iter().any(|t| t.name == tool_name),
            "tool {tool_name} should be wired to the persona post-auto-setup"
        );
    }

    #[test]
    fn re_adoption_is_idempotent() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "P-E");
        let recipe_id = make_recipe_with_tool_hints(&pool, "rec-vacuous-2", &[]);

        let r1 = adopt_recipe_for_persona_inner(&pool, &persona_id, &recipe_id, false)
            .expect("first adoption ok");
        let r2 = adopt_recipe_for_persona_inner(&pool, &persona_id, &recipe_id, false)
            .expect("second adoption (re-link) ok");

        // INSERT OR IGNORE in link_to_persona returns the existing row, so
        // the link id is stable across re-runs.
        assert_eq!(r1.link.id, r2.link.id);
    }
}
