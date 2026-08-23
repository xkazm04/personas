pub mod sanitization;
pub mod text;

/// Milliseconds since the Unix epoch, saturating to 0 if the clock is before it.
///
/// Lives here because both the Fleet registry and `db::repos::fleet_sessions`
/// stamp rows with it, and those two ended up on opposite sides of the crate
/// split. Four lines of `SystemTime` arithmetic is not worth a dependency edge
/// from the data layer up into the command layer.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Extract a printable message from a panic payload returned by `catch_unwind`.
///
/// The job-registry commands all wrap their worker in `catch_unwind` so a panic
/// becomes a failed job rather than a dead runtime, and every one of them needed
/// the same three-line downcast to turn `Box<dyn Any>` into something a user can
/// read. That produced **26 byte-identical private copies** across
/// `commands/**` (measured 2026-08-22). This is the survivor; it depends on
/// nothing but `std`, so it belongs at the bottom of the crate graph where the
/// desktop, engine, and db crates can all reach it.
pub fn extract_panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&str>() {
        return s.to_string();
    }
    if let Some(s) = panic.downcast_ref::<String>() {
        return s.clone();
    }
    "unknown panic".to_string()
}
