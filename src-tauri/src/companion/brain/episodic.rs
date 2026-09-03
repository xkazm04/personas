//! Episodic memory: append-only log of conversation turns and observed
//! agent events. Source of truth lives at
//! `~/.personas/companion-brain/episodes/<YYYY>/<MM>/<DD>/<id>.md`.
//!
//! Episodes are NEVER deleted. They are the no-data-loss guarantee — every
//! distilled semantic fact links back to source episode IDs, so any
//! consolidation can be rebuilt from the source log if it drifts.

use std::fs;
use std::path::MAIN_SEPARATOR;
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

/// SQL boolean that is TRUE for a machine correlator row, built from the same
/// [`MACHINE_EPISODE_MARKERS`] the Rust classifier uses.
///
/// The *positive* half of the pair. [`machine_marker_exclusion_sql`] is its
/// negation, so the two can never disagree about what a machine record is —
/// which they could when each spelled the LIKE list out separately.
///
/// `body_excerpt` holds the raw body (the writer stores `excerpt_500(content)`,
/// not the frontmatter-wrapped file), so the marker is at offset 0. A NULL
/// excerpt yields NULL here, i.e. neither machine nor conversation; every
/// caller pairs this with `body_excerpt IS NOT NULL`.
pub fn machine_marker_match_sql() -> String {
    let clauses: Vec<String> = MACHINE_EPISODE_MARKERS
        .iter()
        .map(|marker| format!("body_excerpt LIKE '{marker}%'"))
        .collect();
    format!("({})", clauses.join(" OR "))
}

/// SQL fragment excluding machine correlator rows, appended to a
/// `companion_node` WHERE clause. Filtering in SQL rather than in Rust is what
/// makes the window *fill up* with conversation — a post-filter would just
/// shrink a 20-row page to 8.
///
/// Expressed as the negation of [`machine_marker_match_sql`]. `NOT (a OR b)`
/// and `NOT a AND NOT b` are the same three-valued expression, including the
/// NULL case, so this is the identical predicate the exclusion always had.
fn machine_marker_exclusion_sql() -> String {
    format!(" AND NOT {}", machine_marker_match_sql())
}

/// Importance a **conversation** turn is written at. Unchanged from the value
/// `append_episode` hard-coded before the machine tier existed.
pub const HUMAN_EPISODE_IMPORTANCE: i64 = 3;

/// Importance a **machine correlator record** is written at.
///
/// One, not zero, and the distinction is the whole design: `importance > 0` is
/// this brain's "still retrievable" gate (`keyword::search_conn`, and how
/// `semantic` marks a superseded fact), so zero would delete a correlator row
/// from the keyword lane outright. The stated intent is that these records
/// still *compete on relevance* — they just must not outrank conversation.
/// `1` is the lowest value that keeps both properties.
///
/// **What this does NOT yet do, stated rather than implied.** The lifecycle
/// sweep's decay and age-out (`consolidation::decay_unused_facts`,
/// `age_out_dormant_facts`) are scoped to `kind = 'fact'` and join
/// `companion_fact`; nothing in this tree decays an EPISODE today. So this
/// tier is ordering information for retrieval, and a ready-made handle for an
/// episode decay pass that does not exist yet — it is not a forgetting
/// mechanism on its own, and reading it as one would be the same fiction the
/// fact lane carried for 77 days.
pub const MACHINE_EPISODE_IMPORTANCE: i64 = 1;

/// Upper bound on rows one [`retier_machine_episodes`] pass rewrites.
///
/// The re-tier is a one-shot backfill over rows written before the tier
/// existed (10,687 on the machine this was measured on, from a two-day Fleet
/// load test). Bounded so a pathological corpus cannot turn a recall turn into
/// a multi-second write; idempotent, so a corpus larger than the bound simply
/// converges over successive process starts.
const MACHINE_RETIER_MAX_ROWS: usize = 25_000;

/// Latch so the backfill is attempted at most once per process **after it
/// succeeds**. A failure deliberately does not latch: freezing the first
/// attempt's error for the life of the process is how a transient DB lock
/// becomes a permanent one.
static MACHINE_RETIER_DONE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Demote already-written machine correlator rows to
/// [`MACHINE_EPISODE_IMPORTANCE`]. Returns how many rows changed.
///
/// Idempotent by construction: the predicate selects only rows that are BOTH
/// machine-marked AND still above the machine tier, so a second call over the
/// same corpus matches nothing and returns 0.
///
/// Not restricted to one session. The write path applies the tier by body
/// marker alone, and a backfill that used a different rule than the writer
/// would leave the corpus in two states that nothing could later tell apart.
/// The two writes that put an episode into the index: its `companion_node`
/// row and its `companion_fts` mirror.
///
/// Both doors go through here — the live writer ([`append_episode`]) and the
/// reconciler ([`reconcile_orphaned_episodes`]) — so the mirror cannot be
/// remembered by one and forgotten by the other. That is not a hypothetical
/// tidiness argument: `companion_fts` is hand-maintained across eleven
/// `companion_node` producers, five of them already forget it, and
/// `keyword.rs` is Athena's only keyword lane, so an unmirrored node is
/// unreachable rather than merely unranked. A second copy of these two
/// statements is a sixth producer waiting to drift.
///
/// `ignore_existing` is the reconciler's door only. `ON CONFLICT(id) DO
/// NOTHING` — and not a statement-wide `OR IGNORE` — because the one
/// conflict that write may swallow is a row that already exists (a racing
/// writer between the `exists` probe and here); `OR IGNORE` would also
/// swallow a NOT NULL or CHECK violation and report the same silent zero.
#[allow(clippy::too_many_arguments)]
fn index_episode(
    conn: &rusqlite::Connection,
    id: &str,
    session_id: &str,
    role: &str,
    created_at: &str,
    rel_path: &str,
    content_hash: &str,
    content: &str,
    excerpt: &str,
    importance: i64,
    ignore_existing: bool,
) -> Result<(), AppError> {
    const NODE_INSERT: &str = "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'episode', ?6, ?2, ?3, ?7, ?4, ?5, ?5)";
    let node_sql = if ignore_existing {
        format!(
            "{NODE_INSERT}
         ON CONFLICT(id) DO NOTHING"
        )
    } else {
        NODE_INSERT.to_string()
    };
    conn.execute(
        &node_sql,
        params![
            id,
            rel_path,
            content_hash,
            excerpt,
            created_at,
            session_id,
            importance
        ],
    )?;
    conn.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![id, content, format!("session:{session_id} role:{role}")],
    )?;
    Ok(())
}

pub fn retier_machine_episodes(pool: &UserDbPool) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let sql = format!(
        "UPDATE companion_node
            SET importance = ?1
          WHERE id IN (
              SELECT id FROM companion_node
               WHERE kind = 'episode'
                 AND body_excerpt IS NOT NULL
                 AND importance > ?1
                 AND {}
               LIMIT ?2
          )",
        machine_marker_match_sql()
    );
    let n = conn.execute(
        &sql,
        params![MACHINE_EPISODE_IMPORTANCE, MACHINE_RETIER_MAX_ROWS as i64],
    )?;
    Ok(n)
}

/// Run [`retier_machine_episodes`] at most once per process, on the path that
/// actually runs (recall), and never fail a turn because of it.
///
/// Same shape and the same reasoning as
/// `consolidation::maybe_run_lifecycle_sweep`: a maintenance write nobody
/// schedules is a maintenance write that never happens.
pub fn maybe_retier_machine_episodes(pool: &UserDbPool) {
    use std::sync::atomic::Ordering;
    if MACHINE_RETIER_DONE.load(Ordering::Relaxed) {
        return;
    }
    match retier_machine_episodes(pool) {
        Ok(n) => {
            MACHINE_RETIER_DONE.store(true, Ordering::Relaxed);
            if n > 0 {
                tracing::info!(
                    rows = n,
                    importance = MACHINE_EPISODE_IMPORTANCE,
                    "companion: re-tiered machine correlator episodes"
                );
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "companion: machine-episode re-tier failed (will retry)");
        }
    }
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

    // The machine tier is applied HERE, from the body, so the writer and the
    // backfill (`retier_machine_episodes`) and the reader
    // (`is_machine_episode`) all classify off the same one marker list.
    let importance = if is_machine_episode(content) {
        MACHINE_EPISODE_IMPORTANCE
    } else {
        HUMAN_EPISODE_IMPORTANCE
    };

    let conn = pool.get()?;
    // The FTS mirror rides along inside `index_episode`: `brain::keyword`
    // reads that table with BM25 and it is the keyword lane's only source. (A
    // sibling device deleted this write on 2026-08-07 because the table then
    // had no reader; the 2026-08-08 merge restored it, because now it does.)
    index_episode(
        &conn, &id, session_id, role_str, &now_str, &rel_path, &hash, content, &excerpt,
        importance, false,
    )?;

    Ok(id)
}

/// Upper bound on episode files one [`reconcile_orphaned_episodes`] pass
/// indexes.
///
/// The pass walks the whole episode tree (14,816 files on the machine this was
/// measured on) but only WRITES for the ones with no index row (3,294 of them,
/// 2,615 of which were user turns). Bounding the writes keeps one pass short on
/// a badly-drifted brain; the walk is idempotent, so what a bounded pass leaves
/// behind the next one picks up.
const RECONCILE_MAX_PER_RUN: u32 = 2_000;

/// What one reconcile pass did. Every number is reported, including zeros --
/// "it ran and found nothing" and "it never ran" are different facts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileReport {
    /// Episode markdown files visited.
    #[ts(type = "number")]
    pub scanned: u32,
    /// Files that had no `companion_node` row and now have one.
    #[ts(type = "number")]
    pub indexed: u32,
    /// Of [`Self::indexed`], how many were machine correlator records.
    #[ts(type = "number")]
    pub indexed_machine: u32,
    /// Files skipped because their frontmatter could not be read (no `id`, no
    /// `created`, or no frontmatter block at all). Counted, never swallowed.
    #[ts(type = "number")]
    pub malformed: u32,
    /// True when [`RECONCILE_MAX_PER_RUN`] stopped the pass with work left.
    pub truncated: bool,
}

/// Index episode markdown files that have no `companion_node` row.
///
/// [`append_episode`] writes the markdown to disk BEFORE the SQL row, by
/// design -- the file is the source of truth and the row is an index over it.
/// The cost of that ordering is that a crash, a failed write, or a process
/// killed between the two leaves a file with no index row, and until this
/// function there was no reconciler and no rebuild-from-disk, so the episode
/// was orphaned forever: invisible to recall, to the transcript, to the sleep
/// cycle and to every count in the health report. Measured on the live brain:
/// 14,816 files against 11,522 rows.
///
/// **It shares the writer's rules rather than restating them.** Timestamp,
/// session and role come from the file's own frontmatter (what
/// [`format_episode_markdown`] wrote), the body goes through the same
/// [`excerpt_500`], the machine classification is [`is_machine_episode`] and
/// the importance is the same [`MACHINE_EPISODE_IMPORTANCE`] /
/// [`HUMAN_EPISODE_IMPORTANCE`] pair `append_episode` applies, and the
/// `companion_fts` mirror is written too -- an indexed episode that skipped the
/// mirror would be stored and unfindable, which is a different orphan.
///
/// Idempotent: a file whose id is already a `companion_node` row is skipped
/// without a write, so a second pass over the same tree reports `indexed: 0`.
pub fn reconcile_orphaned_episodes(pool: &UserDbPool) -> Result<ReconcileReport, AppError> {
    let brain_root = disk::brain_root()?;
    let episodes_root = brain_root.join("episodes");
    let mut report = ReconcileReport::default();
    if !episodes_root.is_dir() {
        return Ok(report);
    }

    let conn = pool.get()?;
    let mut exists = conn.prepare("SELECT 1 FROM companion_node WHERE id = ?1")?;

    let mut stack = vec![episodes_root];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(dir = %dir.display(), error = %e, "companion reconcile: unreadable directory");
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            report.scanned = report.scanned.saturating_add(1);

            if report.indexed >= RECONCILE_MAX_PER_RUN {
                report.truncated = true;
                continue;
            }

            let Ok(full) = fs::read_to_string(&path) else {
                report.malformed = report.malformed.saturating_add(1);
                continue;
            };
            let Some(meta) = parse_episode_frontmatter(&full) else {
                report.malformed = report.malformed.saturating_add(1);
                continue;
            };
            if exists.exists(params![meta.id])? {
                continue;
            }
            // `companion_node.file_path` is relative to the brain root, exactly
            // as `append_episode` writes it -- every reader (`hydrate_row`,
            // `get_episode`) joins it back onto that root.
            let Ok(rel) = path.strip_prefix(&brain_root) else {
                report.malformed = report.malformed.saturating_add(1);
                continue;
            };
            let rel_path = rel.to_string_lossy().replace(MAIN_SEPARATOR, "/");

            // `parse_episode_body` keeps the single trailing newline
            // `format_episode_markdown` appends after the content; the LIVE
            // writer stores `excerpt_500(content)` from the raw content, which
            // has none. Strip exactly that one newline so a recovered row's
            // `body_excerpt` is byte-identical to a natively written one.
            // Without this the read path -- which re-adds the trailing newline
            // by contract (`retrieval::episode_body_from_excerpt`) -- serves
            // every recovered episode with an extra blank line, and prompt
            // bytes for a recovered turn differ from a written one.
            let (_, content) = parse_episode_body(&full);
            let content = match content.strip_suffix('\n') {
                Some(trimmed) => trimmed.to_string(),
                None => content,
            };
            let machine = is_machine_episode(&content);
            let importance = if machine {
                MACHINE_EPISODE_IMPORTANCE
            } else {
                HUMAN_EPISODE_IMPORTANCE
            };

            index_episode(
                &conn,
                &meta.id,
                &meta.session,
                &meta.role,
                &meta.created,
                &rel_path,
                &sha256_hex(&full),
                &content,
                &excerpt_500(&content),
                importance,
                true,
            )?;

            report.indexed = report.indexed.saturating_add(1);
            if machine {
                report.indexed_machine = report.indexed_machine.saturating_add(1);
            }
        }
    }

    if report.indexed > 0 {
        tracing::info!(
            scanned = report.scanned,
            indexed = report.indexed,
            machine = report.indexed_machine,
            malformed = report.malformed,
            truncated = report.truncated,
            "companion: reconciled orphaned episode files into the index"
        );
    }
    Ok(report)
}

/// The frontmatter fields the reconciler needs to reconstruct an index row.
struct EpisodeFrontmatter {
    id: String,
    session: String,
    role: String,
    created: String,
}

/// Read `id` / `session` / `role` / `created` out of an episode file's
/// frontmatter, or `None` when `id` or `created` is missing.
///
/// Strict about those two and forgiving about the rest: they are the primary
/// key and the ordering key, and a guessed value for either would collide or
/// silently reorder the transcript. A missing session or role only degrades a
/// row.
fn parse_episode_frontmatter(full: &str) -> Option<EpisodeFrontmatter> {
    let after = full.strip_prefix("---\n")?;
    let end = after.find("\n---")?;
    let mut id = None;
    let mut session = None;
    let mut role = None;
    let mut created = None;
    for line in after[..end].lines() {
        // `split_once` and not `split`: `created` is an RFC3339 timestamp and
        // is full of colons, so only the FIRST one separates key from value.
        let Some((key, value)) = line.trim().split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        match key.trim() {
            "id" => id = Some(value),
            "session" => session = Some(value),
            "role" => role = Some(value),
            "created" => created = Some(value),
            _ => {}
        }
    }
    Some(EpisodeFrontmatter {
        id: id.filter(|v| !v.is_empty())?,
        created: created.filter(|v| !v.is_empty())?,
        session: session
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "default".to_string()),
        role: role
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "unknown".to_string()),
    })
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

/// How many conversation episodes exist STRICTLY AFTER `after`, across every
/// conversation. Same predicate as [`list_conversation_after`], no `LIMIT`.
///
/// The sleep cycle reports "read N of M episodes in the window", and M has to be
/// the TRUE count: taking it from the length of a capped fetch would make the
/// number shrink to the cap exactly when there was most to say about what went
/// unread, which is the one moment the figure matters.
///
/// **Exclusive**, like its sibling — see [`list_conversation_after`] for why the
/// boundary cannot be inclusive once cycles hand one to each other.
pub fn count_conversation_after(pool: &UserDbPool, after: &str) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let sql = format!(
        "SELECT COUNT(*) FROM companion_node
         WHERE kind = 'episode'
           AND created_at > ?1
           AND body_excerpt IS NOT NULL{}",
        machine_marker_exclusion_sql()
    );
    let n: i64 = conn.query_row(&sql, params![after], |r| r.get(0))?;
    Ok(n.max(0) as usize)
}

/// Conversation episodes created STRICTLY AFTER `after` (RFC3339), across
/// **every** conversation, oldest-first — the sleep cycle's compress input and
/// the corpus its sleep-pressure gauge measures.
///
/// Third member of the [`list_recent_conversation`] family and deliberately
/// built on the same two pieces: [`machine_marker_exclusion_sql`] (so a
/// correlator row can never reach the compress prompt) and the shared row
/// hydration (so an excerpt that provably holds the whole body is served from
/// SQL rather than from disk).
///
/// Cross-session on purpose, unlike its two siblings. Recall reasons inside one
/// thread — a turn from another conversation must not bleed in — but a sleep
/// cycle distils what Athena learned *as a whole*, and long-term memory is
/// global (only `kind='episode'` rows carry `session_id` at all). Each row
/// keeps its own `session_id`, so provenance still says which thread it came
/// from.
///
/// **The boundary is EXCLUSIVE, and `limit` takes the OLDEST rows.** Both
/// changed in L1c and both are load-bearing for the same property: a cycle
/// records the `created_at` of the newest episode it actually fed to compress
/// (`consumed_through`) and the next cycle starts there. Inclusive would
/// re-compress that episode on every cycle forever; newest-first would make an
/// over-long window read the newest N and *orphan* everything older, so a heavy
/// day that overflowed the caps could never be drained. Oldest-first plus an
/// exclusive hand-off means successive cycles walk the corpus forward with no
/// gap and no overlap.
pub fn list_conversation_after(
    pool: &UserDbPool,
    after: &str,
    limit: u32,
) -> Result<Vec<Episode>, AppError> {
    let conn = pool.get()?;
    let sql = format!(
        "SELECT id, file_path, body_excerpt, created_at, COALESCE(session_id, '')
         FROM companion_node
         WHERE kind = 'episode'
           AND created_at > ?1
           AND body_excerpt IS NOT NULL{}
         ORDER BY created_at ASC, id ASC
         LIMIT ?2",
        machine_marker_exclusion_sql()
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![after, limit], |row| {
            Ok((
                (
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ),
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let root = disk::brain_root()?;
    // Already oldest-first out of SQL — no reverse. The order a narrative reads
    // in, and the order a backlog must be drained in.
    Ok(rows
        .into_iter()
        .filter_map(|(row, session_id)| hydrate_row(&root, &session_id, row))
        .collect())
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
    let mut out: Vec<Episode> = rows
        .into_iter()
        .filter_map(|row| hydrate_row(&root, session_id, row))
        .collect();

    // Reverse so callers get oldest-first.
    out.reverse();
    Ok(out)
}

/// Turn one index row into an `Episode`, or `None` when its markdown has
/// vanished from disk (skip the row rather than failing the whole list).
///
/// Extracted from [`hydrate_rows`] so [`list_conversation_since`] — which
/// carries a per-row `session_id` instead of one for the whole page — shares
/// the excerpt-vs-disk decision instead of forking it.
fn hydrate_row(
    root: &std::path::Path,
    session_id: &str,
    (id, rel_path, excerpt, created_at): EpisodeRow,
) -> Option<Episode> {
    if crate::retrieval::excerpt_holds_full_body(&excerpt, crate::retrieval::EPISODE_EXCERPT_CAP) {
        if let Some(role) = crate::retrieval::role_from_episode_path(&rel_path) {
            return Some(Episode {
                id,
                session_id: session_id.to_string(),
                role: role.to_string(),
                content: crate::retrieval::episode_body_from_excerpt(&excerpt),
                file_path: rel_path,
                created_at,
            });
        }
    }
    let full = fs::read_to_string(root.join(&rel_path)).ok()?;
    let (role, content) = parse_episode_body(&full);
    Some(Episode {
        id,
        session_id: session_id.to_string(),
        role,
        content,
        file_path: rel_path,
        created_at,
    })
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
    use personas_db::PoolExt;
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
    // -- reconciling orphaned episode files (X2) --------------------------

    /// Write an episode file to disk with NO index row -- exactly what
    /// `append_episode` leaves behind when it dies between the two writes.
    fn orphan_file(id: &str, session: &str, role: &str, created: &str, body: &str) {
        let rel = format!("episodes/2026/08/01/{id}_{role}.md");
        let abs = disk::brain_root().unwrap().join(&rel);
        fs::create_dir_all(abs.parent().unwrap()).unwrap();
        fs::write(
            &abs,
            format_episode_markdown(id, session, role, created, body),
        )
        .unwrap();
    }

    fn node_count(pool: &crate::db::UserDbPool) -> i64 {
        pool.conn("episodic_test::node_count")
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM companion_node WHERE kind = 'episode'",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// Fail-before: nothing in the tree read episode markdown back into the
    /// index, so an orphaned file was invisible to recall, the transcript, the
    /// sleep cycle and every count -- forever.
    #[test]
    fn an_orphaned_file_is_indexed_once_and_only_once() {
        let _home = crate::companion::brain::test_home::TestHome::new("ep_reconcile");
        let pool = crate::db::init_test_user_db().unwrap();
        orphan_file(
            "ep_lost",
            "default",
            "user",
            "2026-08-01T10:00:00+00:00",
            "the question that was never indexed",
        );
        assert_eq!(node_count(&pool), 0, "fail-before: no index row exists");

        let first = reconcile_orphaned_episodes(&pool).unwrap();
        assert_eq!(first.indexed, 1);
        assert_eq!(first.malformed, 0);
        assert_eq!(node_count(&pool), 1);

        // The recovered row must be a REAL index row: right timestamp, right
        // session, right tier, and mirrored into FTS so it is findable.
        let (session, created, importance, path): (String, String, i64, String) = pool
            .conn("episodic_test::recovered_row")
            .unwrap()
            .query_row(
                "SELECT session_id, created_at, importance, file_path FROM companion_node WHERE id = 'ep_lost'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(session, "default");
        assert_eq!(
            created, "2026-08-01T10:00:00+00:00",
            "the ORIGINAL timestamp"
        );
        assert_eq!(importance, HUMAN_EPISODE_IMPORTANCE);
        assert_eq!(path, "episodes/2026/08/01/ep_lost_user.md");
        let fts: i64 = pool
            .conn("episodic_test::recovered_fts")
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM companion_fts WHERE node_id = 'ep_lost'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            fts, 1,
            "an indexed episode that skips the mirror is unfindable"
        );

        let second = reconcile_orphaned_episodes(&pool).unwrap();
        assert_eq!(second.indexed, 0, "idempotent: nothing left to do");
        assert_eq!(
            second.scanned, 1,
            "but it still LOOKED -- that is not nothing"
        );
        assert_eq!(node_count(&pool), 1);
    }

    /// A file the live writer already indexed must be skipped without a write.
    #[test]
    fn an_already_indexed_file_is_skipped() {
        let _home = crate::companion::brain::test_home::TestHome::new("ep_rec_skip");
        let pool = crate::db::init_test_user_db().unwrap();
        append_episode(&pool, "default", EpisodeRole::User, "already indexed").unwrap();

        let report = reconcile_orphaned_episodes(&pool).unwrap();
        assert_eq!(report.scanned, 1);
        assert_eq!(report.indexed, 0);
        assert_eq!(node_count(&pool), 1);
    }

    /// A malformed file is skipped AND counted. Swallowing it would make a
    /// corrupt brain look like a clean one.
    #[test]
    fn a_malformed_file_is_skipped_and_counted() {
        let _home = crate::companion::brain::test_home::TestHome::new("ep_rec_bad");
        let pool = crate::db::init_test_user_db().unwrap();
        let dir = disk::brain_root().unwrap().join("episodes/2026/08/01");
        fs::create_dir_all(&dir).unwrap();
        // No frontmatter at all.
        fs::write(dir.join("ep_nofm_user.md"), "just a body").unwrap();
        // Frontmatter with no `id`.
        fs::write(
            dir.join("ep_noid_user.md"),
            "---\ntype: episode\nrole: user\ncreated: \"2026-08-01T10:00:00+00:00\"\n---\n\nbody\n",
        )
        .unwrap();
        // Frontmatter with an id but no `created` -- the ordering key.
        fs::write(
            dir.join("ep_nots_user.md"),
            "---\nid: \"ep_nots\"\ntype: episode\nrole: user\n---\n\nbody\n",
        )
        .unwrap();

        let report = reconcile_orphaned_episodes(&pool).unwrap();
        assert_eq!(report.scanned, 3);
        assert_eq!(report.indexed, 0);
        assert_eq!(report.malformed, 3);
        assert_eq!(node_count(&pool), 0);
    }

    /// The reconciler applies the SAME machine tier as the writer -- it does
    /// not re-admit correlator rows at conversation importance.
    #[test]
    fn a_recovered_machine_record_lands_at_the_machine_tier() {
        let _home = crate::companion::brain::test_home::TestHome::new("ep_rec_mach");
        let pool = crate::db::init_test_user_db().unwrap();
        orphan_file(
            "ep_m",
            "default",
            "system",
            "2026-08-01T10:00:00+00:00",
            "fleet-event session:loadgen-1 cc:- state:idle project:loadgen/1",
        );
        orphan_file(
            "ep_h",
            "default",
            "user",
            "2026-08-01T10:00:01+00:00",
            "a real question",
        );

        let report = reconcile_orphaned_episodes(&pool).unwrap();
        assert_eq!((report.indexed, report.indexed_machine), (2, 1));
        assert_eq!(importance_of(&pool, "ep_m"), MACHINE_EPISODE_IMPORTANCE);
        assert_eq!(importance_of(&pool, "ep_h"), HUMAN_EPISODE_IMPORTANCE);
    }

    /// A recovered episode must be reachable by the reads that matter, not
    /// merely present as a row.
    #[test]
    fn a_recovered_episode_reaches_the_recency_window() {
        let _home = crate::companion::brain::test_home::TestHome::new("ep_rec_read");
        let pool = crate::db::init_test_user_db().unwrap();
        orphan_file(
            "ep_back",
            "default",
            "user",
            "2026-08-01T10:00:00+00:00",
            "the recovered turn",
        );
        assert!(list_recent_conversation(&pool, "default", 10)
            .unwrap()
            .is_empty());

        reconcile_orphaned_episodes(&pool).unwrap();

        let window = list_recent_conversation(&pool, "default", 10).unwrap();
        assert_eq!(window.len(), 1);
        assert_eq!(window[0].id, "ep_back");
        assert_eq!(window[0].role, "user");

        // Byte-identical to what the LIVE writer would have produced for the
        // same turn -- not merely "contains the text". A recovered row whose
        // excerpt carries one extra newline renders an extra blank line into
        // every prompt that recalls it, which is what this asserted away.
        let native =
            append_episode(&pool, "default", EpisodeRole::User, "the recovered turn").unwrap();
        let both = list_recent_conversation(&pool, "default", 10).unwrap();
        let recovered = both.iter().find(|e| e.id == "ep_back").unwrap();
        let written = both.iter().find(|e| e.id == native).unwrap();
        assert_eq!(
            recovered.content, written.content,
            "a recovered episode must render exactly like a written one"
        );
        assert_eq!(
            excerpt_of(&pool, "ep_back"),
            excerpt_of(&pool, &native),
            "and its stored excerpt must match byte for byte"
        );
    }

    fn excerpt_of(pool: &crate::db::UserDbPool, id: &str) -> String {
        pool.conn("episodic_test::excerpt_of")
            .unwrap()
            .query_row(
                "SELECT body_excerpt FROM companion_node WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
    }

    // -- the machine importance tier (X1) --------------------------------
    /// The write path applies the tier, so no future correlator row ever needs
    /// the backfill. Goes through `append_episode` (disk + SQL + FTS) rather
    /// than asserting on a constant, because the classification decision the
    /// test is about lives inside that function.
    #[test]
    fn the_write_path_tiers_machine_and_conversation_apart() {
        let _home = crate::companion::brain::test_home::TestHome::new("ep_tier");
        let pool = crate::db::init_test_user_db().unwrap();

        let machine = append_episode(
            &pool,
            "default",
            EpisodeRole::System,
            "fleet-event session:abc cc:- state:running project:personas",
        )
        .unwrap();
        let human = append_episode(
            &pool,
            "default",
            EpisodeRole::User,
            "Check the fleet sessions please",
        )
        .unwrap();

        assert_eq!(importance_of(&pool, &machine), MACHINE_EPISODE_IMPORTANCE);
        assert_eq!(importance_of(&pool, &human), HUMAN_EPISODE_IMPORTANCE);
        assert_eq!(
            retier_machine_episodes(&pool).unwrap(),
            0,
            "the backfill has nothing left to do once the writer tiers"
        );
    }

    /// Seed one machine row and one conversation row through the REAL schema
    /// at the pre-tier importance, then hand back the pool.
    fn seeded_pool() -> crate::db::UserDbPool {
        let pool = crate::db::init_test_user_db().unwrap();
        {
            let conn = pool.conn("episodic_test::seed").unwrap();
            for (id, body) in [
                (
                    "ep_mach",
                    "fleet-event session:loadgen-0001 cc:- state:stale project:loadgen/1",
                ),
                ("ep_orch", "fleet-orchestration wrapped up 3 sessions"),
                ("ep_human", "Why do we still have stale fleet sessions?"),
            ] {
                conn.execute(
                    "INSERT INTO companion_node (id, kind, session_id, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
                     VALUES (?1, 'episode', 'default', 'p.md', 'h', 3, ?2, '2026-08-08', '2026-08-08')",
                    params![id, body],
                )
                .unwrap();
            }
        }
        pool
    }

    fn importance_of(pool: &crate::db::UserDbPool, id: &str) -> i64 {
        pool.conn("episodic_test::importance_of")
            .unwrap()
            .query_row(
                "SELECT importance FROM companion_node WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// Fail-before: every episode was written at importance 3, so nothing
    /// downstream (a decay pass, a ranking tie-break) could tell a load-test
    /// correlator row from something the user said.
    #[test]
    fn the_retier_demotes_machine_rows_and_leaves_conversation_alone() {
        let pool = seeded_pool();
        assert_eq!(importance_of(&pool, "ep_mach"), 3, "fail-before");

        let n = retier_machine_episodes(&pool).unwrap();
        assert_eq!(n, 2, "both marker families are re-tiered");
        assert_eq!(importance_of(&pool, "ep_mach"), MACHINE_EPISODE_IMPORTANCE);
        assert_eq!(importance_of(&pool, "ep_orch"), MACHINE_EPISODE_IMPORTANCE);
        assert_eq!(
            importance_of(&pool, "ep_human"),
            HUMAN_EPISODE_IMPORTANCE,
            "conversation keeps its tier"
        );
    }

    /// The backfill runs on a hot path, so a second pass must be a no-op
    /// rather than a rewrite of the same rows.
    #[test]
    fn the_retier_is_idempotent() {
        let pool = seeded_pool();
        assert_eq!(retier_machine_episodes(&pool).unwrap(), 2);
        assert_eq!(
            retier_machine_episodes(&pool).unwrap(),
            0,
            "a second pass changes nothing"
        );
    }

    /// The demoted tier must stay ABOVE the `importance > 0` retrieval gate:
    /// the design intent is that correlator rows still compete on relevance.
    #[test]
    fn the_machine_tier_stays_retrievable() {
        assert!(
            MACHINE_EPISODE_IMPORTANCE > 0,
            "importance 0 would delete correlator rows from the keyword lane"
        );
        assert!(MACHINE_EPISODE_IMPORTANCE < HUMAN_EPISODE_IMPORTANCE);
    }

    /// The positive predicate and the exclusion must be exact complements over
    /// rows that have a body — they are built from one marker list precisely so
    /// they cannot drift.
    #[test]
    fn the_machine_predicate_and_its_exclusion_are_complements() {
        let pool = seeded_pool();
        let conn = pool.conn("episodic_test::complements").unwrap();
        let machine: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM companion_node WHERE kind='episode' AND body_excerpt IS NOT NULL AND {}",
                    machine_marker_match_sql()
                ),
                [],
                |r| r.get(0),
            )
            .unwrap();
        let conversation: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM companion_node WHERE kind='episode' AND body_excerpt IS NOT NULL{}",
                    machine_marker_exclusion_sql()
                ),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!((machine, conversation), (2, 1));
    }

    #[test]
    fn markers_are_safe_to_interpolate_into_like() {
        for m in MACHINE_EPISODE_MARKERS {
            assert!(
                !m.contains('\''),
                "marker {m:?} would break the SQL literal"
            );
            assert!(
                !m.contains('%'),
                "marker {m:?} would act as a LIKE wildcard"
            );
            assert!(
                !m.contains('_'),
                "marker {m:?} would act as a LIKE wildcard"
            );
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
                0 => insert_body(
                    &conn,
                    &id,
                    "default",
                    &ts,
                    "user",
                    "What should I ship next?",
                ),
                1 => insert_body(
                    &conn,
                    &id,
                    "default",
                    &ts,
                    "assistant",
                    "Here is what I'd pick.",
                ),
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

        let user_count =
            |rows: &[EpisodeRow]| rows.iter().filter(|r| r.1.ends_with("_user.md")).count();
        let machine_count =
            |rows: &[EpisodeRow]| rows.iter().filter(|r| is_machine_episode(&r.2)).count();

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
        insert_body(
            &conn,
            "a1",
            "default",
            "2026-08-01T00:00:01Z",
            "user",
            "mine",
        );
        insert_body(
            &conn,
            "b1",
            "other",
            "2026-08-01T00:00:02Z",
            "user",
            "theirs",
        );

        let rows = query_recent_conversation_rows(&conn, "default", 20).unwrap();
        assert_eq!(ids(&rows), vec!["a1"]);
    }
}
