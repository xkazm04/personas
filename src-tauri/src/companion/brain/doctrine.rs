//! Doctrine: read-only canonical knowledge about the Personas app itself.
//!
//! Source of truth lives at `<repo>/docs/...` (curated 24-file allowlist;
//! see `INCLUDED_DOCS`). We treat them as a separate brain tier alongside
//! episodic memory: ingested into `companion_node` with `kind='doctrine'`,
//! embedded into `companion_embedding`, retrieved via the same hybrid
//! retrieval pipeline but in its own budget.
//!
//! Chunking:
//!   - Split each doc by H2 (`## ...`) headings. Each section becomes one
//!     chunk + one embedding.
//!   - Doc-level intro (text before the first H2) becomes a chunk too.
//!   - If a section exceeds CHUNK_SOFT_CAP_BYTES, split on H3, then on
//!     hard byte boundaries (rare in practice).
//!
//! Upsert keying: chunk identity is `(doc_path, heading_anchor)`. Edits
//! that don't move headings → content_hash diff → re-embed in place.
//! Renamed headings → old chunk dropped, new chunk inserted. Deleted
//! files → all their chunks dropped.
//!
//! Idempotent: safe to call on every app start. Skips unchanged chunks
//! via `content_hash` equality.

use std::path::{Path, PathBuf};
#[cfg(feature = "ml")]
use std::sync::Arc;

#[cfg(feature = "ml")]
use chrono::Utc;

#[cfg(feature = "ml")]
use crate::companion::brain::embeddings;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;

/// Compile-time embedded copies of every `INCLUDED_DOCS` entry. Used as a
/// fallback when the on-disk doc isn't reachable (production builds, no
/// repo on user disk). Dev still reads from disk first so doc edits are
/// hot-reloadable via the refresh-doctrine button.
///
/// Paths here MUST stay in lock-step with `INCLUDED_DOCS`; the build will
/// fail loudly if a referenced file is missing.
const EMBEDDED_DOCS: &[(&str, &str)] = &[
    // Personas
    (
        "features/personas/01-data-model.md",
        include_str!("../../../../docs/features/personas/01-data-model.md"),
    ),
    (
        "features/personas/02-capabilities.md",
        include_str!("../../../../docs/features/personas/02-capabilities.md"),
    ),
    (
        "features/personas/03-trust-and-governance.md",
        include_str!("../../../../docs/features/personas/03-trust-and-governance.md"),
    ),
    // Templates
    (
        "features/templates/01-template-format.md",
        include_str!("../../../../docs/features/templates/01-template-format.md"),
    ),
    (
        "features/templates/02-catalog-loading.md",
        include_str!("../../../../docs/features/templates/02-catalog-loading.md"),
    ),
    (
        "features/templates/03-adoption-flow.md",
        include_str!("../../../../docs/features/templates/03-adoption-flow.md"),
    ),
    (
        "features/templates/04-adoption-questionnaire.md",
        include_str!("../../../../docs/features/templates/04-adoption-questionnaire.md"),
    ),
    (
        "features/templates/05-dynamic-discovery.md",
        include_str!("../../../../docs/features/templates/05-dynamic-discovery.md"),
    ),
    (
        "features/templates/06-integrity-and-security.md",
        include_str!("../../../../docs/features/templates/06-integrity-and-security.md"),
    ),
    (
        "features/templates/07-adoption-answer-pipeline.md",
        include_str!("../../../../docs/features/templates/07-adoption-answer-pipeline.md"),
    ),
    // Execution
    (
        "features/execution/01-entry-points.md",
        include_str!("../../../../docs/features/execution/01-entry-points.md"),
    ),
    (
        "features/execution/02-lifecycle.md",
        include_str!("../../../../docs/features/execution/02-lifecycle.md"),
    ),
    (
        "features/execution/03-chaining-and-approval.md",
        include_str!("../../../../docs/features/execution/03-chaining-and-approval.md"),
    ),
    (
        "features/execution/04-observability.md",
        include_str!("../../../../docs/features/execution/04-observability.md"),
    ),
    // Events / recipes / artist / live roadmap
    (
        "features/events/event-routing.md",
        include_str!("../../../../docs/features/events/event-routing.md"),
    ),
    (
        "features/recipes/recipe-templates.md",
        include_str!("../../../../docs/features/recipes/recipe-templates.md"),
    ),
    (
        "features/plugins/artist/media-studio-architecture.md",
        include_str!("../../../../docs/features/plugins/artist/media-studio-architecture.md"),
    ),
    (
        "features/plugins/artist/media-studio-render-plan.md",
        include_str!("../../../../docs/features/plugins/artist/media-studio-render-plan.md"),
    ),
    (
        "features/live-roadmap/live-roadmap.md",
        include_str!("../../../../docs/features/live-roadmap/live-roadmap.md"),
    ),
    // Top-level concepts
    (
        "features/agents/operations-hub.md",
        include_str!("../../../../docs/features/agents/operations-hub.md"),
    ),
    // (ambient-context-fusion.md and mobile.md were removed in the 2026-07-26
    // docs pruning — their doctrine entries go with them.)
    (
        "concepts/invisible-apps-p2p.md",
        include_str!("../../../../docs/concepts/invisible-apps-p2p.md"),
    ),
    (
        "concepts/persona-design-best-practices.md",
        include_str!("../../../../docs/concepts/persona-design-best-practices.md"),
    ),
    (
        "concepts/operational-data-views.md",
        include_str!("../../../../docs/concepts/operational-data-views.md"),
    ),
    (
        "features/companion/athena-usecases.md",
        include_str!("../../../../docs/features/companion/athena-usecases.md"),
    ),
];

/// Read a curated doc, preferring on-disk content (so dev edits are
/// hot-reloadable) and falling back to the embedded compile-time copy
/// (so production builds with no repo on disk still have all 22 docs).
pub fn read_curated_doc(rel: &str, root: Option<&std::path::Path>) -> Option<String> {
    if let Some(r) = root {
        if let Ok(s) = std::fs::read_to_string(r.join(rel)) {
            return Some(s);
        }
    }
    EMBEDDED_DOCS
        .iter()
        .find(|(p, _)| *p == rel)
        .map(|(_, c)| (*c).to_string())
}

/// Resolve where the curated docs live. In dev, walk up from `cwd` looking
/// for a directory containing `concepts/`. Honors `PERSONAS_DOCS_ROOT`
/// override (used for tests + future Tauri-resource bundling). Returns
/// `None` if no docs root is found — ingestion silently no-ops.
pub fn find_docs_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PERSONAS_DOCS_ROOT") {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            return Some(pb);
        }
    }
    let mut cur = std::env::current_dir().ok()?;
    for _ in 0..6 {
        let candidate = cur.join("docs").join("concepts");
        if candidate.is_dir() {
            return Some(cur.join("docs"));
        }
        match cur.parent() {
            Some(p) => cur = p.to_path_buf(),
            None => break,
        }
    }
    None
}

/// Outcome counts from a single ingestion pass. Useful for logging and
/// future UI surfacing.
#[derive(Debug, Default, Clone)]
pub struct IngestStats {
    pub files_seen: usize,
    pub files_missing: usize,
    pub chunks_inserted: usize,
    pub chunks_updated: usize,
    pub chunks_unchanged: usize,
    pub chunks_deleted: usize,
    pub errors: Vec<String>,
}

/// Process-wide lock serializing doctrine ingestion. See `ingest_all`.
#[cfg(feature = "ml")]
fn ingest_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Run a full doctrine ingestion pass. Idempotent — safe to call on every
/// app start. Reads the curated allowlist, chunks each doc, embeds
/// new/changed chunks, removes orphaned rows.
#[cfg(feature = "ml")]
pub async fn ingest_all(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
) -> Result<IngestStats, AppError> {
    // Serialize ingest process-wide. ingest_all runs on companion_init (startup)
    // AND from the "refresh doctrine" button (companion_reingest_doctrine); each
    // chunk's upsert is a select-then-insert across pooled connections with no
    // UNIQUE constraint, so two overlapping passes both observe None and both
    // INSERT, duplicating every doctrine chunk (+ its FTS/embedding rows). One
    // async lock makes a pass atomic with respect to any other pass
    // (bug-hunt 2026-06-07 companion #3).
    let _ingest_guard = ingest_lock().lock().await;

    embeddings::ensure_vec_table(pool)?;

    let mut stats = IngestStats::default();

    // Disk root is optional now — production builds have no repo, but the
    // EMBEDDED_DOCS fallback in read_curated_doc covers them. We log which
    // mode we're in for transparency.
    let root = find_docs_root();
    match &root {
        Some(r) => {
            tracing::info!(root = %r.display(), "companion doctrine: starting ingest (disk-mode)")
        }
        None => tracing::info!(
            "companion doctrine: starting ingest (embedded-mode, no docs root on disk)"
        ),
    }

    // Track which (file, anchor) pairs we saw so we can prune orphans afterward.
    let mut seen_keys: Vec<String> = Vec::new();

    for rel in INCLUDED_DOCS {
        stats.files_seen += 1;
        let body = match read_curated_doc(rel, root.as_deref()) {
            Some(s) => s,
            None => {
                stats.files_missing += 1;
                tracing::debug!(rel = %rel, "doctrine: file unavailable on disk and not embedded, skipping");
                continue;
            }
        };
        let chunks = chunk_markdown(rel, &body);
        for chunk in chunks {
            seen_keys.push(chunk.file_path.clone());
            match upsert_chunk(pool, embedder, &chunk).await {
                Ok(UpsertOutcome::Inserted) => stats.chunks_inserted += 1,
                Ok(UpsertOutcome::Updated) => stats.chunks_updated += 1,
                Ok(UpsertOutcome::Unchanged) => stats.chunks_unchanged += 1,
                Err(e) => stats
                    .errors
                    .push(format!("upsert {}: {e}", chunk.file_path)),
            }
        }
    }

    // Orphan cleanup: delete companion_node rows with kind='doctrine' whose
    // file_path isn't in seen_keys. Their embeddings get cleaned via the
    // explicit DELETE on companion_embedding.
    stats.chunks_deleted = prune_orphans(pool, &seen_keys)?;

    tracing::info!(
        seen = stats.files_seen,
        missing = stats.files_missing,
        inserted = stats.chunks_inserted,
        updated = stats.chunks_updated,
        unchanged = stats.chunks_unchanged,
        deleted = stats.chunks_deleted,
        errors = stats.errors.len(),
        "companion doctrine: ingest complete"
    );
    Ok(stats)
}

// ── chunking ────────────────────────────────────────────────────────────

// ── upsert ─────────────────────────────────────────────────────────────

#[cfg(feature = "ml")]
async fn upsert_chunk(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    chunk: &DoctrineChunk,
) -> Result<UpsertOutcome, AppError> {
    // Lookup by file_path (which embeds the anchor).
    let existing = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT id, content_hash FROM companion_node
             WHERE kind = 'doctrine' AND file_path = ?1",
            params![chunk.file_path],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok()
    };

    let now = Utc::now().to_rfc3339();
    let excerpt = excerpt_500(&chunk.content);

    match existing {
        Some((id, prior_hash)) if prior_hash == chunk.content_hash => {
            // Hash unchanged. Try to fill in a missing vec entry — happens
            // when the embedder panicked on a previous ingest and the row
            // was inserted without a vector. Best-effort, ignore failure.
            if !has_vec_entry(pool, &id).unwrap_or(true) {
                if let Err(e) =
                    embeddings::embed_and_store(pool, embedder, &id, &chunk.content).await
                {
                    tracing::debug!(node_id = %id, error = %e, "doctrine: backfill embed failed (still skipping)");
                }
            }
            Ok(UpsertOutcome::Unchanged)
        }
        Some((id, _)) => {
            // Update body + re-embed.
            {
                let conn = pool.get()?;
                conn.execute(
                    "UPDATE companion_node SET content_hash = ?1, body_excerpt = ?2, updated_at = ?3
                     WHERE id = ?4",
                    params![chunk.content_hash, excerpt, now, id],
                )?;
                conn.execute(
                    "UPDATE companion_fts SET body = ?1, tags = ?2 WHERE node_id = ?3",
                    params![
                        chunk.content,
                        format!("doctrine path:{}", chunk.file_path),
                        id
                    ],
                )?;
                // Drop old vector row; we'll insert fresh below.
                conn.execute(
                    "DELETE FROM companion_embedding WHERE node_id = ?1",
                    params![id],
                )?;
            }
            // Embed best-effort. If the embedder is poisoned (ORT panic on
            // some Windows configs), the row + FTS still update; vec entry
            // is missing until a future run when the embedder works.
            if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, &chunk.content).await {
                tracing::debug!(node_id = %id, error = %e, "doctrine: embed-on-update failed");
            }
            Ok(UpsertOutcome::Updated)
        }
        None => {
            let id = format!("doc_{}", short_random());
            {
                let conn = pool.get()?;
                conn.execute(
                    "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, embedding_model, embedding_dims, body_excerpt, created_at, updated_at)
                     VALUES (?1, 'doctrine', ?2, ?3, 3, ?4, ?5, ?6, ?7, ?7)",
                    params![
                        id,
                        chunk.file_path,
                        chunk.content_hash,
                        embedder.model_name(),
                        embedder.dimensions() as i64,
                        excerpt,
                        now
                    ],
                )?;
                conn.execute(
                    "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
                    params![
                        id,
                        chunk.content,
                        format!("doctrine path:{}", chunk.file_path)
                    ],
                )?;
            }
            // Same best-effort as the Update path: row sticks even if
            // embedding fails. has_vec_entry() check on next ingest will
            // trigger a backfill attempt.
            if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, &chunk.content).await {
                tracing::debug!(node_id = %id, error = %e, "doctrine: embed-on-insert failed");
            }
            Ok(UpsertOutcome::Inserted)
        }
    }
}

// Path is intentionally unused on builds without the ml feature — silence.
#[cfg(not(feature = "ml"))]
fn _silence_unused(_p: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
}
