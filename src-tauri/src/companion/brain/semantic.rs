//! Semantic memory: distilled facts about the user, projects, and world.
//!
//! Each fact has three persistence layers, in priority order:
//!   1. Markdown on disk under `~/.personas/companion-brain/semantic/<scope>/<id>.md`
//!      — source of truth, readable by humans, recoverable if the index is wiped.
//!   2. `companion_node` row (kind='fact') — drives generic listing/retrieval.
//!   3. `companion_fact` sidecar — typed metadata for queries (scope, key,
//!      confidence, supersedes/contradicts, last_seen).
//!      Plus `companion_provenance` rows linking the fact to source episode IDs.
//!
//! **Provenance contract**: every fact write requires ≥1 source episode id.
//! Writes without sources are rejected at this layer — Athena can't bury a
//! hallucination by leaving the field empty. The dispatcher rejects the same
//! way at the op-parse layer for fast feedback.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};

#[cfg(feature = "ml")]
use crate::companion::brain::embeddings;
use crate::companion::brain::util;
use crate::companion::disk;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// Scope of a fact. We keep the trio small — three buckets are enough to
/// keep retrieval focused while making it cheap to reason about "what
/// does Athena know about *me* vs. about *this project*".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactScope {
    User,
    Project,
    World,
}

impl FactScope {
    pub fn as_str(self) -> &'static str {
        match self {
            FactScope::User => "user",
            FactScope::Project => "project",
            FactScope::World => "world",
        }
    }

    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "user" => Ok(FactScope::User),
            "project" => Ok(FactScope::Project),
            "world" => Ok(FactScope::World),
            other => Err(AppError::Internal(format!(
                "fact scope `{other}` not in (user|project|world)"
            ))),
        }
    }
}

/// One semantic fact, fully assembled across the three persistence layers.
#[derive(Debug, Clone)]
pub struct Fact {
    pub id: String,
    pub scope: String,
    pub key: String,
    pub value: String,
    pub importance: i32,
    pub confidence: f32,
    pub sources: Vec<String>,
    pub supersedes_id: Option<String>,
    pub contradicts_id: Option<String>,
    pub updated_at: String,
    /// Last calendar date (YYYY-MM-DD) this claim still holds, if it named one.
    pub expires_at: Option<String>,
}

/// Input for writing a fact. `sources` non-empty is mandatory — caller
/// must build this from real episode IDs Athena cited in the proposal.
#[derive(Debug)]
pub struct FactInput<'a> {
    pub scope: FactScope,
    pub key: &'a str,
    pub value: &'a str,
    pub sources: &'a [String],
    pub importance: i32, // 1..5
    pub confidence: f32, // 0..1
    pub supersedes_id: Option<&'a str>,
    pub contradicts_id: Option<&'a str>,
    /// The last calendar date (YYYY-MM-DD) on which this claim still holds,
    /// when the claim named one. `None` is the normal case; a caller must
    /// never invent a boundary the source did not state.
    pub expires_at: Option<&'a str>,
}

pub fn write_fact(pool: &UserDbPool, input: &FactInput<'_>) -> Result<String, AppError> {
    if input.sources.is_empty() {
        return Err(AppError::Internal(
            "semantic fact rejected: at least one source episode_id is required \
             (anti-hallucination contract)"
                .into(),
        ));
    }
    if input.key.trim().is_empty() {
        return Err(AppError::Internal("fact key must not be empty".into()));
    }
    if input.value.trim().is_empty() {
        return Err(AppError::Internal("fact value must not be empty".into()));
    }

    let id = format!("fact_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let scope_s = input.scope.as_str();
    let importance = input.importance.clamp(1, 5);
    let confidence = input.confidence.clamp(0.0, 1.0);

    // Slugify the key so the filename stays portable (the key itself is
    // preserved verbatim in the SQL row + frontmatter).
    let slug = slugify(input.key);
    let rel_path = format!("semantic/{scope_s}/{id}_{slug}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = format_fact_markdown(&id, scope_s, input.key, input.value, &now, input);
    fs::write(&abs_path, &body)?;

    let hash = sha256_hex(&body);
    let excerpt = excerpt_500(input.value);

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'fact', ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, rel_path, hash, importance, excerpt, now],
    )?;

    tx.execute(
        "INSERT INTO companion_fact (id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            scope_s,
            input.key,
            confidence,
            input.supersedes_id,
            input.contradicts_id,
            now,
            input.expires_at,
        ],
    )?;

    for src in input.sources {
        // Tolerate duplicates silently — multiple cites of the same
        // episode aren't an error, they're just redundant.
        tx.execute(
            "INSERT OR IGNORE INTO companion_provenance (fact_id, episode_id) VALUES (?1, ?2)",
            params![id, src],
        )?;
    }

    tx.execute(
        "INSERT INTO companion_fts (node_id, body, tags) VALUES (?1, ?2, ?3)",
        params![
            id,
            input.value,
            format!("kind:fact scope:{scope_s} key:{}", input.key)
        ],
    )?;

    // Mark the prior fact as superseded (importance -> 0) without deleting:
    // historical record is preserved, but it stops winning retrieval.
    if let Some(prior) = input.supersedes_id {
        demote_superseded(&tx, prior, &now)?;
    }

    // A write that reaches here is deliberate: an approved proposal, a repair,
    // or a user statement. That is new evidence about the subject, so it lifts
    // any forget tombstone on the key. Consolidation never reaches this line
    // for a tombstoned key — `sleep_cycle::apply` refuses first — so clearing
    // here cannot be the silent re-learn the tombstone exists to prevent.
    tx.execute(
        "DELETE FROM companion_fact_tombstone WHERE scope = ?1 AND fact_key = ?2",
        params![scope_s, input.key],
    )?;

    tx.commit()?;
    Ok(id)
}

/// Retire a memory row: `importance → 0`, never `DELETE`.
///
/// The single implementation of "forgetting is demotion". A demoted row keeps
/// its markdown, its `companion_node` row and its provenance chain; what it
/// loses is retrieval eligibility, because every read — `list_facts`,
/// `list_rules`, and `keyword::search_kind`'s `importance > 0` predicate —
/// filters on exactly this.
///
/// Two callers, and that is the reason it exists as a function: [`write_fact`]
/// demotes the prior fact when a new one supersedes it, and the sleep cycle's
/// reconcile phase demotes the loser of a supersede it judged between two facts
/// that BOTH already exist (`brain::sleep_cycle`). A second hand-written
/// `UPDATE … importance = 0` would be a second forgetting semantics, and the
/// one thing this memory model cannot afford is two of those.
///
/// Takes a `&Connection` so it works inside a `Transaction` (which derefs to
/// one) as well as on a pooled connection. Returns rows changed — 0 means the
/// id matched nothing, which the caller may treat as a dropped candidate.
pub fn demote_superseded(
    conn: &rusqlite::Connection,
    prior_id: &str,
    now: &str,
) -> Result<usize, AppError> {
    Ok(conn.execute(
        "UPDATE companion_node SET importance = 0, updated_at = ?1 WHERE id = ?2",
        params![now, prior_id],
    )?)
}

/// Same as `write_fact`, but also embeds the value into vec0 so retrieval
/// can find it by similarity. Failure to embed is logged, not fatal.
#[cfg(feature = "ml")]
pub async fn write_fact_and_embed(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    input: &FactInput<'_>,
) -> Result<String, AppError> {
    let id = write_fact(pool, input)?;
    if let Err(e) = embeddings::embed_and_store(pool, embedder, &id, input.value).await {
        tracing::warn!(fact_id = %id, error = %e, "companion fact embed failed (continuing)");
    }
    Ok(id)
}

/// Cosine distance below which two fact values are treated as the same
/// fact for fold-instead-of-add purposes. Calibrated for AllMiniLML6V2Q
/// (384-dim): two facts with the same meaning but different wording sit
/// empirically around 0.05-0.15. Set conservatively — false positives
/// (folding two genuinely-distinct facts) are harder to spot than false
/// negatives (the second fact just persists as a near-duplicate). Tune
/// down (more folding) if review queues fill with obvious duplicates.
#[cfg(feature = "ml")]
const FUZZY_DEDUP_THRESHOLD: f32 = 0.15;

/// Top-K candidates inspected for fuzzy dedup. Most duplicates land at
/// rank 1; the extra slots cover edge cases (same fact's superseded
/// prior version was indexed under similar wording, etc.).
#[cfg(feature = "ml")]
const FUZZY_DEDUP_TOPK: usize = 5;

/// Find a near-duplicate of `value` in the same `scope`. Returns the
/// existing fact's id if cosine distance falls below
/// `FUZZY_DEDUP_THRESHOLD`, else None. Excludes superseded facts
/// (importance = 0). Anti-hallucination contract: only inspects
/// facts that have at least one provenance source — pure-author
/// facts can't be the merge target either.
#[cfg(feature = "ml")]
pub async fn find_near_duplicate(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    scope: FactScope,
    value: &str,
) -> Result<Option<String>, AppError> {
    let candidates = embeddings::search_similar(pool, embedder, value, FUZZY_DEDUP_TOPK).await?;
    if candidates.is_empty() {
        return Ok(None);
    }
    let conn = pool.get()?;
    let scope_str = scope.as_str();
    for (node_id, distance) in candidates {
        // Results are sorted by distance ASC; once we exceed the threshold
        // all subsequent hits are further still.
        if distance >= FUZZY_DEDUP_THRESHOLD {
            break;
        }
        let matched: Option<String> = conn
            .query_row(
                "SELECT n.id FROM companion_fact f
                 JOIN companion_node n ON n.id = f.id
                 WHERE n.id = ?1
                   AND f.scope = ?2
                   AND n.kind = 'fact'
                   AND n.importance > 0",
                params![node_id, scope_str],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = matched {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// Reinforce an existing fact: boost importance by 1 (cap 5), bump
/// last_seen_at, append any new source episode ids. Used when a near-
/// duplicate fact is found at consolidation time — the new evidence
/// strengthens the existing entry instead of producing a redundant row.
/// The provenance contract is preserved: every reinforce path adds at
/// least one source (caller passes the proposal's sources).
#[cfg(feature = "ml")]
pub fn reinforce_fact(
    pool: &UserDbPool,
    fact_id: &str,
    new_sources: &[String],
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE companion_node
         SET importance = MIN(5, importance + 1), updated_at = ?1
         WHERE id = ?2 AND kind = 'fact'",
        params![now, fact_id],
    )?;
    tx.execute(
        "UPDATE companion_fact SET last_seen_at = ?1 WHERE id = ?2",
        params![now, fact_id],
    )?;
    for src in new_sources {
        tx.execute(
            "INSERT OR IGNORE INTO companion_provenance (fact_id, episode_id) VALUES (?1, ?2)",
            params![fact_id, src],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(not(feature = "ml"))]
#[allow(dead_code)]
pub async fn write_fact_and_embed(
    pool: &UserDbPool,
    input: &FactInput<'_>,
) -> Result<String, AppError> {
    write_fact(pool, input)
}

/// List facts, optionally filtered by scope. Excludes superseded
/// (importance=0) entries by default — the consolidator can pass
/// `include_superseded=true` to inspect history.
pub fn list_facts(
    pool: &UserDbPool,
    scope: Option<FactScope>,
    include_superseded: bool,
    limit: u32,
) -> Result<Vec<Fact>, AppError> {
    let conn = pool.get()?;
    let scope_filter = match scope {
        Some(_) => "AND f.scope = ?1",
        None => "",
    };
    let imp_filter = if include_superseded {
        ""
    } else {
        "AND n.importance > 0"
    };
    let sql = format!(
        "SELECT n.id, f.scope, f.fact_key, n.body_excerpt, n.importance,
                f.confidence, f.supersedes_id, f.contradicts_id,
                n.updated_at, f.expires_at
         FROM companion_fact f
         JOIN companion_node n ON n.id = f.id
         WHERE n.kind = 'fact' {scope_filter} {imp_filter}
         ORDER BY n.importance DESC, n.updated_at DESC
         LIMIT ?{limit_param}",
        limit_param = if scope.is_some() { 2 } else { 1 }
    );

    let mut stmt = conn.prepare(&sql)?;

    let rows: Vec<Fact> = if let Some(s) = scope {
        stmt.query_map(params![s.as_str(), limit], map_fact_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_fact_row)?
            .collect::<Result<Vec<_>, _>>()?
    };

    drop(stmt);
    // Hydrate sources per row from companion_provenance.
    let mut out = Vec::with_capacity(rows.len());
    for mut f in rows {
        f.sources = load_sources(&conn, &f.id)?;
        out.push(f);
    }
    Ok(out)
}

/// Look up a single fact by id (any scope; includes superseded).
pub fn get_fact(pool: &UserDbPool, id: &str) -> Result<Option<Fact>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT n.id, f.scope, f.fact_key, n.body_excerpt, n.importance,
                    f.confidence, f.supersedes_id, f.contradicts_id,
                    n.updated_at, f.expires_at
             FROM companion_fact f
             JOIN companion_node n ON n.id = f.id
             WHERE n.id = ?1",
            params![id],
            map_fact_row,
        )
        .optional()?;
    match row {
        Some(mut f) => {
            f.sources = load_sources(&conn, &f.id)?;
            Ok(Some(f))
        }
        None => Ok(None),
    }
}

/// Has the user forgotten this `(scope, key)`?
///
/// The only way back is a deliberate [`write_fact`] on the same key, which
/// clears the tombstone as part of its own transaction. There is no separate
/// "un-forget" entry point, and deliberately so: an unused one would be a
/// primitive built ahead of its callers, and the repo has enough of those.
/// Add it the day a surface actually needs it.
///
/// Consulted by consolidation before it re-derives a fact. Answers `false` on
/// any read error: a diagnostic query that cannot run must not be able to
/// block learning outright, and the failure mode it would otherwise create
/// (a brain that silently stops recording anything) is far worse than the one
/// it guards against.
pub fn is_forgotten(pool: &UserDbPool, scope: FactScope, key: &str) -> bool {
    let Ok(conn) = pool.get() else {
        return false;
    };
    conn.query_row(
        "SELECT 1 FROM companion_fact_tombstone WHERE scope = ?1 AND fact_key = ?2",
        params![scope.as_str(), key],
        |_| Ok(()),
    )
    .optional()
    .unwrap_or(None)
    .is_some()
}

/// Delete a fact (rare, audit-trail only). The disk markdown moves to
/// `semantic/_deleted/<id>.md` rather than being unlinked, so a recovery
/// cycle can rebuild the index. SQL rows are removed.
///
/// **Leaves a tombstone.** The deletion removes the fact but not the episodes
/// it was derived from, and the sleep cycle reads those episodes again every
/// night — so without a record of the user's objection the next cycle simply
/// re-derives what was just deleted, and the correction looks ignored. The
/// tombstone is written inside the same transaction as the delete: a fact that
/// disappeared without one would be exactly the silent-relearn case this
/// exists to prevent.
pub fn delete_fact(pool: &UserDbPool, id: &str) -> Result<(), AppError> {
    let root = disk::brain_root()?;
    let conn = pool.get()?;
    let rel: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1 AND kind = 'fact'",
            params![id],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    // Read the identity BEFORE the rows go away. `body_excerpt` carries the
    // rendered value; it is audit-trail only and is never matched against.
    let identity: Option<(String, String, Option<String>)> = conn
        .query_row(
            "SELECT f.scope, f.fact_key, n.body_excerpt
             FROM companion_fact f
             LEFT JOIN companion_node n ON n.id = f.id
             WHERE f.id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let tx = conn.unchecked_transaction()?;
    if let Some((scope, fact_key, excerpt)) = identity.as_ref() {
        tx.execute(
            "INSERT INTO companion_fact_tombstone (scope, fact_key, value_excerpt)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(scope, fact_key) DO UPDATE SET
                 value_excerpt = excluded.value_excerpt,
                 forgotten_at  = datetime('now')",
            params![scope, fact_key, excerpt],
        )?;
    }
    tx.execute(
        "DELETE FROM companion_provenance WHERE fact_id = ?1",
        params![id],
    )?;
    tx.execute("DELETE FROM companion_fact WHERE id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_fts WHERE node_id = ?1", params![id])?;
    tx.execute("DELETE FROM companion_node WHERE id = ?1", params![id])?;
    // Best-effort embedding cleanup — vec0's table name is fixed; skip
    // if missing. The orphaned row is harmless (no node references it).
    let _ = tx.execute(
        "DELETE FROM companion_embedding WHERE node_id = ?1",
        params![id],
    );
    tx.commit()?;

    if let Some(rel) = rel {
        let src = root.join(&rel);
        let dst = root.join(format!(
            "semantic/_deleted/{}",
            src.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown.md")
        ));
        if let Some(parent) = dst.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::rename(&src, &dst);
    }
    Ok(())
}

/// Touch the `last_seen_at` for a set of fact ids. Called by retrieval
/// when a fact is pulled into the working context, so reinforcement
/// resets the decay clock without needing an explicit user action.
pub fn touch_last_seen(pool: &UserDbPool, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = pool.get()?;
    let now = Utc::now().to_rfc3339();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("UPDATE companion_fact SET last_seen_at = ? WHERE id IN ({placeholders})");
    let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 1);
    p.push(&now);
    for id in ids {
        p.push(id as &dyn rusqlite::ToSql);
    }
    conn.execute(&sql, p.as_slice())?;
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────

fn map_fact_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Fact> {
    Ok(Fact {
        id: row.get(0)?,
        scope: row.get(1)?,
        key: row.get(2)?,
        value: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        importance: row.get(4)?,
        confidence: row.get(5)?,
        supersedes_id: row.get(6)?,
        contradicts_id: row.get(7)?,
        updated_at: row.get(8)?,
        expires_at: row.get(9)?,
        sources: Vec::new(),
    })
}

fn load_sources(conn: &rusqlite::Connection, fact_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT episode_id FROM companion_provenance WHERE fact_id = ?1 ORDER BY episode_id",
    )?;
    let rows = stmt
        .query_map(params![fact_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn format_fact_markdown(
    id: &str,
    scope: &str,
    key: &str,
    value: &str,
    now: &str,
    input: &FactInput<'_>,
) -> String {
    let mut frontmatter = format!(
        "---\nid: \"{id}\"\ntype: fact\nscope: {scope}\nkey: \"{}\"\ncreated: \"{now}\"\nimportance: {}\nconfidence: {:.2}\nsources:\n",
        escape_yaml(key),
        input.importance,
        input.confidence
    );
    for src in input.sources {
        frontmatter.push_str(&format!("  - \"{src}\"\n"));
    }
    if let Some(s) = input.supersedes_id {
        frontmatter.push_str(&format!("supersedes: \"{s}\"\n"));
    }
    if let Some(c) = input.contradicts_id {
        frontmatter.push_str(&format!("contradicts: \"{c}\"\n"));
    }
    frontmatter.push_str("---\n\n");
    frontmatter.push_str(value);
    if !value.ends_with('\n') {
        frontmatter.push('\n');
    }
    frontmatter
}

fn escape_yaml(s: &str) -> String {
    util::escape_yaml(s)
}

fn slugify(s: &str) -> String {
    util::slugify(s, "fact", None)
}

fn sha256_hex(s: &str) -> String {
    util::sha256_hex(s)
}

fn excerpt_500(s: &str) -> String {
    util::excerpt(s, 500)
}

fn short_uuid() -> String {
    util::short_id(8)
}

#[cfg(test)]
mod tombstone_tests {
    //! The forget contract: a fact the user deleted must not come back on its
    //! own, and must still be re-learnable when the user says so.
    //!
    //! These run against the real companion schema (`init_test_user_db`) and
    //! the real writers, through [`TestHome`] so the markdown a fact write puts
    //! on disk lands in a temp dir and cannot race another brain test for the
    //! process-global `PERSONAS_HOME`.

    use super::*;
    use crate::companion::brain::episodic::{self, EpisodeRole};
    use crate::companion::brain::test_home::TestHome;

    struct Brain {
        pool: UserDbPool,
        // Holds the shared `PERSONAS_HOME` lock for the test's lifetime.
        _home: TestHome,
    }

    fn brain() -> Brain {
        let home = TestHome::new("tombstone");
        Brain {
            pool: crate::db::init_test_user_db().expect("test user db"),
            _home: home,
        }
    }

    /// `write_fact` refuses a sourceless fact, so every test needs one real
    /// episode to cite.
    fn source_episode(pool: &UserDbPool) -> String {
        episodic::append_episode(pool, "s1", EpisodeRole::User, "I use VS Code")
            .expect("append episode")
    }

    fn write(pool: &UserDbPool, key: &str, value: &str, source: &str) -> String {
        write_fact(
            pool,
            &FactInput {
                scope: FactScope::User,
                key,
                value,
                sources: std::slice::from_ref(&source.to_string()),
                importance: 3,
                confidence: 0.9,
                expires_at: None,
                supersedes_id: None,
                contradicts_id: None,
            },
        )
        .expect("write fact")
    }

    /// Every tombstone on `key`, as `(scope, value_excerpt)`.
    ///
    /// Propagates the pool checkout instead of unwrapping it: a fixture that
    /// panics on acquire hides exactly the saturation the product would, which
    /// is why the rule counts test files too.
    fn tombstones_for(
        pool: &UserDbPool,
        key: &str,
    ) -> Result<Vec<(String, Option<String>)>, AppError> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT scope, value_excerpt FROM companion_fact_tombstone WHERE fact_key = ?1",
        )?;
        let rows = stmt
            .query_map(params![key], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    #[test]
    fn a_fresh_key_is_not_forgotten() {
        let b = brain();
        assert!(!is_forgotten(&b.pool, FactScope::User, "preferred_editor"));
    }

    /// The finding this whole change exists for: deleting a fact must record
    /// the objection, because the episodes it was derived from survive the
    /// delete and consolidation reads them again.
    #[test]
    fn deleting_a_fact_leaves_a_tombstone_on_its_key() {
        let b = brain();
        let src = source_episode(&b.pool);
        let id = write(&b.pool, "preferred_editor", "VS Code", &src);

        assert!(!is_forgotten(&b.pool, FactScope::User, "preferred_editor"));
        delete_fact(&b.pool, &id).expect("delete");
        assert!(
            is_forgotten(&b.pool, FactScope::User, "preferred_editor"),
            "a deleted fact must leave a tombstone, or the next cycle re-derives it"
        );
    }

    /// Scope is part of the key. Forgetting a user-scoped fact must not
    /// silence the same key at project or world scope.
    #[test]
    fn a_tombstone_is_scoped() {
        let b = brain();
        let src = source_episode(&b.pool);
        let id = write(&b.pool, "preferred_editor", "VS Code", &src);
        delete_fact(&b.pool, &id).expect("delete");

        assert!(is_forgotten(&b.pool, FactScope::User, "preferred_editor"));
        assert!(
            !is_forgotten(&b.pool, FactScope::Project, "preferred_editor"),
            "forgetting at one scope must not silence another"
        );
    }

    /// The other half of the contract. A deliberate write is new evidence, not
    /// a re-derivation, so it lifts the tombstone — otherwise "forget that"
    /// would permanently poison the key and the user could never correct it
    /// back.
    #[test]
    fn a_deliberate_write_lifts_the_tombstone() {
        let b = brain();
        let src = source_episode(&b.pool);
        let id = write(&b.pool, "preferred_editor", "VS Code", &src);
        delete_fact(&b.pool, &id).expect("delete");
        assert!(is_forgotten(&b.pool, FactScope::User, "preferred_editor"));

        write(&b.pool, "preferred_editor", "Zed", &src);
        assert!(
            !is_forgotten(&b.pool, FactScope::User, "preferred_editor"),
            "an explicit write is the user speaking again; it must clear the tombstone"
        );
    }

    /// Forgetting the same key twice is not an error and must not duplicate —
    /// the tombstone is keyed on (scope, key), and a second delete just
    /// refreshes it.
    #[test]
    fn forgetting_twice_refreshes_rather_than_duplicating() {
        let b = brain();
        let src = source_episode(&b.pool);

        let first = write(&b.pool, "preferred_editor", "VS Code", &src);
        delete_fact(&b.pool, &first).expect("delete 1");
        let second = write(&b.pool, "preferred_editor", "Zed", &src);
        delete_fact(&b.pool, &second).expect("delete 2");

        let rows = tombstones_for(&b.pool, "preferred_editor").expect("read tombstones");
        assert_eq!(
            rows.len(),
            1,
            "one tombstone per (scope, key), refreshed in place"
        );
        assert!(is_forgotten(&b.pool, FactScope::User, "preferred_editor"));
    }

    /// The tombstone records what was forgotten, for the audit trail. It is
    /// never matched against — forgetting a key forgets the subject, and
    /// matching on the value would let the next cycle re-derive the same fact
    /// in different words.
    #[test]
    fn the_tombstone_records_the_forgotten_value() {
        let b = brain();
        let src = source_episode(&b.pool);
        let id = write(&b.pool, "preferred_editor", "VS Code", &src);
        delete_fact(&b.pool, &id).expect("delete");

        let rows = tombstones_for(&b.pool, "preferred_editor").expect("read tombstones");
        let (scope, excerpt) = rows.first().expect("a tombstone exists");
        assert_eq!(scope, "user");
        assert_eq!(excerpt.as_deref(), Some("VS Code"));
    }
}
