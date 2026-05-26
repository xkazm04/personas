//! Self-contained Obsidian vault search for the MCP sidecar.
//!
//! The `personas-mcp` binary is a standalone crate root that does not include
//! the app's `commands` module (no Tauri, no `AppError`, no app `DbPool`), so
//! it cannot reuse `commands::obsidian_brain::graph`. This module reimplements
//! the pure vault walk + smoothed-Robertson TF-IDF + snippet logic (mirroring
//! that file) over plain `std::fs`, so the sidecar can search the vault
//! filesystem directly. Keep behaviour in sync with `graph.rs` if it changes.

use std::collections::HashMap;
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

/// Lowercase alphanumeric/underscore tokenizer.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.extend(ch.to_lowercase());
        } else if !current.is_empty() {
            tokens.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// TF-IDF scores per note against the query terms. `idf` is the smoothed
/// Robertson form `ln((N+1)/(df+1)) + 1`; title hits get a flat +5 boost.
pub fn tfidf_scores(notes: &[NoteEntry], query_terms: &[String]) -> Vec<f32> {
    let doc_count = notes.len().max(1) as f32;
    let mut doc_freq: HashMap<String, u32> = HashMap::new();
    let tokenized: Vec<HashMap<String, u32>> = notes
        .iter()
        .map(|n| {
            let mut tf: HashMap<String, u32> = HashMap::new();
            for tok in tokenize(&n.body) {
                *tf.entry(tok).or_insert(0) += 1;
            }
            for tok in tf.keys() {
                *doc_freq.entry(tok.clone()).or_insert(0) += 1;
            }
            tf
        })
        .collect();

    let idf: HashMap<&String, f32> = query_terms
        .iter()
        .map(|term| {
            let df = *doc_freq.get(term).unwrap_or(&0) as f32;
            let val = ((doc_count + 1.0) / (df + 1.0)).ln() + 1.0;
            (term, val)
        })
        .collect();

    tokenized
        .iter()
        .enumerate()
        .map(|(i, tf)| {
            let title_lc = notes[i].title.to_lowercase();
            let mut score = 0.0_f32;
            for term in query_terms {
                let f = *tf.get(term).unwrap_or(&0) as f32;
                score += f * idf.get(term).copied().unwrap_or(0.0);
                if title_lc.contains(term) {
                    score += 5.0;
                }
            }
            score
        })
        .collect()
}

/// A short context snippet around the first match, UTF-8-boundary-safe.
pub fn snippet_for(body: &str, query_lc: &str) -> String {
    let body_lc = body.to_lowercase();
    let Some(pos) = body_lc.find(query_lc) else {
        return body.chars().take(160).collect();
    };
    let mut start = pos.saturating_sub(60);
    let mut end = (pos + query_lc.len() + 100).min(body.len());
    while start > 0 && !body.is_char_boundary(start) {
        start -= 1;
    }
    while end < body.len() && !body.is_char_boundary(end) {
        end += 1;
    }
    let mut s = body[start..end].replace('\n', " ");
    if start > 0 {
        s.insert_str(0, "…");
    }
    if end < body.len() {
        s.push('…');
    }
    s
}
