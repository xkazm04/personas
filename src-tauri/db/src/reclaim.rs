//! Giving deleted space back to the disk.
//!
//! A `DELETE` returns pages to SQLite's freelist, not to the filesystem, and
//! nothing in this codebase ever ran `VACUUM`. So retention could delete rows
//! and the file would never get smaller: on the operator's install
//! (2026-09-14) `personas.db` was 347 MB with **25,778 free pages (100.7 MB)**
//! sitting inside it, and fixing retention alone would only have turned dead
//! rows into more dead pages.
//!
//! # The choice: a threshold VACUUM, run where it is safe
//!
//! Measured on a copy of that database (same machine, SSD): after the traces,
//! events and FTS fixes the freelist held 165 MB; **`VACUUM` took 4.4 s and
//! took the file from 347 MB to 158 MB**, freelist 0.
//!
//! The alternative was `auto_vacuum = INCREMENTAL` plus a periodic
//! `PRAGMA incremental_vacuum`. It was declined because:
//!
//! - switching an existing database to it needs one full `VACUUM` anyway, so
//!   it does not remove the cost measured above, it only adds a second mechanism;
//! - `incremental_vacuum` only moves free pages to the end and truncates — it
//!   never defragments, so a heavily-churned file stays slow to scan;
//! - every page write then also maintains pointer-map pages, a permanent cost
//!   paid by every write to save a cost paid only after a large delete.
//!
//! A full `VACUUM` needs no other connection mid-statement and up to 2× the
//! file in free disk. Both are true at exactly one moment without any
//! coordination: inside `init_db`, after migrations and before the pool is
//! handed to the rest of the app. So [`reclaim_at_boot`] runs there, and only
//! when the freelist is large in absolute terms AND a meaningful share of the
//! file ([`BOOT_RECLAIM_POLICY`]) — a healthy install pays one `PRAGMA` read per
//! boot and nothing else. A failed `VACUUM` (full disk) rolls back on its own
//! and boot continues.
//!
//! [`reclaim`] is the same work on demand, for the Storage settings action; it
//! blocks writers for the length of the `VACUUM`, which is why it is a user act
//! with a dry-run preview and not a background job.
//!
//! A quarantined store is never rewritten: `VACUUM` rewrites every page, which
//! is the widest possible write against a file with damaged structure.

use std::time::Instant;

use rusqlite::Connection;

use personas_core::error::AppError;

/// Block and document counts of the `executions_fts` index, read from its
/// shadow tables: `(data_blocks, indexed_docs)`. `None` when the shadow tables
/// cannot be read (no FTS5, or a detached index).
pub fn search_index_stats(conn: &Connection) -> Option<(i64, i64)> {
    let blocks: i64 = conn
        .query_row("SELECT COUNT(*) AS n FROM executions_fts_data", [], |r| {
            r.get("n")
        })
        .ok()?;
    let docs: i64 = conn
        .query_row(
            "SELECT COUNT(*) AS n FROM executions_fts_docsize",
            [],
            |r| r.get("n"),
        )
        .ok()?;
    Some((blocks, docs))
}

/// Merge the executions search index down and drop the postings of deleted rows.
///
/// `executions_fts` is an external-content FTS5 index kept in step by the
/// `executions_fts_a{i,d,u}` triggers, and those triggers are correct — but an
/// FTS5 delete only appends a tombstone to a new segment. The deleted rows'
/// postings stay on disk until a merge happens to reach their segment, and a
/// bulk delete (a retention sweep, the Storage prune) never triggers one. On the
/// operator's install the index still held **17.9 MB in 4,411 blocks for five
/// documents** after executions went from 2,188 to 5. `optimize` merges every
/// segment into one and discards tombstoned postings: measured 17.9 MB → 32 KB
/// in 635 ms on a copy of that database.
///
/// Returns `Ok(false)` without touching the index when it is detached
/// (`executions_fts_stale` set): the boot rebuild owns a detached index, and a
/// merge is a write against a derived structure already known to be damaged.
pub fn optimize_search_index_on(conn: &Connection) -> Result<bool, AppError> {
    let stale: bool = conn
        .query_row(
            "SELECT 1 FROM app_settings WHERE key = ?1",
            [crate::settings_keys::EXECUTIONS_FTS_STALE],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if stale {
        return Ok(false);
    }
    conn.execute_batch("INSERT INTO executions_fts(executions_fts) VALUES('optimize');")?;
    Ok(true)
}

/// When a boot-time reclaim is worth its pause.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReclaimPolicy {
    /// The freelist must hold at least this many bytes.
    pub min_free_bytes: u64,
    /// ...and at least this share of the file.
    pub min_free_ratio: f64,
}

/// 64 MiB and a quarter of the file. The absolute floor keeps a small install
/// from ever paying a boot pause for a few megabytes; the ratio keeps a large,
/// busy install from vacuuming at every launch over routine churn. The
/// operator's install (100.7 MB free of 347 MB, 29%) crosses both; after the
/// reclaim it sits at 0 free and will not cross again until retention has
/// removed another quarter of the file.
pub const BOOT_RECLAIM_POLICY: ReclaimPolicy = ReclaimPolicy {
    min_free_bytes: 64 * 1024 * 1024,
    min_free_ratio: 0.25,
};

/// Below this many data blocks the FTS index is never called bloated — a small
/// index costs too little to be worth a merge.
const BLOAT_MIN_BLOCKS: i64 = 256;
/// A healthy `executions_fts` measured ~2 data blocks per document (4,411
/// blocks for 2,188 executions). The bloated one held 4,411 blocks for 5
/// documents. Sixteen per document sits far from both.
const BLOAT_BLOCKS_PER_DOC: i64 = 16;

/// Whether the executions search index holds far more blocks than its
/// documents need — the residue of a bulk delete no merge has reached.
pub fn search_index_is_bloated(blocks: i64, docs: i64) -> bool {
    blocks > BLOAT_MIN_BLOCKS && blocks > docs.max(1) * BLOAT_BLOCKS_PER_DOC
}

/// Where the bytes in the main database file are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SpaceEstimate {
    pub page_size: u64,
    /// `page_count × page_size` — the main file, excluding the WAL.
    pub database_bytes: u64,
    /// `freelist_count × page_size` — what a `VACUUM` gives back at least.
    pub free_bytes: u64,
    pub search_index_blocks: i64,
    pub search_index_docs: i64,
}

impl SpaceEstimate {
    pub fn search_index_bloated(&self) -> bool {
        search_index_is_bloated(self.search_index_blocks, self.search_index_docs)
    }

    pub fn free_ratio(&self) -> f64 {
        if self.database_bytes == 0 {
            0.0
        } else {
            self.free_bytes as f64 / self.database_bytes as f64
        }
    }

    pub fn meets(&self, policy: &ReclaimPolicy) -> bool {
        self.free_bytes >= policy.min_free_bytes && self.free_ratio() >= policy.min_free_ratio
    }
}

fn pragma_u64(conn: &Connection, pragma: &str) -> Result<u64, AppError> {
    // A pragma's single result column is named after the pragma itself.
    let value: i64 = conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get(pragma))?;
    Ok(value.max(0) as u64)
}

/// Read the space picture. Cheap: three pragma reads and two `COUNT(*)`s over
/// the FTS shadow tables.
pub fn estimate(conn: &Connection) -> Result<SpaceEstimate, AppError> {
    let page_size = pragma_u64(conn, "page_size")?;
    let page_count = pragma_u64(conn, "page_count")?;
    let freelist = pragma_u64(conn, "freelist_count")?;
    let (search_index_blocks, search_index_docs) = search_index_stats(conn).unwrap_or((0, 0));
    Ok(SpaceEstimate {
        page_size,
        database_bytes: page_count.saturating_mul(page_size),
        free_bytes: freelist.saturating_mul(page_size),
        search_index_blocks,
        search_index_docs,
    })
}

/// What a reclaim did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReclaimOutcome {
    pub before: SpaceEstimate,
    pub after: SpaceEstimate,
    pub optimized_search_index: bool,
    pub vacuumed: bool,
    pub elapsed_ms: u64,
}

impl ReclaimOutcome {
    pub fn reclaimed_bytes(&self) -> u64 {
        self.before
            .database_bytes
            .saturating_sub(self.after.database_bytes)
    }
}

fn truncate_wal(conn: &Connection) {
    // In WAL mode the rewritten pages land in the WAL first; the main file
    // only shrinks once they are checkpointed back. Best-effort: a reader
    // holding an old snapshot makes this partial, never wrong.
    if let Err(e) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        tracing::debug!(error = %e, "wal checkpoint after reclaim did not complete");
    }
}

/// Merge a bloated search index, then `VACUUM` and truncate the WAL —
/// unconditionally. The on-demand form, for the Storage settings action.
pub fn reclaim(conn: &Connection) -> Result<ReclaimOutcome, AppError> {
    if crate::damage::is_connection_quarantined(conn) {
        return Err(AppError::Validation(
            "The database is quarantined; reclaiming space rewrites every page and stays \
             refused until the store is restored"
                .into(),
        ));
    }
    let started = Instant::now();
    let before = estimate(conn)?;
    let optimized_search_index = if before.search_index_bloated() {
        optimize_search_index_on(conn)?
    } else {
        false
    };
    conn.execute_batch("VACUUM;")?;
    truncate_wal(conn);
    let after = estimate(conn)?;
    let outcome = ReclaimOutcome {
        before,
        after,
        optimized_search_index,
        vacuumed: true,
        elapsed_ms: started.elapsed().as_millis() as u64,
    };
    tracing::info!(
        before_bytes = outcome.before.database_bytes,
        after_bytes = outcome.after.database_bytes,
        optimized_search_index,
        elapsed_ms = outcome.elapsed_ms,
        "Database space reclaimed on request"
    );
    Ok(outcome)
}

/// The boot-time reclaim: merge a bloated search index, then `VACUUM` only if
/// the freelist crosses `policy`. Never fails boot — every error is logged and
/// the store is left as it was. Returns `None` when nothing was done.
pub(crate) fn reclaim_at_boot(conn: &Connection, policy: &ReclaimPolicy) -> Option<ReclaimOutcome> {
    let started = Instant::now();
    let before = match estimate(conn) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = %e, "Boot space check skipped — could not read page counts");
            return None;
        }
    };

    let mut current = before;
    let mut optimized_search_index = false;
    if before.search_index_bloated() {
        match optimize_search_index_on(conn) {
            Ok(ran) => {
                optimized_search_index = ran;
                if let Ok(e) = estimate(conn) {
                    current = e;
                }
            }
            Err(e) => tracing::warn!(error = %e, "Boot executions_fts optimize failed (non-fatal)"),
        }
    }

    if !current.meets(policy) {
        if !optimized_search_index {
            return None;
        }
        tracing::info!(
            blocks_before = before.search_index_blocks,
            blocks_after = current.search_index_blocks,
            "Merged a bloated executions_fts index at boot"
        );
        return Some(ReclaimOutcome {
            before,
            after: current,
            optimized_search_index,
            vacuumed: false,
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    }

    tracing::info!(
        database_bytes = current.database_bytes,
        free_bytes = current.free_bytes,
        "Reclaiming free space at boot (VACUUM) — the freelist crossed its threshold"
    );
    if let Err(e) = conn.execute_batch("VACUUM;") {
        tracing::warn!(
            error = %e,
            "Boot VACUUM failed (non-fatal) — the store is unchanged; boot continues"
        );
        return None;
    }
    truncate_wal(conn);
    let after = estimate(conn).unwrap_or(current);
    let outcome = ReclaimOutcome {
        before,
        after,
        optimized_search_index,
        vacuumed: true,
        elapsed_ms: started.elapsed().as_millis() as u64,
    };
    tracing::info!(
        before_bytes = outcome.before.database_bytes,
        after_bytes = outcome.after.database_bytes,
        reclaimed_bytes = outcome.reclaimed_bytes(),
        elapsed_ms = outcome.elapsed_ms,
        "Boot VACUUM complete"
    );
    Some(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PoolExt;

    const MIB: u64 = 1024 * 1024;

    /// Fill and then delete ~16 MB of rows, leaving it all on the freelist.
    fn churn(conn: &Connection) {
        let blob = "x".repeat(16 * 1024);
        for i in 0..1000 {
            conn.execute(
                "INSERT INTO execution_traces (id, execution_id, trace_id, persona_id, spans)
                 VALUES (?1, 'e-churn', 't', 'p', ?2)",
                rusqlite::params![format!("churn-{i}"), blob],
            )
            .unwrap();
        }
        conn.execute(
            "DELETE FROM execution_traces WHERE execution_id = 'e-churn'",
            [],
        )
        .unwrap();
    }

    #[test]
    fn boot_reclaim_vacuums_past_the_threshold_and_leaves_the_file_alone_below_it() {
        let pool = crate::init_test_db().unwrap();
        let conn = pool.conn("reclaim::tests").unwrap();
        churn(&conn);
        let before = estimate(&conn).unwrap();
        assert!(
            before.free_bytes >= 8 * MIB,
            "deletes leave pages on the freelist: {before:?}"
        );

        // The control: a policy the freelist does not cross rewrites nothing.
        let unmet = ReclaimPolicy {
            min_free_bytes: 1 << 40,
            min_free_ratio: 0.0,
        };
        assert!(reclaim_at_boot(&conn, &unmet).is_none());
        assert_eq!(estimate(&conn).unwrap().free_bytes, before.free_bytes);

        let met = ReclaimPolicy {
            min_free_bytes: MIB,
            min_free_ratio: 0.01,
        };
        let outcome =
            reclaim_at_boot(&conn, &met).expect("past the threshold the store is vacuumed");
        assert!(outcome.vacuumed);
        assert_eq!(outcome.after.free_bytes, 0, "{outcome:?}");
        assert!(
            outcome.after.database_bytes + 8 * MIB <= before.database_bytes,
            "the file must actually shrink: {outcome:?}"
        );
    }

    #[test]
    fn bloat_heuristic_separates_the_measured_healthy_and_bloated_indexes() {
        assert!(
            !search_index_is_bloated(4_411, 2_188),
            "healthy: ~2 blocks per doc"
        );
        assert!(
            search_index_is_bloated(4_411, 5),
            "bloated: 882 blocks per doc"
        );
        assert!(
            !search_index_is_bloated(100, 0),
            "a tiny index is never worth a merge"
        );
    }
}
