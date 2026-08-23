//! Staging inbox for cross-device memory sync.
//!
//! Phase LS of `docs/plans/athena-longevity.md`. Both paired machines are
//! homes — the operator works on each, governing different projects — so
//! split-brain is the architecture rather than a hazard. The obligation that
//! falls out of it: **project-scoped memory stays local; project-abstract
//! memory syncs.** What crosses the wire is the distillate a sleep cycle
//! produced (user/world-scope facts, user-scope procedurals, preference facts,
//! taxonomy rows) — never the raw episode stream.
//!
//! ## The contract this module exists to enforce
//!
//! * **LS writes here.** An arriving delta lands in `companion_sync_inbox`
//!   tagged with its origin device, and nowhere else.
//! * **The sleep cycle's reconcile phase is the ONLY consumer.** It reads
//!   unprocessed rows, treats them as *semi-trusted evidence*, and puts them
//!   through the same supersede / contradict / dedupe machinery and the same
//!   proposal gate as locally-derived memory.
//! * **Sync never force-writes long-term memory.** There is deliberately no
//!   function here that writes a fact, a procedural or a taxonomy row. The only
//!   way an inbound delta becomes memory is through a cycle's judgement.
//!   Conflict resolution *is* the sleep cycle; this table is what makes that
//!   possible instead of aspirational.
//!
//! ## Why rows are never deleted
//!
//! [`mark_processed`] stamps `processed_cycle_id` rather than deleting. That
//! buys idempotency and echo-prevention for free — a redelivered delta is
//! visibly already-consumed — and it records *which* cycle consumed it, so a
//! bad reconcile is auditable rather than merely regrettable. Identity
//! convergence in L3 works the same way: sync the inputs, let each device
//! re-derive, never diff prose.

// Half of this module's file-wide `#![allow(dead_code)]` came off with L1b:
// `brain::sleep_cycle`'s reconcile phase is the real reader
// (`list_unprocessed` → apply → `mark_processed`) and it dispatches on the
// three `KIND_*` constants. Only [`insert_delta`] keeps a targeted allow — the
// LS transport that writes it is a later wave, and this table having no writer
// yet is precisely the state the module was shipped in.

use rusqlite::params;

use crate::companion::brain::util;
use crate::db::UserDbPool;
use crate::error::AppError;

/// A semantic fact (`companion_fact`-shaped payload).
pub const KIND_FACT: &str = "fact";
/// A procedural / "ritual" payload.
pub const KIND_PROCEDURAL: &str = "procedural";
/// A `companion_taxonomy` row proposed or activated on the other device.
pub const KIND_TAXONOMY: &str = "taxonomy";

/// One staged delta awaiting (or having had) reconciliation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncDelta {
    pub id: String,
    /// Which paired device produced this delta.
    pub origin_device: String,
    /// [`KIND_FACT`] | [`KIND_PROCEDURAL`] | [`KIND_TAXONOMY`].
    pub item_kind: String,
    /// The payload, exactly as it arrived. Kept opaque here on purpose: the
    /// reconcile phase owns interpretation, and a staging table that parsed
    /// payloads would have to be revised every time a synced tier gained a
    /// field.
    pub payload_json: String,
    pub received_at: String,
}

/// Stage one inbound delta. The ONLY write path into the sync lane.
///
/// No product caller yet: the LS transport (`memory_sync_delta` job kind on the
/// existing device pairing) is a later wave. L1b consumes what this writes and
/// is tested against it, which is the order the design intends — the reconcile
/// side must exist before anything is allowed to arrive.
#[allow(dead_code)]
pub fn insert_delta(
    pool: &UserDbPool,
    origin_device: &str,
    item_kind: &str,
    payload_json: &str,
) -> Result<String, AppError> {
    let id = format!("sync_{}", util::short_id(12));
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_sync_inbox
           (id, origin_device, item_kind, payload_json)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, origin_device, item_kind, payload_json],
    )?;
    tracing::debug!(
        origin_device,
        item_kind,
        "companion: sync delta staged for the next reconcile"
    );
    Ok(id)
}

/// Deltas the reconcile phase has not consumed yet, oldest first.
///
/// Oldest-first because reconciliation is order-sensitive: a supersede that
/// arrived after the fact it supersedes must be applied after it, or the newer
/// value loses to the older one.
pub fn list_unprocessed(pool: &UserDbPool, limit: u32) -> Result<Vec<SyncDelta>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, origin_device, item_kind, payload_json, received_at
         FROM companion_sync_inbox
         WHERE processed_cycle_id IS NULL
         ORDER BY received_at ASC, id ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok(SyncDelta {
            id: r.get(0)?,
            origin_device: r.get(1)?,
            item_kind: r.get(2)?,
            payload_json: r.get(3)?,
            received_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Stamp the cycle that consumed these deltas. Returns how many rows changed.
///
/// Stamping rather than deleting: the payload that crossed the wire is the
/// evidence for whatever the cycle then decided, and `processed_cycle_id` is
/// what makes a redelivery visibly a redelivery. Already-processed rows are not
/// re-stamped — the `IS NULL` guard means the FIRST cycle to consume a delta
/// owns it, so a later pass cannot rewrite history by claiming it.
pub fn mark_processed(
    pool: &UserDbPool,
    ids: &[String],
    cycle_id: &str,
) -> Result<usize, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    let mut conn = pool.get()?;
    let tx = conn.transaction()?;
    let mut changed = 0usize;
    {
        let mut stmt = tx.prepare(
            "UPDATE companion_sync_inbox
             SET processed_cycle_id = ?1
             WHERE id = ?2 AND processed_cycle_id IS NULL",
        )?;
        for id in ids {
            changed += stmt.execute(params![cycle_id, id])?;
        }
    }
    tx.commit()?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The round trip the reconcile phase will perform, against the REAL schema
    /// (`init_test_user_db` applies `COMPANION_SCHEMA`) rather than a fixture
    /// this test wrote — the same reason
    /// `keyword::the_real_schema_still_carries_the_index_this_lane_reads`
    /// exists. Drop the table or the index and this fails here, loudly, rather
    /// than silently stranding every inbound delta in production.
    #[test]
    fn a_staged_delta_is_listed_then_stamped_and_retained() {
        let pool = crate::db::init_test_user_db().unwrap();

        let id = insert_delta(
            &pool,
            "workstation-b",
            KIND_FACT,
            r#"{"scope":"user","key":"prefers_atomic_commits","value":"yes"}"#,
        )
        .unwrap();

        let pending = list_unprocessed(&pool, 50).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, id);
        assert_eq!(pending[0].origin_device, "workstation-b");
        assert_eq!(pending[0].item_kind, KIND_FACT);
        assert!(pending[0].payload_json.contains("prefers_atomic_commits"));
        assert!(
            !pending[0].received_at.is_empty(),
            "received_at is defaulted by the schema"
        );

        assert_eq!(
            mark_processed(&pool, &[id.clone()], "cyc_alpha").unwrap(),
            1
        );
        assert!(
            list_unprocessed(&pool, 50).unwrap().is_empty(),
            "a consumed delta must not be handed to the next cycle again"
        );

        // Retained, with the consuming cycle recorded — deletion would destroy
        // the evidence for whatever the cycle decided.
        let (retained, cycle): (String, String) = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT payload_json, processed_cycle_id FROM companion_sync_inbox WHERE id = ?1",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(retained.contains("prefers_atomic_commits"));
        assert_eq!(cycle, "cyc_alpha");
    }

    /// The first cycle to consume a delta owns it. A later pass re-stamping the
    /// same row would rewrite the audit trail and make "which cycle acted on
    /// this evidence" unanswerable.
    #[test]
    fn a_processed_delta_is_not_reclaimed_by_a_later_cycle() {
        let pool = crate::db::init_test_user_db().unwrap();
        let id = insert_delta(&pool, "workstation-b", KIND_TAXONOMY, "{}").unwrap();

        assert_eq!(
            mark_processed(&pool, &[id.clone()], "cyc_first").unwrap(),
            1
        );
        assert_eq!(
            mark_processed(&pool, &[id.clone()], "cyc_second").unwrap(),
            0,
            "re-stamping must report zero rows changed"
        );

        let cycle: String = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT processed_cycle_id FROM companion_sync_inbox WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cycle, "cyc_first", "the original consumer is preserved");
    }

    /// Reconciliation is order-sensitive — a supersede applied before the fact
    /// it supersedes loses the newer value.
    #[test]
    fn unprocessed_deltas_come_back_oldest_first_and_respect_the_limit() {
        let pool = crate::db::init_test_user_db().unwrap();
        for i in 0..5 {
            let id =
                insert_delta(&pool, "workstation-b", KIND_FACT, &format!("{{\"n\":{i}}}")).unwrap();
            // `received_at` defaults to a whole-second timestamp, so several
            // inserts in one test share it. Force a distinct order rather than
            // asserting on a tie the schema does not guarantee.
            pool.get()
                .unwrap()
                .execute(
                    "UPDATE companion_sync_inbox SET received_at = ?1 WHERE id = ?2",
                    params![format!("2026-08-0{} 00:00:00", i + 1), id],
                )
                .unwrap();
        }

        let page = list_unprocessed(&pool, 3).unwrap();
        assert_eq!(page.len(), 3, "the limit is honoured");
        assert!(page[0].payload_json.contains("\"n\":0"));
        assert!(page[2].payload_json.contains("\"n\":2"));
    }

    /// An empty batch must not build a degenerate statement or claim work.
    #[test]
    fn marking_nothing_is_a_no_op() {
        let pool = crate::db::init_test_user_db().unwrap();
        assert_eq!(mark_processed(&pool, &[], "cyc_none").unwrap(), 0);
    }
}
