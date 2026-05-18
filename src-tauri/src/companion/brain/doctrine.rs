//! Doctrine: read-only canonical knowledge about the Personas app itself.
//!
//! Source of truth lives at `<repo>/docs/...` (curated 22-file allowlist;
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

use chrono::Utc;
use rusqlite::params;
use sha2::{Digest, Sha256};

use crate::companion::brain::embeddings;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Curated allowlist — 22 docs that capture Personas' philosophy and
/// architecture without dragging in handoffs, test logs, or stale plans.
/// Paths are relative to the docs root (the directory whose entries
/// include `concepts/`).
const INCLUDED_DOCS: &[&str] = &[
    // Personas — the core ontology (data model, capabilities, governance).
    "features/personas/01-data-model.md",
    "features/personas/02-capabilities.md",
    "features/personas/03-trust-and-governance.md",
    // Templates — adoption flow, catalog, schema, security.
    "features/templates/01-template-format.md",
    "features/templates/02-catalog-loading.md",
    "features/templates/03-adoption-flow.md",
    "features/templates/04-adoption-questionnaire.md",
    "features/templates/05-dynamic-discovery.md",
    "features/templates/06-integrity-and-security.md",
    "features/templates/07-adoption-answer-pipeline.md",
    // Execution — runtime / lifecycle / chaining / observability.
    "features/execution/01-entry-points.md",
    "features/execution/02-lifecycle.md",
    "features/execution/03-chaining-and-approval.md",
    "features/execution/04-observability.md",
    // Events / recipes / artist / live roadmap.
    "features/events/event-routing.md",
    "features/recipes/recipe-templates.md",
    "features/plugins/artist/media-studio-architecture.md",
    "features/plugins/artist/media-studio-render-plan.md",
    "features/live-roadmap/live-roadmap.md",
    // Top-level concepts — design philosophy.
    "concepts/adoption-creation-unification.md",
    "features/agents/operations-hub.md",
    "concepts/ambient-context-fusion.md",
    "concepts/claude-code-routines-integration.md",
    "concepts/cloud-deployment.md",
    "concepts/invisible-apps-p2p.md",
    "concepts/mobile.md",
    "concepts/real-api-testing.md",
    "concepts/persona-design-best-practices.md",
    // Athena's own capability surface — kept in doctrine so the
    // "what can you do?" question pulls a current, honest answer via
    // embedding retrieval instead of relying on the constitution's
    // op-grammar reference alone.
    "features/companion/athena-usecases.md",
];

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
        "concepts/adoption-creation-unification.md",
        include_str!("../../../../docs/concepts/adoption-creation-unification.md"),
    ),
    (
        "features/agents/operations-hub.md",
        include_str!("../../../../docs/features/agents/operations-hub.md"),
    ),
    (
        "concepts/ambient-context-fusion.md",
        include_str!("../../../../docs/concepts/ambient-context-fusion.md"),
    ),
    (
        "concepts/claude-code-routines-integration.md",
        include_str!("../../../../docs/concepts/claude-code-routines-integration.md"),
    ),
    (
        "concepts/cloud-deployment.md",
        include_str!("../../../../docs/concepts/cloud-deployment.md"),
    ),
    (
        "concepts/invisible-apps-p2p.md",
        include_str!("../../../../docs/concepts/invisible-apps-p2p.md"),
    ),
    (
        "concepts/mobile.md",
        include_str!("../../../../docs/concepts/mobile.md"),
    ),
    (
        "concepts/real-api-testing.md",
        include_str!("../../../../docs/concepts/real-api-testing.md"),
    ),
    (
        "concepts/persona-design-best-practices.md",
        include_str!("../../../../docs/concepts/persona-design-best-practices.md"),
    ),
    (
        "features/companion/athena-usecases.md",
        include_str!("../../../../docs/features/companion/athena-usecases.md"),
    ),
];

/// Soft target — sections larger than this are split further. Generous
/// because Athena reads markdown well and we'd rather keep a logical
/// section together than split it just for tidiness.
const CHUNK_SOFT_CAP_BYTES: usize = 8_000;

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

/// Run a full doctrine ingestion pass. Idempotent — safe to call on every
/// app start. Reads the curated allowlist, chunks each doc, embeds
/// new/changed chunks, removes orphaned rows.
#[cfg(feature = "ml")]
pub async fn ingest_all(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
) -> Result<IngestStats, AppError> {
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

#[cfg(not(feature = "ml"))]
pub async fn ingest_all(_pool: &UserDbPool) -> Result<IngestStats, AppError> {
    Ok(IngestStats::default())
}

// ── chunking ────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct DoctrineChunk {
    /// `<rel_path>#<heading_anchor>` — also the upsert key.
    file_path: String,
    /// Heading text (empty for doc-level intro chunk).
    heading: String,
    /// Markdown body of the section, *including* the heading line if any.
    content: String,
    /// sha256 of `content`.
    content_hash: String,
}

fn chunk_markdown(rel_path: &str, body: &str) -> Vec<DoctrineChunk> {
    let mut chunks = Vec::new();
    let mut current_heading = String::new();
    let mut current_lines: Vec<&str> = Vec::new();

    let flush = |heading: &str, lines: &[&str], out: &mut Vec<DoctrineChunk>| {
        let content = lines.join("\n");
        if content.trim().is_empty() {
            return;
        }
        let anchor = if heading.is_empty() {
            "intro".to_string()
        } else {
            slugify(heading)
        };
        // Soft-cap: if a section exceeds the cap, split on H3, then on
        // hard byte boundaries. Each piece gets a UNIQUE upsert key with
        // a `-pN` suffix on the anchor — without this, all pieces of an
        // oversized section share a single key and overwrite each other
        // on every ingest pass (visible as a stable ~N "updated" count
        // that never converges to zero).
        let pieces = split_oversized(&content, CHUNK_SOFT_CAP_BYTES);
        let multi = pieces.len() > 1;
        for (idx, piece) in pieces.into_iter().enumerate() {
            let piece_anchor = if multi {
                format!("{anchor}-p{}", idx + 1)
            } else {
                anchor.clone()
            };
            let file_path = format!("{rel_path}#{piece_anchor}");
            let hash = sha256_hex(&piece);
            out.push(DoctrineChunk {
                file_path,
                heading: heading.to_string(),
                content: piece,
                content_hash: hash,
            });
        }
    };

    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            // Boundary: flush prior section, start new one with this line included.
            flush(&current_heading, &current_lines, &mut chunks);
            current_heading = rest.trim().to_string();
            current_lines.clear();
            current_lines.push(line);
        } else {
            current_lines.push(line);
        }
    }
    flush(&current_heading, &current_lines, &mut chunks);
    chunks
}

/// Split a section that's larger than `cap` bytes. Tries H3 boundaries
/// first, then falls back to hard byte splits at line boundaries (never
/// splitting mid-line). Keeps each piece under cap when possible.
fn split_oversized(content: &str, cap: usize) -> Vec<String> {
    if content.len() <= cap {
        return vec![content.to_string()];
    }
    // Try H3 split first
    let h3_pieces: Vec<&str> = content.split_inclusive("\n### ").collect();
    if h3_pieces.iter().all(|p| p.len() <= cap) && h3_pieces.len() > 1 {
        return h3_pieces.into_iter().map(|s| s.to_string()).collect();
    }
    // Hard split on line boundaries
    let mut out = Vec::new();
    let mut buf = String::new();
    for line in content.lines() {
        if buf.len() + line.len() + 1 > cap && !buf.is_empty() {
            out.push(std::mem::take(&mut buf));
        }
        if !buf.is_empty() {
            buf.push('\n');
        }
        buf.push_str(line);
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "section".into()
    } else {
        out
    }
}

fn sha256_hex(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}

// ── upsert ─────────────────────────────────────────────────────────────

enum UpsertOutcome {
    Inserted,
    Updated,
    Unchanged,
}

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

/// Does this node have an entry in `companion_embedding`?
fn has_vec_entry(pool: &UserDbPool, node_id: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM companion_embedding WHERE node_id = ?1",
            params![node_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(count > 0)
}

fn prune_orphans(pool: &UserDbPool, seen: &[String]) -> Result<usize, AppError> {
    let conn = pool.get()?;
    // Get all doctrine ids and file_paths.
    let mut stmt =
        conn.prepare("SELECT id, file_path FROM companion_node WHERE kind = 'doctrine'")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let seen_set: std::collections::HashSet<&str> = seen.iter().map(|s| s.as_str()).collect();
    let mut deleted = 0;
    for (id, file_path) in rows {
        if !seen_set.contains(file_path.as_str()) {
            conn.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
            conn.execute("DELETE FROM companion_fts WHERE node_id = ?1", params![id])?;
            conn.execute(
                "DELETE FROM companion_embedding WHERE node_id = ?1",
                params![id],
            )?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

fn excerpt_500(content: &str) -> String {
    if content.len() <= 500 {
        return content.to_string();
    }
    let mut end = 500;
    while !content.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    content[..end].to_string()
}

fn short_random() -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(10)
        .collect()
}

// Path is intentionally unused on builds without the ml feature — silence.
#[cfg(not(feature = "ml"))]
fn _silence_unused(_p: &Path) {}
