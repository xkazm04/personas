use tauri::State;

use crate::{
    db::{models::{CreateSavedViewInput, SavedView}, DbPool, repos},
    error::AppError,
};

#[tauri::command]
pub async fn create_saved_view(
    pool: State<'_, DbPool>,
    input: CreateSavedViewInput,
) -> Result<SavedView, AppError> {
    let conn = pool.get()?;
    let view = repos::core::saved_views::create(&conn, input)?;
    Ok(view)
}

#[tauri::command]
pub async fn list_saved_views(
    pool: State<'_, DbPool>,
) -> Result<Vec<SavedView>, AppError> {
    let conn = pool.get()?;
    let views = repos::core::saved_views::list_all(&conn)?;
    Ok(views)
}

#[tauri::command]
pub async fn delete_saved_view(
    pool: State<'_, DbPool>,
    id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    repos::core::saved_views::delete(&conn, &id)?;
    Ok(())
}
