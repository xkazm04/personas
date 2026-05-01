//! Hybrid retrieval bundling memory into the working context for each turn.
//!
//! Phase 2: vector + recency. Phase 3 will add BM25 and graph traversal,
//! plus provenance footer formatting.
//!
//! Strategy:
//!   - Last 5 turns by recency (always — recent context dominates)
//!   - Top 15 vector matches against the user's current message
//!   - Deduplicate by node_id, keep recent first then vector matches
//!
//! When the vec table is empty (cold start), falls through to the
//! Phase-1 behavior of last-N raw episodes so the prompt is never empty.

use std::collections::HashSet;
#[cfg(feature = "ml")]
use std::sync::Arc;

use crate::companion::brain::embeddings;
use crate::companion::brain::episodic::{self, Episode};
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

const RECENCY_TURNS: u32 = 5;
const VECTOR_TOPK: usize = 15;
const FALLBACK_LIMIT: u32 = 20;

/// Retrieve memory for the working context.
///
/// `query` is the user's current message; used to seed the vector search.
/// Returns episodes oldest-first (so the prompt builder can render them
/// in conversational order).
#[cfg(feature = "ml")]
pub async fn retrieve(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    session_id: &str,
    query: &str,
) -> Result<Vec<Episode>, AppError> {
    let recent = episodic::list_recent(pool, session_id, RECENCY_TURNS).unwrap_or_default();
    let recent_ids: HashSet<String> = recent.iter().map(|e| e.id.clone()).collect();

    let semantic_hits =
        embeddings::search_similar(pool, embedder, query, VECTOR_TOPK)
            .await
            .unwrap_or_default();

    if recent.is_empty() && semantic_hits.is_empty() {
        // Cold start — full fallback.
        return Ok(episodic::list_recent(pool, session_id, FALLBACK_LIMIT).unwrap_or_default());
    }

    // Load semantic-matched episodes that aren't already in `recent`.
    // This preserves provenance: we only use what's actually on disk;
    // any vec0 row whose disk file is missing gets quietly skipped.
    let extra_ids: Vec<String> = semantic_hits
        .into_iter()
        .map(|(id, _dist)| id)
        .filter(|id| !recent_ids.contains(id))
        .collect();

    let mut extra = load_episodes_by_ids(pool, &extra_ids).unwrap_or_default();
    // Order semantic results by their own created_at (oldest first) so when
    // we splice with recent (also oldest first) the whole thing stays
    // chronological-ish. Still imperfect, but readable.
    extra.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    // Final order: semantic-recall episodes first (older context), then
    // recent turns (latest, most relevant). The prompt reader sees a
    // chronological-feeling history with relevant-but-old material woven in.
    let mut out = extra;
    out.extend(recent);
    Ok(out)
}

#[cfg(not(feature = "ml"))]
pub async fn retrieve(
    pool: &UserDbPool,
    session_id: &str,
    _query: &str,
) -> Result<Vec<Episode>, AppError> {
    Ok(episodic::list_recent(pool, session_id, FALLBACK_LIMIT).unwrap_or_default())
}

/// Read full episodes by id list, preserving order. Drops any whose disk
/// file is missing (treated as soft errors — never fail the turn).
fn load_episodes_by_ids(pool: &UserDbPool, ids: &[String]) -> Result<Vec<Episode>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'episode' AND id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            let id: String = row.get(0)?;
            let file_path: String = row.get(1)?;
            let _excerpt: String = row.get(2).unwrap_or_default();
            let created_at: String = row.get(3)?;
            Ok((id, file_path, created_at))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let root = crate::companion::disk::brain_root()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, created_at) in rows {
        let full = match std::fs::read_to_string(root.join(&rel_path)) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (role, content) = parse_role_and_body(&full);
        out.push(Episode {
            id,
            // We don't have the session_id from the SQL row; reading the
            // frontmatter would let us recover it, but for prompt-rendering
            // we don't actually need it. Leave a sentinel.
            session_id: String::new(),
            role,
            content,
            file_path: rel_path,
            created_at,
        });
    }
    Ok(out)
}

fn parse_role_and_body(full: &str) -> (String, String) {
    let mut role = "unknown".to_string();
    let mut body = full.to_string();
    if let Some(after) = full.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            for line in after[..end].lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("role:") {
                    role = rest.trim().to_string();
                }
            }
            body = after[end + 4..].trim_start().to_string();
        }
    }
    (role, body)
}
