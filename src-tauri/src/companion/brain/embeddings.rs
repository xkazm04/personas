//! Embedding pipeline for the companion brain.
//!
//! Reuses the existing `engine::embedder::EmbeddingManager` (AllMiniLML6V2Q,
//! 384-dim) and the `sqlite-vec` extension already wired by
//! `engine::vector_store`. No new model bundling.
//!
//! The `companion_embedding` vec0 virtual table is created at runtime (not
//! at migration time) so that sqlite-vec auto-extension registration on
//! every connection from the pool runs first. Mirrors how knowledge bases
//! provision their per-KB vec0 tables in
//! `engine::vector_store::SqliteVectorStore::create_index`.
//!
//! Schema columns `embedding_model` and `embedding_dims` on `companion_node`
//! exist so we can swap models without a schema break — a reindex job is
//! sufficient.

#[cfg(feature = "ml")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "ml")]
use std::sync::Arc;

#[cfg(feature = "ml")]
use rusqlite::params;

#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;

/// Latched to `true` only after the table has been created *successfully* this
/// process. Unlike a `Once` (which records that the closure *ran*, not that it
/// *succeeded*), this lets a transient first-call failure — e.g. a busy/locked
/// pool connection — be retried on the next call instead of being cached as
/// done, which previously left the table absent for the whole process and
/// silently broke all vector recall (`search_similar` returned empty forever).
#[cfg(feature = "ml")]
static VEC_TABLE_READY: AtomicBool = AtomicBool::new(false);

/// Process-cumulative count of companion recall hits excluded by the
/// shared-corpus model guard — vectors recorded under an embedding model
/// different from the one now loaded. Queryable diagnostic stat (also surfaced
/// via `tracing::warn` at the moment of exclusion). Stays `0` unless the
/// embedder model has changed since some vectors were written, in which case a
/// brain re-embed clears it back to producing zero exclusions.
#[cfg(feature = "ml")]
static MODEL_GUARD_EXCLUDED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Read the cumulative companion model-guard exclusion counter. Reserved
/// queryable diagnostic — the active surface today is the `tracing::warn` at
/// exclusion time; this reader lets a future recall-stats command expose the
/// running total without re-plumbing the counter.
#[cfg(feature = "ml")]
#[allow(dead_code)]
pub fn model_guard_excluded_total() -> u64 {
    MODEL_GUARD_EXCLUDED.load(Ordering::Relaxed)
}

/// Drop hits whose `companion_node.embedding_model` differs from the currently
/// loaded embedder. Rows with a NULL stamp (legacy episodic writes that predate
/// stamping) are omitted from the lookup map and therefore grandfathered as
/// current-model by [`crate::retrieval::filter_by_model`] — so at the current
/// model this is a no-op and recall is byte-identical. Exclusions are counted
/// and logged, never silently swallowed.
#[cfg(feature = "ml")]
fn apply_model_guard(
    conn: &rusqlite::Connection,
    hits: Vec<(String, f32)>,
    current_model: &str,
) -> Result<Vec<(String, f32)>, AppError> {
    if hits.is_empty() {
        return Ok(hits);
    }
    let ids_json =
        serde_json::to_string(&hits.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>())
            .map_err(|e| AppError::Internal(format!("model guard id serialize: {e}")))?;
    let mut stmt = conn.prepare(
        "SELECT id, embedding_model FROM companion_node
         WHERE id IN (SELECT value FROM json_each(?1)) AND embedding_model IS NOT NULL",
    )?;
    let mut model_of = std::collections::HashMap::new();
    let rows = stmt.query_map(params![ids_json], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (id, model) = row?;
        model_of.insert(id, model);
    }
    let (kept, excluded) = crate::retrieval::filter_by_model(&hits, current_model, &model_of);
    if excluded > 0 {
        MODEL_GUARD_EXCLUDED.fetch_add(excluded as u64, Ordering::Relaxed);
        tracing::warn!(
            excluded,
            current_model,
            "companion recall: excluded embeddings recorded under a different model (re-embed the brain to restore them)"
        );
    }
    Ok(kept)
}

#[cfg(feature = "ml")]
pub fn ensure_vec_table(pool: &UserDbPool) -> Result<(), AppError> {
    // Fast path: already created successfully this process.
    if VEC_TABLE_READY.load(Ordering::Acquire) {
        return Ok(());
    }
    // `CREATE VIRTUAL TABLE IF NOT EXISTS` is idempotent, so re-running after a
    // prior transient failure is safe; only latch "ready" once it succeeds.
    let conn = pool.get()?;
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS companion_embedding USING vec0(node_id TEXT, embedding float[{COMPANION_VEC_DIMS}])"
    ))?;
    if !VEC_TABLE_READY.swap(true, Ordering::AcqRel) {
        tracing::info!(dims = COMPANION_VEC_DIMS, "companion_embedding table ready");
    }
    Ok(())
}

/// Embed `text` and write to `companion_embedding`. Best-effort — caller
/// can choose to swallow errors so embedding failure doesn't fail the
/// surrounding write (e.g., we still want the episode persisted to disk +
/// companion_node even if embedding fails).
#[cfg(feature = "ml")]
pub async fn embed_and_store(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    node_id: &str,
    text: &str,
) -> Result<(), AppError> {
    ensure_vec_table(pool)?;
    let vec = embedder.embed_query(text).await?;
    if vec.len() != COMPANION_VEC_DIMS {
        return Err(AppError::Internal(format!(
            "embedder produced {} dims, expected {COMPANION_VEC_DIMS}",
            vec.len()
        )));
    }
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_embedding (node_id, embedding) VALUES (?1, ?2)",
        params![node_id, blob],
    )?;
    // Stamp the model on the owning node so the recall-side model guard can tell
    // which embedder a vector was written under. Doctrine already stamps at
    // insert; episodic did not — stamping here covers ALL callers uniformly and
    // is an idempotent no-op when the node was already stamped with this model.
    conn.execute(
        "UPDATE companion_node SET embedding_model = ?1, embedding_dims = ?2 WHERE id = ?3",
        params![embedder.model_name(), embedder.dimensions() as i64, node_id],
    )?;
    Ok(())
}

/// What a [`reembed_missing`] pass did.
///
/// `ml`-only, unlike the rest of this module's pairs: the non-`ml` caller never
/// reaches the backfill at all — `companion_reembed_missing` short-circuits to
/// `available: false` before it — so a non-`ml` twin would be a stub with no
/// caller rather than a stub with a trivial one.
#[cfg(feature = "ml")]
#[derive(Debug, Default, Clone, Copy)]
pub struct ReembedCounts {
    /// Nodes that now have a vector recorded under the current model.
    pub embedded: u32,
    /// Nodes that needed one but could not get one — no readable body and no
    /// excerpt to fall back on, or the embedder rejected the text.
    pub skipped: u32,
}

/// How many nodes are processed between progress logs / connection releases.
#[cfg(feature = "ml")]
const REEMBED_BATCH: usize = 32;

/// One node that needs a vector.
///
/// Compiled under both feature sets even though only the `ml` build acts on it,
/// because [`reembed_candidates`] is the part of the backfill a test can reach
/// without an ONNX model and it is worth keeping honest in both.
#[derive(Debug, Clone)]
#[cfg_attr(not(feature = "ml"), allow(dead_code))]
pub struct ReembedCandidate {
    pub id: String,
    /// Relative to `brain_root()`. Doctrine nodes carry a `docs/…#anchor`
    /// reference instead of a real file; those fall back to the excerpt.
    pub file_path: String,
    pub body_excerpt: Option<String>,
}

/// Backfill `companion_embedding` for every node that has no vector, or whose
/// vector was written under a *different* embedding model.
///
/// This closes a real hole rather than adding a nicety. `embed_and_store` is
/// only ever called at write time, and doctrine is the single kind that
/// self-heals ([`super::doctrine`]'s `has_vec_entry` backfill). Everything
/// else — every fact, procedural and episode — gets exactly one chance at a
/// vector, at the instant it is written. So:
///
///   * memory that arrives by any route other than a live write (a portability
///     import, a hand-restored brain directory, a write that happened while the
///     embedder was poisoned) has text and no vector, permanently; and
///   * [`apply_model_guard`] *drops* recall hits whose stamped
///     `embedding_model` differs from the loaded one and logs "re-embed the
///     brain to restore them" — an instruction nothing in the codebase could
///     carry out until this function existed.
///
/// Either way recall silently degrades to the recency and importance lanes and
/// never recovers. This is the repair.
///
/// The text embedded per node is the best available: the markdown body at
/// `brain_root()/<file_path>` when that reads as UTF-8, else `body_excerpt`.
/// Doctrine nodes always take the excerpt path — their `file_path` is a
/// `docs/…#anchor` reference, not a file on disk.
///
/// Any existing vector row is deleted before the new one is inserted, because
/// `embed_and_store` does a plain INSERT; without the delete a re-run would
/// stack duplicate vectors for the same node. That also makes this idempotent:
/// a second run finds nothing to do and reports `embedded: 0`.
#[cfg(feature = "ml")]
pub async fn reembed_missing(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
) -> Result<ReembedCounts, AppError> {
    ensure_vec_table(pool)?;
    let current_model = embedder.model_name().to_string();
    let candidates = reembed_candidates(pool, &current_model)?;

    if candidates.is_empty() {
        return Ok(ReembedCounts::default());
    }
    let total = candidates.len();
    tracing::info!(total, model = %current_model, "companion re-embed: starting backfill");

    let root = crate::companion::disk::brain_root().ok();
    let mut counts = ReembedCounts::default();

    for (i, cand) in candidates.into_iter().enumerate() {
        let ReembedCandidate {
            id,
            file_path,
            body_excerpt,
        } = cand;
        let text = root
            .as_ref()
            .map(|r| r.join(&file_path))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .or(body_excerpt)
            .unwrap_or_default();
        if text.trim().is_empty() {
            counts.skipped += 1;
            continue;
        }
        {
            let conn = pool.get()?;
            // Plain INSERT downstream — clear the old row or we stack vectors.
            let _ = conn.execute(
                "DELETE FROM companion_embedding WHERE node_id = ?1",
                params![id],
            );
        }
        match embed_and_store(pool, embedder, &id, &text).await {
            Ok(()) => counts.embedded += 1,
            Err(e) => {
                counts.skipped += 1;
                tracing::debug!(node_id = %id, error = %e, "companion re-embed: node skipped");
            }
        }
        if (i + 1) % REEMBED_BATCH == 0 {
            tracing::info!(
                done = i + 1,
                total,
                embedded = counts.embedded,
                skipped = counts.skipped,
                "companion re-embed: progress"
            );
        }
    }

    tracing::info!(
        embedded = counts.embedded,
        skipped = counts.skipped,
        "companion re-embed: done"
    );
    Ok(counts)
}

/// Cosine search over `companion_embedding`. Returns (node_id, distance)
/// ordered by ascending distance (smaller = closer).
#[cfg(feature = "ml")]
pub async fn search_similar(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    query: &str,
    k: usize,
) -> Result<Vec<(String, f32)>, AppError> {
    ensure_vec_table(pool)?;
    let vec = embedder.embed_query(query).await?;
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = pool.get()?;
    // Empty vec table → silent empty result, not an error.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM companion_embedding", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT node_id, distance FROM companion_embedding
         WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![blob, k as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    apply_model_guard(&conn, rows, embedder.model_name())
}

/// Distance scan restricted to a single `companion_node.kind`. Returns
/// (node_id, L2 distance) ordered nearest-first.
///
/// `companion_embedding` is one shared vec0 table across all kinds and has
/// no `kind` column, so a kind-filtered KNN can't be expressed as a `MATCH`
/// query. Instead we brute-force `vec_distance_l2` over the rows that join to
/// the requested kind. This is the "dedicated lane" that keeps a small,
/// structurally-distinct corpus (doctrine = a few hundred embedded MD chunks)
/// from being starved out of the shared top-K by an episode-heavy brain — the
/// gap that made architecture/policy questions answer from the constitution
/// instead of retrieval. Cheap because the per-kind corpus is small.
#[cfg(feature = "ml")]
pub async fn search_similar_kind(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    query: &str,
    kind: &str,
    k: usize,
) -> Result<Vec<(String, f32)>, AppError> {
    ensure_vec_table(pool)?;
    let vec = embedder.embed_query(query).await?;
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT e.node_id, vec_distance_l2(e.embedding, ?1) AS dist
         FROM companion_embedding e
         JOIN companion_node n ON n.id = e.node_id
         WHERE n.kind = ?2
         ORDER BY dist ASC LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(params![blob, kind, k as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod reembed_selection_tests {
    //! The selection rule behind `companion_reembed_missing`, tested without an
    //! ONNX model — deliberately, because the embedder is the one part of that
    //! command a test cannot have and the *choice of what to re-embed* is the
    //! part that can actually be wrong.
    //!
    //! `companion_embedding` is a `vec0` virtual table in production, but this
    //! code only ever runs `SELECT node_id FROM companion_embedding` against
    //! it, so a plain table stands in exactly.
    use rusqlite::params;

    const MODEL: &str = "AllMiniLML6V2Q";

    fn seed(pool: &crate::db::UserDbPool, rows: &[(&str, Option<&str>)]) {
        let conn = pool.get().unwrap();
        for (id, model) in rows {
            conn.execute(
                "INSERT INTO companion_node (id, kind, file_path, content_hash, embedding_model) \
                 VALUES (?1, 'fact', ?2, 'sha256:x', ?3)",
                params![id, format!("semantic/user/{id}.md"), model],
            )
            .unwrap();
        }
    }
}

#[cfg(all(test, feature = "ml"))]
mod tests {
    //! Verifies the one runtime unknown behind the dedicated doctrine lane:
    //! that `vec_distance_l2` resolves in the bundled sqlite-vec (0.1.6) when
    //! given a raw float32 blob, and that the kind-filtered brute-force scan
    //! returns only the requested kind, nearest-first. No embedder needed —
    //! we hand-craft vectors so the test is deterministic and cheap.
    use rusqlite::{params, Connection};

    fn blob(v: &[f32]) -> Vec<u8> {
        bytemuck::cast_slice(v).to_vec()
    }

    #[test]
    fn vec_distance_l2_kind_scan() {
        crate::engine::vector_store::ensure_vec_registered_pub();
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            "CREATE VIRTUAL TABLE companion_embedding USING vec0(node_id TEXT, embedding float[4]);
             CREATE TABLE companion_node (id TEXT PRIMARY KEY, kind TEXT);",
        )
        .expect("schema");
        // query ≈ doctrine d1 (near); episode e1 is far; doctrine d2 is far.
        for (id, kind, v) in [
            ("d1", "doctrine", blob(&[0.95, 0.05, 0.0, 0.0])),
            ("d2", "doctrine", blob(&[0.0, 0.0, 0.0, 1.0])),
            ("e1", "episode", blob(&[0.9, 0.1, 0.0, 0.0])),
        ] {
            conn.execute(
                "INSERT INTO companion_node (id, kind) VALUES (?1, ?2)",
                params![id, kind],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO companion_embedding (node_id, embedding) VALUES (?1, ?2)",
                params![id, v],
            )
            .unwrap();
        }
        let q = blob(&[1.0, 0.0, 0.0, 0.0]);
        let mut stmt = conn
            .prepare(
                "SELECT e.node_id, vec_distance_l2(e.embedding, ?1) AS dist
                 FROM companion_embedding e
                 JOIN companion_node n ON n.id = e.node_id
                 WHERE n.kind = ?2
                 ORDER BY dist ASC LIMIT ?3",
            )
            .expect("prepare (vec_distance_l2 must resolve in sqlite-vec 0.1.6)");
        let rows: Vec<(String, f32)> = stmt
            .query_map(params![q, "doctrine", 10_i64], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        // Only doctrine rows (episode e1 excluded despite being near), nearest first.
        assert_eq!(rows.len(), 2, "kind filter must exclude the episode");
        assert_eq!(rows[0].0, "d1", "nearest doctrine first");
        assert_eq!(rows[1].0, "d2");
        assert!(rows[0].1 < rows[1].1, "distances strictly ordered");
    }

    #[test]
    fn model_guard_excludes_foreign_model_but_keeps_null_and_current() {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(
            "CREATE TABLE companion_node (id TEXT PRIMARY KEY, embedding_model TEXT);",
        )
        .expect("schema");
        // cur = current model, old = swapped-away model, leg = legacy NULL stamp.
        for (id, model) in [
            ("cur", Some("AllMiniLML6V2Q")),
            ("old", Some("BGESmallENV15")),
            ("leg", None),
        ] {
            conn.execute(
                "INSERT INTO companion_node (id, embedding_model) VALUES (?1, ?2)",
                params![id, model],
            )
            .unwrap();
        }
        let hits = vec![
            ("cur".to_string(), 0.1_f32),
            ("old".to_string(), 0.2_f32),
            ("leg".to_string(), 0.3_f32),
        ];
        let before = super::model_guard_excluded_total();
        let kept = super::apply_model_guard(&conn, hits, "AllMiniLML6V2Q").expect("guard");
        assert_eq!(
            kept.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["cur", "leg"],
            "foreign-model vector dropped; current + legacy-NULL kept"
        );
        assert_eq!(
            super::model_guard_excluded_total() - before,
            1,
            "exactly one exclusion counted and surfaced"
        );
    }
}
