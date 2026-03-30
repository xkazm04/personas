//! Clipboard intelligence: search knowledge bases for error resolutions.
//!
//! When an error is detected in clipboard content, this module searches across
//! all knowledge bases in the vector store for similar past resolutions.

use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::error::AppError;
use crate::AppState;

/// A knowledge base match result from vector search.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbMatch {
    /// Name of the knowledge base that contained the match.
    pub kb_name: String,
    /// The chunk text that matched.
    pub chunk_text: String,
    /// Cosine similarity score (0.0 = no similarity, lower distance = better match).
    pub similarity: f32,
    /// Source file path of the matched chunk (if available).
    pub source_file: Option<String>,
}

/// Search all knowledge bases for content similar to the given error query.
///
/// Returns up to `limit` matches sorted by similarity (best first).
/// This is called internally by the clipboard watcher — not exposed as a Tauri command
/// to avoid leaking clipboard content to the frontend unnecessarily.
pub fn search_kb_for_error(
    state: &AppState,
    query: &str,
    limit: usize,
) -> Result<Vec<KbMatch>, AppError> {
    let embedding_manager = state.embedding_manager.as_ref().ok_or_else(|| {
        AppError::Internal("Embedding manager not available".into())
    })?;
    let vector_store = state.vector_store.as_ref().ok_or_else(|| {
        AppError::Internal("Vector store not available".into())
    })?;

    // Get the query embedding synchronously via a blocking spawn
    let query_text = query.to_string();
    let em = embedding_manager.clone();
    let query_vec = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(em.embed_query(&query_text))
    })?;

    // List all knowledge bases from user_db
    let user_conn = state.user_db.get()?;
    let kb_list = list_all_kbs(&user_conn)?;

    if kb_list.is_empty() {
        return Ok(Vec::new());
    }

    let mut all_matches: Vec<KbMatch> = Vec::new();

    for (kb_id, kb_name) in &kb_list {
        // Search this KB's vector index; skip if it doesn't exist yet
        let results = match vector_store.search(kb_id, &query_vec, limit) {
            Ok(r) => r,
            Err(_) => continue, // KB may not have been indexed yet
        };

        for (chunk_id, distance) in results {
            // Convert distance to similarity (sqlite-vec returns L2 distance;
            // lower = more similar). We normalise to 0..1 range where 1 = identical.
            let similarity = 1.0 / (1.0 + distance);

            // Look up the chunk text and source file from kb_chunks / kb_documents
            let (chunk_text, source_file) =
                lookup_chunk_content(&user_conn, &chunk_id).unwrap_or_default();

            if chunk_text.is_empty() {
                continue;
            }

            all_matches.push(KbMatch {
                kb_name: kb_name.clone(),
                chunk_text,
                similarity,
                source_file,
            });
        }
    }

    // Sort by similarity descending (best first)
    all_matches.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    all_matches.truncate(limit);

    Ok(all_matches)
}

/// Tauri command wrapper for manual KB error search from the frontend.
#[tauri::command]
pub async fn search_kb_for_clipboard_error(
    state: State<'_, Arc<AppState>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<KbMatch>, AppError> {
    let limit = limit.unwrap_or(3);
    search_kb_for_error(&state, &query, limit)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// List all knowledge base (id, name) pairs from the user database.
fn list_all_kbs(conn: &rusqlite::Connection) -> Result<Vec<(String, String)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name FROM knowledge_bases WHERE status = 'ready' ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Look up a chunk's text content and its document's source path.
fn lookup_chunk_content(
    conn: &rusqlite::Connection,
    chunk_id: &str,
) -> Result<(String, Option<String>), AppError> {
    let mut stmt = conn.prepare(
        "SELECT c.content, d.source_path
         FROM kb_chunks c
         LEFT JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id = ?1",
    )?;
    let result = stmt.query_row(params![chunk_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    })?;
    Ok(result)
}
