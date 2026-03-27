//! Tauri commands for vector knowledge base CRUD, ingestion, and search.

use std::sync::Arc;

use rusqlite::params;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::db::models::{
    KbDocument, KbSearchQuery, KnowledgeBase, VectorSearchResult,
};
use crate::db::repos::resources::audit_log;
use crate::db::{DbPool, UserDbPool};
use crate::engine::event_registry::event_name;
use crate::engine::kb_ingest;
use crate::engine::vector_store::SqliteVectorStore;
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

    // Step 1: Create vector index first — easiest to roll back (just DROP TABLE)
    let vs = state
        .vector_store
        .as_ref()
        .ok_or_else(|| AppError::Internal("Vector store not initialized".into()))?;
    vs.create_index(&id, dims as usize)?;

    // Step 2: Write both DB records. If either fails, clean up the vector index.
    let db_result: Result<(), AppError> = (|| {
        // Create KB record in user database
        {
            let conn = state.user_db.get()?;
            conn.execute(
                "INSERT INTO knowledge_bases (id, credential_id, name, description, embedding_model, embedding_dims, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![id, credential_id, name, description, model_name, dims, now],
            )?;
        }

        // Create credential entry in main DB so it appears in the vault
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
        Ok(())
    })();

    if let Err(e) = db_result {
        tracing::error!(error = %e, kb_id = %id, "DB insert failed, cleaning up vector index");
        let _ = vs.drop_index(&id);
        // Best-effort cleanup of any partially written DB records
        if let Ok(conn) = state.user_db.get() {
            let _ = conn.execute("DELETE FROM knowledge_bases WHERE id = ?1", params![id]);
        }
        if let Ok(conn) = state.db.get() {
            let _ = conn.execute("DELETE FROM persona_credentials WHERE id = ?1", params![credential_id]);
        }
        return Err(e);
    }

    let kb = kb_ingest::get_kb(&state.user_db, &id)?;

    audit_log::insert_warn(&state.db, &credential_id, &name, "kb_create", Some(&format!("model={model_name}, dims={dims}")));

    Ok(kb)
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

    audit_log::insert_warn(&state.db, &kb.credential_id, &kb.name, "kb_delete", None);

    Ok(())
}

// ============================================================================
// Path Security
// ============================================================================

/// Directories and path components that must never be ingested.
/// Blocks credential files, SSH keys, system config, and other sensitive data.
const SENSITIVE_PATH_COMPONENTS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".gpg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".config/gcloud",
    ".password-store",
];

/// Exact sensitive file names (case-insensitive) that should be blocked.
const SENSITIVE_FILE_NAMES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.production",
    ".netrc",
    ".npmrc",
    "credentials.json",
    "service-account.json",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
    "known_hosts",
];

#[cfg(target_os = "windows")]
const SENSITIVE_PREFIXES: &[&str] = &[
    "C:\\Windows\\",
    "C:\\ProgramData\\",
];

#[cfg(not(target_os = "windows"))]
const SENSITIVE_PREFIXES: &[&str] = &[
    "/etc/",
    "/var/",
    "/private/etc/",
];

/// Reject paths that point to known sensitive files or system directories.
fn validate_path_safety(path: &str) -> Result<(), AppError> {
    let normalized = path.replace('\\', "/");
    let lower = normalized.to_lowercase();

    // Block system directories
    for prefix in SENSITIVE_PREFIXES {
        let check = prefix.replace('\\', "/").to_lowercase();
        if lower.starts_with(&check) {
            return Err(AppError::Forbidden(format!(
                "Ingesting files from system directory is not allowed: {path}"
            )));
        }
    }

    // Block paths containing sensitive directory components
    for component in SENSITIVE_PATH_COMPONENTS {
        let pattern = format!("/{component}/");
        let pattern_end = format!("/{component}");
        if lower.contains(&pattern) || lower.ends_with(&pattern_end) {
            return Err(AppError::Forbidden(format!(
                "Path contains sensitive directory '{component}': {path}"
            )));
        }
        // Also check backslash variant for Windows
        let win_pattern = format!("\\{component}\\").to_lowercase();
        let win_end = format!("\\{component}").to_lowercase();
        if lower.contains(&win_pattern) || lower.ends_with(&win_end) {
            return Err(AppError::Forbidden(format!(
                "Path contains sensitive directory '{component}': {path}"
            )));
        }
    }

    // Block sensitive file names
    if let Some(file_name) = std::path::Path::new(path).file_name().and_then(|f| f.to_str()) {
        let file_lower = file_name.to_lowercase();
        for sensitive in SENSITIVE_FILE_NAMES {
            if file_lower == sensitive.to_lowercase() {
                return Err(AppError::Forbidden(format!(
                    "Ingesting sensitive file is not allowed: {file_name}"
                )));
            }
        }
    }

    Ok(())
}

// ============================================================================
// Native File/Directory Pickers
// ============================================================================

/// Open the native OS file picker and return selected file paths.
/// This ensures paths are user-chosen via the OS dialog, not programmatically injected.
#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn kb_pick_files(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<String>, AppError> {
    require_auth(&state).await?;
    let app_clone = app.clone();
    let paths = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_title("Select files to ingest")
            .add_filter("Supported Files", &[
                "txt", "md", "html", "htm", "csv", "json", "yaml", "yml",
                "toml", "log", "rs", "py", "js", "ts", "tsx", "jsx",
            ])
            .blocking_pick_files()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    match paths {
        Some(file_paths) => {
            let result: Vec<String> = file_paths
                .into_iter()
                .filter_map(|fp| fp.into_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            Ok(result)
        }
        None => Ok(Vec::new()), // User cancelled
    }
}

/// Open the native OS directory picker and return the selected path.
#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn kb_pick_directory(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, AppError> {
    require_auth(&state).await?;
    let app_clone = app.clone();
    let path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .set_title("Select directory to scan")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Dialog task failed: {e}")))?;

    match path {
        Some(fp) => {
            let p = fp
                .into_path()
                .map_err(|e| AppError::Internal(format!("Invalid path: {e}")))?;
            Ok(Some(p.to_string_lossy().to_string()))
        }
        None => Ok(None), // User cancelled
    }
}

// ============================================================================
// Document Ingestion
// ============================================================================

/// Shared helper that resolves embedder/vector_store from AppState, creates a
/// background ingestion job, and handles audit logging + error emission
/// consistently for both file and directory ingestion paths.
fn spawn_ingest_job(
    app: &tauri::AppHandle,
    state: &AppState,
    kb: KnowledgeBase,
    file_paths: Vec<String>,
    audit_action: &str,
) -> Result<String, AppError> {
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

    let file_count = file_paths.len();
    let job_id = uuid::Uuid::new_v4().to_string();
    let user_db = state.user_db.clone();
    let cancel = tokio_util::sync::CancellationToken::new();
    let job_id_clone = job_id.clone();
    let audit_pool = state.db.clone();
    let kb_cred_id = kb.credential_id.clone();
    let kb_name = kb.name.clone();
    let app = app.clone();

    audit_log::insert_warn(
        &audit_pool,
        &kb_cred_id,
        &kb_name,
        audit_action,
        Some(&format!("{file_count} file(s)")),
    );

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

        match &result {
            Ok(_) => {
                audit_log::insert_warn(
                    &audit_pool,
                    &kb_cred_id,
                    &kb_name,
                    "kb_ingest_complete",
                    Some(&format!("{file_count} file(s) ingested")),
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "Ingestion failed");
                let _ = audit_log::insert(
                    &audit_pool,
                    &kb_cred_id,
                    &kb_name,
                    "kb_ingest_failed",
                    None,
                    None,
                    Some(&e.to_string()),
                );
                let _ = app.emit(
                    event_name::KB_INGEST_ERROR,
                    serde_json::json!({
                        "jobId": job_id_clone,
                        "error": e.to_string()
                    }),
                );
            }
        }
    });

    Ok(job_id)
}

#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn kb_ingest_files(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    kb_id: String,
    file_paths: Vec<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    // Canonicalize all paths to prevent traversal, then validate safety
    let canonical_paths: Vec<String> = file_paths
        .iter()
        .map(|p| {
            let canonical = std::fs::canonicalize(p)
                .map(|c| c.to_string_lossy().to_string())
                .map_err(|_| AppError::Validation(format!("Invalid file path: {p}")))?;
            validate_path_safety(&canonical)?;
            Ok(canonical)
        })
        .collect::<Result<_, AppError>>()?;

    let kb = kb_ingest::get_kb(&state.user_db, &kb_id)?;
    spawn_ingest_job(&app, &state, kb, canonical_paths, "kb_ingest_files")
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

    // Canonicalize directory path to prevent traversal, then validate safety
    let canonical_dir = std::fs::canonicalize(&dir_path)
        .map_err(|_| AppError::Validation(format!("Invalid directory path: {dir_path}")))?;
    if !canonical_dir.is_dir() {
        return Err(AppError::Validation(format!(
            "Not a directory: {dir_path}"
        )));
    }
    validate_path_safety(&canonical_dir.to_string_lossy())?;

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

    let kb = kb_ingest::get_kb(&state.user_db, &kb_id)?;
    spawn_ingest_job(&app, &state, kb, file_paths, "kb_ingest_directory")
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

    // Audit log the search (log query length, not raw text)
    audit_log::insert_warn(&state.db, &format!("kb:{}", query.kb_id), &query.kb_id, "kb_search", Some(&format!("query_len={}, top_k={top_k}", query.query.len())));

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

    audit_log::insert_warn(&state.db, &format!("kb:{kb_id}"), &kb_id, "kb_doc_delete", Some(&format!("doc={document_id}, chunks={}", chunk_ids.len())));

    Ok(())
}

// ============================================================================
// Startup Reconciliation
// ============================================================================

/// Detect and clean up orphaned KB records left by crashes during creation.
///
/// Checks for two inconsistency types:
/// 1. KB exists in `user_db.knowledge_bases` but has no matching credential in
///    `db.persona_credentials` — delete the orphaned user_db record and drop
///    the vector index if it exists.
/// 2. Credential exists in `db.persona_credentials` (service_type =
///    `personas_vector_db`) but has no matching KB in `user_db.knowledge_bases`
///    — delete the orphaned credential.
pub fn reconcile_orphaned_kb_records(
    db: &DbPool,
    user_db: &UserDbPool,
    vector_store: &SqliteVectorStore,
) {
    let mut cleaned = 0u32;

    // Case 1: KB rows in user_db without a matching credential in main db
    if let Ok(user_conn) = user_db.get() {
        let kb_rows: Vec<(String, String)> = (|| -> Result<Vec<_>, rusqlite::Error> {
            let mut stmt = user_conn.prepare(
                "SELECT id, credential_id FROM knowledge_bases",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })()
        .unwrap_or_default();

        for (kb_id, cred_id) in &kb_rows {
            let cred_exists = (|| -> Result<bool, rusqlite::Error> {
                let conn = db.get().map_err(|e| {
                    rusqlite::Error::InvalidParameterName(e.to_string())
                })?;
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM persona_credentials WHERE id = ?1",
                    params![cred_id],
                    |row| row.get(0),
                )?;
                Ok(count > 0)
            })()
            .unwrap_or(true); // If we can't check, assume it exists (don't delete)

            if !cred_exists {
                tracing::warn!(
                    kb_id = %kb_id,
                    credential_id = %cred_id,
                    "Orphaned KB record found (no matching credential), cleaning up"
                );
                let _ = vector_store.drop_index(kb_id);
                let _ = user_conn.execute("DELETE FROM kb_chunks WHERE kb_id = ?1", params![kb_id]);
                let _ = user_conn.execute("DELETE FROM kb_documents WHERE kb_id = ?1", params![kb_id]);
                let _ = user_conn.execute("DELETE FROM knowledge_bases WHERE id = ?1", params![kb_id]);
                cleaned += 1;
            }
        }
    }

    // Case 2: Credential rows in main db without a matching KB in user_db
    if let Ok(main_conn) = db.get() {
        let cred_rows: Vec<(String, Option<String>)> = (|| -> Result<Vec<_>, rusqlite::Error> {
            let mut stmt = main_conn.prepare(
                "SELECT id, metadata FROM persona_credentials WHERE service_type = 'personas_vector_db'",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })()
        .unwrap_or_default();

        for (cred_id, metadata) in &cred_rows {
            let kb_id = metadata
                .as_deref()
                .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                .and_then(|v| v.get("kb_id")?.as_str().map(String::from));

            let Some(kb_id) = kb_id else { continue };

            let kb_exists = (|| -> Result<bool, rusqlite::Error> {
                let conn = user_db.get().map_err(|e| {
                    rusqlite::Error::InvalidParameterName(e.to_string())
                })?;
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM knowledge_bases WHERE id = ?1",
                    params![kb_id],
                    |row| row.get(0),
                )?;
                Ok(count > 0)
            })()
            .unwrap_or(true); // If we can't check, assume it exists

            if !kb_exists {
                tracing::warn!(
                    credential_id = %cred_id,
                    kb_id = %kb_id,
                    "Orphaned KB credential found (no matching knowledge_base), cleaning up"
                );
                let _ = main_conn.execute(
                    "DELETE FROM persona_credentials WHERE id = ?1",
                    params![cred_id],
                );
                let _ = vector_store.drop_index(&kb_id);
                cleaned += 1;
            }
        }
    }

    if cleaned > 0 {
        tracing::info!("KB reconciliation: cleaned up {cleaned} orphaned record(s)");
    }
}
