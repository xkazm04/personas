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

// ----------------------------------------------------------------------------
// Bundle-supplied paths
// ----------------------------------------------------------------------------
//
// A bundle names files by a path it chose, and the import re-anchors that path
// onto a directory on THIS machine. That makes every such string an untrusted
// input to a `join` + `create_dir_all` + `write`, so the rules live here once
// rather than being re-derived per domain.
//
// `Path::is_absolute()` is NOT one of those rules, and used alone it is a hole
// on Windows. `PathBuf::push` (which `join` calls) documents two ways an
// argument replaces the receiver:
//
//   * "if `path` has a root but no prefix, it replaces everything except for
//     the prefix (if any) of `self`" — so `\Users\me\...` escapes, and it is not
//     `is_absolute()` because on Windows that also demands a prefix (`C:\`,
//     `\\?\`, `\\server\share`);
//   * "if `path` has a prefix but no root, it replaces `self`" — so the
//     drive-relative `C:evil.bat` escapes too, and is likewise not absolute.
//
// Both shapes contain no `..`, so neither an `is_absolute()` test nor a `..`
// substring test sees them. The check below is structural instead: a safe path
// is a non-empty sequence of `/`-separated plain names, and nothing else.

/// One safe path segment — no separator of either flavour, no drive-letter
/// colon, never `.` / `..` / empty.
pub(crate) fn is_safe_rel_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains("..")
        && !s.contains(':')
}

/// A bundle-supplied path that is safe to re-anchor under a local root.
///
/// Forward slashes only: that is the single canonical form every exporter in
/// this module emits (`relative_brain_path` and the skill collector both
/// normalise `\` to `/`), so accepting a second form would only widen the
/// input space of a trust boundary for no gain.
pub(crate) fn is_safe_rel_path(rel: &str) -> bool {
    if rel.is_empty() || !rel.split('/').all(is_safe_rel_segment) {
        return false;
    }
    // Whatever the host platform's parser makes of the string, it must come
    // back as plain names — no `Prefix`, no `RootDir`, no `ParentDir`. The
    // segment test above already implies this today; keeping it means a future
    // loosening there cannot silently re-open the escape.
    std::path::Path::new(rel)
        .components()
        .all(|c| matches!(c, std::path::Component::Normal(_)))
}

/// True when a path is anchored somewhere — it carries a prefix (`C:`, `\\?\`,
/// `\\server\share`) or a root (`\...`, `/...`), or both. This is the property that
/// makes `PathBuf::push` discard the receiver; `is_absolute()` is the narrower
/// "prefix AND root" (on Windows) and misses the two half-anchored shapes.
pub(crate) fn is_anchored_path(p: &std::path::Path) -> bool {
    p.components().any(|c| {
        matches!(
            c,
            std::path::Component::Prefix(_) | std::path::Component::RootDir
        )
    })
}

/// Resolve `.` / `..` textually, without touching the filesystem. Used only to
/// compare a not-yet-created path against its intended root.
fn normalize_lexically(p: &std::path::Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Join a bundle-supplied relative path onto a local root, or `None` if the
/// result would not land inside it.
///
/// Defence in depth: validation runs `is_safe_rel_path` on the raw value at the
/// import boundary, but the value is *rewritten* between there and the write
/// (an id collision renames the file), so the boundary is re-asserted at the
/// syscall rather than trusted to survive the rewrite.
pub(crate) fn safe_join(root: &std::path::Path, rel: &str) -> Option<std::path::PathBuf> {
    if !is_safe_rel_path(rel) {
        return None;
    }
    let joined = root.join(rel);
    normalize_lexically(&joined)
        .starts_with(normalize_lexically(root))
        .then_some(joined)
}
