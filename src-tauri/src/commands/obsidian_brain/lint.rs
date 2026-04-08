//! Vault lint — knowledge integrity check.
//!
//! Inspired by Karpathy's LLM knowledge base setup (research run 2026-04-08):
//! the wiki/vault is treated like source code, with a lint pass that catches
//! stale notes, broken wikilinks, and orphans before they erode trust in the
//! knowledge base. Pure read-only — never mutates the vault.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use crate::db::models::{BrokenWikilink, OrphanNote, StaleNote, VaultLintReport};
use crate::error::AppError;

/// A note older than this many days with no recent edits is considered stale.
/// Configurable by the caller; this is the default the IPC command exposes.
pub const DEFAULT_STALE_DAYS: i64 = 180;

/// Run the lint over a vault directory.
///
/// `stale_days`: notes whose mtime is older than now - stale_days are reported.
/// Pass 0 to skip stale detection entirely.
pub fn lint_vault(vault_path: &Path, stale_days: i64) -> Result<VaultLintReport, AppError> {
    if !vault_path.exists() || !vault_path.is_dir() {
        return Err(AppError::Validation(format!(
            "Vault path does not exist or is not a directory: {}",
            vault_path.display()
        )));
    }

    // Collect every .md file in the vault.
    let notes = collect_markdown_files(vault_path)?;

    // Build a name → relative-path index for wikilink resolution.
    // Obsidian wikilinks reference notes by their basename (without .md), so
    // we key on the lowercase basename and stash the full relative path.
    let mut basename_index: HashMap<String, PathBuf> = HashMap::new();
    for note in &notes {
        if let Some(stem) = note.file_stem().and_then(|s| s.to_str()) {
            basename_index
                .entry(stem.to_lowercase())
                .or_insert_with(|| note.clone());
        }
    }

    // Track which notes are referenced from somewhere — anything not in this
    // set after the scan is an orphan.
    let mut referenced: HashSet<PathBuf> = HashSet::new();

    let mut broken: Vec<BrokenWikilink> = Vec::new();
    let mut stale: Vec<StaleNote> = Vec::new();

    let now = Utc::now();
    let stale_cutoff = if stale_days > 0 {
        Some(now - chrono::Duration::days(stale_days))
    } else {
        None
    };

    for note in &notes {
        // Stale check via mtime
        if let Some(cutoff) = stale_cutoff {
            if let Ok(meta) = std::fs::metadata(note) {
                if let Ok(modified) = meta.modified() {
                    let modified_dt: DateTime<Utc> = modified.into();
                    if modified_dt < cutoff {
                        let days_stale = (now - modified_dt).num_days();
                        stale.push(StaleNote {
                            path: relative_path(vault_path, note),
                            last_modified: modified_dt.to_rfc3339(),
                            days_stale,
                        });
                    }
                }
            }
        }

        // Wikilink check — read the file, scan for `[[target]]` references.
        let content = match std::fs::read_to_string(note) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_idx, line) in content.lines().enumerate() {
            for link in extract_wikilinks(line) {
                // Strip aliases (`[[Target|Alias]]` → `Target`) and
                // section refs (`[[Target#Heading]]` → `Target`).
                let target = link
                    .split('|')
                    .next()
                    .unwrap_or(&link)
                    .split('#')
                    .next()
                    .unwrap_or(&link)
                    .trim()
                    .to_string();

                if target.is_empty() {
                    continue;
                }

                let key = target.to_lowercase();
                if let Some(target_path) = basename_index.get(&key) {
                    referenced.insert(target_path.clone());
                } else {
                    broken.push(BrokenWikilink {
                        source_path: relative_path(vault_path, note),
                        target,
                        line: (line_idx + 1) as i64,
                    });
                }
            }
        }
    }

    // Orphans: notes not referenced from anywhere AND not at the top level
    // (top-level "index"-style notes are commonly entry points and shouldn't
    // be flagged). We also exclude anything inside a folder named like an
    // index/inbox/00 prefix as a coarse heuristic.
    let orphans: Vec<OrphanNote> = notes
        .iter()
        .filter(|n| !referenced.contains(*n))
        .filter(|n| !is_likely_entry_point(vault_path, n))
        .map(|n| OrphanNote {
            path: relative_path(vault_path, n),
        })
        .collect();

    Ok(VaultLintReport {
        vault_path: vault_path.display().to_string(),
        scanned_count: notes.len() as i64,
        stale_notes: stale,
        broken_wikilinks: broken,
        orphans,
        generated_at: now.to_rfc3339(),
    })
}

/// Recursively collect every `.md` file under `root`, skipping `.obsidian/`,
/// `.trash/`, and any dot-directory.
fn collect_markdown_files(root: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut out = Vec::new();
    walk(root, &mut out)?;
    Ok(out)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), AppError> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::Internal(format!("read_dir failed for {}: {e}", dir.display())))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Skip dot-directories (.obsidian, .trash, .git, etc.)
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }
            walk(&path, out)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            out.push(path);
        }
    }
    Ok(())
}

/// Pull every `[[link target]]` out of a line. Tolerates aliases (`[[A|B]]`)
/// and section refs (`[[A#Heading]]`); the caller normalizes those.
fn extract_wikilinks(line: &str) -> Vec<String> {
    let mut links = Vec::new();
    let bytes = line.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            // Find the matching `]]`.
            let start = i + 2;
            let mut j = start;
            while j + 1 < bytes.len() {
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    if let Ok(s) = std::str::from_utf8(&bytes[start..j]) {
                        // Skip embed/transclude markers (`![[…]]`) — Obsidian
                        // treats them as references too, which is what we want;
                        // no special handling needed beyond the bracket scan.
                        if !s.is_empty() {
                            links.push(s.to_string());
                        }
                    }
                    i = j + 2;
                    break;
                }
                j += 1;
            }
            if j + 1 >= bytes.len() {
                break;
            }
        } else {
            i += 1;
        }
    }
    links
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
        .replace('\\', "/")
}

/// Heuristic for "this note is probably an entry point and shouldn't be
/// flagged as orphan even if nothing wikilinks to it":
/// - top-level (no parent folder inside the vault), OR
/// - filename is `README`, `index`, or starts with `00 ` / `_index`.
fn is_likely_entry_point(vault_root: &Path, note: &Path) -> bool {
    let rel = match note.strip_prefix(vault_root) {
        Ok(r) => r,
        Err(_) => return false,
    };
    if rel.components().count() <= 1 {
        return true;
    }
    if let Some(stem) = note.file_stem().and_then(|s| s.to_str()) {
        let lower = stem.to_lowercase();
        if lower == "readme" || lower == "index" || lower.starts_with("00 ") || lower == "_index" {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn extract_basic_wikilink() {
        let links = extract_wikilinks("see [[Target]] for details");
        assert_eq!(links, vec!["Target".to_string()]);
    }

    #[test]
    fn extract_wikilink_with_alias_and_section() {
        let links = extract_wikilinks("[[Foo|bar]] and [[Baz#Section]]");
        assert_eq!(links, vec!["Foo|bar".to_string(), "Baz#Section".to_string()]);
    }

    #[test]
    fn extract_multiple_wikilinks_one_line() {
        let links = extract_wikilinks("[[A]] [[B]] [[C]]");
        assert_eq!(links, vec!["A".to_string(), "B".to_string(), "C".to_string()]);
    }

    #[test]
    fn lint_detects_broken_wikilink() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // Create the .obsidian marker so a future test_connection wouldn't reject it.
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        write(&root.join("a.md"), "links to [[ghost]]\n");
        write(&root.join("b.md"), "no links here\n");

        let report = lint_vault(root, 0).unwrap();
        assert_eq!(report.broken_wikilinks.len(), 1);
        assert_eq!(report.broken_wikilinks[0].target, "ghost");
        assert_eq!(report.scanned_count, 2);
    }

    #[test]
    fn lint_detects_orphan_but_not_entry_point() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(&root.join("README.md"), "top-level entry\n");
        write(&root.join("notes/lonely.md"), "no one links here\n");
        write(&root.join("notes/popular.md"), "links [[lonely]]\n");

        let report = lint_vault(root, 0).unwrap();
        // README is a top-level entry point → not orphan.
        // popular is referenced from nothing but is at depth 2 → flagged.
        // lonely is referenced from popular → not orphan.
        let orphan_paths: Vec<&str> =
            report.orphans.iter().map(|o| o.path.as_str()).collect();
        assert!(orphan_paths.contains(&"notes/popular.md"));
        assert!(!orphan_paths.iter().any(|p| p.contains("README")));
        assert!(!orphan_paths.iter().any(|p| p.contains("lonely")));
    }

    #[test]
    fn lint_resolves_wikilink_case_insensitive() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(&root.join("Target.md"), "I am the target\n");
        write(&root.join("source.md"), "ref [[target]]\n");

        let report = lint_vault(root, 0).unwrap();
        assert!(report.broken_wikilinks.is_empty());
    }
}
