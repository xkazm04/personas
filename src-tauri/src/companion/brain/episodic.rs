//! Episodic memory: append-only log of conversation turns and observed
//! agent events. Source of truth lives at
//! `~/.personas/companion-brain/episodes/<YYYY>/<MM>/<DD>/<id>.md`.
//!
//! Episodes are NEVER deleted. They are the no-data-loss guarantee — every
//! distilled semantic fact links back to source episode IDs, so any
//! consolidation can be rebuilt from the source log if it drifts.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use chrono::Utc;
use rusqlite::params;

#[cfg(feature = "ml")]
use crate::companion::brain::embeddings;
use crate::companion::brain::util;
use crate::companion::disk;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Body prefixes that mark an episode as a **machine correlator record**
/// rather than conversation.
///
/// Fleet writes one System episode per session state transition
/// (`brain/fleet.rs`, `commands/companion/fleet_bridge.rs`). The bodies open
/// with a structured marker line — `fleet-event session:… cc:… state:…` — that
/// exists precisely so machines can find and classify them; these constants
/// are the reader's half of that contract.
///
/// They are the majority of episodic memory (259 of 907 episodes on the live
/// brain, inside a 515-system-episode majority) and they were crowding the
/// conversation out of Athena's own recall window: the live 20-episode window
/// held **2 user messages**.
///
/// NOT included: `[Fleet] …` completion lines. Those are deliberately
/// chat-visible (`Bubble.tsx` renders them in the fleet voice) — a report to
/// the operator, not a correlator record.
///
/// Every marker must be free of `'` and `%` — they are interpolated into a
/// SQL `LIKE` pattern by [`machine_marker_exclusion_sql`]. Asserted in tests.
pub const MACHINE_EPISODE_MARKERS: &[&str] = &["fleet-event ", "fleet-orchestration "];

/// Is this episode body a machine correlator record rather than conversation?
///
/// Single source of truth for the classification: the chat transcript
/// (`companion_list_recent_messages`) and the recall window
/// ([`list_recent_conversation`]) both ask this question, and they must never
/// drift apart from each other or from the writer's marker format.
pub fn is_machine_episode(content: &str) -> bool {
    MACHINE_EPISODE_MARKERS
        .iter()
        .any(|marker| content.starts_with(marker))
}

/// SQL fragment excluding machine correlator rows, appended to a
/// `companion_node` WHERE clause. Filtering in SQL rather than in Rust is what
/// makes the window *fill up* with conversation — a post-filter would just
/// shrink a 20-row page to 8.
///
/// `body_excerpt` holds the raw body (the writer stores `excerpt_500(content)`,
/// not the frontmatter-wrapped file), so the marker is at offset 0. Rows with a
/// NULL excerpt are already excluded by the callers' `body_excerpt IS NOT NULL`.
fn machine_marker_exclusion_sql() -> String {
    MACHINE_EPISODE_MARKERS
        .iter()
        .map(|marker| format!(" AND body_excerpt NOT LIKE '{marker}%'"))
        .collect()
}

/// Roles used in conversation episodes. Observation episodes (agent events
/// auto-captured by the companion) use a separate kind handled later.
#[derive(Debug, Clone, Copy)]
pub enum EpisodeRole {
    User,
    Assistant,
    System,
}

impl EpisodeRole {
    fn as_str(self) -> &'static str {
        match self {
            EpisodeRole::User => "user",
            EpisodeRole::Assistant => "assistant",
            EpisodeRole::System => "system",
        }
    }
}

/// One persisted conversation turn.
#[derive(Debug, Clone)]
#[allow(dead_code)] // session_id and file_path populated for future filtering / vault paths
pub struct Episode {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub file_path: String,
    pub created_at: String,
}

/// Append a conversation turn. Writes the markdown file to disk first
/// (source of truth), then inserts the SQL index row. Returns the new
/// episode's id.
pub fn append_episode(
    pool: &UserDbPool,
    session_id: &str,
    role: EpisodeRole,
    content: &str,
) -> Result<String, AppError> {
    let id = format!("ep_{}", short_uuid());
    let now = Utc::now();
    let now_str = now.to_rfc3339();
    let role_str = role.as_str();

    let rel_path = format!(
        "episodes/{}/{}/{}/{}_{}.md",
        now.format("%Y"),
        now.format("%m"),
        now.format("%d"),
        id,
        role_str
    );
    let abs_path = disk::brain_root()?.join(&rel_path);

    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format_episode_markdown(&id, session_id, role_str, &now_str, content);
    fs::write(&abs_path, &body)?;

    let hash = sha256_hex(&body);
    let excerpt = excerpt_500(content);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'episode', ?6, ?2, ?3, 3, ?4, ?5, ?5)",
        params![id, rel_path, hash, excerpt, now_str, session_id],
    )?;

    // Mirror into FTS: `brain::keyword` reads this table with BM25, so the
    // mirror is the keyword lane's only source. (A sibling device deleted this
    // write on 2026-08-07 because the table then had no reader; the 2026-08-08
    // merge restored it, because now it does.)
    conn.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![id, content, format!("session:{session_id} role:{role_str}")],
    )?;

    Ok(id)
}

/// Same as `append_episode`, but also embeds the content into the
/// `companion_embedding` vec0 table. Embedding failure is logged but does
/// NOT fail the episode write — the episode is persisted to disk + SQL
/// index regardless. (We can always reindex later from disk.)
#[cfg(feature = "ml")]
pub async fn append_episode_and_embed(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    session_id: &str,
    role: EpisodeRole,
    content: &str,
) -> Result<String, AppError> {
    let id = append_episode(pool, session_id, role, content)?;
    if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, content).await {
        tracing::warn!(node_id = %id, error = %e, "companion embed_and_store failed (continuing)");
    }
    Ok(id)
}

/// Read the most recent episodes for a session, oldest-first (so they can
/// be appended in order to the working-context bundle).
pub fn list_recent(
    pool: &UserDbPool,
    session_id: &str,
    limit: u32,
) -> Result<Vec<Episode>, AppError> {
    let conn = pool.get()?;
    // Scoped to one conversation via the indexed session_id column (added in
    // the multi-conversation migration). Pre-multiconv episodes were backfilled
    // to session_id='default', so the migrated 'General' thread keeps its full
    // history. Replaces the old read-every-episode-then-match-frontmatter path.
    let rows = query_recent_rows(&conn, session_id, limit)?;
    hydrate_rows(session_id, rows)
}

/// Like [`list_recent`], but excluding machine correlator records
/// (see [`MACHINE_EPISODE_MARKERS`]). **This is the read the RECALL window
/// uses.**
///
/// Machine chatter was 57% of episodic memory and it was crowding the
/// conversation out of the window Athena reasons over: 12 of the live 20
/// recall slots were system rows, leaving 2 user messages. It still competes
/// on relevance — the keyword lane can and should surface a fleet event when
/// the question is about one — it just no longer competes on *recency*.
///
/// The full log stays queryable through [`list_recent`] / [`list_before`],
/// `companion_fts`, and the append-only markdown on disk. Nothing is deleted.
pub fn list_recent_conversation(
    pool: &UserDbPool,
    session_id: &str,
    limit: u32,
) -> Result<Vec<Episode>, AppError> {
    let conn = pool.get()?;
    let rows = query_recent_conversation_rows(&conn, session_id, limit)?;
    hydrate_rows(session_id, rows)
}

/// Keyset page of episodes STRICTLY OLDER than the `(created_at, id)`
/// cursor, oldest-first — the "load earlier messages" read behind the
/// transcript's scroll-to-top pagination.
///
/// Keyset rather than OFFSET because the transcript grows at the newest
/// end while the user pages backwards: an offset would shift under them
/// and duplicate or drop rows. The predicate mirrors `list_recent`'s
/// `(created_at DESC, id DESC)` total order exactly, which is what makes
/// consecutive pages provably gap-free and duplicate-free.
pub fn list_before(
    pool: &UserDbPool,
    session_id: &str,
    before_created_at: &str,
    before_id: &str,
    limit: u32,
) -> Result<Vec<Episode>, AppError> {
    let conn = pool.get()?;
    let rows = query_rows_before(&conn, session_id, before_created_at, before_id, limit)?;
    hydrate_rows(session_id, rows)
}

/// `(id, file_path, body_excerpt, created_at)` — one index row, newest-first.
type EpisodeRow = (String, String, String, String);

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EpisodeRow> {
    let id: String = row.get(0)?;
    let file_path: String = row.get(1)?;
    let excerpt: String = row.get(2)?;
    let created_at: String = row.get(3)?;
    Ok((id, file_path, excerpt, created_at))
}

/// The newest `limit` index rows for a session, newest-first.
///
/// Scoped to one conversation via the indexed session_id column (added in
/// the multi-conversation migration). Pre-multiconv episodes were backfilled
/// to session_id='default', so the migrated 'General' thread keeps its full
/// history.
///
/// Ordering carries an `id` tiebreak so the sort is a TOTAL order on
/// (created_at, id). Two episodes written in the same second used to be
/// orderable either way, which would let `list_before`'s keyset cursor both
/// skip and repeat rows at a page boundary.
fn query_recent_rows(
    conn: &rusqlite::Connection,
    session_id: &str,
    limit: u32,
) -> rusqlite::Result<Vec<EpisodeRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'episode'
           AND session_id = ?1
           AND body_excerpt IS NOT NULL
         ORDER BY created_at DESC, id DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![session_id, limit], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// The newest `limit` **conversation** index rows for a session, newest-first.
/// Same shape and ordering as [`query_recent_rows`] with the machine-correlator
/// exclusion applied in SQL, so the page fills with `limit` conversation turns
/// instead of shrinking to whatever survives a post-filter.
fn query_recent_conversation_rows(
    conn: &rusqlite::Connection,
    session_id: &str,
    limit: u32,
) -> rusqlite::Result<Vec<EpisodeRow>> {
    let sql = format!(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'episode'
           AND session_id = ?1
           AND body_excerpt IS NOT NULL{}
         ORDER BY created_at DESC, id DESC
         LIMIT ?2",
        machine_marker_exclusion_sql()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![session_id, limit], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// The newest `limit` index rows STRICTLY OLDER than the cursor,
/// newest-first. Predicate mirrors `query_recent_rows`'s total order.
fn query_rows_before(
    conn: &rusqlite::Connection,
    session_id: &str,
    before_created_at: &str,
    before_id: &str,
    limit: u32,
) -> rusqlite::Result<Vec<EpisodeRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, body_excerpt, created_at
         FROM companion_node
         WHERE kind = 'episode'
           AND session_id = ?1
           AND body_excerpt IS NOT NULL
           AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
         ORDER BY created_at DESC, id DESC
         LIMIT ?4",
    )?;
    let rows = stmt
        .query_map(
            params![session_id, before_created_at, before_id, limit],
            read_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Turn newest-first index rows into oldest-first `Episode`s.
///
/// Serves from the SQL `body_excerpt` whenever it provably holds the full
/// body (see `retrieval::excerpt_holds_full_body`) — most conversation
/// turns fit the excerpt cap, so this kills the per-row
/// `fs::read_to_string` N+1 on the recall hot path. Disk is read only for
/// genuinely long bodies (or rows whose path doesn't carry the role).
fn hydrate_rows(session_id: &str, rows: Vec<EpisodeRow>) -> Result<Vec<Episode>, AppError> {
    let root = disk::brain_root()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, excerpt, created_at) in rows {
        if crate::retrieval::excerpt_holds_full_body(
            &excerpt,
            crate::retrieval::EPISODE_EXCERPT_CAP,
        ) {
            if let Some(role) = crate::retrieval::role_from_episode_path(&rel_path) {
                out.push(Episode {
                    id,
                    session_id: session_id.to_string(),
                    role: role.to_string(),
                    content: crate::retrieval::episode_body_from_excerpt(&excerpt),
                    file_path: rel_path,
                    created_at,
                });
                continue;
            }
        }
        let full = match fs::read_to_string(root.join(&rel_path)) {
            Ok(s) => s,
            Err(_) => continue, // file missing on disk — skip, don't fail the whole list
        };
        let (role, content) = parse_episode_body(&full);
        out.push(Episode {
            id,
            session_id: session_id.to_string(),
            role,
            content,
            file_path: rel_path,
            created_at,
        });
    }

    // Reverse so callers get oldest-first.
    out.reverse();
    Ok(out)
}

// ── helpers ─────────────────────────────────────────────────────────────

fn format_episode_markdown(
    id: &str,
    session_id: &str,
    role: &str,
    created: &str,
    content: &str,
) -> String {
    format!(
        "---\nid: \"{id}\"\ntype: episode\nrole: {role}\nsession: \"{session_id}\"\ncreated: \"{created}\"\n---\n\n{content}\n"
    )
}

fn parse_episode_body(full: &str) -> (String, String) {
    // Extract role from frontmatter, body after second `---`.
    let mut role = "unknown".to_string();
    let mut body = full.to_string();
    if let Some(after) = full.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            let yaml = &after[..end];
            for line in yaml.lines() {
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

fn sha256_hex(s: &str) -> String {
    util::sha256_hex(s)
}

fn excerpt_500(content: &str) -> String {
    // Cap shared with the excerpt-vs-full-body decision
    // (`retrieval::excerpt_holds_full_body`) — the reader's completeness
    // guarantee depends on the writer's cap and boundary backoff staying
    // exactly this shape. `util::excerpt` uses the identical
    // backward-scan-to-boundary algorithm, so the invariant holds.
    const CAP: usize = crate::retrieval::EPISODE_EXCERPT_CAP;
    util::excerpt(content, CAP)
}

fn short_uuid() -> String {
    util::short_id(8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Minimal `companion_node` shape the two list queries touch.
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE companion_node (
                id           TEXT PRIMARY KEY,
                kind         TEXT NOT NULL,
                session_id   TEXT,
                file_path    TEXT,
                body_excerpt TEXT,
                created_at   TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, id: &str, session: &str, created_at: &str) {
        conn.execute(
            "INSERT INTO companion_node (id, kind, session_id, file_path, body_excerpt, created_at)
             VALUES (?1, 'episode', ?2, 'episodes/x.md', 'body', ?3)",
            params![id, session, created_at],
        )
        .unwrap();
    }

    /// Insert with an explicit body so the machine-correlator filter can be
    /// exercised. `role` only lands in the file path (the schema has no role
    /// column — role is derived from the path).
    fn insert_body(
        conn: &Connection,
        id: &str,
        session: &str,
        created_at: &str,
        role: &str,
        body: &str,
    ) {
        conn.execute(
            "INSERT INTO companion_node (id, kind, session_id, file_path, body_excerpt, created_at)
             VALUES (?1, 'episode', ?2, ?3, ?4, ?5)",
            params![
                id,
                session,
                format!("episodes/2026/08/01/{id}_{role}.md"),
                body,
                created_at
            ],
        )
        .unwrap();
    }

    fn ids(rows: &[EpisodeRow]) -> Vec<&str> {
        rows.iter().map(|r| r.0.as_str()).collect()
    }

    /// 6 episodes, three of them sharing one timestamp so the `id` tiebreak
    /// is exercised. Two pages of 3 must partition the set exactly.
    #[test]
    fn keyset_pages_are_gap_free_and_duplicate_free() {
        let conn = test_conn();
        insert(&conn, "e6", "default", "2026-08-05T10:00:06Z");
        insert(&conn, "e5", "default", "2026-08-05T10:00:05Z");
        // Three rows in the same second — the tiebreak's whole reason to exist.
        insert(&conn, "e4", "default", "2026-08-05T10:00:04Z");
        insert(&conn, "e3", "default", "2026-08-05T10:00:04Z");
        insert(&conn, "e2", "default", "2026-08-05T10:00:04Z");
        insert(&conn, "e1", "default", "2026-08-05T10:00:01Z");

        let page1 = query_recent_rows(&conn, "default", 3).unwrap();
        assert_eq!(ids(&page1), vec!["e6", "e5", "e4"]);

        let cursor = page1.last().unwrap().clone();
        let page2 = query_rows_before(&conn, "default", &cursor.3, &cursor.0, 3).unwrap();
        assert_eq!(ids(&page2), vec!["e3", "e2", "e1"], "no gap, no duplicate");

        let cursor2 = page2.last().unwrap().clone();
        let page3 = query_rows_before(&conn, "default", &cursor2.3, &cursor2.0, 3).unwrap();
        assert!(page3.is_empty(), "exhausted");
    }

    #[test]
    fn cursor_is_strict_so_the_cursor_row_never_repeats() {
        let conn = test_conn();
        insert(&conn, "e2", "default", "2026-08-05T10:00:00Z");
        insert(&conn, "e1", "default", "2026-08-05T10:00:00Z");

        // Cursor = the newest row; only the older same-timestamp row follows.
        let page = query_rows_before(&conn, "default", "2026-08-05T10:00:00Z", "e2", 10).unwrap();
        assert_eq!(ids(&page), vec!["e1"]);

        // Cursor = the oldest row; nothing is older.
        let page = query_rows_before(&conn, "default", "2026-08-05T10:00:00Z", "e1", 10).unwrap();
        assert!(page.is_empty());
    }

    #[test]
    fn paging_stays_scoped_to_one_conversation() {
        let conn = test_conn();
        insert(&conn, "a2", "default", "2026-08-05T10:00:02Z");
        insert(&conn, "b2", "other", "2026-08-05T10:00:02Z");
        insert(&conn, "a1", "default", "2026-08-05T10:00:01Z");
        insert(&conn, "b1", "other", "2026-08-05T10:00:01Z");

        let page = query_rows_before(&conn, "default", "2026-08-05T10:00:02Z", "a2", 10).unwrap();
        assert_eq!(ids(&page), vec!["a1"]);
    }

    /// Walking the whole log page-by-page must reproduce the full set once.
    #[test]
    fn full_walk_covers_every_row_exactly_once() {
        let conn = test_conn();
        for i in 0..17 {
            // Deliberately coarse timestamps: 17 rows across 4 seconds.
            insert(
                &conn,
                &format!("e{i:02}"),
                "default",
                &format!("2026-08-05T10:00:0{}Z", i % 4),
            );
        }

        let mut seen: Vec<String> = Vec::new();
        let mut page = query_recent_rows(&conn, "default", 5).unwrap();
        while !page.is_empty() {
            for r in &page {
                seen.push(r.0.clone());
            }
            let c = page.last().unwrap().clone();
            page = query_rows_before(&conn, "default", &c.3, &c.0, 5).unwrap();
        }

        assert_eq!(seen.len(), 17, "every row visited");
        let mut sorted = seen.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 17, "no duplicates across pages");
    }

    // ── machine correlator records vs conversation ──────────────────────

    /// The markers are interpolated into a SQL `LIKE` pattern, so they must
    /// carry no quote or wildcard. Guards `machine_marker_exclusion_sql`.
    #[test]
    fn markers_are_safe_to_interpolate_into_like() {
        for m in MACHINE_EPISODE_MARKERS {
            assert!(!m.contains('\''), "marker {m:?} would break the SQL literal");
            assert!(!m.contains('%'), "marker {m:?} would act as a LIKE wildcard");
            assert!(!m.contains('_'), "marker {m:?} would act as a LIKE wildcard");
            assert!(!m.is_empty());
        }
    }

    #[test]
    fn classifier_matches_the_writers_marker_format() {
        // Exactly what `brain/fleet.rs::format_episode_body` emits.
        assert!(is_machine_episode(
            "fleet-event session:abc123 cc:- state:running project:personas\n\nFleet session **abc123** …"
        ));
        // `fleet_bridge.rs` operation wrap-up.
        assert!(is_machine_episode(
            "fleet-orchestration op:op_1 state:op_completed intent:ship it\n\n…"
        ));
        // Deliberately NOT machine chatter — a report to the operator that
        // `Bubble.tsx` renders in the chat.
        assert!(!is_machine_episode("[Fleet] builder finished — 3 commits"));
        assert!(!is_machine_episode(
            "Can you check what the fleet-event pipeline is doing?"
        ));
        assert!(!is_machine_episode(""));
    }

    /// The measured live shape: a 20-slot recall window that held **2 user
    /// messages** because fleet correlator rows had taken 12 of the slots.
    ///
    /// Fixture reproduces that ratio — every block of 10 consecutive episodes
    /// is 1 user + 1 assistant + 8 fleet-event rows — so the unfiltered top-20
    /// yields exactly the 2 user messages that were observed.
    #[test]
    fn conversation_window_stops_losing_the_user_to_machine_chatter() {
        let conn = test_conn();
        // 200 episodes, oldest first, so ids sort with time. Enough blocks
        // that 20 conversation turns exist to fill the filtered window.
        for i in 0..200 {
            let ts = format!("2026-08-01T{:02}:{:02}:00Z", i / 60, i % 60);
            let id = format!("e{i:03}");
            match i % 10 {
                0 => insert_body(&conn, &id, "default", &ts, "user", "What should I ship next?"),
                1 => insert_body(&conn, &id, "default", &ts, "assistant", "Here is what I'd pick."),
                _ => insert_body(
                    &conn,
                    &id,
                    "default",
                    &ts,
                    "system",
                    "fleet-event session:s1 cc:- state:running project:personas\n\ndetail",
                ),
            }
        }

        let unfiltered = query_recent_rows(&conn, "default", 20).unwrap();
        let filtered = query_recent_conversation_rows(&conn, "default", 20).unwrap();

        let user_count = |rows: &[EpisodeRow]| {
            rows.iter()
                .filter(|r| r.1.ends_with("_user.md"))
                .count()
        };
        let machine_count = |rows: &[EpisodeRow]| {
            rows.iter().filter(|r| is_machine_episode(&r.2)).count()
        };

        // Baseline: the defect, reproduced.
        assert_eq!(unfiltered.len(), 20);
        assert_eq!(user_count(&unfiltered), 2, "the measured live shape: 2/20");
        assert_eq!(machine_count(&unfiltered), 16);

        // Fixed: the window still holds 20 rows — it FILLS with conversation
        // rather than shrinking — and the user share rises 2 → 10.
        assert_eq!(filtered.len(), 20, "window fills, it does not shrink");
        assert_eq!(machine_count(&filtered), 0, "no correlator rows in recall");
        assert_eq!(user_count(&filtered), 10, "user share 2/20 -> 10/20");
        assert!(
            user_count(&filtered) >= 5 * user_count(&unfiltered),
            "material rise, not a rounding difference"
        );
    }

    /// Removing correlator rows from RECALL must not remove them from the
    /// record. `list_recent` (the transcript/audit read) still returns them.
    #[test]
    fn fleet_history_stays_queryable_after_it_leaves_the_recall_window() {
        let conn = test_conn();
        insert_body(&conn, "e1", "default", "2026-08-01T00:00:01Z", "user", "hi");
        insert_body(
            &conn,
            "e2",
            "default",
            "2026-08-01T00:00:02Z",
            "system",
            "fleet-event session:s9 cc:- state:exited project:personas\n\nexited cleanly",
        );

        let recall = query_recent_conversation_rows(&conn, "default", 20).unwrap();
        assert_eq!(ids(&recall), vec!["e1"], "not in the recall window");

        let audit = query_recent_rows(&conn, "default", 20).unwrap();
        assert_eq!(ids(&audit), vec!["e2", "e1"], "still in the record");
    }

    #[test]
    fn conversation_window_keeps_session_scoping() {
        let conn = test_conn();
        insert_body(&conn, "a1", "default", "2026-08-01T00:00:01Z", "user", "mine");
        insert_body(&conn, "b1", "other", "2026-08-01T00:00:02Z", "user", "theirs");

        let rows = query_recent_conversation_rows(&conn, "default", 20).unwrap();
        assert_eq!(ids(&rows), vec!["a1"]);
    }
}
