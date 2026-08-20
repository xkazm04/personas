//! Refresh the per-context structural fingerprint cache (`dev_context_fingerprints`).
//!
//! **The point is that a scan becomes an investment rather than an expense.**
//! Before this, every scan re-read files to answer one question and threw the
//! reading away — a probe over this repo read 13,622 files to answer 6 questions
//! because `dev_contexts.category` (4 values) was the only metadata worth
//! routing on. This command extracts cheap deterministic facts ONCE
//! (`personas_core::context_fingerprint` — no LLM, no network) and caches them,
//! so later questions are SQL queries.
//!
//! Two caches do the work, and neither is recomputed unnecessarily:
//!   - `dev_context_file_hashes` (populated by the last scan) supplies per-file
//!     sha256, so this command does not re-hash unchanged files.
//!   - `dev_context_fingerprints.content_hash` covers a context's file LIST plus
//!     each file's sha256, so a context whose hash is unchanged is SKIPPED
//!     without reading a single one of its files.
//!
//! Contexts are read from the DB (`dev_contexts`), never from `context-map.json`
//! — a delta rescan may be rewriting that file concurrently.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use ts_rs::TS;

use personas_core::context_fingerprint::{fingerprint_files, Fingerprint};

use crate::db::models::DevContextFingerprint;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Per-file read cap. Generated bundles and minified assets blow past this and
/// carry no structural signal; mirrors `incremental_scan::MAX_FILE_BYTES`.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Hash component recorded for a mapped path that no longer exists on disk, so
/// a file appearing or disappearing changes the context's `content_hash`.
const MISSING_MARKER: &str = "\u{0}missing";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextFingerprintRefreshSummary {
    pub contexts_total: i32,
    pub contexts_refreshed: i32,
    /// Contexts whose `content_hash` matched the cached row — zero files read.
    pub contexts_skipped: i32,
    /// Files actually read from disk during this refresh.
    pub files_read: i32,
    /// Mapped `file_paths` entries that no longer exist on disk, summed over
    /// every context inspected. Reported rather than silently swallowed: ~13% of
    /// the live map is dangling, and that staleness must be visible.
    pub missing_files: i32,
}

/// One context's outcome from the blocking filesystem pass.
struct ContextWork {
    context_id: String,
    content_hash: String,
    file_count: i32,
    missing_file_count: i32,
    /// `None` when the context's `content_hash` was unchanged — nothing was read
    /// and nothing needs writing.
    fingerprint: Option<Fingerprint>,
    files_read: i32,
}

fn parse_file_paths(raw: &str) -> Vec<String> {
    let mut paths = serde_json::from_str::<Vec<String>>(raw).unwrap_or_default();
    // Sort + dedup so the hash is insensitive to pure reordering or a duplicate
    // entry in the map. Membership and content changes still invalidate it; a
    // rescan that merely shuffles `file_paths` does not force a needless re-read.
    paths.sort();
    paths.dedup();
    paths
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Hash a context's `(path, per-file sha256)` pairs into its `content_hash`.
/// Both halves are folded in, and the path is length-delimited by the `\0`
/// separators, so neither a membership change nor a content change can collide.
fn content_hash(components: &[(String, String)]) -> String {
    let mut hasher = Sha256::new();
    for (path, sha) in components {
        hasher.update(path.as_bytes());
        hasher.update([0u8]);
        hasher.update(sha.as_bytes());
        hasher.update([b'\n']);
    }
    hex::encode(hasher.finalize())
}

/// Blocking pass: stat/read only what is necessary, per context.
///
/// `cached_hashes` is the last scan's `{relative_path: sha256}` snapshot;
/// `existing` is `{context_id: content_hash}` from the previous fingerprint run.
fn refresh_blocking(
    root: &Path,
    contexts: &[(String, String)], // (context_id, file_paths JSON)
    cached_hashes: &HashMap<String, String>,
    existing: &HashMap<String, String>,
) -> Vec<ContextWork> {
    let mut out = Vec::with_capacity(contexts.len());

    for (context_id, raw_paths) in contexts {
        let paths = parse_file_paths(raw_paths);
        let mut components: Vec<(String, String)> = Vec::with_capacity(paths.len());
        // Contents read while hashing a cache-miss file, kept so the fingerprint
        // pass below never reads the same file twice.
        let mut preread: HashMap<String, String> = HashMap::new();
        let mut missing = 0i32;
        let mut files_read = 0i32;

        for path in &paths {
            let abs = root.join(path);
            // A stat, not a read: the file-hash cache is the last scan's
            // snapshot, so a file deleted since then is still IN the cache and
            // only the filesystem can say it is gone.
            let exists = abs.metadata().map(|m| m.is_file()).unwrap_or(false);
            if !exists {
                missing += 1;
                components.push((path.clone(), MISSING_MARKER.to_string()));
                continue;
            }

            match cached_hashes.get(path) {
                Some(sha) => components.push((path.clone(), sha.clone())),
                None => {
                    // Not in the cache (added since the last scan, or a
                    // non-source extension the scan skips). Hash it ourselves
                    // rather than leave a hole that would freeze the fingerprint.
                    match std::fs::read(&abs) {
                        Ok(bytes) if bytes.len() as u64 <= MAX_FILE_BYTES => {
                            files_read += 1;
                            components.push((path.clone(), sha256_hex(&bytes)));
                            preread
                                .insert(path.clone(), String::from_utf8_lossy(&bytes).into_owned());
                        }
                        Ok(_) => {
                            // Over the cap: recorded by size so growth still
                            // invalidates, but never read for content.
                            let size = abs.metadata().map(|m| m.len()).unwrap_or(0);
                            components.push((path.clone(), format!("\u{0}oversize:{size}")));
                        }
                        Err(_) => {
                            missing += 1;
                            components.push((path.clone(), MISSING_MARKER.to_string()));
                        }
                    }
                }
            }
        }

        let hash = content_hash(&components);
        let file_count = paths.len() as i32;

        if existing.get(context_id).is_some_and(|prev| prev == &hash) {
            out.push(ContextWork {
                context_id: context_id.clone(),
                content_hash: hash,
                file_count,
                missing_file_count: missing,
                fingerprint: None,
                files_read,
            });
            continue;
        }

        // Dirty: read whatever is still unread and fingerprint the contents.
        let mut files: Vec<(String, String)> = Vec::with_capacity(paths.len());
        for path in &paths {
            if let Some(contents) = preread.remove(path) {
                files.push((path.clone(), contents));
                continue;
            }
            let abs = root.join(path);
            match std::fs::metadata(&abs) {
                Ok(m) if m.is_file() && m.len() <= MAX_FILE_BYTES => {
                    if let Ok(bytes) = std::fs::read(&abs) {
                        files_read += 1;
                        files.push((path.clone(), String::from_utf8_lossy(&bytes).into_owned()));
                    }
                }
                _ => continue,
            }
        }

        out.push(ContextWork {
            context_id: context_id.clone(),
            content_hash: hash,
            file_count,
            missing_file_count: missing,
            fingerprint: Some(fingerprint_files(&files)),
            files_read,
        });
    }

    out
}

/// Refresh the fingerprint cache for one project, reading only the contexts
/// whose files changed. Returns what it did so a caller can see the saving.
#[tauri::command]
pub async fn dev_tools_refresh_context_fingerprints(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<ContextFingerprintRefreshSummary, AppError> {
    require_auth(&state).await?;

    let project = repo::get_project_by_id(&state.db, &project_id)?;
    let root = PathBuf::from(&project.root_path);

    // Contexts come from the DB, never from context-map.json — a delta rescan
    // may be rewriting that file right now.
    let contexts: Vec<(String, String)> =
        repo::list_contexts_by_project(&state.db, &project_id, None)?
            .into_iter()
            .map(|c| (c.id, c.file_paths))
            .collect();
    let cached_hashes = repo::get_file_hashes(&state.db, &project_id).unwrap_or_default();
    let existing = repo::get_context_fingerprint_hashes(&state.db, &project_id).unwrap_or_default();

    let contexts_total = contexts.len() as i32;

    let work = tokio::task::spawn_blocking(move || {
        refresh_blocking(&root, &contexts, &cached_hashes, &existing)
    })
    .await
    .map_err(|e| AppError::Internal(format!("fingerprint refresh join error: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut refreshed = 0i32;
    let mut skipped = 0i32;
    let mut files_read = 0i32;
    let mut missing_files = 0i32;

    for item in work {
        files_read += item.files_read;
        missing_files += item.missing_file_count;

        let Some(fp) = item.fingerprint else {
            skipped += 1;
            continue;
        };

        let row = DevContextFingerprint {
            project_id: project_id.clone(),
            context_id: item.context_id,
            content_hash: item.content_hash,
            file_count: item.file_count,
            missing_file_count: item.missing_file_count,
            imports: Some(serde_json::to_string(&fp.imports).unwrap_or_else(|_| "[]".to_string())),
            primitives: Some(
                serde_json::to_string(&fp.primitives).unwrap_or_else(|_| "[]".to_string()),
            ),
            promise_all_count: fp.promise_all_count,
            join_all_count: fp.join_all_count,
            await_count: fp.await_count,
            sql_write_count: fp.sql_write_count,
            spawn_count: fp.spawn_count,
            use_effect_count: fp.use_effect_count,
            set_state_after_await_count: fp.set_state_after_await_count,
            exports_components: fp.exports_components,
            exports_hooks: fp.exports_hooks,
            exports_commands: fp.exports_commands,
            exports_repo_fns: fp.exports_repo_fns,
            computed_at: now.clone(),
        };
        repo::upsert_context_fingerprint(&state.db, &row)?;
        refreshed += 1;
    }

    tracing::info!(
        project_id = %project_id,
        contexts_total,
        refreshed,
        skipped,
        files_read,
        missing_files,
        "Refreshed context fingerprints"
    );

    Ok(ContextFingerprintRefreshSummary {
        contexts_total,
        contexts_refreshed: refreshed,
        contexts_skipped: skipped,
        files_read,
        missing_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_paths_are_sorted_and_deduped() {
        let paths = parse_file_paths(r#"["b.rs","a.rs","b.rs"]"#);
        assert_eq!(paths, vec!["a.rs", "b.rs"]);
    }

    #[test]
    fn malformed_file_paths_degrade_to_empty() {
        assert!(parse_file_paths("not json").is_empty());
    }

    #[test]
    fn content_hash_is_membership_sensitive() {
        let a = vec![
            ("a.rs".to_string(), "1".to_string()),
            ("b.rs".to_string(), "2".to_string()),
        ];
        let mut more = a.clone();
        more.push(("c.rs".to_string(), "3".to_string()));
        assert_ne!(content_hash(&a), content_hash(&more));
    }

    /// `content_hash` itself is order-SENSITIVE; order-insensitivity comes from
    /// `parse_file_paths` sorting before the hash is built. Pinning both halves
    /// separately keeps that division of labour honest.
    #[test]
    fn order_insensitivity_comes_from_sorting_not_from_the_hash() {
        let a = vec![
            ("a.rs".to_string(), "1".to_string()),
            ("b.rs".to_string(), "2".to_string()),
        ];
        let mut reversed = a.clone();
        reversed.reverse();
        assert_ne!(content_hash(&a), content_hash(&reversed));

        assert_eq!(
            parse_file_paths(r#"["a.rs","b.rs"]"#),
            parse_file_paths(r#"["b.rs","a.rs"]"#),
            "the sort is what makes a pure reorder a no-op"
        );
    }

    #[test]
    fn content_hash_changes_when_a_file_sha_changes() {
        let a = vec![("a.rs".to_string(), "sha1".to_string())];
        let b = vec![("a.rs".to_string(), "sha2".to_string())];
        assert_ne!(content_hash(&a), content_hash(&b));
    }

    #[test]
    fn content_hash_separator_prevents_path_sha_collisions() {
        let a = vec![("ab".to_string(), "c".to_string())];
        let b = vec![("a".to_string(), "bc".to_string())];
        assert_ne!(content_hash(&a), content_hash(&b));
    }
}
