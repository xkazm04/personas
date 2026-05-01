//! Embedding pipeline for the companion brain.
//!
//! Reuses the existing `engine::embedder::EmbeddingManager` (AllMiniLML6V2Q,
//! 384-dim) and the `sqlite-vec` extension already wired by
//! `engine::vector_store`. No new model bundling.
//!
//! The `companion_embedding` vec0 virtual table is created at runtime (not
//! at migration time) so that sqlite-vec auto-extension registration on
//! every connection from the pool runs first. Mirrors how knowledge bases
//! provision their per-KB vec0 tables in
//! `engine::vector_store::SqliteVectorStore::create_index`.
//!
//! Schema columns `embedding_model` and `embedding_dims` on `companion_node`
//! exist so we can swap models without a schema break — a reindex job is
//! sufficient.

#[cfg(feature = "ml")]
use std::sync::Arc;
#[cfg(feature = "ml")]
use std::sync::Once;

use rusqlite::params;

use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Native dim for AllMiniLML6V2Q (the model the app already ships with).
pub const COMPANION_VEC_DIMS: usize = 384;

/// Ensures the `companion_embedding` vec0 virtual table exists. Cheap to
/// call repeatedly — gated by a `Once` so we only run it once per process.
#[cfg(feature = "ml")]
static INIT_VEC_TABLE: Once = Once::new();

#[cfg(feature = "ml")]
pub fn ensure_vec_table(pool: &UserDbPool) -> Result<(), AppError> {
    let mut result: Result<(), AppError> = Ok(());
    INIT_VEC_TABLE.call_once(|| {
        result = (|| -> Result<(), AppError> {
            let conn = pool.get()?;
            conn.execute_batch(&format!(
                "CREATE VIRTUAL TABLE IF NOT EXISTS companion_embedding USING vec0(node_id TEXT, embedding float[{COMPANION_VEC_DIMS}])"
            ))?;
            tracing::info!(dims = COMPANION_VEC_DIMS, "companion_embedding table ready");
            Ok(())
        })();
    });
    result
}

#[cfg(not(feature = "ml"))]
pub fn ensure_vec_table(_pool: &UserDbPool) -> Result<(), AppError> {
    Ok(())
}

/// Embed `text` and write to `companion_embedding`. Best-effort — caller
/// can choose to swallow errors so embedding failure doesn't fail the
/// surrounding write (e.g., we still want the episode persisted to disk
/// + companion_node even if embedding fails).
#[cfg(feature = "ml")]
pub async fn embed_and_store(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    node_id: &str,
    text: &str,
) -> Result<(), AppError> {
    ensure_vec_table(pool)?;
    let vec = embedder.embed_query(text).await?;
    if vec.len() != COMPANION_VEC_DIMS {
        return Err(AppError::Internal(format!(
            "embedder produced {} dims, expected {COMPANION_VEC_DIMS}",
            vec.len()
        )));
    }
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_embedding (node_id, embedding) VALUES (?1, ?2)",
        params![node_id, blob],
    )?;
    Ok(())
}

#[cfg(not(feature = "ml"))]
pub async fn embed_and_store(
    _pool: &UserDbPool,
    _node_id: &str,
    _text: &str,
) -> Result<(), AppError> {
    Ok(())
}

/// Cosine search over `companion_embedding`. Returns (node_id, distance)
/// ordered by ascending distance (smaller = closer).
#[cfg(feature = "ml")]
pub async fn search_similar(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    query: &str,
    k: usize,
) -> Result<Vec<(String, f32)>, AppError> {
    ensure_vec_table(pool)?;
    let vec = embedder.embed_query(query).await?;
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = pool.get()?;
    // Empty vec table → silent empty result, not an error.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM companion_embedding", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT node_id, distance FROM companion_embedding
         WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![blob, k as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(not(feature = "ml"))]
pub async fn search_similar(
    _pool: &UserDbPool,
    _query: &str,
    _k: usize,
) -> Result<Vec<(String, f32)>, AppError> {
    Ok(Vec::new())
}
