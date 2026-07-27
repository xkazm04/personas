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
