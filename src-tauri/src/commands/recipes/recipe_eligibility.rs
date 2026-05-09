//! Stage E.1 — IPC surface for recipe eligibility scoring.
//!
//! Two commands:
//!
//! - `get_recipe_eligibility(recipe_id, persona_id)` — single recipe,
//!   used when the user opens a recipe detail card.
//! - `get_recipe_catalog_for_persona(persona_id)` — bulk pass over
//!   every recipe, used by the upcoming Templates 2nd-level sidebar
//!   (Stage E.3) to render the catalog grid with eligibility tags.
//!
//! Both fetch the persona's wired tools + the global tool catalog
//! once per call (catalog has ~20-30 entries; the join is cheap), then
//! delegate to the pure scorer in `engine::recipe_eligibility`.

use std::sync::Arc;

use tauri::State;

use crate::db::repos::resources::recipes as recipe_repo;
use crate::db::repos::resources::tools as tool_repo;
use crate::engine::recipe_eligibility::{
    score_recipe_eligibility, RecipeEligibility,
};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

#[tauri::command]
pub async fn get_recipe_eligibility(
    state: State<'_, Arc<AppState>>,
    recipe_id: String,
    persona_id: String,
) -> Result<RecipeEligibility, AppError> {
    require_auth(&state).await?;
    if recipe_id.trim().is_empty() {
        return Err(AppError::Validation("recipe_id cannot be empty".into()));
    }
    if persona_id.trim().is_empty() {
        return Err(AppError::Validation("persona_id cannot be empty".into()));
    }
    let recipe = recipe_repo::get_by_id(&state.db, &recipe_id)?;
    let persona_tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let catalog = tool_repo::get_all_definitions(&state.db)?;
    Ok(score_recipe_eligibility(
        &recipe,
        &persona_id,
        &persona_tools,
        &catalog,
    ))
}

/// Bulk: score every recipe in the catalog against `persona_id` once.
/// Returns one `RecipeEligibility` per recipe, in the same order
/// `list_recipes` would return them. ~5 ms total for 291 recipes
/// against a typical persona.
#[tauri::command]
pub async fn get_recipe_catalog_for_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<RecipeEligibility>, AppError> {
    require_auth(&state).await?;
    if persona_id.trim().is_empty() {
        return Err(AppError::Validation("persona_id cannot be empty".into()));
    }
    let recipes = recipe_repo::get_all(&state.db)?;
    let persona_tools = tool_repo::get_tools_for_persona(&state.db, &persona_id)?;
    let catalog = tool_repo::get_all_definitions(&state.db)?;
    let scored: Vec<RecipeEligibility> = recipes
        .iter()
        .map(|r| score_recipe_eligibility(r, &persona_id, &persona_tools, &catalog))
        .collect();
    Ok(scored)
}
