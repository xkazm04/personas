//! Tauri command surface for the Companion (Athena) plugin.
//!
//! Phase 0 ships only `companion_init` — the rest of the surface
//! (chat send, stream, approve/reject, brain queries, consolidation,
//! dev feedback, observability digest) lands in Phase 1+.

pub mod approvals;
pub mod brain;
pub mod chat;
pub mod consolidate;
pub mod feedback;
pub mod observability;
pub mod voice;

use std::sync::Arc;
use tauri::State;

use crate::companion::brain::doctrine;
use crate::companion::dev_session;
use crate::companion::disk;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Initialize the companion-brain disk layout. Idempotent — safe to call
/// on every app start. Returns the absolute path to the brain root for
/// debugging / display purposes.
///
/// Also kicks off doctrine ingestion (the curated app-philosophy docs) in
/// a background tokio task so first-run embedding doesn't block the UI.
#[tauri::command]
pub fn companion_init(state: State<'_, Arc<AppState>>) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let root = disk::ensure_initialized()?;

    // Spawn doctrine ingest in the background. `companion_init` is a sync
    // command, so we use Tauri's async runtime helper rather than
    // `tokio::spawn` (which would panic — no current runtime in scope).
    // Subsequent calls are cheap (idempotent via content_hash).
    #[cfg(feature = "ml")]
    {
        let pool = state.user_db.clone();
        let embedder = state.embedding_manager.clone();
        if let Some(emb) = embedder.clone() {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_doctrine_ingest(pool, emb).await {
                    tracing::warn!(error = %e, "companion doctrine ingest failed");
                }
            });
        } else {
            tracing::debug!("companion doctrine: no embedder configured, skipping ingest");
        }
        // Recover any self-improve runs orphaned by a previous Tauri-dev
        // restart. The detached coding CLI keeps running across the
        // parent-process restart triggered by source edits; this scan
        // surfaces their outcome as a system episode so the conversation
        // doesn't get stuck. Cheap when the dir is empty.
        let pool2 = state.user_db.clone();
        let emb2 = embedder;
        tauri::async_runtime::spawn(async move {
            if let Err(e) =
                dev_session::recover_orphan_improvements(&pool2, emb2.as_ref()).await
            {
                tracing::warn!(error = %e, "self-improve: orphan recovery failed");
            }
        });
    }

    Ok(root.display().to_string())
}

/// Re-run doctrine ingestion on demand. Idempotent — unchanged chunks are
/// skipped via content_hash. Useful when docs/ changes and the user wants
/// Athena to pick up the latest without an app restart.
#[tauri::command]
pub async fn companion_reingest_doctrine(
    state: State<'_, Arc<AppState>>,
) -> Result<DoctrineIngestSummary, AppError> {
    crate::ipc_auth::require_auth(&state).await?;
    #[cfg(feature = "ml")]
    {
        let pool = state.user_db.clone();
        let embedder = state.embedding_manager.clone().ok_or_else(|| {
            AppError::Internal("embedding manager unavailable (ml feature disabled)".into())
        })?;
        let stats = doctrine::ingest_all(&pool, &embedder).await?;
        Ok(DoctrineIngestSummary::from(stats))
    }
    #[cfg(not(feature = "ml"))]
    {
        let _ = state;
        Ok(DoctrineIngestSummary::default())
    }
}

/// Frontend-friendly summary of an ingest pass.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctrineIngestSummary {
    pub files_seen: usize,
    pub files_missing: usize,
    pub chunks_inserted: usize,
    pub chunks_updated: usize,
    pub chunks_unchanged: usize,
    pub chunks_deleted: usize,
    pub errors: Vec<String>,
}

impl From<doctrine::IngestStats> for DoctrineIngestSummary {
    fn from(s: doctrine::IngestStats) -> Self {
        Self {
            files_seen: s.files_seen,
            files_missing: s.files_missing,
            chunks_inserted: s.chunks_inserted,
            chunks_updated: s.chunks_updated,
            chunks_unchanged: s.chunks_unchanged,
            chunks_deleted: s.chunks_deleted,
            errors: s.errors,
        }
    }
}

#[cfg(feature = "ml")]
async fn run_doctrine_ingest(
    pool: UserDbPool,
    embedder: Arc<EmbeddingManager>,
) -> Result<(), AppError> {
    let stats = doctrine::ingest_all(&pool, &embedder).await?;
    tracing::info!(
        inserted = stats.chunks_inserted,
        updated = stats.chunks_updated,
        unchanged = stats.chunks_unchanged,
        deleted = stats.chunks_deleted,
        "companion doctrine ingest completed (background)"
    );
    Ok(())
}
