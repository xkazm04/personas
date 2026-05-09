//! Stage D Phase 1 — recipe matching Tauri command.
//!
//! Frontend wraps this in a debounced typeahead from the Glyph composer:
//! when the user pauses typing in the intent field for ~300ms, call this
//! command to find the best matching recipe (if any). If the top score
//! clears the SUGGESTION_THRESHOLD, render a "use this recipe?" chip.
//!
//! Rationale for server-side: keeps recipe payload off the wire (frontend
//! never ships the full recipes table for matching), centralizes the
//! scoring logic, sets up cleanly for v2 embedding-based matching that
//! needs server-side inference.

use std::sync::Arc;

use tauri::State;

use crate::db::repos::resources::recipes as recipe_repo;
use crate::engine::recipe_matcher::{match_intent_to_recipes, RecipeMatch};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Match a user-typed intent to the recipe catalog. Returns the top-K
/// matches sorted by score descending. Empty intent or empty catalog
/// returns an empty Vec — the frontend treats no-results identically to
/// below-threshold-results: silent fallthrough, no UI chip.
///
/// `top_k` defaults to 1 (single best suggestion). Pass 3 for debug
/// surfaces that want to see runner-up scores.
///
/// Performance note: scans all recipes in memory. For ~500 recipes
/// (Phase 1b's expected catalog size), the keyword Jaccard scoring is
/// well under 10ms even on cold pages. If the catalog grows >5K recipes,
/// add an inverted index on tokenized name+tags as a prefilter; for now
/// the simple full-scan is adequate.
#[tauri::command]
pub async fn match_recipes_to_intent(
    state: State<'_, Arc<AppState>>,
    intent: String,
    top_k: Option<usize>,
) -> Result<Vec<RecipeMatch>, AppError> {
    require_auth(&state).await?;
    if intent.trim().is_empty() {
        return Ok(Vec::new());
    }
    // Pull all recipes. We rely on the matcher's own zero-overlap filter
    // to drop noise. For extreme catalog sizes this would need pagination
    // / pre-filtering, but Phase 1b's ~500 recipe ceiling makes the full
    // scan an acceptable v1 trade-off.
    let recipes = recipe_repo::get_all(&state.db)?;
    Ok(match_intent_to_recipes(&intent, &recipes, top_k))
}
