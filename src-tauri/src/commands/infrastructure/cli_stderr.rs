//! Bounded ring buffer for captured Claude CLI stderr.
//!
//! Long-running CLI scans (idea scanner, context-map generation, ...) drain the
//! child process's stderr in a background task. Historically that stream was
//! read into a String that was immediately dropped, so when a scan failed (auth
//! error, rate limit, CLI crash) the user only saw an opaque "timed out after N
//! minutes" with zero diagnostic detail — even though the real cause was
//! printed to stderr within seconds.
//!
//! This module keeps the most recent ~32 KB of stderr in a shared buffer so the
//! tail can be appended to the `AppError` that the scan returns, turning
//! dead-end failures into actionable errors.

use std::sync::Mutex;

/// Maximum number of bytes retained in the stderr ring buffer.
pub const STDERR_RING_CAP: usize = 32 * 1024;

/// Append a line to a bounded ring buffer (drop oldest bytes when over cap).
pub fn push_stderr_line(buf: &Mutex<String>, line: &str) {
    if let Ok(mut s) = buf.lock() {
        s.push_str(line);
        if !line.ends_with('\n') {
            s.push('\n');
        }
        if s.len() > STDERR_RING_CAP {
            // Drop oldest bytes; align on a UTF-8 boundary so we don't
            // truncate mid-char.
            let drop = s.len() - STDERR_RING_CAP;
            let mut idx = drop;
            while idx < s.len() && !s.is_char_boundary(idx) {
                idx += 1;
            }
            s.drain(..idx);
        }
    }
}

/// Snapshot the captured stderr buffer for inclusion in error messages.
pub fn snapshot_stderr(buf: &Mutex<String>) -> String {
    buf.lock().map(|s| s.clone()).unwrap_or_default()
}
