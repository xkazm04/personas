//! Small primitives used by both the export and import halves.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// `'fact','procedural',…` — the learned kinds as a SQL literal list. Built
/// from the const so the query and the exporter can never disagree, and safe to
/// interpolate because every element is a compile-time literal.
pub(crate) fn athena_kind_list() -> String {
    ATHENA_LEARNED_KINDS
        .iter()
        .map(|k| format!("'{k}'"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Record a cap-truncation in the export's warning channel. Every `.take()` /
/// `break` in this module funnels through here — before it existed the caps
/// dropped data with no signal on either end while the import side hard-
/// rejected the very same overflow.
pub(crate) fn push_truncation_warning(
    warnings: &mut Vec<String>,
    what: &str,
    kept: usize,
    total: usize,
    context: &str,
) {
    if total <= kept {
        return;
    }
    warnings.push(format!(
        "{context}: kept {kept} of {total} {what}; {} dropped (export cap).",
        total - kept
    ));
}

/// A KPI is part of an exportable "setup" when it is actively measured or
/// paused — not a `proposed` review-queue suggestion or an `archived` retiree.
pub(crate) fn is_exportable_kpi(status: &str) -> bool {
    status == "active" || status == "paused"
}

/// Run a single-parameter query and collect the mapped rows. All dev-tools
/// collection queries key off one id (project or workspace), so this keeps
/// the two dozen table sweeps below from each re-spelling the same loop.
pub(crate) fn query_rows<T>(
    conn: &rusqlite::Connection,
    sql: &str,
    key: &str,
    map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, AppError> {
    let mut stmt = conn.prepare(sql).map_err(AppError::Database)?;
    let rows = stmt.query_map([key], map).map_err(AppError::Database)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(AppError::Database)?);
    }
    Ok(out)
}

// ============================================================================
// Athena memory export collection
// ============================================================================

/// Does this database have the companion schema at all? Very old installs (and
/// unit tests that only apply the knowledge-base schema) do not, and that is
/// "no Athena", not an error — same posture `collect_twin_exports` takes toward
/// a missing `twin_profiles`.
pub(crate) fn has_companion_schema(conn: &rusqlite::Connection) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='companion_node'",
        [],
        |_| Ok(()),
    )
    .is_ok()
}
