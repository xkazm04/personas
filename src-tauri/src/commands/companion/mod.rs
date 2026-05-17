//! Tauri command surface for the Companion (Athena) plugin.
//!
//! Phase 0 ships only `companion_init` — the rest of the surface
//! (chat send, stream, approve/reject, brain queries, consolidation,
//! dev feedback, observability digest) lands in Phase 1+.

pub mod approvals;
pub mod brain;
pub mod chat;
pub mod connectors;
pub mod consolidate;
pub mod decisions;
pub mod feedback;
pub mod jobs;
pub mod observability;
pub mod plugins;
pub mod proactive;
pub mod project_tracking;
#[cfg(feature = "desktop")]
pub mod sensory;
pub mod templates;
pub mod voice;

use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::companion::brain::doctrine;
use crate::companion::dev_session;
use crate::companion::disk;
use crate::companion::proactive as proactive_engine;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Once-per-process guard so re-running `companion_init` (HMR, manual
/// re-call) doesn't stack a second proactive scheduler task. The
/// `OnceLock` value is the JoinHandle of the first scheduler spawn —
/// we don't actually use it (cancel-on-shutdown is handled by Tauri's
/// async runtime tearing down), but storing it prevents respawn.
static PROACTIVE_SCHEDULER: OnceLock<()> = OnceLock::new();

/// Same one-shot guard for the Phase G background-job worker.
static JOB_WORKER: OnceLock<()> = OnceLock::new();

/// How often the background scheduler wakes to evaluate triggers. Five
/// minutes is a sweet spot — short enough that a goal hitting its 24h
/// window fires within minutes of the threshold, long enough that the
/// per-tick cost (a handful of SQL queries) stays trivial.
const PROACTIVE_TICK_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Job-worker poll interval. Faster cadence than the proactive
/// scheduler because users expect "I started a scan" → results within
/// seconds-to-a-minute, not minutes. 3s polling is cheap (single SQL
/// SELECT per tick when the queue is empty).
const JOB_WORKER_INTERVAL: Duration = Duration::from_secs(3);

/// Initialize the companion-brain disk layout. Idempotent — safe to call
/// on every app start. Returns the absolute path to the brain root for
/// debugging / display purposes.
///
/// Also kicks off doctrine ingestion (the curated app-philosophy docs) in
/// a background tokio task so first-run embedding doesn't block the UI.
#[tauri::command]
pub fn companion_init(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let root = disk::ensure_initialized(&state.db)?;

    // Phase E: spawn the proactive scheduler exactly once. Subsequent
    // companion_init calls (re-mount, HMR) hit the OnceLock guard and
    // skip — without it we'd queue up a tick every refresh.
    PROACTIVE_SCHEDULER.get_or_init(|| {
        let pool = state.user_db.clone();
        let app_handle = app.clone();
        // Phase 3 b — clone the ambient + rule-engine handles so the
        // scheduler can run `ambient_match` candidates alongside the
        // existing time/state-based triggers. Desktop-feature gated;
        // non-desktop builds get None and skip the ambient leg.
        #[cfg(feature = "desktop")]
        let ambient_ctx = state.ambient_context.clone();
        #[cfg(feature = "desktop")]
        let rule_engine = state.context_rule_engine.clone();
        tauri::async_runtime::spawn(async move {
            // Tiny initial delay so first-tick observability doesn't
            // race the rest of `companion_init` (doctrine ingest,
            // orphan recovery). 30s is enough.
            tokio::time::sleep(Duration::from_secs(30)).await;
            loop {
                let res = {
                    #[cfg(feature = "desktop")]
                    {
                        run_proactive_tick(&pool, &app_handle, Some(&ambient_ctx), Some(&rule_engine)).await
                    }
                    #[cfg(not(feature = "desktop"))]
                    {
                        run_proactive_tick(&pool, &app_handle).await
                    }
                };
                if let Err(e) = res {
                    tracing::warn!(error = %e, "proactive scheduler tick failed");
                }
                tokio::time::sleep(PROACTIVE_TICK_INTERVAL).await;
            }
        });
    });

    // Phase G: spawn the background-job worker. Same OnceLock guard so
    // HMR/re-init doesn't stack workers (which would race for queued
    // rows; the SQL UPDATE...WHERE status='queued' guarantees
    // exactly-once even if it did, but spawning multiple is wasteful).
    JOB_WORKER.get_or_init(|| {
        let pool = state.user_db.clone();
        let app_handle = app.clone();
        let sink = crate::companion::jobs::JobEventSink::App(app_handle);
        #[cfg(feature = "ml")]
        let embedder = state.embedding_manager.clone();
        tauri::async_runtime::spawn(async move {
            // Short startup delay so the bridge boot logs land first.
            tokio::time::sleep(Duration::from_secs(2)).await;
            loop {
                #[cfg(feature = "ml")]
                let res =
                    crate::companion::jobs::worker_tick(&pool, embedder.as_ref(), &sink).await;
                #[cfg(not(feature = "ml"))]
                let res = crate::companion::jobs::worker_tick(&pool, &sink).await;
                if let Err(e) = res {
                    tracing::warn!(error = %e, "job worker tick failed");
                }
                tokio::time::sleep(JOB_WORKER_INTERVAL).await;
            }
        });
    });

    // Seed the project registry on first run with the Personas repo
    // so "list projects" / "scan project X" have something to act on.
    // Idempotent (path UNIQUE).
    if let Err(e) = crate::companion::projects::seed_default_project(&state.user_db) {
        tracing::warn!(error = %e, "companion: seed_default_project failed");
    }

    // Recover any background jobs that were `running` when the process
    // last exited (HMR rebuild, crash). Without this they'd sit in
    // `running` forever; with it they get marked `failed` so the user
    // can re-enqueue cleanly.
    if let Err(e) = crate::companion::jobs::recover_orphans(&state.user_db) {
        tracing::warn!(error = %e, "companion: job orphan recovery failed");
    }
    if let Err(e) = crate::companion::jobs::prune_terminal_jobs(&state.user_db) {
        tracing::warn!(error = %e, "companion: job history prune failed");
    }

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
            if let Err(e) = dev_session::recover_orphan_improvements(&pool2, emb2.as_ref()).await {
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

/// One scheduler tick: evaluate triggers, mark new messages delivered,
/// emit `companion://proactive` if anything new landed. Errors are
/// logged inside; the loop keeps running.
///
/// Desktop builds also run `ambient_match` (Phase 3 b) so context-rule
/// matches against the rolling ambient window become Nudges alongside
/// the time/state-based triggers. Non-desktop builds skip the ambient
/// leg entirely.
#[cfg(feature = "desktop")]
async fn run_proactive_tick(
    pool: &UserDbPool,
    app: &AppHandle,
    ambient_ctx: Option<&crate::engine::ambient_context::AmbientContextHandle>,
    rule_engine: Option<&crate::engine::context_rules::ContextRuleEngineHandle>,
) -> Result<(), AppError> {
    let extra = match (ambient_ctx, rule_engine) {
        (Some(ctx), Some(eng)) => proactive_engine::triggers::ambient_match(ctx, eng)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "ambient_match: skipping (non-fatal)");
                Vec::new()
            }),
        _ => Vec::new(),
    };
    let new_msgs = proactive_engine::evaluate_with_extra_candidates(pool, extra)?;
    if new_msgs.is_empty() {
        return Ok(());
    }
    run_proactive_tick_finalize(pool, app, new_msgs).await
}

#[cfg(not(feature = "desktop"))]
async fn run_proactive_tick(pool: &UserDbPool, app: &AppHandle) -> Result<(), AppError> {
    let new_msgs = proactive_engine::evaluate(pool)?;
    if new_msgs.is_empty() {
        return Ok(());
    }
    run_proactive_tick_finalize(pool, app, new_msgs).await
}

async fn run_proactive_tick_finalize(
    pool: &UserDbPool,
    app: &AppHandle,
    new_msgs: Vec<crate::companion::proactive::ProactiveMessage>,
) -> Result<(), AppError> {
    if new_msgs.is_empty() {
        return Ok(());
    }
    for m in &new_msgs {
        if let Err(e) = proactive_engine::mark_delivered(pool, &m.id) {
            tracing::warn!(id = %m.id, error = %e, "proactive: mark_delivered failed");
        }
    }
    let payload = crate::commands::companion::proactive::ProactiveDelivery {
        messages: new_msgs
            .into_iter()
            .map(|m| crate::companion::proactive::ProactiveMessage {
                status: "delivered".into(),
                ..m
            })
            .collect(),
    };
    if let Err(e) = app.emit(
        crate::commands::companion::proactive::PROACTIVE_EVENT,
        payload,
    ) {
        tracing::warn!(error = %e, "proactive: scheduler event emit failed");
    }
    Ok(())
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
