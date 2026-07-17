//! Shared all-knowledge-base scan.
//!
//! ONE implementation of "embed a query, search every knowledge base, return
//! the best matches" — consumed by both the clipboard-intelligence command
//! path (`commands::execution::clipboard_intel::search_kb_for_error`) and the
//! clipboard-watcher subscription (`engine::subscription`). Those two sites
//! were drifted copy-paste duplicates; any future ranking or filter change
//! must land here exactly once.
//!
//! ## Why `status = 'ready'`
//!
//! Only knowledge bases whose row says `status = 'ready'` are scanned. This is
//! the stricter of the two historical variants and is kept deliberately: a KB
//! mid-creation, mid-reindex, or in an error state can have a missing or
//! half-populated vec0 table, and an ambient scan (clipboard watcher) must
//! never surface partial results or errors from a KB the user hasn't finished
//! setting up. Per-KB search errors are still skipped silently for the same
//! reason — an ambient lane degrades to fewer results, never to a failure.

use crate::db::UserDbPool;
use crate::engine::embedder::EmbeddingManager;
use crate::engine::vector_store::SqliteVectorStore;
use crate::error::AppError;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A knowledge base match result from an all-KB vector scan.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct KbMatch {
    /// Name of the knowledge base that contained the match.
    pub kb_name: String,
    /// The chunk text that matched.
    pub chunk_text: String,
    /// Similarity score in 0..1 (1 = identical; derived from L2 distance).
    pub similarity: f32,
    /// Source file path of the matched chunk (if available).
    pub source_file: Option<String>,
}

/// Embed `query` and scan all ready knowledge bases. Synchronous — both
/// callers run on the tokio runtime but in sync contexts, so the embedding
/// await is bridged with `block_in_place`, exactly as the two original
/// implementations did.
///
/// Returns up to `limit` matches sorted by similarity (best first).
pub fn search_all_kbs(
    user_db: &UserDbPool,
    embedder: &EmbeddingManager,
    vector_store: &SqliteVectorStore,
    query: &str,
    limit: usize,
) -> Result<Vec<KbMatch>, AppError> {
    let query_text = query.to_string();
    let query_vec = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(embedder.embed_query(&query_text))
    })?;
    search_all_kbs_with_vec(user_db, vector_store, &query_vec, limit)
}

/// The embedding-free core of [`search_all_kbs`]: scan all ready KBs with an
/// already-computed query vector. Split out so the scan semantics (ready
/// filter, per-KB error skip, similarity ranking, truncation) are unit-testable
/// without an ONNX model.
pub fn search_all_kbs_with_vec(
    user_db: &UserDbPool,
    vector_store: &SqliteVectorStore,
    query_vec: &[f32],
    limit: usize,
) -> Result<Vec<KbMatch>, AppError> {
    let user_conn = user_db.get()?;

    // Stricter status filter on purpose — see module docs.
    let kb_list: Vec<(String, String)> = {
        let mut stmt = user_conn.prepare(
            "SELECT id, name FROM knowledge_bases WHERE status = 'ready' ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };

    if kb_list.is_empty() {
        return Ok(Vec::new());
    }

    let mut all_matches: Vec<KbMatch> = Vec::new();
    let mut floor_filtered = 0usize;

    for (kb_id, kb_name) in &kb_list {
        // Skip KBs whose vector index doesn't exist yet (never ingested).
        let results = match vector_store.search(kb_id, query_vec, limit) {
            Ok(r) => r,
            Err(_) => continue,
        };

        // Shared relevance floor — the same primitive (and threshold) `kb_search`
        // and the companion brain apply (`retrieval::MAX_VECTOR_DISTANCE`, L2 over
        // MiniLM-normalized vectors). An ambient scan (clipboard-error notifications)
        // must NOT surface arbitrarily-far chunks: without this floor a query with
        // nothing close still got padded with the least-irrelevant passages of every
        // KB. Applied per-KB before similarity conversion so an off-topic clipboard
        // event notifies with NOTHING rather than noise.
        let (results, dropped) =
            crate::retrieval::filter_by_distance_floor(&results, crate::retrieval::MAX_VECTOR_DISTANCE);
        floor_filtered += dropped;

        for (chunk_id, distance) in results {
            // L2 distance → 0..1 similarity (1 = identical).
            let similarity = 1.0 / (1.0 + distance);

            let (chunk_text, source_file) =
                lookup_chunk_content(&user_conn, &chunk_id).unwrap_or_default();
            if chunk_text.is_empty() {
                continue;
            }

            all_matches.push(KbMatch {
                kb_name: kb_name.clone(),
                chunk_text,
                similarity,
                source_file,
            });
        }
    }

    all_matches.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    all_matches.truncate(limit);

    // Annotate how much noise the floor removed, mirroring `kb_search`'s
    // `floor_filtered` response field. This lane has no UI count surface (an
    // ambient clipboard notification), so — like the companion's `dropped_far`
    // — it is recorded as a tracing field rather than a return value.
    tracing::debug!(
        floor_filtered,
        kept = all_matches.len(),
        "search_all_kbs: applied shared relevance floor"
    );

    Ok(all_matches)
}

/// Look up a chunk's text content and its document's source path.
fn lookup_chunk_content(
    conn: &rusqlite::Connection,
    chunk_id: &str,
) -> Result<(String, Option<String>), AppError> {
    let mut stmt = conn.prepare_cached(
        "SELECT c.content, d.source_path
         FROM kb_chunks c
         LEFT JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id = ?1",
    )?;
    let result = stmt.query_row(rusqlite::params![chunk_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    const KB_READY: &str = "aaaaaaaa-1111-2222-3333-444444444444";
    const KB_NOT_READY: &str = "bbbbbbbb-1111-2222-3333-444444444444";

    fn test_pool() -> UserDbPool {
        crate::engine::vector_store::ensure_vec_registered_pub();
        let tmp = std::env::temp_dir().join(format!("kb_scan_test_{}.db", uuid::Uuid::new_v4()));
        let manager = SqliteConnectionManager::file(&tmp);
        let pool = r2d2::Pool::builder().max_size(2).build(manager).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE knowledge_bases (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
             CREATE TABLE kb_documents (
                id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, source_path TEXT
            );
             CREATE TABLE kb_chunks (
                id TEXT PRIMARY KEY, kb_id TEXT NOT NULL, document_id TEXT NOT NULL,
                content TEXT NOT NULL
            );",
        )
        .unwrap();
        drop(conn);
        pool
    }

    fn seed_kb(
        pool: &UserDbPool,
        vs: &SqliteVectorStore,
        kb_id: &str,
        name: &str,
        status: &str,
        chunks: &[(&str, [f32; 4])],
    ) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO knowledge_bases (id, name, status) VALUES (?1, ?2, ?3)",
            rusqlite::params![kb_id, name, status],
        )
        .unwrap();
        let doc_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO kb_documents (id, kb_id, source_path) VALUES (?1, ?2, '/src/doc.md')",
            rusqlite::params![doc_id, kb_id],
        )
        .unwrap();
        vs.create_index(kb_id, 4).unwrap();
        let mut entries = Vec::new();
        for (content, vec) in chunks {
            let chunk_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO kb_chunks (id, kb_id, document_id, content) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![chunk_id, kb_id, doc_id, content],
            )
            .unwrap();
            entries.push((chunk_id, vec.to_vec()));
        }
        vs.insert_vectors(kb_id, &entries).unwrap();
    }

    /// The parity test for the shared lane: both former call sites (command +
    /// subscription) now route through `search_all_kbs_with_vec`, so this test
    /// pins the semantics they share — ready-only KB filter, the shared relevance
    /// floor, similarity-desc ordering across KBs, source path hydration, and
    /// truncation to `limit`.
    #[test]
    fn shared_scan_filters_ready_ranks_by_similarity_and_truncates() {
        let pool = test_pool();
        let vs = SqliteVectorStore::new(pool.clone());

        // Ready KB: one near chunk (in-floor), one moderately-near chunk (in-floor),
        // and one far chunk (past MAX_VECTOR_DISTANCE — the floor must drop it).
        // `[1,0.5,0,0]` is L2 √0.25 = 0.5 from the query — well inside the 1.30
        // floor; `[0,10,0,0]` is ~10 away — well past it.
        seed_kb(
            &pool,
            &vs,
            KB_READY,
            "Ready KB",
            "ready",
            &[
                ("near match", [1.0, 0.0, 0.0, 0.0]),
                ("mid match", [1.0, 0.5, 0.0, 0.0]),
                ("far match", [0.0, 10.0, 0.0, 0.0]),
            ],
        );
        // Non-ready KB: would be the closest hit of all — must be excluded.
        seed_kb(
            &pool,
            &vs,
            KB_NOT_READY,
            "Indexing KB",
            "indexing",
            &[("exact but not ready", [1.0, 0.0, 0.0, 0.1])],
        );

        let query = [1.0f32, 0.0, 0.0, 0.0];
        let matches = search_all_kbs_with_vec(&pool, &vs, &query, 10).unwrap();

        // Only the ready KB's in-floor chunks; the far chunk is dropped by the
        // relevance floor, so exactly the two near/mid chunks survive.
        assert_eq!(matches.len(), 2);
        assert!(matches.iter().all(|m| m.kb_name == "Ready KB"));
        assert!(
            matches.iter().all(|m| m.chunk_text != "far match"),
            "the far chunk must be dropped by the shared relevance floor"
        );
        assert_eq!(matches[0].chunk_text, "near match");
        assert!(matches[0].similarity > matches[1].similarity);
        assert_eq!(matches[0].source_file.as_deref(), Some("/src/doc.md"));

        // Truncation to limit.
        let one = search_all_kbs_with_vec(&pool, &vs, &query, 1).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].chunk_text, "near match");
    }
}
