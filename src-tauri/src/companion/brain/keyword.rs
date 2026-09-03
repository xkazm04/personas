//! Keyword (BM25) retrieval lane over `companion_fts`.
//!
//! `companion_fts` has been written by every memory tier since Phase 1 —
//! episodes (`episodic::append_episode`), facts (`semantic`), procedurals
//! (`procedural`), goals (`goals`) and doctrine (`doctrine::upsert_chunk`) all
//! mirror their body into it — but until this module it had **no readers**:
//! every reference in the tree was a `DELETE` or an `UPDATE`. Every episode
//! body was stored a second time, in full, and never queried.
//!
//! That dead index is the whole reason recall was a constant. The vector lane
//! is `ml`-gated and the shipped desktop build has no `ml` feature, so the
//! non-ml path had no query-dependent retrieval at all: it returned the same
//! N most-recent episodes and the same top-N facts on every turn, and
//! `doctrine` was hard-coded to `Vec::new()` — 407 indexed doctrine chunks
//! were never once consulted.
//!
//! This lane needs no embedder, so it runs in **both** builds and gives the
//! ml path a keyword floor for the (currently universal) case where a node
//! has no vector.
//!
//! Ranking is BM25 (`ORDER BY bm25(companion_fts) ASC` — FTS5's bm25 is
//! negated, so ascending is best-first). The MATCH expression comes from
//! [`crate::retrieval::build_fts5_match_query`], which is where free-form user
//! text is made safe for the FTS5 grammar; when it yields nothing the lane
//! returns empty rather than matching everything.

use rusqlite::{params, Connection};

use crate::db::UserDbPool;
use crate::error::AppError;
use crate::retrieval::build_fts5_match_query;

/// Cap on how many query terms ride the MATCH expression. Long pasted
/// messages otherwise turn into a 200-term OR that matches the whole corpus
/// and ranks by nothing in particular.
pub const MAX_QUERY_TERMS: usize = 12;

/// BM25 search restricted to one `companion_node.kind`, newest-relevance
/// first. Returns node ids in rank order.
///
/// Rows with `importance <= 0` are excluded: that is how `semantic` marks a
/// superseded fact and how `consolidation::prune_low_value_facts` demotes a
/// low-value one. Honoring it here is what makes forgetting bind on the
/// keyword lane and not just on the `list_*` reads.
pub fn search_kind(
    pool: &UserDbPool,
    query: &str,
    kind: &str,
    limit: usize,
) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    Ok(search_conn(&conn, query, kind, None, limit)?)
}

/// One episode hit from the keyword lane, carrying whether the row is a
/// machine correlator record.
///
/// Replaces the id-only `search_kind_in_session`, which this change left with
/// zero callers and therefore deleted: both of its call sites were the episode
/// lane, and both now need to know which hits are correlator records. A
/// session-scoped search for some *other* kind has never existed -- episodes
/// are the only tier that carries a `session_id` at all.
///
/// The flag rides along from SQL rather than being recomputed in Rust because
/// the lane returns ids only — resolving 6 ids back to 6 bodies just to answer
/// "is this a fleet event" would be an N+1 on the recall hot path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpisodeHit {
    pub id: String,
    pub machine: bool,
}

/// BM25 episode search for one conversation, with a **cap on how many machine
/// correlator records may take a slot**.
///
/// The design intent is unchanged — a correlator row may still be the best
/// answer to "what happened with fleet session abc", so it still competes on
/// relevance. What is new is a bound: on a corpus where machine records are
/// 92.7% of episodes, a terse fleet-vocabulary question could take all six
/// slots with load-test rows and leave no conversation in the window at all.
///
/// Implemented as two ranked reads rather than one over-fetch, because an
/// over-fetch cannot be *exact* on a corpus of this shape: it would need to
/// scan the whole machine majority to guarantee it found `limit` conversation
/// rows. The conversation read takes the top `limit`, the machine read the top
/// `machine_cap`, and the merge is by BM25 score, so the surviving order is
/// the order a single unrestricted query would have produced.
pub fn search_episodes_in_session(
    pool: &UserDbPool,
    query: &str,
    session_id: &str,
    limit: usize,
    machine_cap: usize,
) -> Result<Vec<EpisodeHit>, AppError> {
    let conn = pool.get()?;
    Ok(search_episodes_conn(
        &conn,
        query,
        session_id,
        limit,
        machine_cap,
    )?)
}

/// Connection-level worker behind [`search_episodes_in_session`].
fn search_episodes_conn(
    conn: &Connection,
    query: &str,
    session_id: &str,
    limit: usize,
    machine_cap: usize,
) -> rusqlite::Result<Vec<EpisodeHit>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let match_expr = build_fts5_match_query(query, MAX_QUERY_TERMS);
    if match_expr.is_empty() {
        return Ok(Vec::new());
    }
    let machine_sql = crate::companion::brain::episodic::machine_marker_match_sql();

    let mut scored: Vec<(f64, EpisodeHit)> = Vec::new();
    // (predicate over the machine expression, how many rows that side may take)
    let lanes: [(String, usize, bool); 2] = [
        (format!("NOT {machine_sql}"), limit, false),
        (machine_sql.clone(), machine_cap, true),
    ];
    for (predicate, lane_limit, machine) in lanes {
        if lane_limit == 0 {
            continue;
        }
        let sql = format!(
            "SELECT companion_fts.node_id, bm25(companion_fts)
               FROM companion_fts
               JOIN companion_node ON companion_node.id = companion_fts.node_id
              WHERE companion_fts MATCH ?1
                AND companion_node.kind = 'episode'
                AND companion_node.importance > 0
                AND companion_node.session_id = ?2
                AND companion_node.body_excerpt IS NOT NULL
                AND {predicate}
              ORDER BY bm25(companion_fts) ASC
              LIMIT ?3"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![match_expr, session_id, lane_limit as i64], |r| {
                Ok((r.get::<_, f64>(1)?, r.get::<_, String>(0)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (score, id) in rows {
            scored.push((score, EpisodeHit { id, machine }));
        }
    }

    // FTS5's bm25 is negated, so ascending is best-first — the same order both
    // reads used. `total_cmp` keeps this a total order without an unwrap.
    scored.sort_by(|a, b| a.0.total_cmp(&b.0));
    scored.truncate(limit);
    Ok(scored.into_iter().map(|(_, hit)| hit).collect())
}

/// Connection-level worker — takes a `Connection` rather than a pool so it is
/// unit-testable against an in-memory database (same shape as
/// `episodic::query_recent_rows`).
fn search_conn(
    conn: &Connection,
    query: &str,
    kind: &str,
    session_id: Option<&str>,
    limit: usize,
) -> rusqlite::Result<Vec<String>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let match_expr = build_fts5_match_query(query, MAX_QUERY_TERMS);
    if match_expr.is_empty() {
        // No usable terms. An empty MATCH is an FTS5 syntax error, and
        // "match everything" would reintroduce exactly the constant-recall
        // behavior this lane exists to kill.
        return Ok(Vec::new());
    }
    let limit = limit as i64;

    let base = "SELECT companion_fts.node_id
                FROM companion_fts
                JOIN companion_node ON companion_node.id = companion_fts.node_id
                WHERE companion_fts MATCH ?1
                  AND companion_node.kind = ?2
                  AND companion_node.importance > 0";
    let tail = " ORDER BY bm25(companion_fts) ASC LIMIT ?3";

    match session_id {
        Some(sid) => {
            let sql = format!("{base} AND companion_node.session_id = ?4{tail}");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params![match_expr, kind, limit, sid], |r| {
                    r.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>();
            rows
        }
        None => {
            let sql = format!("{base}{tail}");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params![match_expr, kind, limit], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>();
            rows
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal shape of the two tables the lane touches. `companion_fts` is
    /// declared exactly as the real schema declares it
    /// (`db/src/lib.rs`: `fts5(node_id UNINDEXED, body, tags)`).
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE companion_node (
                 id           TEXT PRIMARY KEY,
                 kind         TEXT NOT NULL,
                 session_id   TEXT,
                 file_path    TEXT,
                 importance   INTEGER NOT NULL DEFAULT 3,
                 body_excerpt TEXT,
                 created_at   TEXT NOT NULL
             );
             CREATE VIRTUAL TABLE companion_fts USING fts5(node_id UNINDEXED, body, tags);",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, id: &str, kind: &str, session: &str, body: &str, importance: i32) {
        conn.execute(
            "INSERT INTO companion_node (id, kind, session_id, file_path, importance, body_excerpt, created_at)
             VALUES (?1, ?2, ?3, 'x.md', ?4, ?5, '2026-08-01T00:00:00Z')",
            params![id, kind, session, importance, body],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
            params![id, body, format!("kind:{kind}")],
        )
        .unwrap();
    }

    /// The corpus Athena actually has: doctrine chunks on distinct topics,
    /// which the non-ml build had never once retrieved.
    fn seed_doctrine(conn: &Connection) {
        insert(
            conn,
            "doc_memory",
            "doctrine",
            "",
            "Memory decay and forgetting. Facts that are not recalled lose importance \
             over time; consolidation distills episodes into semantic facts.",
            3,
        );
        insert(
            conn,
            "doc_connectors",
            "doctrine",
            "",
            "Connector credentials are encrypted at rest with AES-256-GCM and never \
             leave the local machine. OAuth tokens refresh through the vault.",
            3,
        );
        insert(
            conn,
            "doc_scheduling",
            "doctrine",
            "",
            "Triggers fire on a cron schedule. The scheduler debounces overlapping \
             runs and records every firing in the execution log.",
            3,
        );
    }

    // ── Direction 1 acceptance: doctrine reaches recall ──────────────────

    #[test]
    fn a_doctrine_question_retrieves_doctrine() {
        let conn = test_conn();
        seed_doctrine(&conn);

        let hits = search_conn(&conn, "how does memory decay work?", "doctrine", None, 8).unwrap();
        assert!(
            hits.contains(&"doc_memory".to_string()),
            "the memory-decay doctrine chunk must reach recall, got {hits:?}"
        );
    }

    /// The core defect: recall was a CONSTANT — the same rows every turn
    /// regardless of the question. Two different questions must now produce
    /// two different recall sets.
    #[test]
    fn recall_varies_with_the_query() {
        let conn = test_conn();
        seed_doctrine(&conn);

        let about_memory =
            search_conn(&conn, "memory decay and forgetting", "doctrine", None, 8).unwrap();
        let about_creds = search_conn(
            &conn,
            "where are credentials encrypted",
            "doctrine",
            None,
            8,
        )
        .unwrap();

        assert_ne!(
            about_memory, about_creds,
            "two different questions must not return the same recall set"
        );
        assert_eq!(about_memory.first().map(String::as_str), Some("doc_memory"));
        assert_eq!(
            about_creds.first().map(String::as_str),
            Some("doc_connectors")
        );
    }

    #[test]
    fn an_off_topic_question_returns_nothing_rather_than_filler() {
        let conn = test_conn();
        seed_doctrine(&conn);
        // No corpus term matches. The lane must return empty — padding an
        // off-topic turn with the least-irrelevant rows is the failure the
        // vector lane's distance floor exists to prevent, and the keyword
        // lane owes the same guarantee.
        let hits = search_conn(&conn, "quokka photography", "doctrine", None, 8).unwrap();
        assert!(hits.is_empty(), "expected no filler, got {hits:?}");
    }

    #[test]
    fn a_pure_stopword_question_returns_nothing() {
        let conn = test_conn();
        seed_doctrine(&conn);
        let hits = search_conn(&conn, "what is it? and so?", "doctrine", None, 8).unwrap();
        assert!(hits.is_empty(), "expected no filler, got {hits:?}");
    }

    // ── lane hygiene ────────────────────────────────────────────────────

    #[test]
    fn the_lane_is_scoped_to_one_kind() {
        let conn = test_conn();
        seed_doctrine(&conn);
        insert(
            &conn,
            "ep_1",
            "episode",
            "default",
            "I was asking about memory decay yesterday.",
            3,
        );

        let doctrine = search_conn(&conn, "memory decay", "doctrine", None, 8).unwrap();
        assert!(!doctrine.contains(&"ep_1".to_string()));
        let episodes = search_conn(&conn, "memory decay", "episode", None, 8).unwrap();
        assert_eq!(episodes, vec!["ep_1".to_string()]);
    }

    // -- the machine-correlator lane cap (X1) ---------------------------

    /// A load-test corpus: one conversation turn against many machine
    /// correlator rows that all match the same terse fleet vocabulary. This is
    /// the live shape (92.7% machine) in miniature.
    fn seed_fleet_flood(conn: &Connection) {
        insert(
            conn,
            "ep_human",
            "episode",
            "default",
            "Why do we still have stale fleet sessions in the sidebar?",
            3,
        );
        for i in 0..12 {
            insert(
                conn,
                &format!("ep_m{i:02}"),
                "episode",
                "default",
                &format!("fleet-event session:loadgen-{i:04} cc:- state:stale project:loadgen/{i}"),
                1,
            );
        }
    }

    /// Fail-before: with no cap, this same corpus and query fills every slot
    /// with correlator rows. The cap is what leaves room for conversation.
    #[test]
    fn machine_records_cannot_take_more_than_the_cap() {
        let conn = test_conn();
        seed_fleet_flood(&conn);

        let uncapped = search_episodes_conn(&conn, "fleet session stale", "default", 6, 6).unwrap();
        assert_eq!(
            uncapped.iter().filter(|h| h.machine).count(),
            6,
            "fail-before: an uncapped lane is all correlator rows, got {uncapped:?}"
        );

        let capped = search_episodes_conn(&conn, "fleet session stale", "default", 6, 2).unwrap();
        assert_eq!(
            capped.iter().filter(|h| h.machine).count(),
            2,
            "at most the cap may be machine, got {capped:?}"
        );
        assert!(
            capped.iter().any(|h| h.id == "ep_human"),
            "the conversation turn must survive the flood, got {capped:?}"
        );
    }

    /// The design intent the cap must NOT break: a correlator record may still
    /// be the best answer to a question about one.
    #[test]
    fn machine_records_still_compete_on_relevance() {
        let conn = test_conn();
        seed_fleet_flood(&conn);

        let hits = search_episodes_conn(&conn, "loadgen 0003", "default", 6, 2).unwrap();
        assert!(
            hits.iter().any(|h| h.machine),
            "a fleet question must still reach a fleet record, got {hits:?}"
        );
    }

    /// A cap of zero excludes them entirely; the lane still answers with
    /// conversation rather than returning nothing.
    #[test]
    fn a_zero_cap_excludes_machine_records_without_emptying_the_lane() {
        let conn = test_conn();
        seed_fleet_flood(&conn);

        let hits = search_episodes_conn(&conn, "fleet session stale", "default", 6, 0).unwrap();
        assert!(hits.iter().all(|h| !h.machine), "got {hits:?}");
        assert_eq!(hits.len(), 1, "the one conversation turn, got {hits:?}");
    }

    /// The capped lane keeps every other guarantee `search_conn` gives:
    /// session isolation, the `importance > 0` gate, and no filler.
    #[test]
    fn the_capped_lane_keeps_session_isolation_and_the_importance_gate() {
        let conn = test_conn();
        insert(&conn, "ep_a", "episode", "default", "the kpi dashboard", 3);
        insert(&conn, "ep_b", "episode", "other", "the kpi dashboard", 3);
        insert(
            &conn,
            "ep_gone",
            "episode",
            "default",
            "the kpi dashboard",
            0,
        );

        let hits = search_episodes_conn(&conn, "kpi dashboard", "default", 8, 2).unwrap();
        assert_eq!(
            hits.iter().map(|h| h.id.as_str()).collect::<Vec<_>>(),
            vec!["ep_a"],
            "no cross-session bleed and no superseded rows"
        );

        let none = search_episodes_conn(&conn, "what is it? and so?", "default", 8, 2).unwrap();
        assert!(none.is_empty(), "a stopword query is still no filler");
    }

    #[test]
    fn episode_search_stays_inside_one_conversation() {
        let conn = test_conn();
        insert(&conn, "ep_a", "episode", "default", "the kpi dashboard", 3);
        insert(&conn, "ep_b", "episode", "other", "the kpi dashboard", 3);

        let hits = search_conn(&conn, "kpi dashboard", "episode", Some("default"), 8).unwrap();
        assert_eq!(hits, vec!["ep_a".to_string()], "no cross-session bleed");
    }

    /// Superseded facts (`importance = 0`) and facts demoted by
    /// `prune_low_value_facts` must not ride the keyword lane either.
    #[test]
    fn demoted_rows_are_excluded() {
        let conn = test_conn();
        insert(
            &conn,
            "fact_live",
            "fact",
            "",
            "operator prefers terse replies",
            4,
        );
        insert(
            &conn,
            "fact_dead",
            "fact",
            "",
            "operator prefers verbose replies",
            0,
        );

        let hits = search_conn(&conn, "operator prefers replies", "fact", None, 8).unwrap();
        assert_eq!(hits, vec!["fact_live".to_string()]);
    }

    #[test]
    fn free_text_with_fts5_operators_does_not_error() {
        let conn = test_conn();
        seed_doctrine(&conn);
        // Every one of these is FTS5 grammar in raw form; a naive MATCH
        // would return `Err` and the lane would silently go dark.
        for q in [
            "memory - decay",
            "\"unbalanced",
            "decay NEAR memory",
            "state:idle",
            "decay*",
            "memory AND OR NOT",
        ] {
            let r = search_conn(&conn, q, "doctrine", None, 8);
            assert!(r.is_ok(), "query {q:?} must not error: {r:?}");
        }
    }

    #[test]
    fn limit_is_respected() {
        let conn = test_conn();
        for i in 0..10 {
            insert(
                &conn,
                &format!("doc_{i}"),
                "doctrine",
                "",
                "retrieval retrieval retrieval",
                3,
            );
        }
        let hits = search_conn(&conn, "retrieval", "doctrine", None, 4).unwrap();
        assert_eq!(hits.len(), 4);
        assert!(search_conn(&conn, "retrieval", "doctrine", None, 0)
            .unwrap()
            .is_empty());
    }

    /// Every other test in this module builds its own `companion_fts`, so all
    /// nine would pass unchanged if the REAL schema stopped creating the table —
    /// the lane would go silently empty and the suite would stay green. That is
    /// not hypothetical: a sibling device dropped `companion_fts` on 2026-08-07
    /// (correctly, at the time — it then had no reader), and its tombstone
    /// invites the next person to do it again. This is the one test that runs
    /// against `init_test_user_db`'s real schema, so removing the table fails
    /// loudly here instead of quietly in production recall.
    #[test]
    fn the_real_schema_still_carries_the_index_this_lane_reads() {
        let pool = crate::db::init_test_user_db().unwrap();
        {
            let conn = pool.get().unwrap();
            // Same statement shape the writers use (episodic/doctrine/semantic/
            // procedural/goals all insert node + mirror).
            conn.execute(
                "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
                 VALUES ('doc_real', 'doctrine', NULL, 'p.md', 'h', 3, 'x', '2026-08-08', '2026-08-08')",
                [],
            )
            .expect("companion_node must exist in the real schema");
            conn.execute(
                "INSERT INTO companion_fts (node_id, body, tags) VALUES ('doc_real', 'worktree isolation doctrine', 'doctrine')",
                [],
            )
            .expect("companion_fts must exist in the real schema — the keyword lane reads it");
        }
        let hits = search_kind(&pool, "worktree isolation", "doctrine", 5).unwrap();
        assert_eq!(
            hits,
            vec!["doc_real".to_string()],
            "a row written through the real schema must be retrievable by the lane"
        );
    }
}
