//! Cached location of the user's managed local-drive sandbox.
//!
//! Only the cache lives here. Resolving and creating the directory stays in
//! `commands::drive`, which owns the Tauri path resolution. Split out because
//! `engine::prompt` mentions the sandbox root when composing a system prompt,
//! and the prompt builder cannot depend on the command layer above it.

use std::path::PathBuf;
use std::sync::OnceLock;

static MANAGED_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// The managed root, if it has been resolved. `None` before first resolution.
pub fn get() -> Option<PathBuf> {
    MANAGED_ROOT.get().cloned()
}

/// Publish the resolved root. Later calls are ignored — first writer wins,
/// matching the `OnceLock` semantics this replaced.
pub fn set(root: PathBuf) -> PathBuf {
    MANAGED_ROOT.get_or_init(|| root).clone()
}
