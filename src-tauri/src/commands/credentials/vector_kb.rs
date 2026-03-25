//! Tauri commands for vector knowledge base CRUD, ingestion, and search.

use std::sync::Arc;

use rusqlite::params;
use tauri::{Emitter, State};

use crate::db::models::{
    KbDocument, KbSearchQuery, KnowledgeBase, VectorSearchResult,
};
use crate::engine::event_registry::event_name;
use crate::engine::kb_ingest;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Maximum recursion depth when scanning directories.
const MAX_DIR_DEPTH: usize = 10;
/// Maximum number of files to collect from a directory scan.
const MAX_DIR_FILES: usize = 5000;
/// Maximum allowed top_k for vector search.
const MAX_TOP_K: usize = 200;

// ============================================================================
// Knowledge Base CRUD
// ============================================================================

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn create_knowledge_base(
    state: State<'_, Arc<AppState>>,
    name: String,
    description: Option<String>,
) -> Result<KnowledgeBase, AppError> {
    require_auth(&state).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let credential_id = format!("kb-cred-{id}");
    let now = chrono::Utc::now().to_rfc3339();

    let embedder = state
        .embedding_manager
        .as_ref()
        .ok_or_else(|| AppError::Internal("Embedding manager not initialized".into()))?;
    let dims = embedder.dimensions() as i32;
    let model_name = embedder.model_name().to_string();

    // Create KB record in user database
    {
        let conn = state.user_db.get()?;
        conn.execute(
            "INSERT INTO knowledge_bases (id, credential_id, name, description, embedding_model, embedding_dims, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, credential_id, name, description, model_name, dims, now],
        )?;
    }

    // Also create a credential entry in the main DB so it appears in the vault
    {
        let conn = state.db.get()?;
        conn.execute(
            "INSERT OR IGNORE INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                credential_id,
                format!("KB: {name}"),
                "personas_vector_db",
                "{}",
                "",
                format!(r#"{{"is_builtin":false,"kb_id":"{id}","description":"Vector knowledge base for semantic search."}}"#),
                now,
            ],
        )?;
    }

    // Create vector index table — if this fails, clean up the orphaned DB records
    let vs = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not initialized".into()))?;
    if let Err(e) = vs.create_index(&id, dims as usize) {
        tracing::error!(error = %e, kb_id = %id, "Vector index creation failed, cleaning up orphaned records");
        if let Ok(conn) = state.user_db.get() {
            let _ = conn.execute("DELETE FROM knowledge_bases WHERE id = ?1", params![id]);
        }
        if let Ok(conn) = state.db.get() {
            let _ = conn.execute("DELETE FROM persona_credentials WHERE id = ?1", params![credential_id]);
        }
        return Err(e);
    }

    kb_ingest::get_kb(&state.user_db, &id)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_knowledge_bases(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<KnowledgeBase>, AppError> {
    require_auth(&state).await?;
    let conn = state.user_db.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, credential_id, name, description, embedding_model, embedding_dims,
                chunk_size, chunk_overlap, document_count, chunk_count, status,
                created_at, updated_at
         FROM knowledge_bases ORDER BY created_at DESC",
    )?;

    let rows = stmt
        .query_map([], |row| {
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
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_knowledge_base(
    state: State<'_, Arc<AppState>>,
    kb_id: String,
) -> Result<KnowledgeBase, AppError> {
    require_auth(&state).await?;
    kb_ingest::get_kb(&state.user_db, &kb_id)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_knowledge_base(
    state: State<'_, Arc<AppState>>,
    kb_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;

    // Get KB to find credential_id
    let kb = kb_ingest::get_kb(&state.user_db, &kb_id)?;

    // Drop vector index
    if let Some(vs) = &state.vector_store {
        vs.drop_index(&kb_id)?;
    }

    // Delete from user DB in a transaction for consistency
    {
        let mut conn = state.user_db.get()?;
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM kb_chunks WHERE kb_id = ?1", params![kb_id])?;
        tx.execute("DELETE FROM kb_documents WHERE kb_id = ?1", params![kb_id])?;
        tx.execute("DELETE FROM knowledge_bases WHERE id = ?1", params![kb_id])?;
        tx.commit()?;
    }

    // Delete credential from main DB
    {
        let conn = state.db.get()?;
        conn.execute(
            "DELETE FROM persona_credentials WHERE id = ?1",
            params![kb.credential_id],
        )?;
    }

    Ok(())
}

// ============================================================================
// Document Ingestion
// ============================================================================

#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn kb_ingest_files(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    kb_id: String,
    file_paths: Vec<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    // Canonicalize all paths to prevent traversal
    let canonical_paths: Vec<String> = file_paths
        .iter()
        .map(|p| {
            std::fs::canonicalize(p)
                .map(|c| c.to_string_lossy().to_string())
                .map_err(|_| AppError::Validation(format!("Invalid file path: {p}")))
        })
        .collect::<Result<_, _>>()?;

    let kb = kb_ingest::get_kb(&state.user_db, &kb_id)?;
    let embedder = state
        .embedding_manager
        .as_ref()
        .ok_or_else(|| AppError::Internal("Embedding manager not initialized".into()))?
        .clone();
    let vector_store = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not initialized".into()))?
        .clone();

    let job_id = uuid::Uuid::new_v4().to_string();
    let user_db = state.user_db.clone();
    let cancel = tokio_util::sync::CancellationToken::new();
    let job_id_clone = job_id.clone();

    // Run ingestion in background
    tokio::spawn(async move {
        let result = kb_ingest::ingest_files(
            app.clone(),
            user_db,
            embedder,
            vector_store,
            kb,
            canonical_paths,
            job_id_clone.clone(),
            cancel,
        )
        .await;

        if let Err(e) = result {
            tracing::error!(error = %e, "File ingestion failed");
            let _ = app.emit(event_name::KB_INGEST_ERROR, serde_json::json!({
                "jobId": job_id_clone,
                "error": e.to_string()
            }));
        }
    });

    Ok(job_id)
}

#[tauri::command]
#[tracing::instrument(skip(state, text))]
pub async fn kb_ingest_text(
    state: State<'_, Arc<AppState>>,
    kb_id: String,
    title: String,
    text: String,
) -> Result<usize, AppError> {
    require_auth(&state).await?;
    let kb = kb_ingest::get_kb(&state.user_db, &kb_id)?;
    let embedder = state
        .embedding_manager
        .as_ref()
        .ok_or_else(|| AppError::Internal("Embedding manager not initialized".into()))?;
    let vector_store = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not initialized".into()))?;

    kb_ingest::ingest_text(&state.user_db, embedder, vector_store, &kb, &title, &text).await
}

#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn kb_ingest_directory(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    kb_id: String,
    dir_path: String,
    patterns: Vec<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    // Canonicalize directory path to prevent traversal
    let canonical_dir = std::fs::canonicalize(&dir_path)
        .map_err(|_| AppError::Validation(format!("Invalid directory path: {dir_path}")))?;
    if !canonical_dir.is_dir() {
        return Err(AppError::Validation(format!(
            "Not a directory: {dir_path}"
        )));
    }

    let allowed_exts: Vec<String> = if patterns.is_empty() {
        vec![
            "txt", "md", "html", "htm", "csv", "json", "yaml", "yml", "toml", "log", "rs", "py",
            "js", "ts", "tsx", "jsx",
        ]
        .into_iter()
        .map(String::from)
        .collect()
    } else {
        patterns
            .iter()
            .map(|p| p.trim_start_matches("*.").trim_start_matches('.').to_string())
            .collect()
    };

    let mut file_paths = Vec::new();
    collect_files_recursive(&canonical_dir, &allowed_exts, &mut file_paths, 0, &canonical_dir)?;

    if file_paths.is_empty() {
        return Err(AppError::Validation(
            "No supported files found in directory".into(),
        ));
    }

    // Delegate to kb_ingest_files logic
    let kb = kb_ingest::get_kb(&state.user_db, &kb_id)?;
    let embedder = state
        .embedding_manager
        .as_ref()
        .ok_or_else(|| AppError::Internal("Embedding manager not initialized".into()))?
        .clone();
    let vector_store = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not initialized".into()))?
        .clone();

    let job_id = uuid::Uuid::new_v4().to_string();
    let user_db = state.user_db.clone();
    let cancel = tokio_util::sync::CancellationToken::new();
    let job_id_clone = job_id.clone();

    tokio::spawn(async move {
        let result = kb_ingest::ingest_files(
            app.clone(),
            user_db,
            embedder,
            vector_store,
            kb,
            file_paths,
            job_id_clone.clone(),
            cancel,
        )
        .await;

        if let Err(e) = result {
            tracing::error!(error = %e, "Directory ingestion failed");
            let _ = app.emit(event_name::KB_INGEST_ERROR, serde_json::json!({
                "jobId": job_id_clone,
                "error": e.to_string()
            }));
        }
    });

    Ok(job_id)
}

fn collect_files_recursive(
    dir: &std::path::Path,
    allowed_exts: &[String],
    out: &mut Vec<String>,
    depth: usize,
    root_boundary: &std::path::Path,
) -> Result<(), AppError> {
    if depth > MAX_DIR_DEPTH || out.len() >= MAX_DIR_FILES {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        // Canonicalize each entry to resolve symlinks, then verify it
        // remains within the approved root directory. This prevents
        // symlink escapes that could exfiltrate sensitive files.
        let canonical = match std::fs::canonicalize(&path) {
            Ok(c) => c,
            Err(_) => continue, // Skip unresolvable entries
        };
        if !canonical.starts_with(root_boundary) {
            tracing::warn!(
                path = %path.display(),
                resolved = %canonical.display(),
                boundary = %root_boundary.display(),
                "Skipping symlink that escapes directory boundary"
            );
            continue;
        }

        if canonical.is_dir() {
            collect_files_recursive(&canonical, allowed_exts, out, depth + 1, root_boundary)?;
        } else if out.len() < MAX_DIR_FILES {
            if let Some(ext) = canonical.extension().and_then(|e| e.to_str()) {
                if allowed_exts.iter().any(|a| a.eq_ignore_ascii_case(ext)) {
                    out.push(canonical.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(())
}

// ============================================================================
// Search
// ============================================================================

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn kb_search(
    state: State<'_, Arc<AppState>>,
    query: KbSearchQuery,
) -> Result<Vec<VectorSearchResult>, AppError> {
    require_auth(&state).await?;

    let embedder = state
        .embedding_manager
        .as_ref()
        .ok_or_else(|| AppError::Internal("Embedding manager not initialized".into()))?;
    let vector_store = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not initialized".into()))?;

    let top_k = query.top_k.unwrap_or(10).min(MAX_TOP_K);

    // Embed the query
    let query_vec = embedder.embed_query(&query.query).await?;

    // Search vectors
    let matches = vector_store.search(&query.kb_id, &query_vec, top_k)?;

    if matches.is_empty() {
        return Ok(Vec::new());
    }

    // Hydrate results with chunk and document metadata in a single batch query
    let conn = state.user_db.get()?;

    let placeholders: Vec<String> = (1..=matches.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT c.id, c.document_id, c.content, c.metadata_json,
                d.title, d.source_path
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let chunk_ids: Vec<&str> = matches.iter().map(|(id, _)| id.as_str()).collect();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = chunk_ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;

    // Collect hydrated rows keyed by chunk_id
    let mut hydrated: std::collections::HashMap<String, (String, String, Option<String>, String, Option<String>)> =
        std::collections::HashMap::with_capacity(matches.len());
    for row in rows {
        if let Ok((cid, doc_id, content, meta_json, doc_title, source_path)) = row {
            hydrated.insert(cid, (doc_id, content, meta_json, doc_title, source_path));
        }
    }

    // Rebuild results in original vector-search ranking order
    let mut results = Vec::with_capacity(matches.len());
    for (chunk_id, distance) in &matches {
        let Some((doc_id, content, meta_json, doc_title, source_path)) = hydrated.remove(chunk_id) else {
            continue;
        };

        // Convert distance to a 0-1 score (lower distance = higher score)
        let score = 1.0 / (1.0 + distance);

        // Apply min_score filter
        if let Some(min) = query.min_score {
            if score < min {
                continue;
            }
        }

        // Apply source filter
        if let Some(ref filter) = query.filter_source {
            if let Some(ref sp) = source_path {
                if !sp.starts_with(filter) {
                    continue;
                }
            } else {
                continue;
            }
        }

        let metadata = meta_json
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok());

        results.push(VectorSearchResult {
            chunk_id: chunk_id.clone(),
            document_id: doc_id,
            document_title: doc_title,
            content,
            score,
            distance: *distance,
            source_path,
            metadata,
        });
    }

    Ok(results)
}

// ============================================================================
// Document Management
// ============================================================================

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn kb_list_documents(
    state: State<'_, Arc<AppState>>,
    kb_id: String,
) -> Result<Vec<KbDocument>, AppError> {
    require_auth(&state).await?;
    kb_ingest::list_kb_documents(&state.user_db, &kb_id)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn kb_delete_document(
    state: State<'_, Arc<AppState>>,
    document_id: String,
) -> Result<(), AppError> {
    require_auth(&state).await?;
    let mut conn = state.user_db.get()?;

    // Run all deletes (vectors, chunks, document) and counter update in a
    // single transaction so the database never enters an inconsistent state.
    let tx = conn.transaction()?;

    // Look up KB ID and chunk IDs inside the transaction
    let kb_id: String = tx.query_row(
        "SELECT kb_id FROM kb_documents WHERE id = ?1",
        params![document_id],
        |row| row.get(0),
    )?;

    let chunk_ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM kb_chunks WHERE document_id = ?1")?;
        let ids = stmt
            .query_map(params![document_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };

    // Delete vectors from the vec0 virtual table (same SQLite DB)
    if state.vector_store.is_some() {
        crate::engine::vector_store::delete_vectors_by_chunks(&tx, &kb_id, &chunk_ids)?;
    }

    // Delete chunks, then the document row
    tx.execute(
        "DELETE FROM kb_chunks WHERE document_id = ?1",
        params![document_id],
    )?;
    tx.execute(
        "DELETE FROM kb_documents WHERE id = ?1",
        params![document_id],
    )?;

    // Update counters in the same transaction
    tx.execute(
        "UPDATE knowledge_bases SET
            document_count = (SELECT COUNT(*) FROM kb_documents WHERE kb_id = ?1 AND status = 'indexed'),
            chunk_count = (SELECT COUNT(*) FROM kb_chunks WHERE kb_id = ?1),
            updated_at = datetime('now')
         WHERE id = ?1",
        params![kb_id],
    )?;

    tx.commit()?;
    Ok(())
}
