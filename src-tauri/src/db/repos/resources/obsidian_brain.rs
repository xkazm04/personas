use rusqlite::params;

use crate::db::models::{SyncLogEntry, SyncState};
use crate::db::DbPool;
use crate::error::AppError;

pub fn upsert_sync_state(pool: &DbPool, state: &SyncState) -> Result<(), AppError> {
    timed_query!("obsidian_sync_state", "obsidian_sync::upsert_sync_state", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO obsidian_sync_state (id, entity_type, entity_id, vault_file_path, content_hash, sync_direction, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
               vault_file_path = ?4, content_hash = ?5, sync_direction = ?6, synced_at = ?7",
            params![
                state.id,
                state.entity_type,
                state.entity_id,
                state.vault_file_path,
                state.content_hash,
                state.sync_direction,
                state.synced_at,
            ],
        )?;
        Ok(())
    })
}

pub fn get_sync_state(
    pool: &DbPool,
    entity_type: &str,
    entity_id: &str,
) -> Result<Option<SyncState>, AppError> {
    timed_query!("obsidian_sync_state", "obsidian_sync::get_sync_state", {
        let conn = pool.get()?;
        let result = conn.query_row(
            "SELECT id, entity_type, entity_id, vault_file_path, content_hash, sync_direction, synced_at
             FROM obsidian_sync_state WHERE entity_type = ?1 AND entity_id = ?2",
            params![entity_type, entity_id],
            |row| {
                Ok(SyncState {
                    id: row.get(0)?,
                    entity_type: row.get(1)?,
                    entity_id: row.get(2)?,
                    vault_file_path: row.get(3)?,
                    content_hash: row.get(4)?,
                    sync_direction: row.get(5)?,
                    synced_at: row.get(6)?,
                })
            },
        );
        match result {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e)),
        }
    })
}

pub fn get_sync_states_by_type(
    pool: &DbPool,
    entity_type: &str,
) -> Result<Vec<SyncState>, AppError> {
    timed_query!("obsidian_sync_state", "obsidian_sync::get_sync_states_by_type", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, entity_type, entity_id, vault_file_path, content_hash, sync_direction, synced_at
             FROM obsidian_sync_state WHERE entity_type = ?1 ORDER BY synced_at DESC",
        )?;
        let rows = stmt
            .query_map(params![entity_type], |row| {
                Ok(SyncState {
                    id: row.get(0)?,
                    entity_type: row.get(1)?,
                    entity_id: row.get(2)?,
                    vault_file_path: row.get(3)?,
                    content_hash: row.get(4)?,
                    sync_direction: row.get(5)?,
                    synced_at: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn delete_sync_state(
    pool: &DbPool,
    entity_type: &str,
    entity_id: &str,
) -> Result<bool, AppError> {
    timed_query!("obsidian_sync_state", "obsidian_sync::delete_sync_state", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "DELETE FROM obsidian_sync_state WHERE entity_type = ?1 AND entity_id = ?2",
            params![entity_type, entity_id],
        )?;
        Ok(rows > 0)
    })
}

pub fn insert_sync_log(pool: &DbPool, entry: &SyncLogEntry) -> Result<(), AppError> {
    timed_query!("obsidian_sync_log", "obsidian_sync::insert_sync_log", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO obsidian_sync_log (id, sync_type, entity_type, entity_id, vault_file_path, action, details, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry.id,
                entry.sync_type,
                entry.entity_type,
                entry.entity_id,
                entry.vault_file_path,
                entry.action,
                entry.details,
                entry.created_at,
            ],
        )?;
        Ok(())
    })
}

pub fn list_sync_log(
    pool: &DbPool,
    limit: i64,
) -> Result<Vec<SyncLogEntry>, AppError> {
    timed_query!("obsidian_sync_log", "obsidian_sync::list_sync_log", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, sync_type, entity_type, entity_id, vault_file_path, action, details, created_at
             FROM obsidian_sync_log ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(SyncLogEntry {
                    id: row.get(0)?,
                    sync_type: row.get(1)?,
                    entity_type: row.get(2)?,
                    entity_id: row.get(3)?,
                    vault_file_path: row.get(4)?,
                    action: row.get(5)?,
                    details: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}
