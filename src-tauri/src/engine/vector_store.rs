//! SQLite-vec based vector store for knowledge bases.
//!
//! Each knowledge base gets its own `vec0` virtual table for vector storage.
//! Vectors are stored alongside metadata in regular SQLite tables.
//!
//! sqlite-vec is registered as an auto-extension, so every connection from the
//! pool automatically has vec0 available.

use std::sync::Once;

use rusqlite::params;

use crate::db::UserDbPool;
use crate::error::AppError;

/// Register sqlite-vec as a global auto-extension.
/// Safe to call multiple times — only the first call takes effect.
static INIT_VEC: Once = Once::new();

fn ensure_vec_registered() {
    INIT_VEC.call_once(|| {
        // SAFETY: sqlite3_vec_init has the signature expected by sqlite3_auto_extension
        // (xEntryPoint: extern "C" fn(*mut sqlite3, *mut *const c_char, *const sqlite3_api_routines) -> c_int).
        // This is guaranteed by the sqlite-vec crate's public API.
        unsafe {
            #[allow(clippy::missing_transmute_annotations)]
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }
        tracing::info!("sqlite-vec extension registered as auto-extension");
    });
}

/// Wraps the user-facing database with sqlite-vec extension for vector operations.
pub struct SqliteVectorStore {
    pool: UserDbPool,
}

impl SqliteVectorStore {
    /// Create a new vector store wrapping the user database pool.
    /// Registers sqlite-vec as a global auto-extension on first call.
    pub fn new(pool: UserDbPool) -> Self {
        ensure_vec_registered();
        Self { pool }
    }

    /// Create the vector virtual table for a knowledge base.
    pub fn create_index(&self, kb_id: &str, dims: usize) -> Result<(), AppError> {
        let conn = self.pool.get()?;
        let table_name = vec_table_name(kb_id)?;
        let sql = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS [{table_name}] USING vec0(chunk_id TEXT, embedding float[{dims}])"
        );
        conn.execute_batch(&sql)?;
        tracing::debug!(kb_id, dims, "Created vector index table {table_name}");
        Ok(())
    }

    /// Drop the vector virtual table for a knowledge base.
    pub fn drop_index(&self, kb_id: &str) -> Result<(), AppError> {
        let conn = self.pool.get()?;
        let table_name = vec_table_name(kb_id)?;
        conn.execute_batch(&format!("DROP TABLE IF EXISTS [{table_name}]"))?;
        tracing::debug!(kb_id, "Dropped vector index table {table_name}");
        Ok(())
    }

    /// Insert a batch of (chunk_id, embedding) pairs.
    pub fn insert_vectors(
        &self,
        kb_id: &str,
        entries: &[(String, Vec<f32>)],
    ) -> Result<usize, AppError> {
        if entries.is_empty() {
            return Ok(0);
        }

        let conn = self.pool.get()?;
        let table_name = vec_table_name(kb_id)?;
        let sql = format!(
            "INSERT INTO [{table_name}] (chunk_id, embedding) VALUES (?1, ?2)"
        );
        let mut stmt = conn.prepare(&sql)?;

        let mut count = 0;
        for (chunk_id, embedding) in entries {
            let blob = vec_f32_to_blob(embedding);
            stmt.execute(params![chunk_id, blob])?;
            count += 1;
        }

        Ok(count)
    }

    /// K-nearest-neighbor similarity search.
    /// Returns (chunk_id, distance) pairs ordered by ascending distance.
    pub fn search(
        &self,
        kb_id: &str,
        query_vec: &[f32],
        k: usize,
    ) -> Result<Vec<(String, f32)>, AppError> {
        let conn = self.pool.get()?;
        let table_name = vec_table_name(kb_id)?;
        let blob = vec_f32_to_blob(query_vec);

        let sql = format!(
            "SELECT chunk_id, distance FROM [{table_name}] WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt
            .query_map(params![blob, k as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    /// Delete vectors by chunk IDs.
    pub fn delete_by_chunks(
        &self,
        kb_id: &str,
        chunk_ids: &[String],
    ) -> Result<usize, AppError> {
        let conn = self.pool.get()?;
        delete_vectors_by_chunks(&conn, kb_id, chunk_ids)
    }

    /// Count vectors in a knowledge base.
    pub fn count(&self, kb_id: &str) -> Result<usize, AppError> {
        let conn = self.pool.get()?;
        let table_name = vec_table_name(kb_id)?;
        let sql = format!("SELECT COUNT(*) FROM [{table_name}]");
        let count: i64 = conn.query_row(&sql, [], |row| row.get(0))?;
        Ok(count as usize)
    }
}

/// Delete vectors by chunk IDs using an externally-provided connection.
/// This allows callers to include vector deletes inside their own transaction.
pub fn delete_vectors_by_chunks(
    conn: &rusqlite::Connection,
    kb_id: &str,
    chunk_ids: &[String],
) -> Result<usize, AppError> {
    if chunk_ids.is_empty() {
        return Ok(0);
    }

    let table_name = vec_table_name(kb_id)?;
    let placeholders: Vec<String> = (1..=chunk_ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "DELETE FROM [{table_name}] WHERE chunk_id IN ({})",
        placeholders.join(",")
    );

    let params: Vec<&dyn rusqlite::types::ToSql> = chunk_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();

    let deleted = conn.execute(&sql, params.as_slice())?;
    Ok(deleted)
}

/// Sanitize a KB ID into a safe SQLite table name suffix.
/// Validates that kb_id contains only hex digits and hyphens (UUID format)
/// to prevent SQL injection via dynamic table names.
fn vec_table_name(kb_id: &str) -> Result<String, AppError> {
    if kb_id.is_empty()
        || !kb_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err(AppError::Validation(
            "Invalid knowledge base ID format".into(),
        ));
    }
    let safe = kb_id.replace('-', "_");
    Ok(format!("kb_vec_{safe}"))
}

/// Convert a Vec<f32> to a byte blob for sqlite-vec.
fn vec_f32_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}
