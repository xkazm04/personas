use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::models::{CreateSavedViewInput, SavedView};
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

row_mapper!(row_to_view -> SavedView {
    id, name, persona_id, day_range, custom_start_date, custom_end_date,
    compare_enabled [bool],
    is_smart [bool],
    view_type, view_config,
    created_at, updated_at,
});

pub fn create(pool: &DbPool, input: CreateSavedViewInput) -> Result<SavedView, AppError> {
    timed_query!("saved_views", "saved_views::create", {
        let conn = pool.get()?;
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO saved_views (id, name, persona_id, day_range, custom_start_date, custom_end_date, compare_enabled, is_smart, view_type, view_config, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                input.name,
                input.persona_id,
                input.day_range,
                input.custom_start_date,
                input.custom_end_date,
                input.compare_enabled as i32,
                input.is_smart as i32,
                input.view_type,
                input.view_config,
                now,
                now,
            ],
        )?;

        get_by_id(pool, &id)?.ok_or_else(|| AppError::Internal("Failed to create saved view".to_string()))
    })
}

pub fn get_by_id(pool: &DbPool, id: &str) -> Result<Option<SavedView>, AppError> {
    timed_query!("saved_views", "saved_views::get_by_id", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM saved_views WHERE id = ?1",
        )?;

        let view = stmt.query_row(params![id], row_to_view).optional()?;
        Ok(view)
    })
}

pub fn list_all(pool: &DbPool) -> Result<Vec<SavedView>, AppError> {
    timed_query!("saved_views", "saved_views::list_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM saved_views ORDER BY is_smart DESC, name ASC",
        )?;

        let rows = stmt.query_map([], row_to_view)?;
        Ok(collect_rows(rows, "saved_views::list_all"))
    })
}

pub fn list_by_type(pool: &DbPool, view_type: &str) -> Result<Vec<SavedView>, AppError> {
    timed_query!("saved_views", "saved_views::list_by_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT * FROM saved_views WHERE view_type = ?1 ORDER BY is_smart DESC, name ASC",
        )?;

        let rows = stmt.query_map(params![view_type], row_to_view)?;
        Ok(collect_rows(rows, "saved_views::list_by_type"))
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("saved_views", "saved_views::delete", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM saved_views WHERE id = ?1", params![id])?;
        Ok(())
    })
}
