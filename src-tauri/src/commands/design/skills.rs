use std::sync::Arc;

use tauri::State;

use crate::db::models::{
    CreateSkillComponentInput, CreateSkillInput, PersonaSkill, Skill, SkillComponent,
    SkillWithComponents, UpdateSkillInput,
};
use crate::db::repos::resources::skills as skill_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Create a new skill.
#[tauri::command]
pub async fn create_skill(
    state: State<'_, Arc<AppState>>,
    input: CreateSkillInput,
) -> Result<Skill, AppError> {
    require_auth(&state).await?;
    skill_repo::create_skill(&state.db, input)
}

/// Get a skill with all its components.
#[tauri::command]
pub async fn get_skill(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<SkillWithComponents, AppError> {
    require_auth(&state).await?;
    skill_repo::get_skill_with_components(&state.db, &id)
}

/// List all skills.
#[tauri::command]
pub async fn list_skills(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Skill>, AppError> {
    require_auth(&state).await?;
    skill_repo::list_skills(&state.db)
}

/// Update skill metadata.
#[tauri::command]
pub async fn update_skill(
    state: State<'_, Arc<AppState>>,
    id: String,
    input: UpdateSkillInput,
) -> Result<Skill, AppError> {
    require_auth(&state).await?;
    skill_repo::update_skill(&state.db, &id, input)
}

/// Delete a skill and cascade to components and persona assignments.
#[tauri::command]
pub async fn delete_skill(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    skill_repo::delete_skill(&state.db, &id)
}

/// Add a component (tool, trigger_template, or credential_schema) to a skill.
#[tauri::command]
pub async fn add_skill_component(
    state: State<'_, Arc<AppState>>,
    skill_id: String,
    input: CreateSkillComponentInput,
) -> Result<SkillComponent, AppError> {
    require_auth(&state).await?;
    skill_repo::add_component(&state.db, &skill_id, input)
}

/// Remove a component from a skill.
#[tauri::command]
pub async fn remove_skill_component(
    state: State<'_, Arc<AppState>>,
    component_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    skill_repo::remove_component(&state.db, &component_id)
}

/// Assign a skill to a persona with optional config overrides.
#[tauri::command]
pub async fn assign_skill(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    skill_id: String,
    config: Option<String>,
) -> Result<PersonaSkill, AppError> {
    require_auth(&state).await?;
    skill_repo::assign_skill_to_persona(&state.db, &persona_id, &skill_id, config)
}

/// Remove a skill from a persona.
#[tauri::command]
pub async fn remove_skill(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
    skill_id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    skill_repo::remove_skill_from_persona(&state.db, &persona_id, &skill_id)
}

/// Get all skills assigned to a persona, with their components.
#[tauri::command]
pub async fn get_persona_skills(
    state: State<'_, Arc<AppState>>,
    persona_id: String,
) -> Result<Vec<SkillWithComponents>, AppError> {
    require_auth(&state).await?;
    skill_repo::get_persona_skills(&state.db, &persona_id)
}
