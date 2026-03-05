use std::sync::Arc;

use serde_json::json;
use tauri::State;

use crate::commands::credentials::ai_artifact_flow::{AiArtifactParams, run_ai_artifact_task};
use crate::commands::credentials::shared::build_credential_task_cli_args;
use crate::db::models::{
    CreatePersonaRecipeLinkInput, CreateRecipeInput, PersonaRecipeLink,
    RecipeDefinition, RecipeExecutionInput, RecipeExecutionResult, RecipeVersion,
    UpdateRecipeInput,
};
use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::recipes as repo;
use crate::error::AppError;
use crate::AppState;

use super::recipe_generation;
use super::recipe_versioning;

#[tauri::command]
pub fn list_recipes(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RecipeDefinition>, AppError> {
    repo::get_all(&state.db)
}

#[tauri::command]
pub fn get_recipe(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<RecipeDefinition, AppError> {
    repo::get_by_id(&state.db, &id)
}

#[tauri::command]
pub fn create_recipe(
    state: State<'_, Arc<AppState>>,
    input: CreateRecipeInput,
) -> Result<RecipeDefinition, AppError> {
    repo::create(&state.db, input)
}

#[tauri::command]
pub fn update_recipe(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateRecipeInput,
) -> Result<RecipeDefinition, AppError> {
    repo::update(&state.db, &id, input)
}

#[tauri::command]
pub fn delete_recipe(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &id)
}

#[tauri::command]
pub fn link_recipe_to_persona(
    state: State<'_, Arc<AppState>>,
    input: CreatePersonaRecipeLinkInput,
) -> Result<PersonaRecipeLink, AppError> {
    repo::link_to_persona(&state.db, input)
}

#[tauri::command]
pub fn unlink_recipe_from_persona(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    recipe_id: String,
) -> Result<bool, AppError> {
    repo::unlink_from_persona(&state.db, &persona_id, &recipe_id)
}

#[tauri::command]
pub fn get_persona_recipes(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<RecipeDefinition>, AppError> {
    repo::get_for_persona(&state.db, &persona_id)
}

#[tauri::command]
pub fn execute_recipe(
    state: State<'_, Arc<AppState>>,
    input: RecipeExecutionInput,
) -> Result<RecipeExecutionResult, AppError> {
    let recipe = repo::get_by_id(&state.db, &input.recipe_id)?;

    // Substitute {{variable}} placeholders with input_data values
    let mut rendered = recipe.prompt_template.clone();
    for (key, value) in &input.input_data {
        let placeholder = format!("{{{{{}}}}}", key);
        let replacement = match value {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        rendered = rendered.replace(&placeholder, &replacement);
    }

    Ok(RecipeExecutionResult {
        recipe_id: recipe.id,
        recipe_name: recipe.name,
        rendered_prompt: rendered,
        input_data: input.input_data,
        executed_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn get_credential_recipes(
    state: State<'_, Arc<AppState>>,
    credential_id: String,
) -> Result<Vec<RecipeDefinition>, AppError> {
    repo::get_for_credential(&state.db, &credential_id)
}

#[tauri::command]
pub async fn start_recipe_generation(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    credential_id: String,
    description: String,
) -> Result<serde_json::Value, AppError> {
    // Load credential info for the prompt
    let credential = cred_repo::get_by_id(&state.db, &credential_id)?;

    let prompt = recipe_generation::build_recipe_generation_prompt(
        description.trim(),
        &credential.name,
        &credential.service_type,
    );

    let cli_args = build_credential_task_cli_args();
    let generation_id = uuid::Uuid::new_v4().to_string();

    // Reuse the credential design mutex (one credential op at a time)
    let active_id = state.active_credential_design_id.clone();
    {
        let mut guard = active_id.lock().unwrap();
        *guard = Some(generation_id.clone());
    }

    let gen_id = generation_id.clone();

    tokio::spawn(async move {
        run_ai_artifact_task(AiArtifactParams {
            app,
            task_id: gen_id,
            prompt_text: prompt,
            cli_args,
            active_id,
            active_child_pid: None,
            messages: recipe_generation::RECIPE_GENERATION_MESSAGES,
            extractor: recipe_generation::extract_recipe_generation_result,
        })
        .await;
    });

    Ok(json!({ "generation_id": generation_id }))
}

#[tauri::command]
pub async fn cancel_recipe_generation(
    state: State<'_, Arc<AppState>>,
) -> Result<bool, AppError> {
    let mut guard = state.active_credential_design_id.lock().unwrap();
    *guard = None;
    Ok(true)
}

#[tauri::command]
pub fn get_use_case_recipes(
    state: State<'_, Arc<AppState>>,
    use_case_id: String,
) -> Result<Vec<RecipeDefinition>, AppError> {
    repo::get_for_use_case(&state.db, &use_case_id)
}

#[tauri::command]
pub fn promote_use_case_to_recipe(
    state: State<'_, Arc<AppState>>,
    credential_id: Option<String>,
    use_case_id: String,
    name: String,
    description: Option<String>,
    category: Option<String>,
) -> Result<RecipeDefinition, AppError> {
    // Build a recipe from use case fields
    let prompt_template = format!(
        "Execute the following use case:\n\n{}\n\n{}",
        name,
        description.as_deref().unwrap_or("")
    );

    repo::create(
        &state.db,
        CreateRecipeInput {
            credential_id,
            use_case_id: Some(use_case_id),
            name,
            description,
            category,
            prompt_template,
            input_schema: None,
            output_contract: None,
            tool_requirements: None,
            credential_requirements: None,
            model_preference: None,
            sample_inputs: None,
            tags: None,
            icon: None,
            color: None,
        },
    )
}

// ============================================================================
// Recipe Versioning
// ============================================================================

#[tauri::command]
pub fn get_recipe_versions(
    state: State<'_, Arc<AppState>>,
    recipe_id: String,
) -> Result<Vec<RecipeVersion>, AppError> {
    repo::get_versions(&state.db, &recipe_id)
}

#[tauri::command]
pub async fn start_recipe_versioning(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    recipe_id: String,
    change_requirements: String,
) -> Result<serde_json::Value, AppError> {
    let recipe = repo::get_by_id(&state.db, &recipe_id)?;

    let prompt = recipe_versioning::build_recipe_versioning_prompt(
        &recipe.name,
        &recipe.prompt_template,
        recipe.input_schema.as_deref(),
        change_requirements.trim(),
    );

    let cli_args = build_credential_task_cli_args();
    let versioning_id = uuid::Uuid::new_v4().to_string();

    let active_id = state.active_credential_design_id.clone();
    {
        let mut guard = active_id.lock().unwrap();
        *guard = Some(versioning_id.clone());
    }

    let ver_id = versioning_id.clone();

    tokio::spawn(async move {
        run_ai_artifact_task(AiArtifactParams {
            app,
            task_id: ver_id,
            prompt_text: prompt,
            cli_args,
            active_id,
            active_child_pid: None,
            messages: recipe_versioning::RECIPE_VERSIONING_MESSAGES,
            extractor: recipe_versioning::extract_recipe_versioning_result,
        })
        .await;
    });

    Ok(json!({ "versioning_id": versioning_id }))
}

#[tauri::command]
pub async fn cancel_recipe_versioning(
    state: State<'_, Arc<AppState>>,
) -> Result<bool, AppError> {
    let mut guard = state.active_credential_design_id.lock().unwrap();
    *guard = None;
    Ok(true)
}

#[tauri::command]
pub fn accept_recipe_version(
    state: State<'_, Arc<AppState>>,
    recipe_id: String,
    prompt_template: String,
    input_schema: Option<String>,
    sample_inputs: Option<String>,
    description: Option<String>,
    changes_summary: Option<String>,
) -> Result<RecipeDefinition, AppError> {
    let latest = repo::get_latest_version_number(&state.db, &recipe_id)?;

    // If no versions exist yet, snapshot the current recipe as v1
    if latest == 0 {
        let current = repo::get_by_id(&state.db, &recipe_id)?;
        repo::create_version(
            &state.db,
            &recipe_id,
            1,
            &current.prompt_template,
            current.input_schema.as_deref(),
            current.sample_inputs.as_deref(),
            current.description.as_deref(),
            Some("Initial version (snapshot before first edit)"),
        )?;
    }

    let new_version_number = if latest == 0 { 2 } else { latest + 1 };

    // Create the new version record
    repo::create_version(
        &state.db,
        &recipe_id,
        new_version_number,
        &prompt_template,
        input_schema.as_deref(),
        sample_inputs.as_deref(),
        description.as_deref(),
        changes_summary.as_deref(),
    )?;

    // Update the recipe definition with the new data
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.db.get()?;
    conn.execute(
        "UPDATE recipe_definitions SET prompt_template = ?1, input_schema = ?2, sample_inputs = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![prompt_template, input_schema, sample_inputs, now, recipe_id],
    )?;

    repo::get_by_id(&state.db, &recipe_id)
}

#[tauri::command]
pub fn revert_recipe_version(
    state: State<'_, Arc<AppState>>,
    recipe_id: String,
    version_id: String,
) -> Result<RecipeDefinition, AppError> {
    repo::revert_to_version(&state.db, &recipe_id, &version_id)
}
