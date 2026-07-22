//! Shared vault filesystem primitives — directory walking, wikilink
//! extraction, and vault-relative path formatting.
//!
//! Extracted (2026-07) from five near-identical directory walkers and three
//! near-identical wikilink extractors that had drifted across `graph.rs`,
//! `lint.rs`, `semantic_lint.rs`, `revitalize.rs`, and `drive.rs`. Each caller
//! had a *deliberately* different error policy and recursion-depth cap — this
//! module makes those differences explicit options (`WalkOptions`) instead of
//! silently unifying them, so porting a caller to the shared walker changes
//! zero observable behavior.

use std::path::{Path, PathBuf};

// ============================================================================
// Directory walk
// ============================================================================

/// How `walk_markdown_files` should react to a `read_dir` failure partway
/// through the walk (permission error, path removed mid-walk, etc).
///
/// The five original walkers split cleanly into two camps:
/// - `graph.rs`, `revitalize.rs`: best-effort — an unreadable subdirectory is
///   skipped and the walk continues (`SkipSilently`).
/// - `lint.rs`, `semantic_lint.rs`, `drive.rs`: fail the whole walk on the
///   first error via `?` propagation (`Abort`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorPolicy {
    /// Skip the unreadable directory and keep walking the rest of the tree.
    SkipSilently,
    /// Propagate the `read_dir` error immediately, aborting the whole walk.
    Abort,
}

/// Options controlling `walk_markdown_files`. Each caller sets these to match
/// its *current* behavior — see the per-field docs for which original walker
/// each default/override traces back to.
#[derive(Debug, Clone, Copy)]
pub struct WalkOptions {
    /// Maximum recursion depth (root = depth 0). `graph.rs`'s `walk_vault`
    /// capped at 12 as a symlink-loop / pathological-nesting backstop; that
    /// is the default here. The other four walkers had no cap — callers that
    /// want that (unbounded) behavior pass `u32::MAX`.
    pub max_depth: u32,
    /// What to do when a `read_dir` call fails. See [`ErrorPolicy`].
    pub on_error: ErrorPolicy,
    /// When true, dot-prefixed **files** (not just directories) are skipped.
    /// Only `graph.rs`'s original walker checked `name.starts_with('.')`
    /// before branching on file-vs-directory, so it excluded dot-files too.
    /// The other four walkers only ever tested the dot-prefix on
    /// directories, so a hidden `.md` file at the top level would still be
    /// collected by them. Default `false` preserves that majority behavior;
    /// `graph.rs` opts in with `true`.
    pub skip_hidden_files: bool,
}

impl Default for WalkOptions {
    fn default() -> Self {
        Self {
            max_depth: 12,
            on_error: ErrorPolicy::SkipSilently,
            skip_hidden_files: false,
        }
    }
}

impl WalkOptions {
    /// No recursion-depth cap (matches `lint.rs` / `semantic_lint.rs` /
    /// `drive.rs` / `revitalize.rs`, none of which capped depth).
    pub const UNBOUNDED_DEPTH: u32 = u32::MAX;
}

/// Recursively collect every `.md` file under `root`. Dot-prefixed
/// directories (`.obsidian`, `.trash`, `.git`, …) are always skipped —
/// every original walker agreed on that. Symlinks are not treated specially
/// (matches the original walkers, all of which used `Path::is_dir()`, which
/// follows symlinks); `max_depth` is the backstop against symlink loops.
pub fn walk_markdown_files(
    root: &Path,
    opts: &WalkOptions,
) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut out = Vec::new();
    walk_dir(root, &mut out, 0, opts)?;
    Ok(out)
}

fn walk_dir(
    dir: &Path,
    out: &mut Vec<PathBuf>,
    depth: u32,
    opts: &WalkOptions,
) -> Result<(), std::io::Error> {
    if depth > opts.max_depth {
        return Ok(());
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            return match opts.on_error {
                ErrorPolicy::Abort => Err(e),
                ErrorPolicy::SkipSilently => Ok(()),
            };
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false);
        if path.is_dir() {
            if is_hidden {
                continue;
            }
            walk_dir(&path, out, depth + 1, opts)?;
        } else {
            if opts.skip_hidden_files && is_hidden {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                out.push(path);
            }
        }
    }
    Ok(())
}

// ============================================================================
// Wikilink extraction
// ============================================================================

/// Pull every raw `[[...]]` payload out of `text` — e.g. `[[Foo|bar]]` yields
/// `"Foo|bar"`, `[[Baz#Section]]` yields `"Baz#Section"`. Aliases and section
/// refs are returned UNSTRIPPED; call [`strip_alias_and_section`] to
/// normalize. Works over a single line or a whole document — callers that
/// need line numbers (e.g. `lint.rs`, for `BrokenWikilink::line`) call this
/// per-line; callers that just need the vault-wide target set (e.g.
/// `semantic_lint.rs`) call it over the full note body.
///
/// Byte-scan implementation ported verbatim from `lint.rs::extract_wikilinks`
/// / `semantic_lint.rs::extract_wikilink_targets` (the two were already
/// byte-for-byte identical up to the alias/section stripping step, so there
/// was no real conflict to reconcile there — see `strip_alias_and_section`).
/// `graph.rs` used a regex (`\[\[([^\]\|#]+)(?:[#\|][^\]]*)?\]\]`) that
/// captured the ALREADY-stripped target directly; callers that want that
/// combined behavior should call `strip_alias_and_section` on each result.
pub fn extract_wikilinks(text: &str) -> Vec<String> {
    let mut links = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            let mut j = start;
            while j + 1 < bytes.len() {
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    if let Ok(s) = std::str::from_utf8(&bytes[start..j]) {
                        // Embed/transclude markers (`![[...]]`) are treated
                        // as references too — no special handling needed
                        // beyond the bracket scan.
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

/// Normalize a raw wikilink payload by stripping the alias (`Target|Alias`)
/// and section reference (`Target#Heading`), in that order, matching the
/// identical logic both `lint.rs` and `semantic_lint.rs` already used:
/// split on the first `|`, then split the remainder on the first `#`, then
/// trim. (`graph.rs`'s regex achieved the same result structurally by never
/// capturing past `|`/`#` in the first place.)
pub fn strip_alias_and_section(raw: &str) -> String {
    raw.split('|')
        .next()
        .unwrap_or(raw)
        .split('#')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_string()
}

// ============================================================================
// Path formatting
// ============================================================================

/// Format `path` relative to `root` as a forward-slash vault-relative string
/// (e.g. for display / storage keys). Falls back to `path` unchanged if it
/// isn't actually under `root`.
pub fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
        .replace('\\', "/")
}

// ============================================================================
// Tests
// ============================================================================

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

    // ── extract_wikilinks (moved from lint.rs) ─────────────────────────

    #[test]
    fn extract_basic_wikilink() {
        let links = extract_wikilinks("see [[Target]] for details");
        assert_eq!(links, vec!["Target".to_string()]);
    }

    #[test]
    fn extract_wikilink_with_alias_and_section() {
        let links = extract_wikilinks("[[Foo|bar]] and [[Baz#Section]]");
        assert_eq!(
            links,
            vec!["Foo|bar".to_string(), "Baz#Section".to_string()]
        );
    }

    #[test]
    fn extract_multiple_wikilinks_one_line() {
        let links = extract_wikilinks("[[A]] [[B]] [[C]]");
        assert_eq!(
            links,
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
    }

    // ── strip_alias_and_section (moved from semantic_lint.rs's dedup test,
    //    adapted to exercise extraction + stripping directly) ────────────

    #[test]
    fn strip_alias_and_section_variants() {
        assert_eq!(strip_alias_and_section("Target"), "Target");
        assert_eq!(strip_alias_and_section("Target|Alias"), "Target");
        assert_eq!(strip_alias_and_section("Target#Section"), "Target");
        assert_eq!(strip_alias_and_section("Target|Alias#weird"), "Target");
        assert_eq!(strip_alias_and_section("  Target  "), "Target");
    }

    #[test]
    fn extract_and_strip_dedup_like_semantic_lint() {
        let content = "[[A]] and [[B]] and [[A|alias]] and [[C#section]]";
        let mut out: Vec<String> = Vec::new();
        for raw in extract_wikilinks(content) {
            let target = strip_alias_and_section(&raw);
            if !target.is_empty() && !out.contains(&target) {
                out.push(target);
            }
        }
        assert_eq!(
            out,
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
    }

    // ── relative_path ────────────────────────────────────────────────

    #[test]
    fn relative_path_strips_root_and_normalizes_separators() {
        let root = Path::new("/vault");
        let path = Path::new("/vault/notes/a.md");
        assert_eq!(relative_path(root, path), "notes/a.md");
    }

    #[test]
    fn relative_path_falls_back_to_full_path_outside_root() {
        let root = Path::new("/vault");
        let path = Path::new("/elsewhere/a.md");
        assert_eq!(relative_path(root, path), path.display().to_string());
    }

    // ── walk_markdown_files ─────────────────────────────────────────────

    #[test]
    fn walk_collects_md_files_and_skips_dot_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(&root.join("a.md"), "a");
        write(&root.join("nested/b.md"), "b");
        write(&root.join(".obsidian/workspace.md"), "ignored");

        let files = walk_markdown_files(root, &WalkOptions::default()).unwrap();
        let names: Vec<String> = files
            .iter()
            .map(|p| relative_path(root, p))
            .collect();
        assert!(names.contains(&"a.md".to_string()));
        assert!(names.contains(&"nested/b.md".to_string()));
        assert!(!names.iter().any(|n| n.contains(".obsidian")));
    }

    #[test]
    fn walk_skip_hidden_files_option() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(&root.join(".hidden.md"), "hidden");
        write(&root.join("visible.md"), "visible");

        let default_opts = WalkOptions {
            skip_hidden_files: false,
            ..WalkOptions::default()
        };
        let with_default = walk_markdown_files(root, &default_opts).unwrap();
        assert_eq!(with_default.len(), 2);

        let strict_opts = WalkOptions {
            skip_hidden_files: true,
            ..WalkOptions::default()
        };
        let with_hidden_skipped = walk_markdown_files(root, &strict_opts).unwrap();
        assert_eq!(with_hidden_skipped.len(), 1);
    }

    #[test]
    fn walk_respects_max_depth() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(&root.join("l0.md"), "0");
        write(&root.join("d1/l1.md"), "1");
        write(&root.join("d1/d2/l2.md"), "2");

        let shallow = WalkOptions {
            max_depth: 1,
            ..WalkOptions::default()
        };
        let files = walk_markdown_files(root, &shallow).unwrap();
        let names: Vec<String> = files.iter().map(|p| relative_path(root, p)).collect();
        assert!(names.contains(&"l0.md".to_string()));
        assert!(names.contains(&"d1/l1.md".to_string()));
        assert!(!names.iter().any(|n| n.contains("l2.md")));
    }

    #[test]
    fn walk_abort_policy_propagates_read_dir_error() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("does-not-exist");

        let abort_opts = WalkOptions {
            on_error: ErrorPolicy::Abort,
            ..WalkOptions::default()
        };
        assert!(walk_markdown_files(&missing, &abort_opts).is_err());

        let skip_opts = WalkOptions {
            on_error: ErrorPolicy::SkipSilently,
            ..WalkOptions::default()
        };
        let result = walk_markdown_files(&missing, &skip_opts).unwrap();
        assert!(result.is_empty());
    }
}
