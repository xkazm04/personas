//! Self-contained Obsidian vault search for the MCP sidecar.
//!
//! The `personas-mcp` binary is a standalone crate root that does not include
//! the app's `commands` module (no Tauri, no `AppError`, no app `DbPool`), so
//! it cannot reuse `commands::obsidian_brain::graph`. This module reimplements
//! the vault walk over plain `std::fs`, so the sidecar can search the vault
//! filesystem directly. The scoring itself is shared with `graph.rs` through
//! `personas_core::utils::vault_search`.

use std::path::{Path, PathBuf};

pub struct NoteEntry {
    pub path: PathBuf,
    pub title: String,
    pub body: String,
}

/// Recursively collect `.md` notes under `vault_root` (skips dotfiles/dirs,
/// caps recursion depth). Read failures are skipped silently.
pub fn walk_vault(vault_root: &Path) -> Vec<NoteEntry> {
    fn walk(dir: &Path, out: &mut Vec<NoteEntry>, depth: u32) {
        if depth > 12 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                walk(&path, out, depth + 1);
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let body = match std::fs::read_to_string(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let title = name.trim_end_matches(".md").to_string();
            out.push(NoteEntry { path, title, body });
        }
    }
    let mut out = Vec::new();
    walk(vault_root, &mut out, 0);
    out
}

// Tokenizer, TF-IDF and snippet logic live in personas-core (shared with the
// app's graph search); only the vault walk is local to the sidecar.
pub use crate::utils::vault_search::{snippet_for, tokenize};

/// TF-IDF scores per note against the query terms (see
/// `personas_core::utils::vault_search::tfidf_scores`).
pub fn tfidf_scores(notes: &[NoteEntry], query_terms: &[String]) -> Vec<f32> {
    let docs: Vec<(&str, &str)> = notes
        .iter()
        .map(|n| (n.title.as_str(), n.body.as_str()))
        .collect();
    crate::utils::vault_search::tfidf_scores(&docs, query_terms)
}
