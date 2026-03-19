use std::sync::Arc;
use tauri::State;

use crate::{
    db::{models::{CreateSavedViewInput, SavedView}, repos},
    error::AppError,
    ipc_auth::require_auth,
    AppState,
};

#[tauri::command]
pub async fn create_saved_view(
    state: State<'_, Arc<AppState>>,
    input: CreateSavedViewInput,
) -> Result<SavedView, AppError> {
    require_auth(&state).await?;
    let conn = state.db.get()?;
    let view = repos::core::saved_views::create(&conn, input)?;
    Ok(view)
}

#[tauri::command]
pub async fn list_saved_views(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SavedView>, AppError> {
    require_auth(&state).await?;
    let conn = state.db.get()?;
    let views = repos::core::saved_views::list_all(&conn)?;
    Ok(views)
}

#[tauri::command]
pub async fn list_saved_views_by_type(
    state: State<'_, Arc<AppState>>,
    view_type: String,
) -> Result<Vec<SavedView>, AppError> {
    require_auth(&state).await?;
    let conn = state.db.get()?;
    let views = repos::core::saved_views::list_by_type(&conn, &view_type)?;
    Ok(views)
}

#[tauri::command]
pub async fn delete_saved_view(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let conn = state.db.get()?;
    repos::core::saved_views::delete(&conn, &id)?;
    Ok(())
}
