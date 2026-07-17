//! Small shared helpers used across companion modules.
//!
//! Consolidates the id-generator that used to be re-defined (as
//! `short_random` / `short_uuid`, with inconsistent truncation lengths)
//! in `dispatcher.rs`, `dev_session.rs`, `session.rs`, `turn_ledger.rs`,
//! and `projects.rs`.

/// A short, non-cryptographic random id suffix: the hex digits of a v4
/// UUID, truncated to `len` characters. Used for turn ids, approval ids,
/// scratch-file names, and similar ephemeral/display identifiers — not
/// for anything requiring guaranteed global uniqueness at scale.
pub fn short_id(len: usize) -> String {
    uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(len)
        .collect()
}
