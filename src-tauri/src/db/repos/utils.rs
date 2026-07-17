/// Build a `?1, ?2, ..., ?N` placeholder list for a hand-rolled `IN (...)`
/// clause. For straightforward single-column bulk fetches, prefer
/// `QueryBuilder::where_in` (in `db::query_builder`), which also owns the
/// param boxing. This helper exists for the call sites that can't route
/// through `QueryBuilder` — e.g. the `IN` clause is combined with other raw
/// SQL text/params, or the same placeholder list is reused verbatim across
/// more than one clause in the same statement.
pub fn in_placeholders(n: usize) -> String {
    (0..n)
        .map(|i| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Escape SQL `LIKE` metacharacters (`\`, `%`, `_`) so a caller-supplied
/// string matches only literally when used with an `ESCAPE '\'` clause (e.g.
/// `QueryBuilder::where_like_escape`/`where_like_escape_any`, or a hand-rolled
/// `LIKE ?N ESCAPE '\\'`). Order matters: `\` must be escaped first so it
/// doesn't double-escape the `%`/`_` escapes introduced after it. Previously
/// hand-rolled identically in multiple repos (team_memories, settings) — hoist
/// here so the escaping rule lives in exactly one place.
pub fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Collect rows from a query while logging row-mapping failures.
///
/// This keeps list endpoints resilient to individual corrupted rows and gives
/// enough context in logs to debug schema/data issues.
pub fn collect_rows<T>(rows: impl Iterator<Item = rusqlite::Result<T>>, context: &str) -> Vec<T> {
    let mut results = Vec::new();
    let mut skipped_count = 0usize;
    for (idx, row_result) in rows.enumerate() {
        match row_result {
            Ok(item) => results.push(item),
            Err(e) => {
                tracing::warn!(
                    context = context,
                    row_index = idx,
                    error = %e,
                    "Failed to map database row"
                );
                skipped_count += 1;
            }
        }
    }
    if skipped_count > 0 {
        tracing::warn!(
            context,
            skipped_count,
            "Skipped {skipped_count} rows due to mapping errors"
        );
    }
    results
}
