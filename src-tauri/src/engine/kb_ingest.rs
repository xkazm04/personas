//! Knowledge base document ingestion pipeline.
//!
//! Orchestrates: read source → chunk → embed → store vectors.
//! Runs as a background job with progress events and cancellation support.

use std::path::Path;
use std::sync::Arc;

use rusqlite::params;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use super::event_registry::event_name;
use crate::db::models::{KbDocument, KbIngestProgress, KnowledgeBase};
use crate::db::UserDbPool;
use crate::error::AppError;

use super::chunker;
use super::embedder::EmbeddingManager;
use super::vector_store::SqliteVectorStore;

/// Batch size for embedding (number of chunks per batch call).
const EMBED_BATCH_SIZE: usize = 32;

/// Ingest files into a knowledge base.
#[allow(clippy::too_many_arguments)]
pub async fn ingest_files(
    app: AppHandle,
    user_db: UserDbPool,
    embedder: Arc<EmbeddingManager>,
    vector_store: Arc<SqliteVectorStore>,
    kb: KnowledgeBase,
    file_paths: Vec<String>,
    job_id: String,
    cancel: CancellationToken,
) -> Result<KbIngestProgress, AppError> {
    let total = file_paths.len();
    let mut progress = KbIngestProgress {
        job_id: job_id.clone(),
        kb_id: kb.id.clone(),
        status: "running".into(),
        documents_total: total,
        documents_done: 0,
        chunks_created: 0,
        current_file: None,
        error: None,
    };

    let max_chars = (kb.chunk_size as usize) * 4; // ~4 chars per token
    let overlap_chars = (kb.chunk_overlap as usize) * 4;

    for (i, file_path) in file_paths.iter().enumerate() {
        if cancel.is_cancelled() {
            progress.status = "cancelled".into();
            return Ok(progress);
        }

        let path = Path::new(file_path);
        let title = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("untitled")
            .to_string();

        progress.current_file = Some(title.clone());
        let _ = app.emit(event_name::KB_INGEST_PROGRESS, &progress);

        match ingest_single_file(
            &user_db,
            &embedder,
            &vector_store,
            &kb,
            path,
            &title,
            max_chars,
            overlap_chars,
        )
        .await
        {
            Ok(chunks) => {
                progress.chunks_created += chunks;
            }
            Err(e) => {
                tracing::warn!(file = %file_path, error = %e, "Failed to ingest file");
                // Continue with next file
            }
        }

        progress.documents_done = i + 1;
        let _ = app.emit(event_name::KB_INGEST_PROGRESS, &progress);
    }

    // Update KB counters
    update_kb_counters(&user_db, &kb.id)?;

    progress.status = "completed".into();
    progress.current_file = None;
    let _ = app.emit(event_name::KB_INGEST_COMPLETE, &progress);

    Ok(progress)
}

/// Ingest raw text into a knowledge base.
pub async fn ingest_text(
    user_db: &UserDbPool,
    embedder: &EmbeddingManager,
    vector_store: &SqliteVectorStore,
    kb: &KnowledgeBase,
    title: &str,
    text: &str,
) -> Result<usize, AppError> {
    let max_chars = (kb.chunk_size as usize) * 4;
    let overlap_chars = (kb.chunk_overlap as usize) * 4;

    let chunk_result = chunker::chunk_text(text, max_chars, overlap_chars);

    // Check if document already exists with same hash
    if document_exists_with_hash(user_db, &kb.id, &chunk_result.content_hash)? {
        tracing::debug!(title, hash = %chunk_result.content_hash, "Document already indexed, skipping");
        return Ok(0);
    }

    let doc_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Insert document record
    {
        let conn = user_db.get()?;
        conn.execute(
            "INSERT INTO kb_documents (id, kb_id, source_type, title, content_hash, byte_size, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                doc_id,
                kb.id,
                "text",
                title,
                chunk_result.content_hash,
                chunk_result.byte_size as i64,
                "indexing",
                now,
            ],
        )?;
    }

    let chunks_created = store_chunks_and_vectors(
        user_db,
        embedder,
        vector_store,
        &kb.id,
        &doc_id,
        &chunk_result.chunks,
    )
    .await?;

    // Mark document as indexed
    {
        let conn = user_db.get()?;
        conn.execute(
            "UPDATE kb_documents SET status = 'indexed', chunk_count = ?1, indexed_at = ?2 WHERE id = ?3",
            params![chunks_created as i32, now, doc_id],
        )?;
    }

    update_kb_counters(user_db, &kb.id)?;

    Ok(chunks_created)
}

/// Ingest a single file.
#[allow(clippy::too_many_arguments)]
async fn ingest_single_file(
    user_db: &UserDbPool,
    embedder: &EmbeddingManager,
    vector_store: &SqliteVectorStore,
    kb: &KnowledgeBase,
    path: &Path,
    title: &str,
    max_chars: usize,
    overlap_chars: usize,
) -> Result<usize, AppError> {
    let chunk_result = chunker::chunk_file(path, max_chars, overlap_chars)?;

    // Skip if already indexed
    if document_exists_with_hash(user_db, &kb.id, &chunk_result.content_hash)? {
        tracing::debug!(title, "Document unchanged, skipping");
        return Ok(0);
    }

    let doc_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let source_path = path.to_string_lossy().to_string();

    // Insert document record
    {
        let conn = user_db.get()?;
        conn.execute(
            "INSERT INTO kb_documents (id, kb_id, source_type, source_path, title, content_hash, byte_size, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                doc_id,
                kb.id,
                "file",
                source_path,
                title,
                chunk_result.content_hash,
                chunk_result.byte_size as i64,
                "indexing",
                now,
            ],
        )?;
    }

    let chunks_created = store_chunks_and_vectors(
        user_db,
        embedder,
        vector_store,
        &kb.id,
        &doc_id,
        &chunk_result.chunks,
    )
    .await?;

    // Mark document as indexed
    {
        let conn = user_db.get()?;
        conn.execute(
            "UPDATE kb_documents SET status = 'indexed', chunk_count = ?1, indexed_at = ?2 WHERE id = ?3",
            params![chunks_created as i32, now, doc_id],
        )?;
    }

    Ok(chunks_created)
}

/// Store chunks in the DB and their embeddings in the vector store.
async fn store_chunks_and_vectors(
    user_db: &UserDbPool,
    embedder: &EmbeddingManager,
    vector_store: &SqliteVectorStore,
    kb_id: &str,
    doc_id: &str,
    chunks: &[chunker::TextChunk],
) -> Result<usize, AppError> {
    if chunks.is_empty() {
        return Ok(0);
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut chunk_ids = Vec::with_capacity(chunks.len());
    let mut texts = Vec::with_capacity(chunks.len());

    // Insert chunk records
    {
        let conn = user_db.get()?;
        let mut stmt = conn.prepare(
            "INSERT INTO kb_chunks (id, kb_id, document_id, chunk_index, content, token_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;

        for chunk in chunks {
            let chunk_id = uuid::Uuid::new_v4().to_string();
            let approx_tokens = (chunk.char_count / 4) as i32;
            stmt.execute(params![
                chunk_id,
                kb_id,
                doc_id,
                chunk.chunk_index as i32,
                chunk.content,
                approx_tokens,
                now,
            ])?;
            chunk_ids.push(chunk_id);
            texts.push(chunk.content.clone());
        }
    }

    // Embed in batches and insert vectors
    for batch_start in (0..texts.len()).step_by(EMBED_BATCH_SIZE) {
        let batch_end = (batch_start + EMBED_BATCH_SIZE).min(texts.len());
        let batch_texts = &texts[batch_start..batch_end];
        let batch_ids = &chunk_ids[batch_start..batch_end];

        let embeddings = embedder.embed_batch(batch_texts).await?;

        let entries: Vec<(String, Vec<f32>)> = batch_ids
            .iter()
            .cloned()
            .zip(embeddings.into_iter())
            .collect();

        vector_store.insert_vectors(kb_id, &entries)?;
    }

    Ok(chunks.len())
}

/// Check if a document with the given content hash already exists in the KB.
fn document_exists_with_hash(
    user_db: &UserDbPool,
    kb_id: &str,
    content_hash: &str,
) -> Result<bool, AppError> {
    let conn = user_db.get()?;
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM kb_documents WHERE kb_id = ?1 AND content_hash = ?2 AND status = 'indexed'",
        params![kb_id, content_hash],
        |row| row.get(0),
    )?;
    Ok(exists)
}

/// Recalculate and update the document_count and chunk_count on the knowledge base.
fn update_kb_counters(user_db: &UserDbPool, kb_id: &str) -> Result<(), AppError> {
    let conn = user_db.get()?;
    conn.execute(
        "UPDATE knowledge_bases SET
            document_count = (SELECT COUNT(*) FROM kb_documents WHERE kb_id = ?1 AND status = 'indexed'),
            chunk_count = (SELECT COUNT(*) FROM kb_chunks WHERE kb_id = ?1),
            updated_at = datetime('now')
         WHERE id = ?1",
        params![kb_id],
    )?;
    Ok(())
}

/// Get a knowledge base by ID from the user database.
pub fn get_kb(user_db: &UserDbPool, kb_id: &str) -> Result<KnowledgeBase, AppError> {
    let conn = user_db.get()?;
    conn.query_row(
        "SELECT id, credential_id, name, description, embedding_model, embedding_dims,
                chunk_size, chunk_overlap, document_count, chunk_count, status,
                created_at, updated_at
         FROM knowledge_bases WHERE id = ?1",
        params![kb_id],
        |row| {
            Ok(KnowledgeBase {
                id: row.get(0)?,
                credential_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                embedding_model: row.get(4)?,
                embedding_dims: row.get(5)?,
                chunk_size: row.get(6)?,
                chunk_overlap: row.get(7)?,
                document_count: row.get(8)?,
                chunk_count: row.get(9)?,
                status: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
    )
    .map_err(|_| AppError::NotFound(format!("Knowledge base not found: {kb_id}")))
}

/// List all documents in a knowledge base.
pub fn list_kb_documents(user_db: &UserDbPool, kb_id: &str) -> Result<Vec<KbDocument>, AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, kb_id, source_type, source_path, title, content_hash, byte_size,
                chunk_count, metadata_json, status, error_message, indexed_at, created_at
         FROM kb_documents WHERE kb_id = ?1 ORDER BY created_at DESC",
    )?;

    let rows = stmt
        .query_map(params![kb_id], |row| {
            Ok(KbDocument {
                id: row.get(0)?,
                kb_id: row.get(1)?,
                source_type: row.get(2)?,
                source_path: row.get(3)?,
                title: row.get(4)?,
                content_hash: row.get(5)?,
                byte_size: row.get(6)?,
                chunk_count: row.get(7)?,
                metadata_json: row.get(8)?,
                status: row.get(9)?,
                error_message: row.get(10)?,
                indexed_at: row.get(11)?,
                created_at: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}
