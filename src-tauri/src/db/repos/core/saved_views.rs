use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::db::models::{CreateSavedViewInput, SavedView};
use crate::error::AppError;

pub fn create(conn: &Connection, input: CreateSavedViewInput) -> Result<SavedView, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO saved_views (
            id, name, persona_id, day_range, custom_start_date, custom_end_date, compare_enabled, is_smart, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            input.name,
            input.persona_id,
            input.day_range,
            input.custom_start_date,
            input.custom_end_date,
            input.compare_enabled as i32,
            input.is_smart as i32,
            now,
            now,
        ],
    )?;

    get_by_id(conn, &id)?.ok_or_else(|| AppError::Internal("Failed to create saved view".to_string()))
}

pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SavedView>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, persona_id, day_range, custom_start_date, custom_end_date, compare_enabled, is_smart, created_at, updated_at
         FROM saved_views
         WHERE id = ?1",
    )?;

    let view = stmt.query_row(params![id], |row| {
        Ok(SavedView {
            id: row.get(0)?,
            name: row.get(1)?,
            persona_id: row.get(2)?,
            day_range: row.get(3)?,
            custom_start_date: row.get(4)?,
            custom_end_date: row.get(5)?,
            compare_enabled: row.get::<_, i32>(6)? != 0,
            is_smart: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }).optional()?;

    Ok(view)
}

pub fn list_all(conn: &Connection) -> Result<Vec<SavedView>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, persona_id, day_range, custom_start_date, custom_end_date, compare_enabled, is_smart, created_at, updated_at
         FROM saved_views
         ORDER BY is_smart DESC, name ASC",
    )?;

    let iter = stmt.query_map([], |row| {
        Ok(SavedView {
            id: row.get(0)?,
            name: row.get(1)?,
            persona_id: row.get(2)?,
            day_range: row.get(3)?,
            custom_start_date: row.get(4)?,
            custom_end_date: row.get(5)?,
            compare_enabled: row.get::<_, i32>(6)? != 0,
            is_smart: row.get::<_, i32>(7)? != 0,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;

    let mut views = Vec::new();
    for view in iter {
        views.push(view?);
    }

    Ok(views)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM saved_views WHERE id = ?1", params![id])?;
    Ok(())
}
