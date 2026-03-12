/// Collect rows from a query while logging row-mapping failures.
///
/// This keeps list endpoints resilient to individual corrupted rows and gives
/// enough context in logs to debug schema/data issues.
pub fn collect_rows<T>(
    rows: impl Iterator<Item = rusqlite::Result<T>>,
    context: &str,
) -> Vec<T> {
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
        tracing::warn!(context, skipped_count, "Skipped {skipped_count} rows due to mapping errors");
    }
    results
}
