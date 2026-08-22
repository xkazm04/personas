use rusqlite::params;

use crate::models::{RevitalizeRunRecord, SyncLogEntry, SyncState};
use crate::DbPool;
use personas_core::error::AppError;

// One projection + one mapper per table, so a SELECT and its mapping cannot
// disagree. Every mapper below binds by column NAME; the const column order
// mirrors the `CREATE TABLE` purely so the two read alike.
const SYNC_STATE_COLUMNS: &str =
    "id, entity_type, entity_id, vault_file_path, content_hash, sync_direction, synced_at";

row_mapper!(row_to_sync_state -> SyncState {
    id,
    entity_type,
    entity_id,
    vault_file_path,
    content_hash,
    sync_direction,
    synced_at,
});

const SYNC_LOG_COLUMNS: &str =
    "id, sync_type, entity_type, entity_id, vault_file_path, action, details, created_at";

row_mapper!(row_to_sync_log -> SyncLogEntry {
    id,
    sync_type,
    entity_type,
    entity_id,
    vault_file_path,
    action,
    details,
    created_at,
});

const REVITALIZE_RUN_COLUMNS: &str = "id, vault_name, vault_path, status, error,                                       files_deleted, files_merged, files_updated, files_reviewed,                                       notes_before, notes_after, est_tokens_before, est_tokens_after,                                       duration_secs, started_at, created_at";

row_mapper!(row_to_revitalize_run -> RevitalizeRunRecord {
    id,
    vault_name,
    vault_path,
    status,
    error,
    files_deleted,
    files_merged,
    files_updated,
    files_reviewed,
    notes_before,
    notes_after,
    est_tokens_before,
    est_tokens_after,
    duration_secs,
    started_at,
    created_at,
});

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
            &format!(
                "SELECT {SYNC_STATE_COLUMNS} FROM obsidian_sync_state WHERE entity_type = ?1 AND entity_id = ?2"
            ),
            params![entity_type, entity_id],
            row_to_sync_state,
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
    timed_query!(
        "obsidian_sync_state",
        "obsidian_sync::get_sync_states_by_type",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {SYNC_STATE_COLUMNS} FROM obsidian_sync_state WHERE entity_type = ?1 ORDER BY synced_at DESC"
            ))?;
            let rows = stmt
                .query_map(params![entity_type], row_to_sync_state)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
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

pub fn list_sync_log(pool: &DbPool, limit: i64) -> Result<Vec<SyncLogEntry>, AppError> {
    timed_query!("obsidian_sync_log", "obsidian_sync::list_sync_log", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SYNC_LOG_COLUMNS} FROM obsidian_sync_log ORDER BY created_at DESC LIMIT ?1"
        ))?;
        let rows = stmt
            .query_map(params![limit], row_to_sync_log)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

// ── Revitalize run history ───────────────────────────────────────────

pub fn insert_revitalize_run(pool: &DbPool, run: &RevitalizeRunRecord) -> Result<(), AppError> {
    timed_query!(
        "obsidian_revitalize_runs",
        "obsidian_revitalize::insert_run",
        {
            let conn = pool.get()?;
            conn.execute(
                "INSERT INTO obsidian_revitalize_runs (
                    id, vault_name, vault_path, status, error,
                    files_deleted, files_merged, files_updated, files_reviewed,
                    notes_before, notes_after, est_tokens_before, est_tokens_after,
                    duration_secs, started_at, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    run.id,
                    run.vault_name,
                    run.vault_path,
                    run.status,
                    run.error,
                    run.files_deleted,
                    run.files_merged,
                    run.files_updated,
                    run.files_reviewed,
                    run.notes_before,
                    run.notes_after,
                    run.est_tokens_before,
                    run.est_tokens_after,
                    run.duration_secs,
                    run.started_at,
                    run.created_at,
                ],
            )?;
            Ok(())
        }
    )
}

pub fn list_revitalize_runs(
    pool: &DbPool,
    limit: i64,
) -> Result<Vec<RevitalizeRunRecord>, AppError> {
    timed_query!(
        "obsidian_revitalize_runs",
        "obsidian_revitalize::list_runs",
        {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {REVITALIZE_RUN_COLUMNS} FROM obsidian_revitalize_runs ORDER BY created_at DESC LIMIT ?1"
            ))?;
            let rows = stmt
                .query_map(params![limit], row_to_revitalize_run)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        }
    )
}
