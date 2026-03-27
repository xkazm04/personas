use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::models::{CreateSavedViewInput, SavedView};
use crate::db::DbPool;
use crate::error::AppError;

fn row_to_view(row: &rusqlite::Row) -> rusqlite::Result<SavedView> {
    Ok(SavedView {
        id: row.get(0)?,
        name: row.get(1)?,
        persona_id: row.get(2)?,
        day_range: row.get(3)?,
        custom_start_date: row.get(4)?,
        custom_end_date: row.get(5)?,
        compare_enabled: row.get::<_, i32>(6)? != 0,
        is_smart: row.get::<_, i32>(7)? != 0,
        view_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "analytics".to_string()),
        view_config: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const SELECT_COLS: &str =
    "id, name, persona_id, day_range, custom_start_date, custom_end_date, compare_enabled, is_smart, view_type, view_config, created_at, updated_at";

pub fn create(pool: &DbPool, input: CreateSavedViewInput) -> Result<SavedView, AppError> {
    timed_query!("saved_views", "saved_views::create", {
        let conn = pool.get()?;
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            &format!(
                "INSERT INTO saved_views ({SELECT_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
            ),
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
            &format!("SELECT {SELECT_COLS} FROM saved_views WHERE id = ?1"),
        )?;

        let view = stmt.query_row(params![id], row_to_view).optional()?;
        Ok(view)
    })
}

pub fn list_all(pool: &DbPool) -> Result<Vec<SavedView>, AppError> {
    timed_query!("saved_views", "saved_views::list_all", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            &format!("SELECT {SELECT_COLS} FROM saved_views ORDER BY is_smart DESC, name ASC"),
        )?;

        let iter = stmt.query_map([], row_to_view)?;
        let mut views = Vec::new();
        for view in iter {
            views.push(view?);
        }
        Ok(views)
    })
}

pub fn list_by_type(pool: &DbPool, view_type: &str) -> Result<Vec<SavedView>, AppError> {
    timed_query!("saved_views", "saved_views::list_by_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            &format!("SELECT {SELECT_COLS} FROM saved_views WHERE view_type = ?1 ORDER BY is_smart DESC, name ASC"),
        )?;

        let iter = stmt.query_map(params![view_type], row_to_view)?;
        let mut views = Vec::new();
        for view in iter {
            views.push(view?);
        }
        Ok(views)
    })
}

pub fn delete(pool: &DbPool, id: &str) -> Result<(), AppError> {
    timed_query!("saved_views", "saved_views::delete", {
        let conn = pool.get()?;
        conn.execute("DELETE FROM saved_views WHERE id = ?1", params![id])?;
        Ok(())
    })
}
