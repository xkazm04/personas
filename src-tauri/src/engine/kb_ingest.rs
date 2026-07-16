//! Knowledge base document ingestion pipeline.
//!
//! Orchestrates: read source → chunk → embed → store vectors.
//! Runs as a background job with progress events and cancellation support.

use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use super::event_registry::event_name;
use crate::db::models::{KbDocument, KbIngestProgress, KnowledgeBase};
use crate::db::UserDbPool;
use crate::error::AppError;

use super::chunker;
use super::embedder::EmbeddingManager;
use super::vector_store::{delete_vectors_by_chunks, SqliteVectorStore};

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

    // Track per-file failures so the final status reflects reality. Without
    // this the job reports "completed" even when every document failed —
    // success theater that hides a fully-broken ingest behind a green check.
    let mut failed_count = 0usize;
    let mut last_error: Option<String> = None;

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
                failed_count += 1;
                last_error = Some(e.to_string());
                // Continue with the next file
            }
        }

        progress.documents_done = i + 1;
        let _ = app.emit(event_name::KB_INGEST_PROGRESS, &progress);
    }

    // Update KB counters
    update_kb_counters(&user_db, &kb.id)?;

    progress.current_file = None;
    // Don't report success when ingestion didn't actually succeed. If *every*
    // document failed this is a failure, not a "completed" job. A partial
    // failure stays "completed" (some chunks did land) but populates `error`
    // with the failed count so the UI shows an error state instead of a silent
    // green check.
    if total > 0 && failed_count == total {
        progress.status = "failed".into();
        progress.error = Some(match &last_error {
            Some(e) => format!("All {total} document(s) failed to ingest: {e}"),
            None => format!("All {total} document(s) failed to ingest"),
        });
    } else if failed_count > 0 {
        progress.status = "completed".into();
        progress.error = Some(format!(
            "{failed_count} of {total} document(s) failed to ingest"
        ));
    } else {
        progress.status = "completed".into();
    }
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

    match store_chunks_and_vectors(
        user_db,
        embedder,
        vector_store,
        &kb.id,
        &doc_id,
        &chunk_result.chunks,
    )
    .await
    {
        Ok(chunks_created) => {
            // Mark document as indexed
            let conn = user_db.get()?;
            conn.execute(
                "UPDATE kb_documents SET status = 'indexed', chunk_count = ?1, indexed_at = ?2 WHERE id = ?3",
                params![chunks_created as i32, now, doc_id],
            )?;
            update_kb_counters(user_db, &kb.id)?;
            Ok(chunks_created)
        }
        Err(e) => {
            mark_document_failed(user_db, &doc_id, &e.to_string())?;
            Err(e)
        }
    }
}

/// Re-embed an entire knowledge base end-to-end.
///
/// Drops and recreates the vec0 index, then re-embeds *every stored chunk*
/// (their text is persisted in `kb_chunks`, so no source files are re-read)
/// with the CURRENT embedding model, keying vectors by the existing chunk ids.
/// Because it rebuilds the index to the current model's dimensionality and
/// records that model on the KB row, reindex is the canonical fix for the
/// "indexed with model X but current model is Y — re-index to search it"
/// guard in `kb_search`.
///
/// Progress is reported on the same `kb:ingest_progress` / `kb:ingest_complete`
/// events the ingest job uses, with `documents_total`/`documents_done` tracking
/// chunk progress so the existing progress bar renders it unchanged. Honors the
/// `CancellationToken` between embedding batches (delete_knowledge_base cancels
/// by kb_id).
pub async fn reindex_kb(
    app: AppHandle,
    user_db: UserDbPool,
    embedder: Arc<EmbeddingManager>,
    vector_store: Arc<SqliteVectorStore>,
    kb: KnowledgeBase,
    job_id: String,
    cancel: CancellationToken,
) -> Result<KbIngestProgress, AppError> {
    // Snapshot every chunk's id + text, ordered so re-embedding is deterministic.
    let chunks: Vec<(String, String)> = {
        let conn = user_db.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, content FROM kb_chunks WHERE kb_id = ?1 ORDER BY document_id, chunk_index",
        )?;
        let rows = stmt
            .query_map(params![kb.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    let total = chunks.len();
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
    let _ = app.emit(event_name::KB_INGEST_PROGRESS, &progress);

    // Rebuild the vector table to the current model's geometry. DROP + CREATE is
    // what lets reindex recover from a model/dims change; a same-model reindex
    // simply repopulates the fresh table.
    let dims = embedder.dimensions();
    vector_store.drop_index(&kb.id)?;
    vector_store.create_index(&kb.id, dims)?;

    for batch_start in (0..chunks.len()).step_by(EMBED_BATCH_SIZE) {
        if cancel.is_cancelled() {
            progress.status = "cancelled".into();
            let _ = app.emit(event_name::KB_INGEST_COMPLETE, &progress);
            return Ok(progress);
        }

        let batch_end = (batch_start + EMBED_BATCH_SIZE).min(chunks.len());
        let batch = &chunks[batch_start..batch_end];
        let batch_ids: Vec<String> = batch.iter().map(|(id, _)| id.clone()).collect();
        let batch_texts: Vec<String> = batch.iter().map(|(_, c)| c.clone()).collect();

        let embeddings = embedder.embed_batch(&batch_texts).await?;
        if embeddings.len() != batch_texts.len() {
            return Err(AppError::Internal(format!(
                "embed_batch returned {} vectors for {} inputs during reindex",
                embeddings.len(),
                batch_texts.len()
            )));
        }

        let entries: Vec<(String, Vec<f32>)> =
            batch_ids.into_iter().zip(embeddings.into_iter()).collect();
        vector_store.insert_vectors(&kb.id, &entries)?;

        progress.chunks_created += batch.len();
        progress.documents_done = batch_end;
        let _ = app.emit(event_name::KB_INGEST_PROGRESS, &progress);
    }

    // Record the model/dims we just rebuilt against so kb_search's model
    // reconciliation guard passes for this KB.
    {
        let conn = user_db.get()?;
        conn.execute(
            "UPDATE knowledge_bases SET embedding_model = ?1, embedding_dims = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![embedder.model_name(), dims as i64, kb.id],
        )?;
    }
    update_kb_counters(&user_db, &kb.id)?;

    progress.current_file = None;
    progress.status = "completed".into();
    let _ = app.emit(event_name::KB_INGEST_COMPLETE, &progress);

    Ok(progress)
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
    let source_path = path.to_string_lossy().to_string();

    // Supersede-on-reingest. The old hash-only dedup was insert-only: editing a
    // source file produced a *new* document (different hash) while the previous
    // version's chunks + vectors lingered forever — double-indexed, with stale
    // passages still winning searches. Resolve by PATH first:
    //   - a prior indexed document at this exact path with the SAME hash means
    //     the file is unchanged → skip (as before);
    //   - the SAME path with a DIFFERENT hash means the file was edited →
    //     supersede: delete the old document (chunks + vectors + row) inside one
    //     transaction, then index the new content below. No orphaned vectors, no
    //     double-count.
    if let Some((old_doc_id, old_hash)) =
        find_indexed_document_by_path(user_db, &kb.id, &source_path)?
    {
        if old_hash == chunk_result.content_hash {
            tracing::debug!(title, "Document unchanged, skipping");
            return Ok(0);
        }
        tracing::info!(
            title,
            old_doc_id = %old_doc_id,
            "Source file changed since last ingest; superseding old document"
        );
        delete_document_cascade(user_db, &kb.id, &old_doc_id)?;
    } else if document_exists_with_hash(user_db, &kb.id, &chunk_result.content_hash)? {
        // No document at this path, but identical content is already indexed
        // elsewhere in the KB (e.g. the same file copied under two names) —
        // keep the existing hash-dedup behavior and skip.
        tracing::debug!(title, "Document content already indexed, skipping");
        return Ok(0);
    }

    let doc_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Insert document record
    {
        let conn = user_db.get()?;
        conn.execute(
            "INSERT INTO kb_documents (id, kb_id, source_type, source_path, title, content_hash, byte_size,
                                       page_count, empty_pages, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                doc_id,
                kb.id,
                "file",
                source_path,
                title,
                chunk_result.content_hash,
                chunk_result.byte_size as i64,
                chunk_result.page_count,
                chunk_result.empty_pages,
                "indexing",
                now,
            ],
        )?;
    }

    // A paginated document where *every* page came back empty is a scanned
    // PDF: we can read no text from it at all. Storing zero chunks and calling
    // that "indexed" is the failure this guard exists to prevent — the user
    // would get a green check and then silently empty search results forever.
    // Fail with the actual reason so they know they need an OCR'd copy.
    if chunk_result.chunks.is_empty() && chunk_result.empty_pages > 0 {
        let msg = format!(
            "No text layer found in any of the {} page(s) — this looks like a scanned document. \
             Personas reads the PDF text layer and does not run OCR, so an OCR'd copy is needed.",
            chunk_result.empty_pages
        );
        mark_document_failed(user_db, &doc_id, &msg)?;
        return Err(AppError::Validation(msg));
    }

    match store_chunks_and_vectors(
        user_db,
        embedder,
        vector_store,
        &kb.id,
        &doc_id,
        &chunk_result.chunks,
    )
    .await
    {
        Ok(chunks_created) => {
            // Mark document as indexed
            let conn = user_db.get()?;
            conn.execute(
                "UPDATE kb_documents SET status = 'indexed', chunk_count = ?1, indexed_at = ?2 WHERE id = ?3",
                params![chunks_created as i32, now, doc_id],
            )?;
            Ok(chunks_created)
        }
        Err(e) => {
            mark_document_failed(user_db, &doc_id, &e.to_string())?;
            Err(e)
        }
    }
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
            "INSERT INTO kb_chunks (id, kb_id, document_id, chunk_index, content, token_count,
                                    source_page, extraction_confidence, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
                chunk.page,
                chunk.extraction_confidence,
                now,
            ])?;
            chunk_ids.push(chunk_id);
            texts.push(chunk.content.clone());
        }
    }

    // Embed in batches and insert vectors
    let embed_result =
        embed_and_store_vectors(embedder, vector_store, kb_id, &chunk_ids, &texts).await;

    if let Err(e) = embed_result {
        // Clean up orphaned chunks and any partial vectors on embedding failure
        tracing::warn!(doc_id, error = %e, "Embedding failed, cleaning up orphaned chunks");
        cleanup_orphaned_chunks(user_db, vector_store, kb_id, &chunk_ids);
        return Err(e);
    }

    Ok(chunks.len())
}

/// Run embedding batches and store vectors. Separated so the caller can clean up on failure.
async fn embed_and_store_vectors(
    embedder: &EmbeddingManager,
    vector_store: &SqliteVectorStore,
    kb_id: &str,
    chunk_ids: &[String],
    texts: &[String],
) -> Result<(), AppError> {
    for batch_start in (0..texts.len()).step_by(EMBED_BATCH_SIZE) {
        let batch_end = (batch_start + EMBED_BATCH_SIZE).min(texts.len());
        let batch_texts = &texts[batch_start..batch_end];
        let batch_ids = &chunk_ids[batch_start..batch_end];

        let embeddings = embedder.embed_batch(batch_texts).await?;

        // embed_batch must return exactly one vector per input, in order. If the
        // embedder (ONNX/fastembed) ever returns fewer, zip() would silently
        // truncate — leaving chunk rows with no vector (permanently unsearchable)
        // and an inflated document counter (bug-hunt 2026-06-07 mcp #3). Fail
        // loudly so the caller's cleanup_orphaned_chunks path runs.
        if embeddings.len() != batch_texts.len() {
            return Err(AppError::Internal(format!(
                "embed_batch returned {} vectors for {} inputs",
                embeddings.len(),
                batch_texts.len()
            )));
        }

        let entries: Vec<(String, Vec<f32>)> = batch_ids
            .iter()
            .cloned()
            .zip(embeddings.into_iter())
            .collect();

        vector_store.insert_vectors(kb_id, &entries)?;
    }

    Ok(())
}

/// Remove orphaned chunk rows and their vectors after an embedding failure.
///
/// **Atomicity** (added 2026-05-05): both deletes run inside a single
/// `rusqlite::Transaction` on the user-db pool (the same pool the vector
/// store wraps — see `SqliteVectorStore::new`). Without the tx, a partial
/// failure left the KB in one of two corrupt shapes:
///   - chunks deleted, vectors retained → searches return zombie chunk_ids
///     that 404 on lookup;
///   - vectors deleted, chunks retained → silent search misses, plus the
///     next ingest re-creates duplicate chunks.
/// This function is itself best-effort (errors are logged, not propagated)
/// because the caller is already in the failure path; but failing partially
/// is strictly worse than failing entirely.
///
/// `_vector_store` is unused here now that we hold the connection ourselves,
/// but the parameter stays for call-site stability and to make the dependency
/// explicit at the function boundary.
fn cleanup_orphaned_chunks(
    user_db: &UserDbPool,
    _vector_store: &SqliteVectorStore,
    kb_id: &str,
    chunk_ids: &[String],
) {
    if chunk_ids.is_empty() {
        return;
    }
    let mut conn = match user_db.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "Failed to acquire user_db connection for orphan cleanup");
            return;
        }
    };
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "Failed to begin orphan-cleanup transaction");
            return;
        }
    };

    if let Err(e) = delete_vectors_by_chunks(&tx, kb_id, chunk_ids) {
        tracing::error!(error = %e, "Failed to delete orphaned vectors during cleanup; rolling back");
        // tx drops on early return → automatic rollback.
        return;
    }

    let placeholders: Vec<String> = (1..=chunk_ids.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "DELETE FROM kb_chunks WHERE id IN ({})",
        placeholders.join(",")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = chunk_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    if let Err(e) = tx.execute(&sql, params.as_slice()) {
        tracing::error!(error = %e, "Failed to delete orphaned chunks during cleanup; rolling back");
        return;
    }

    if let Err(e) = tx.commit() {
        tracing::error!(error = %e, "Failed to commit orphan-cleanup transaction");
    }
}

/// Mark a document as failed and record the error message.
/// This prevents zombie documents that are stuck in "indexing" status forever.
fn mark_document_failed(
    user_db: &UserDbPool,
    doc_id: &str,
    error_msg: &str,
) -> Result<(), AppError> {
    let conn = user_db.get()?;
    conn.execute(
        "UPDATE kb_documents SET status = 'failed', error_message = ?1 WHERE id = ?2",
        params![error_msg, doc_id],
    )?;
    Ok(())
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

/// Find an already-indexed document in this KB whose `source_path` matches,
/// returning `(document_id, content_hash)` when present. This is the anchor for
/// supersede-on-reingest: a file is identified by its path, so a re-ingest of
/// the same path is an update of that document rather than a brand-new one.
fn find_indexed_document_by_path(
    user_db: &UserDbPool,
    kb_id: &str,
    source_path: &str,
) -> Result<Option<(String, String)>, AppError> {
    let conn = user_db.get()?;
    let row = conn
        .query_row(
            "SELECT id, content_hash FROM kb_documents
             WHERE kb_id = ?1 AND source_path = ?2 AND status = 'indexed'
             ORDER BY created_at DESC LIMIT 1",
            params![kb_id, source_path],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    Ok(row)
}

/// Delete a superseded (or otherwise unwanted) document end-to-end: its vectors,
/// its chunks, and the document row — all in ONE transaction on the user-db
/// pool (the same pool the vector store wraps). Mirrors the atomicity contract
/// of [`cleanup_orphaned_chunks`]: a partial delete would either leave vectors
/// pointing at deleted chunks (zombie search hits) or chunks with no vectors
/// (silent misses), so the three deletes commit together or not at all.
fn delete_document_cascade(
    user_db: &UserDbPool,
    kb_id: &str,
    doc_id: &str,
) -> Result<(), AppError> {
    let mut conn = user_db.get()?;
    let tx = conn.transaction()?;

    let chunk_ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM kb_chunks WHERE document_id = ?1")?;
        let ids = stmt
            .query_map(params![doc_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };

    delete_vectors_by_chunks(&tx, kb_id, &chunk_ids)?;
    tx.execute(
        "DELETE FROM kb_chunks WHERE document_id = ?1",
        params![doc_id],
    )?;
    tx.execute("DELETE FROM kb_documents WHERE id = ?1", params![doc_id])?;
    tx.commit()?;
    Ok(())
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

/// Render a knowledge base as a compact Markdown **corpus map**: what is in
/// here, how big each document is, and which parts are unreliable.
///
/// This exists because semantic search alone gives an agent no sense of the
/// shape of a corpus. Asked "how many footings are in the warehouse slab?",
/// an agent with only a search tool must guess query terms and hope; it cannot
/// tell whether the KB even contains structural drawings, whether the relevant
/// document is one page or two hundred, or whether half of it is a scan it
/// cannot read. It reads the map first — a few hundred tokens — and only then
/// searches, with the vocabulary and the caveats already in hand.
///
/// The map deliberately reports what is *missing* (scanned pages, failed
/// documents) as prominently as what is present. A confident-sounding answer
/// drawn from a corpus that is 40% unreadable scans is the failure this is
/// meant to prevent.
pub fn kb_corpus_map(user_db: &UserDbPool, kb_id: &str) -> Result<String, AppError> {
    let kb = get_kb(user_db, kb_id)?;
    let docs = list_kb_documents(user_db, kb_id)?;

    let mut out = String::new();
    out.push_str(&format!("# Knowledge base: {}\n\n", kb.name));
    if let Some(desc) = kb.description.as_deref().filter(|d| !d.trim().is_empty()) {
        out.push_str(&format!("{desc}\n\n"));
    }

    let indexed: Vec<&KbDocument> = docs.iter().filter(|d| d.status == "indexed").collect();
    let failed: Vec<&KbDocument> = docs.iter().filter(|d| d.status == "failed").collect();
    let total_chunks: i32 = indexed.iter().map(|d| d.chunk_count).sum();

    out.push_str(&format!(
        "{} document(s) indexed, {} searchable passage(s).\n\n",
        indexed.len(),
        total_chunks
    ));

    if indexed.is_empty() && failed.is_empty() {
        out.push_str("_This knowledge base is empty — nothing has been indexed yet._\n");
        return Ok(out);
    }

    if !indexed.is_empty() {
        out.push_str("## Documents\n\n");
        out.push_str("| Document | Pages | Passages | Notes |\n");
        out.push_str("|---|---|---|---|\n");
        for d in &indexed {
            let pages = d
                .page_count
                .map(|p| p.to_string())
                .unwrap_or_else(|| "—".into());
            // Surface the unreadable fraction inline, where a reader deciding
            // whether to trust this document will actually see it.
            let notes = if d.empty_pages > 0 {
                format!(
                    "⚠ {} page(s) are scanned images with no readable text — content on them is NOT searchable",
                    d.empty_pages
                )
            } else {
                String::new()
            };
            out.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                escape_pipes(&d.title),
                pages,
                d.chunk_count,
                notes
            ));
        }
        out.push('\n');
    }

    if !failed.is_empty() {
        out.push_str("## Not indexed\n\n");
        out.push_str(
            "These documents failed to index, so **nothing in them is searchable**:\n\n",
        );
        for d in &failed {
            let why = d.error_message.as_deref().unwrap_or("unknown error");
            out.push_str(&format!(
                "- {} — {}\n",
                escape_pipes(&d.title),
                escape_pipes(why)
            ));
        }
        out.push('\n');
    }

    out.push_str(
        "## How to use this\n\n\
         Search this knowledge base for passages, then cite the document and page each \
         passage came from. Passages carry an extraction confidence: a low value means the \
         text was scraped from a mostly-image page and may be partial — say so rather than \
         answering with false certainty. If the map above shows no document that could \
         plausibly contain the answer, say the knowledge base does not cover it instead of \
         guessing.\n",
    );

    Ok(out)
}

/// Markdown tables use `|` as the cell delimiter, so a pipe inside a document
/// title or an error message would break the row apart.
fn escape_pipes(s: &str) -> String {
    s.replace('|', "\\|")
}

/// List all documents in a knowledge base.
pub fn list_kb_documents(user_db: &UserDbPool, kb_id: &str) -> Result<Vec<KbDocument>, AppError> {
    let conn = user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, kb_id, source_type, source_path, title, content_hash, byte_size,
                chunk_count, metadata_json, page_count, empty_pages, status, error_message,
                indexed_at, created_at
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
                page_count: row.get(9)?,
                empty_pages: row.get(10)?,
                status: row.get(11)?,
                error_message: row.get(12)?,
                indexed_at: row.get(13)?,
                created_at: row.get(14)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[cfg(test)]
mod supersede_tests {
    use super::*;
    use crate::engine::vector_store::SqliteVectorStore;
    use r2d2_sqlite::SqliteConnectionManager;

    // A syntactically-valid KB id (hex + hyphens) so `vec_table_name` accepts it.
    const KB_ID: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    /// Minimal user-db pool with just the KB relational tables this module
    /// touches. sqlite-vec is registered so the vec0 virtual table can be
    /// created via `SqliteVectorStore`. Temp-file (not `:memory:`) so every
    /// pooled connection sees the same database.
    fn test_user_db() -> UserDbPool {
        crate::engine::vector_store::ensure_vec_registered_pub();
        let tmp = std::env::temp_dir().join(format!("kb_ingest_test_{}.db", uuid::Uuid::new_v4()));
        let manager = SqliteConnectionManager::file(&tmp);
        let pool = r2d2::Pool::builder().max_size(2).build(manager).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE kb_documents (
                id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, source_type TEXT NOT NULL,
                source_path TEXT, title TEXT NOT NULL, content_hash TEXT NOT NULL,
                byte_size INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0,
                metadata_json TEXT, page_count INTEGER, empty_pages INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL, error_message TEXT, indexed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
             CREATE TABLE kb_chunks (
                id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, document_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL, content TEXT NOT NULL, token_count INTEGER,
                source_page INTEGER, extraction_confidence REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();
        drop(conn);
        pool
    }

    /// Insert one indexed document with `n` chunks and a matching vector per
    /// chunk. Returns the document id.
    fn seed_document(
        pool: &UserDbPool,
        vs: &SqliteVectorStore,
        source_path: &str,
        content_hash: &str,
        n: usize,
    ) -> String {
        let doc_id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO kb_documents (id, kb_id, source_type, source_path, title, content_hash, status)
             VALUES (?1, ?2, 'file', ?3, 'doc', ?4, 'indexed')",
            params![doc_id, KB_ID, source_path, content_hash],
        )
        .unwrap();
        let mut entries: Vec<(String, Vec<f32>)> = Vec::new();
        for i in 0..n {
            let chunk_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO kb_chunks (id, kb_id, document_id, chunk_index, content)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![chunk_id, KB_ID, doc_id, i as i32, format!("chunk {i}")],
            )
            .unwrap();
            entries.push((chunk_id, vec![i as f32, 0.0, 0.0, 1.0]));
        }
        vs.insert_vectors(KB_ID, &entries).unwrap();
        doc_id
    }

    fn count(pool: &UserDbPool, sql: &str) -> i64 {
        pool.get()
            .unwrap()
            .query_row(sql, [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn find_by_path_returns_id_and_hash_then_none_after_delete() {
        let pool = test_user_db();
        let vs = SqliteVectorStore::new(pool.clone());
        vs.create_index(KB_ID, 4).unwrap();

        let doc_id = seed_document(&pool, &vs, "/tmp/report.md", "hashA", 2);

        let found = find_indexed_document_by_path(&pool, KB_ID, "/tmp/report.md").unwrap();
        assert_eq!(found, Some((doc_id.clone(), "hashA".to_string())));

        // A different path is not matched.
        assert_eq!(
            find_indexed_document_by_path(&pool, KB_ID, "/tmp/other.md").unwrap(),
            None
        );

        delete_document_cascade(&pool, KB_ID, &doc_id).unwrap();
        assert_eq!(
            find_indexed_document_by_path(&pool, KB_ID, "/tmp/report.md").unwrap(),
            None
        );
    }

    #[test]
    fn supersede_leaves_no_orphans_and_no_double_count() {
        let pool = test_user_db();
        let vs = SqliteVectorStore::new(pool.clone());
        vs.create_index(KB_ID, 4).unwrap();

        // Old version of the file: 3 chunks + 3 vectors.
        let old_id = seed_document(&pool, &vs, "/tmp/report.md", "hashA", 3);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM kb_chunks"), 3);
        assert_eq!(vs.count(KB_ID).unwrap(), 3);

        // Re-ingest of the SAME path with a DIFFERENT hash supersedes the old
        // document: delete it end-to-end before the new content is indexed.
        let (found_id, found_hash) =
            find_indexed_document_by_path(&pool, KB_ID, "/tmp/report.md")
                .unwrap()
                .expect("old document should be found by path");
        assert_eq!(found_id, old_id);
        assert_ne!(found_hash, "hashB"); // hash differs → supersede path
        delete_document_cascade(&pool, KB_ID, &old_id).unwrap();

        // No orphaned chunks or vectors survive the supersede.
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM kb_chunks"), 0);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM kb_documents"), 0);
        assert_eq!(vs.count(KB_ID).unwrap(), 0);

        // New version indexed: 2 chunks + 2 vectors.
        seed_document(&pool, &vs, "/tmp/report.md", "hashB", 2);

        // Exactly ONE document at that path (no double-count) and only the new
        // document's chunks/vectors remain.
        assert_eq!(
            count(
                &pool,
                "SELECT COUNT(*) FROM kb_documents WHERE source_path = '/tmp/report.md'"
            ),
            1
        );
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM kb_chunks"), 2);
        assert_eq!(vs.count(KB_ID).unwrap(), 2);
    }
}
