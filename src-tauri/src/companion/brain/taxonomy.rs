//! Classification-tag registry for tier-3 long-term memory.
//!
//! Phase L1 of `docs/plans/athena-longevity.md`. Facts, procedurals and
//! preferences are tagged from `companion_taxonomy` rather than from a
//! hard-coded enum, because the design's central bet is that **schema
//! evolution is rows, never DDL**. Athena's critique phase may propose a new
//! classification; the operator gates it; expansion stays data — additive,
//! reviewable, reversible. A tag proposed by a cycle carries that cycle's id in
//! `origin`, so every expansion traces back to the pass that argued for it.
//!
//! Two states, and the difference is the whole gate: a `proposed` tag is inert
//! — it classifies nothing and no consumer should offer it — until
//! [`activate`] promotes it. The nine seeds ship `active`, because they are the
//! vocabulary the first cycle needs in order to say anything at all; they are
//! written by `COMPANION_SCHEMA` on every boot with `INSERT OR IGNORE`, so
//! seeding is idempotent and cannot overwrite a status someone has since
//! changed.

// Substrate shipped ahead of its caller: the compress/reconcile phases of the
// L1b sleep cycle are the consumers, and the LS sync lane replicates the
// registry between paired devices. Shipping the schema + API now is what keeps
// L1b focused on cycle judgement instead of plumbing (the lesson from L1
// nearly being a two-job wave). This allow is scoped to this file and comes off
// when L1b lands; if it is still here after L1b, the cycle is not using its own
// tag registry.
#![allow(dead_code)]

use rusqlite::{params, OptionalExtension};

use crate::companion::brain::util;
use crate::db::UserDbPool;
use crate::error::AppError;

/// In use — may be applied to memory rows and offered to a classifier.
pub const STATUS_ACTIVE: &str = "active";
/// Suggested but not yet gated in. Inert until [`activate`].
pub const STATUS_PROPOSED: &str = "proposed";
/// `origin` of the tags shipped with the schema.
pub const ORIGIN_SEED: &str = "seed";

/// One row of the registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaxonomyTag {
    pub id: String,
    pub tag: String,
    pub definition: String,
    /// `"seed"` or the `companion_cycle.id` that proposed it.
    pub origin: String,
    /// [`STATUS_ACTIVE`] | [`STATUS_PROPOSED`].
    pub status: String,
    pub created_at: String,
}

/// Every tag a classifier may currently use, alphabetically.
///
/// Deliberately excludes `proposed` rows: handing an ungated tag to the
/// classifier would make the approval gate decorative, since the tag would
/// already be in use by the time anyone reviewed it.
pub fn list_active(pool: &UserDbPool) -> Result<Vec<TaxonomyTag>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, tag, definition, origin, status, created_at
         FROM companion_taxonomy
         WHERE status = ?1
         ORDER BY tag",
    )?;
    let rows = stmt.query_map(params![STATUS_ACTIVE], |r| {
        Ok(TaxonomyTag {
            id: r.get(0)?,
            tag: r.get(1)?,
            definition: r.get(2)?,
            origin: r.get(3)?,
            status: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Propose a new tag from a cycle. Lands as [`STATUS_PROPOSED`], inert until
/// [`activate`].
///
/// Returns the new row's id, or `None` when `tag` already exists in ANY status.
/// Idempotent on purpose rather than erroring: a cycle re-deriving a
/// classification it proposed last night is normal, and a failed insert must
/// not abort a reconcile phase. `None` means "already known", which is the
/// caller's cue to do nothing — not an error to report.
pub fn propose(
    pool: &UserDbPool,
    tag: &str,
    definition: &str,
    origin_cycle: &str,
) -> Result<Option<String>, AppError> {
    let id = format!("tax_{}", util::short_id(10));
    let conn = pool.get()?;
    let n = conn.execute(
        "INSERT INTO companion_taxonomy (id, tag, definition, origin, status)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(tag) DO NOTHING",
        params![id, tag, definition, origin_cycle, STATUS_PROPOSED],
    )?;
    if n == 0 {
        return Ok(None);
    }
    tracing::info!(tag, origin_cycle, "companion: taxonomy tag proposed");
    Ok(Some(id))
}

/// Gate a proposed tag into use. Returns `false` when no such tag exists (an
/// already-active tag re-activates harmlessly and returns `true`).
pub fn activate(pool: &UserDbPool, tag: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "UPDATE companion_taxonomy SET status = ?1 WHERE tag = ?2",
        params![STATUS_ACTIVE, tag],
    )?;
    if n > 0 {
        tracing::info!(tag, "companion: taxonomy tag activated");
    }
    Ok(n > 0)
}

/// Read one tag by name, whatever its status. Mostly for tests and for a
/// reconcile phase checking whether an inbound sync delta names something it
/// already knows.
pub fn get(pool: &UserDbPool, tag: &str) -> Result<Option<TaxonomyTag>, AppError> {
    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT id, tag, definition, origin, status, created_at
             FROM companion_taxonomy WHERE tag = ?1",
            params![tag],
            |r| {
                Ok(TaxonomyTag {
                    id: r.get(0)?,
                    tag: r.get(1)?,
                    definition: r.get(2)?,
                    origin: r.get(3)?,
                    status: r.get(4)?,
                    created_at: r.get(5)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The nine seeds the design names, in the schema rather than in a Rust
    /// boot hook — asserted against the REAL schema (`init_test_user_db`
    /// applies `COMPANION_SCHEMA`) rather than a fixture this test wrote, so
    /// dropping the seed block fails here instead of leaving the first sleep
    /// cycle with no vocabulary.
    ///
    /// Modelled on `keyword::the_real_schema_still_carries_the_index_this_lane_reads`.
    #[test]
    fn the_real_schema_seeds_the_nine_starting_tags_as_active() {
        let pool = crate::db::init_test_user_db().unwrap();
        let tags = list_active(&pool).unwrap();
        let names: Vec<&str> = tags.iter().map(|t| t.tag.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "constraint",
                "contact",
                "decision",
                "environment",
                "incident",
                "preference",
                "style",
                "tool",
                "workflow",
            ],
            "the seed vocabulary must survive in the shipped schema"
        );
        for t in &tags {
            assert_eq!(t.origin, ORIGIN_SEED);
            assert_eq!(t.status, STATUS_ACTIVE);
            assert!(
                !t.definition.trim().is_empty(),
                "a tag with no definition cannot be applied consistently by an LLM: {}",
                t.tag
            );
        }
    }

    /// Boot runs `COMPANION_SCHEMA` every launch. Re-running it must not
    /// duplicate the seeds — `INSERT OR IGNORE` on the UNIQUE tag is what makes
    /// re-execution safe, and this is the assertion that it stays that way.
    #[test]
    fn re_running_the_schema_does_not_duplicate_the_seeds() {
        let pool = crate::db::init_test_user_db().unwrap();
        let before = list_active(&pool).unwrap().len();
        {
            let conn = pool.get().unwrap();
            // Exactly what the next app launch does.
            conn.execute_batch(crate::db::companion_schema_for_test())
                .expect("re-executing COMPANION_SCHEMA must be idempotent");
        }
        assert_eq!(list_active(&pool).unwrap().len(), before);
    }

    /// The UNIQUE constraint is real, not merely intended: two rows claiming
    /// the same tag with different definitions would make classification
    /// nondeterministic.
    #[test]
    fn the_tag_column_is_unique_at_the_database_level() {
        let pool = crate::db::init_test_user_db().unwrap();
        let conn = pool.get().unwrap();
        let err = conn.execute(
            "INSERT INTO companion_taxonomy (id, tag, definition, origin, status)
             VALUES ('dupe', 'preference', 'a rival definition', 'seed', 'active')",
            [],
        );
        assert!(
            err.is_err(),
            "a second row for an existing tag must be rejected by the schema"
        );
    }

    /// The gate: a cycle proposes, the tag is inert, activation puts it in use.
    #[test]
    fn a_proposed_tag_is_inert_until_activated() {
        let pool = crate::db::init_test_user_db().unwrap();
        let id = propose(&pool, "risk", "A known hazard and its blast radius.", "cyc_123")
            .unwrap()
            .expect("a brand-new tag is proposed");

        let stored = get(&pool, "risk").unwrap().expect("row exists");
        assert_eq!(stored.id, id);
        assert_eq!(stored.status, STATUS_PROPOSED);
        assert_eq!(stored.origin, "cyc_123", "the proposing cycle is traceable");
        assert!(
            !list_active(&pool).unwrap().iter().any(|t| t.tag == "risk"),
            "an ungated tag must not be offered to a classifier — otherwise the gate is decorative"
        );

        assert!(activate(&pool, "risk").unwrap());
        assert!(list_active(&pool).unwrap().iter().any(|t| t.tag == "risk"));
    }

    /// Re-proposing a known tag is a no-op, not a failure. A cycle that
    /// re-derives last night's classification must not abort its reconcile
    /// phase on a UNIQUE violation.
    #[test]
    fn re_proposing_a_known_tag_is_a_no_op() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert_eq!(
            propose(&pool, "preference", "a rival definition", "cyc_9").unwrap(),
            None,
            "an existing tag yields None rather than an error"
        );
        // …and the seed definition is untouched.
        let seed = get(&pool, "preference").unwrap().unwrap();
        assert_eq!(seed.origin, ORIGIN_SEED);
        assert_ne!(seed.definition, "a rival definition");
    }

    /// Activating something that does not exist reports false rather than
    /// inventing a row — a typo'd tag name must not silently create vocabulary.
    #[test]
    fn activating_an_unknown_tag_reports_false() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert!(!activate(&pool, "no_such_tag").unwrap());
        assert!(get(&pool, "no_such_tag").unwrap().is_none());
    }
}
