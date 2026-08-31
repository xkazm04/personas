//! Boot phase: vector-knowledge-base runtime wiring (`ml` feature only).

use std::sync::Arc;

use crate::db::{self, DbPool};
use crate::startup_timing::StartupTimer;
use crate::{commands, engine};

// Task-relevant memory recall (MEMORY CONTRACT (7)): register the
// embedder + vec-registered user-DB pool so the runner's recall
// path and the memory repo's embed-on-write hooks can reach them
// without threading new parameters through every execution entry
// point. Then run the idempotent embedding backfill in gentle
// batches (delayed past boot; loops until no un-embedded,
// recall-eligible memory remains — each batch is diffed against
// the vec table, so restarts/repeat runs are safe).
#[cfg(feature = "ml")]
pub fn init_task_recall_runtime(
    pool: &DbPool,
    user_db_pool: &db::UserDbPool,
    embedding_manager: &Arc<engine::embedder::EmbeddingManager>,
    st: &mut StartupTimer,
) {
    {
        engine::memory_recall::init_task_recall_runtime(
            user_db_pool.clone(),
            embedding_manager.clone(),
        );
        let bf_main = pool.clone();
        let bf_vec = user_db_pool.clone();
        let bf_emb = embedding_manager.clone();
        tauri::async_runtime::spawn(async move {
            use futures_util::FutureExt;
            tokio::time::sleep(std::time::Duration::from_secs(90)).await;
            // Panic boundary per the panic-isolation golden path: a panic in a
            // backfill batch becomes this task's own observable outcome (warn;
            // next launch retries) rather than a task that silently vanishes.
            let run = std::panic::AssertUnwindSafe(async {
                loop {
                    match db::repos::core::memories::backfill_memory_embeddings(
                        &bf_main, &bf_vec, &bf_emb, 64,
                    )
                    .await
                    {
                        Ok(0) => break,
                        Ok(n) => {
                            tracing::info!(embedded = n, "memory embedding backfill: batch done");
                            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "memory embedding backfill stopped (next launch retries)");
                            break;
                        }
                    }
                }
            })
            .catch_unwind()
            .await;
            if run.is_err() {
                tracing::warn!("memory embedding backfill panicked (next launch retries)");
            }
        });
        // Dependent-side orphan visibility (deferred-fixes #108): walk the
        // VECTOR store and ask, per id, whether its owner still exists — the
        // direction no parent-first sweep can cover. Report mode only: it
        // deletes nothing and logs the accounting even when it is zero (a
        // reconciler whose only output is silence is indistinguishable from
        // one that never ran). Apply mode stays operator-invoked.
        let sw_main = pool.clone();
        let sw_vec = user_db_pool.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            // The blocking handle is awaited and its panic arm handled, per
            // the panic-isolation golden path: an abrupt death becomes this
            // work item's own outcome, not an unobservable disappearance.
            let sweep = tokio::task::spawn_blocking(move || {
                db::repos::core::memory_reaper::reconcile_memory_vector_orphans(
                    &sw_main,
                    &sw_vec,
                    db::repos::core::memory_reaper::SweepMode::Report,
                    1024,
                )
            })
            .await;
            match sweep {
                // The sweep logs its own accounting, zero included.
                Ok(Ok(_report)) => {}
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "memory vector orphan sweep failed at boot (report-only; next launch retries)");
                }
                Err(join) if join.is_panic() => {
                    tracing::warn!(
                        "memory vector orphan sweep panicked at boot (report-only; next launch retries)"
                    );
                }
                Err(_) => {} // cancelled at shutdown — nothing owed
            }
        });
        st.checkpoint("memory_recall_runtime");
    }
}

// Reconcile orphaned KB records left by crashes during creation
#[cfg(feature = "ml")]
pub fn reconcile_orphaned_kb(
    pool: &DbPool,
    user_db_pool: &db::UserDbPool,
    vector_store: &Arc<engine::vector_store::SqliteVectorStore>,
    st: &mut StartupTimer,
) {
    {
        commands::credentials::vector_kb::reconcile_orphaned_kb_records(
            pool,
            user_db_pool,
            vector_store,
        );
        st.checkpoint("kb_reconciliation");
    }
}
