//! Backlog — Athena's self-promises and capability gaps.
//!
//! Two kinds:
//!   - **self_promise** — "I'll check on the deploy after lunch" or
//!     "let me get back to you on X". A specific commitment Athena
//!     made; the source episode pins down where it was made.
//!   - **capability_gap** — "I can't currently do X — should I propose
//!     wiring it up?". Surfaces in the backlog so the user can come
//!     back to it without Athena nagging.
//!
//! Append-only: items are resolved (`done` | `dropped`), not deleted.
//! `reminded_count` lets the proactive engine (Phase E) ratchet
//! frequency without re-pinging the same item every day.
//!
//! ## Disk and index say the same thing about resolution
//!
//! Every item is written twice: the markdown under `backlog/<kind>/<id>.md`
//! is the durable record, and `companion_node` + `companion_backlog_item` are
//! the index over it. Until 2026-09-03 [`resolve_item`] updated only the index
//! — the file kept saying `status: pending` forever, on the reasoning that
//! "the markdown stays as the audit record". An audit record that contradicts
//! the truth is not an audit record. Concretely it mattered in two places
//! already in the tree: `embeddings::reembed_missing` re-derives a node's
//! vector from `brain_root()/<file_path>` when that file reads as UTF-8, so a
//! resolved promise was being re-embedded from its unresolved text; and any
//! future index rebuild reading these files would have had no way to tell a
//! live commitment from a closed one, and would have restored all of them at
//! [`IMPORTANCE_PENDING`].
//!
//! So resolution is written to both, and [`importance_for_status`] is the one
//! definition of the importance a given status implies — used by the writer,
//! by the resolver, and by anything that later rebuilds from disk.

use std::fs;

use chrono::Utc;
use rusqlite::{params, OptionalExtension};

use crate::companion::brain::util;
use crate::companion::disk;
use crate::db::UserDbPool;
use crate::error::AppError;

/// Importance a pending item carries in `companion_node`. Mid-band: a
/// self-promise should surface in recall without outranking a fact.
pub const IMPORTANCE_PENDING: i32 = 3;

/// Importance a resolved item carries. Zero is the retrieval gate
/// (`keyword.rs` filters `importance > 0`), so a closed item stops competing
/// for prompt budget while its row and its markdown both survive.
pub const IMPORTANCE_RESOLVED: i32 = 0;

/// The `status` an unresolved item carries, in SQL and in the frontmatter.
pub const STATUS_PENDING: &str = "pending";

/// The importance a status implies. One definition, so the writer, the
/// resolver and any rebuild-from-disk cannot disagree about what a resolved
/// item is worth.
pub fn importance_for_status(status: &str) -> i32 {
    match status {
        STATUS_PENDING => IMPORTANCE_PENDING,
        _ => IMPORTANCE_RESOLVED,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BacklogKind {
    SelfPromise,
    CapabilityGap,
}

impl BacklogKind {
    pub fn as_str(self) -> &'static str {
        match self {
            BacklogKind::SelfPromise => "self_promise",
            BacklogKind::CapabilityGap => "capability_gap",
        }
    }
    pub fn parse(s: &str) -> Result<Self, AppError> {
        match s {
            "self_promise" => Ok(BacklogKind::SelfPromise),
            "capability_gap" => Ok(BacklogKind::CapabilityGap),
            other => Err(AppError::Internal(format!(
                "backlog kind `{other}` not in (self_promise|capability_gap)"
            ))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct BacklogItem {
    pub id: String,
    pub kind: String,
    pub summary: String,
    pub status: String,
    pub source_episode_id: Option<String>,
    pub reminded_count: i32,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug)]
pub struct BacklogInput<'a> {
    pub kind: BacklogKind,
    pub summary: &'a str,
    /// Where Athena committed to this. Required for self_promise so
    /// the user can audit; optional for capability_gap.
    pub source_episode_id: Option<&'a str>,
}

pub fn write_item(pool: &UserDbPool, input: &BacklogInput<'_>) -> Result<String, AppError> {
    if input.summary.trim().is_empty() {
        return Err(AppError::Internal(
            "backlog summary must not be empty".into(),
        ));
    }
    if matches!(input.kind, BacklogKind::SelfPromise) && input.source_episode_id.is_none() {
        return Err(AppError::Internal(
            "backlog self_promise rejected: source_episode_id is required \
             (Athena needs to remember where she committed)"
                .into(),
        ));
    }

    let id = format!("blog_{}", short_uuid());
    let now = Utc::now().to_rfc3339();
    let kind_s = input.kind.as_str();
    let rel_path = format!("backlog/{kind_s}/{id}.md");
    let abs_path = disk::brain_root()?.join(&rel_path);
    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = format_item_markdown(&id, kind_s, &now, input);
    fs::write(&abs_path, &body)?;
    let hash = sha256_hex(&body);

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO companion_node (id, kind, file_path, content_hash, importance, body_excerpt, created_at, updated_at)
         VALUES (?1, 'backlog', ?2, ?3, ?4, ?5, ?6, ?6)",
        params![
            id,
            rel_path,
            hash,
            importance_for_status(STATUS_PENDING),
            input.summary,
            now
        ],
    )?;
    tx.execute(
        "INSERT INTO companion_backlog_item (id, summary, kind, source_episode_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.summary, kind_s, input.source_episode_id, now],
    )?;
    tx.commit()?;
    Ok(id)
}

/// Close an item as `done` (or `dropped`) in BOTH places it is recorded.
///
/// Order is: claim the row (the `status = 'pending'` guard is what makes a
/// double-resolve an error rather than a silent second write), then rewrite
/// the markdown, then stamp the node with the resolved importance and the new
/// content hash. Claiming first means a disk failure leaves the index
/// authoritative and the item already out of retrieval — the safe direction.
/// The reverse order would leave a file claiming a resolution the index never
/// made.
pub fn resolve_item(pool: &UserDbPool, id: &str, dropped: bool) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    let new_status = if dropped { "dropped" } else { "done" };
    let conn = pool.get()?;
    let updated = conn.execute(
        "UPDATE companion_backlog_item
         SET status = ?1, resolved_at = ?2
         WHERE id = ?3 AND status = 'pending'",
        params![new_status, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::Internal(format!(
            "backlog item `{id}` not found or already resolved"
        )));
    }

    // Rewrite the markdown so the durable record agrees with the index. A
    // missing file is not fatal — the row is already resolved and that is the
    // fact retrieval reads — but it IS worth saying out loud, because a
    // backlog item with no file on disk means something ate the brain
    // directory.
    let rel_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    let mut new_hash: Option<String> = None;
    if let Some(rel) = rel_path {
        let abs = disk::brain_root()?.join(&rel);
        match fs::read_to_string(&abs) {
            Ok(body) => {
                let rewritten = apply_resolution_to_markdown(&body, new_status, &now);
                fs::write(&abs, &rewritten)?;
                new_hash = Some(sha256_hex(&rewritten));
            }
            Err(e) => tracing::warn!(
                item_id = %id,
                path = %abs.display(),
                error = %e,
                "companion backlog: resolved item has no readable markdown;                  index updated, disk record left as-is"
            ),
        }
    }

    // Drop importance so resolved items fall out of retrieval (the gate is
    // `importance > 0`), and re-stamp the hash so the node still describes the
    // bytes actually on disk.
    match new_hash {
        Some(hash) => conn.execute(
            "UPDATE companion_node SET importance = ?1, content_hash = ?2, updated_at = ?3 \
             WHERE id = ?4",
            params![importance_for_status(new_status), hash, now, id],
        )?,
        None => conn.execute(
            "UPDATE companion_node SET importance = ?1, updated_at = ?2 WHERE id = ?3",
            params![importance_for_status(new_status), now, id],
        )?,
    };
    Ok(())
}

pub fn list_items(
    pool: &UserDbPool,
    kind: Option<BacklogKind>,
    pending_only: bool,
    limit: u32,
) -> Result<Vec<BacklogItem>, AppError> {
    let conn = pool.get()?;
    let mut clauses: Vec<&str> = Vec::new();
    if pending_only {
        clauses.push("b.status = 'pending'");
    }
    if kind.is_some() {
        clauses.push("b.kind = ?1");
    }
    let where_clause = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let sql = format!(
        "SELECT b.id, b.kind, b.summary, b.status, b.source_episode_id, b.reminded_count,
                b.created_at, b.resolved_at
         FROM companion_backlog_item b
         {where_clause}
         ORDER BY
           CASE b.status WHEN 'pending' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
           b.created_at DESC
         LIMIT ?{limit_param}",
        limit_param = if kind.is_some() { 2 } else { 1 }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<BacklogItem> = if let Some(k) = kind {
        stmt.query_map(params![k.as_str(), limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![limit], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn get_item(pool: &UserDbPool, id: &str) -> Result<Option<BacklogItem>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT b.id, b.kind, b.summary, b.status, b.source_episode_id, b.reminded_count,
                    b.created_at, b.resolved_at
             FROM companion_backlog_item b
             WHERE b.id = ?1",
            params![id],
            map_row,
        )
        .optional()?;
    Ok(row)
}

/// Increment `reminded_count` so the proactive engine can ratchet
/// down its surfacing frequency. Returns the new count.
#[allow(dead_code)] // wired by Phase E proactive engine
pub fn bump_reminded(pool: &UserDbPool, id: &str) -> Result<i32, AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE companion_backlog_item SET reminded_count = reminded_count + 1 WHERE id = ?1",
        params![id],
    )?;
    let count: i32 = conn.query_row(
        "SELECT reminded_count FROM companion_backlog_item WHERE id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    Ok(count)
}

// ── helpers ─────────────────────────────────────────────────────────────

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BacklogItem> {
    Ok(BacklogItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        summary: row.get(2)?,
        status: row.get(3)?,
        source_episode_id: row.get(4)?,
        reminded_count: row.get(5)?,
        created_at: row.get(6)?,
        resolved_at: row.get(7)?,
    })
}

fn format_item_markdown(id: &str, kind: &str, now: &str, input: &BacklogInput<'_>) -> String {
    let mut s = format!(
        "---\nid: \"{id}\"\ntype: backlog_item\nkind: {kind}\nstatus: {STATUS_PENDING}\ncreated: \"{now}\"\n"
    );
    if let Some(src) = input.source_episode_id {
        s.push_str(&format!("source_episode_id: \"{src}\"\n"));
    }
    s.push_str("---\n\n");
    s.push_str(input.summary);
    if !input.summary.ends_with('\n') {
        s.push('\n');
    }
    s
}

/// Rewrite an item's frontmatter to record its resolution, leaving the body
/// untouched.
///
/// Pure and idempotent: re-applying it (a re-resolve, a repair pass, a
/// migration over files written before `status:` existed) converges on the
/// same bytes rather than stacking a second `status:` line. A file with no
/// frontmatter at all is handled by prepending one — that is what the items
/// written before 2026-09-03 look like, and losing their resolution because
/// their header is the old shape would defeat the point.
fn apply_resolution_to_markdown(body: &str, status: &str, resolved_at: &str) -> String {
    let Some(rest) = body.strip_prefix("---\n") else {
        return format!("---\nstatus: {status}\nresolved: \"{resolved_at}\"\n---\n\n{body}");
    };
    let Some(end) = rest.find("\n---") else {
        // Opening fence with no closing one: not frontmatter we can trust to
        // edit. Prepend rather than corrupt.
        return format!("---\nstatus: {status}\nresolved: \"{resolved_at}\"\n---\n\n{body}");
    };
    let (front, tail) = rest.split_at(end);

    let mut lines: Vec<String> = Vec::new();
    let mut saw_status = false;
    let mut saw_resolved = false;
    for line in front.lines() {
        if line.starts_with("status:") {
            lines.push(format!("status: {status}"));
            saw_status = true;
        } else if line.starts_with("resolved:") {
            lines.push(format!("resolved: \"{resolved_at}\""));
            saw_resolved = true;
        } else {
            lines.push(line.to_string());
        }
    }
    if !saw_status {
        lines.push(format!("status: {status}"));
    }
    if !saw_resolved {
        lines.push(format!("resolved: \"{resolved_at}\""));
    }
    format!("---\n{}{}", lines.join("\n"), tail)
}

/// Read one frontmatter key out of an item's markdown. The rebuild direction
/// of [`apply_resolution_to_markdown`]: what a pass that re-derived the index
/// from disk would see.
///
/// No production caller, deliberately and stated rather than hidden: there is
/// no rebuild-from-disk pass in this tree (searched 2026-09-03 —
/// `embeddings::reembed_missing` is the only reader of these files and it
/// re-embeds rather than re-indexes). This is the *read* half of the contract
/// the resolution rewrite exists to satisfy, and the tests below are what
/// currently hold it. Building the rebuild pass on top of a pair of accessors
/// nobody had written would be the harder order.
#[allow(dead_code)] // the read half of the disk↔index contract; tests hold it
pub fn frontmatter_value(body: &str, key: &str) -> Option<String> {
    let rest = body.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    rest[..end].lines().find_map(|line| {
        let v = line.strip_prefix(key)?.strip_prefix(':')?;
        Some(v.trim().trim_matches('"').to_string())
    })
}

/// The importance an index rebuilt from this file alone would give it. This is
/// the invariant the resolution rewrite exists to make true: before it, every
/// resolved item on disk read as pending and would have come back at
/// [`IMPORTANCE_PENDING`]. Same standing as [`frontmatter_value`] above.
#[allow(dead_code)] // the read half of the disk↔index contract; tests hold it
pub fn importance_from_markdown(body: &str) -> i32 {
    importance_for_status(
        frontmatter_value(body, "status")
            .as_deref()
            .unwrap_or(STATUS_PENDING),
    )
}

fn sha256_hex(s: &str) -> String {
    util::sha256_hex(s)
}

fn short_uuid() -> String {
    util::short_id(8)
}

#[cfg(test)]
mod tests {
    //! What these cover is one invariant stated two ways: **a resolved item is
    //! resolved on disk too.** Before 2026-09-03 `resolve_item` wrote only SQL,
    //! so the markdown — the durable record, and the text
    //! `embeddings::reembed_missing` re-derives a vector from — kept describing
    //! a live commitment forever, and an index rebuilt from those files would
    //! have restored every closed promise at importance 3.
    //!
    //! There is no rebuild-from-disk pass in the tree today (searched
    //! 2026-09-03: nothing walks `brain_root()` reconstructing `companion_node`
    //! — `embeddings::reembed_missing` is the only reader of these files, and
    //! it re-embeds rather than re-indexes). So the tests assert the property a
    //! rebuild would depend on, through [`importance_from_markdown`], rather
    //! than pretending a rebuild exists.
    //!
    //! Every pool checkout below propagates rather than unwrapping, and the
    //! tests return `Result` to make that possible: a fixture that panics on
    //! acquire hides exactly the saturation the product would (the reasoning
    //! `pool-get-unwrapped` counts test files for, and the same shape
    //! `semantic.rs`'s fixtures already use).

    use super::*;
    use crate::companion::brain::episodic::{self, EpisodeRole};
    use crate::companion::brain::test_home::TestHome;

    struct Brain {
        pool: UserDbPool,
        // Holds the shared `PERSONAS_HOME` lock for the test's lifetime:
        // `brain_root()` reads a process-global, so an unguarded redirect
        // races every other brain test that needs one.
        _home: TestHome,
    }

    fn brain() -> Result<Brain, AppError> {
        let home = TestHome::new("backlog");
        Ok(Brain {
            pool: crate::db::init_test_user_db()?,
            _home: home,
        })
    }

    fn a_promise(pool: &UserDbPool) -> Result<String, AppError> {
        let ep = episodic::append_episode(
            pool,
            "s1",
            EpisodeRole::Assistant,
            "I'll check the deploy after lunch",
        )?;
        write_item(
            pool,
            &BacklogInput {
                kind: BacklogKind::SelfPromise,
                summary: "check the deploy after lunch",
                source_episode_id: Some(&ep),
            },
        )
    }

    fn body_on_disk(pool: &UserDbPool, id: &str) -> Result<String, AppError> {
        let conn = pool.get()?;
        let rel: String = conn.query_row(
            "SELECT file_path FROM companion_node WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(fs::read_to_string(disk::brain_root()?.join(rel))?)
    }

    fn node_column<T: rusqlite::types::FromSql>(
        pool: &UserDbPool,
        id: &str,
        column: &str,
    ) -> Result<T, AppError> {
        let conn = pool.get()?;
        // `column` is a literal at every call site below, never user input.
        let sql = format!("SELECT {column} FROM companion_node WHERE id = ?1");
        Ok(conn.query_row(&sql, params![id], |r| r.get(0))?)
    }

    /// The fail-before proof. Run against the pre-2026-09-03 `resolve_item`
    /// (SQL only) the last assertion fails with 3: the file still said
    /// `status: pending`, so an index re-derived from disk would have brought
    /// the promise back at full importance. Verified by mutation on
    /// 2026-09-03 — with the rewrite disabled this test goes red and the two
    /// pure-helper tests below go with it.
    #[test]
    fn a_resolved_item_reads_as_resolved_from_disk_alone() -> Result<(), AppError> {
        let b = brain()?;
        let id = a_promise(&b.pool)?;

        let before = body_on_disk(&b.pool, &id)?;
        assert_eq!(
            frontmatter_value(&before, "status").as_deref(),
            Some(STATUS_PENDING)
        );
        assert_eq!(importance_from_markdown(&before), IMPORTANCE_PENDING);

        resolve_item(&b.pool, &id, false)?;

        let after = body_on_disk(&b.pool, &id)?;
        assert_eq!(
            frontmatter_value(&after, "status").as_deref(),
            Some("done"),
            "the markdown must record the resolution, not just the index"
        );
        assert!(
            frontmatter_value(&after, "resolved").is_some_and(|v| !v.is_empty()),
            "a resolution with no timestamp is not an audit record"
        );
        assert_eq!(
            importance_from_markdown(&after),
            IMPORTANCE_RESOLVED,
            "an index rebuilt from this file alone must NOT resurrect the item"
        );
        assert_eq!(
            node_column::<i32>(&b.pool, &id, "importance")?,
            IMPORTANCE_RESOLVED
        );
        assert!(
            after.contains("check the deploy after lunch"),
            "the body is the record; only the frontmatter changes"
        );
        Ok(())
    }

    /// `dropped` is a resolution too, and it must not read as pending either.
    #[test]
    fn dropping_an_item_also_lands_on_disk() -> Result<(), AppError> {
        let b = brain()?;
        let id = a_promise(&b.pool)?;
        resolve_item(&b.pool, &id, true)?;
        let body = body_on_disk(&b.pool, &id)?;
        assert_eq!(
            frontmatter_value(&body, "status").as_deref(),
            Some("dropped")
        );
        assert_eq!(importance_from_markdown(&body), IMPORTANCE_RESOLVED);
        Ok(())
    }

    /// The node row must keep describing the bytes on disk. A stale
    /// `content_hash` is how a "has this changed?" check silently answers no
    /// forever.
    #[test]
    fn resolution_restamps_the_content_hash() -> Result<(), AppError> {
        let b = brain()?;
        let id = a_promise(&b.pool)?;
        resolve_item(&b.pool, &id, false)?;
        assert_eq!(
            node_column::<String>(&b.pool, &id, "content_hash")?,
            sha256_hex(&body_on_disk(&b.pool, &id)?)
        );
        Ok(())
    }

    /// A second resolve is an error, not a second rewrite — the
    /// `status = 'pending'` guard on the claim is what makes that true.
    #[test]
    fn resolving_twice_is_refused() -> Result<(), AppError> {
        let b = brain()?;
        let id = a_promise(&b.pool)?;
        resolve_item(&b.pool, &id, false)?;
        assert!(resolve_item(&b.pool, &id, true).is_err());
        assert_eq!(
            frontmatter_value(&body_on_disk(&b.pool, &id)?, "status").as_deref(),
            Some("done"),
            "the refused second resolve must not have touched the file"
        );
        Ok(())
    }

    /// Items written before `status:` existed in the frontmatter still have to
    /// be resolvable, and the rewrite must converge rather than stack keys.
    #[test]
    fn the_rewrite_handles_legacy_frontmatter_and_is_idempotent() {
        let legacy = "---\nid: \"blog_old\"\ntype: backlog_item\nkind: self_promise\ncreated: \"2026-01-01T00:00:00Z\"\n---\n\nan old promise\n";
        let once = apply_resolution_to_markdown(legacy, "done", "2026-09-03T00:00:00Z");
        let twice = apply_resolution_to_markdown(&once, "done", "2026-09-03T00:00:00Z");
        assert_eq!(once, twice, "re-applying a resolution must be a no-op");
        assert_eq!(once.matches("status:").count(), 1);
        assert_eq!(once.matches("resolved:").count(), 1);
        assert_eq!(importance_from_markdown(&once), IMPORTANCE_RESOLVED);
        assert!(once.contains("an old promise"));
        assert!(once.contains("id: \"blog_old\""), "existing keys survive");
    }

    /// A file with no frontmatter at all must gain one rather than be
    /// corrupted — the resolution has to land somewhere readable.
    #[test]
    fn the_rewrite_prepends_frontmatter_when_there_is_none() {
        let bare = "just a body, no fence\n";
        let out = apply_resolution_to_markdown(bare, "dropped", "2026-09-03T00:00:00Z");
        assert_eq!(
            frontmatter_value(&out, "status").as_deref(),
            Some("dropped")
        );
        assert!(out.contains("just a body, no fence"));
    }
}
