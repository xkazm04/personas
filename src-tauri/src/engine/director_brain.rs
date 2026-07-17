//! Director ↔ Obsidian Brain bridge.
//!
//! When `director.brain_enabled` is on AND a vault is configured, the Director
//! turns its rendered review into durable long-term memory:
//!
//!   - [`read_brain_history`] folds the persona's most recent Director notes
//!     into the evaluator's payload before a review;
//!   - [`write_brain_note`] persists the new review back into the vault under
//!     a `Director/<persona>/` folder after.
//!
//! Plain `std::fs` + the `obsidian_brain::mirror_*` helpers — no embeddings,
//! works in the lite build, fully best-effort (a vault failure never breaks
//! a review).
//!
//! Extracted out of `engine::director` in v2 so the gating + filesystem code
//! stays out of the evaluator's main pipeline.
//!
//! Used by `engine::director::evaluate_with_llm`; visibility kept at
//! `pub(super)` for the engine module.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::db::repos::core::settings;
use crate::db::settings_keys::DIRECTOR_BRAIN_ENABLED;
use crate::db::DbPool;

/// Max per-persona Director note files kept on disk before the oldest are
/// rolled into the rolling digest. Bounds the folder so it stays browsable and
/// the "3 newest" read window keeps meaning something, while the digest
/// preserves long-term signal that would otherwise be lost to compaction.
const MAX_NOTES_PER_PERSONA: usize = 12;

/// How many of the newest notes the evaluator folds into its payload verbatim.
const READ_WINDOW: usize = 3;

/// Filename (inside a persona's `Director/<slug>/` folder) of the rolling
/// digest that accumulates condensed one-line summaries of compacted notes.
/// Leading underscore keeps it visually distinct and it is deliberately
/// excluded from the "note" scans so it is never re-read as a review or
/// re-compacted into itself.
const DIGEST_FILENAME: &str = "_digest.md";

/// Vault-relative folder for a persona's Director notes, e.g. `Director/My-Bot`.
/// Non-alphanumerics in the persona name collapse to `-` so the path is safe
/// across Windows + Unix and stays predictable for users browsing the vault.
pub(super) fn director_vault_folder(persona_name: &str) -> String {
    let slug: String = persona_name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    format!("Director/{}", slug.trim_matches('-'))
}

/// True when the Director may use the Brain vault: the setting is on AND a
/// vault is configured. Both signals are required — if either is missing we
/// skip the read/write so the evaluator behaves identically to the no-brain
/// case.
pub(crate) fn brain_enabled(pool: &DbPool) -> bool {
    let on = matches!(
        settings::get(pool, DIRECTOR_BRAIN_ENABLED),
        Ok(Some(v)) if v == "true"
    );
    on && crate::commands::obsidian_brain::mirror_vault_root(pool).is_some()
}

/// List a persona folder's Director note files (excluding the rolling digest),
/// sorted oldest → newest by modification time.
///
/// Sort by actual mtime, not filename. Director notes are timestamp-named today
/// (so a lexicographic sort happens to be chronological), but a manually-added
/// or differently-named note in this folder would make ordering wrong. mtime is
/// correct regardless of naming. The digest (`_digest.md`) is filtered out so it
/// is neither read as a review nor rolled into itself.
fn list_note_files(dir: &Path) -> Vec<(SystemTime, PathBuf)> {
    let mut files: Vec<(SystemTime, PathBuf)> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("md"))
            .filter(|p| p.file_name().and_then(|s| s.to_str()) != Some(DIGEST_FILENAME))
            .filter_map(|p| {
                let mtime = std::fs::metadata(&p).and_then(|m| m.modified()).ok()?;
                Some((mtime, p))
            })
            .collect(),
        Err(_) => return Vec::new(),
    };
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}

/// Deterministically condense one review note into a single digest entry:
/// a dated line carrying the score header, followed by the coaching verdict
/// titles. No LLM — a pure extraction from the rendered markdown so long-term
/// signal (when a persona was scored low, and on what) survives compaction.
fn condense_note(path: &Path, body: &str) -> String {
    let date = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");
    // The first `## Director review — …` line carries the stars + score (or the
    // unscored marker). Strip leading `#`/space so it reads as a bullet.
    let score_line = body
        .lines()
        .find(|l| l.trim_start().starts_with("## Director review"))
        .map(|l| l.trim_start().trim_start_matches('#').trim())
        .unwrap_or("(no score recorded)");
    // Coaching verdict titles are rendered as `#### {title} _(sev · cat)_`.
    let titles: Vec<String> = body
        .lines()
        .filter_map(|l| l.strip_prefix("#### "))
        .map(|t| t.split(" _(").next().unwrap_or(t).trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let mut entry = format!("- **{date}** — {score_line}\n");
    for t in titles {
        entry.push_str(&format!("  - {t}\n"));
    }
    entry
}

/// Enforce the per-persona note cap: roll every note beyond
/// [`MAX_NOTES_PER_PERSONA`] (oldest first) into the rolling digest, then delete
/// the source files. **Order matters:** the digest is written to disk BEFORE any
/// source is deleted, and a note is only deleted once its condensed entry is in
/// the digest — so a mid-way failure can never destroy a review that wasn't
/// preserved first. A note that fails to read is left in place (retried on the
/// next write). Existing over-cap vaults migrate lazily: the first write after
/// this ships rolls their whole backlog down to the cap.
fn compact_notes(dir: &Path) -> std::io::Result<()> {
    let files = list_note_files(dir);
    if files.len() <= MAX_NOTES_PER_PERSONA {
        return Ok(());
    }
    let overflow = files.len() - MAX_NOTES_PER_PERSONA;
    let digest_path = dir.join(DIGEST_FILENAME);

    let mut digest = std::fs::read_to_string(&digest_path).unwrap_or_default();
    if digest.trim().is_empty() {
        digest = String::from("# Director digest — rolled-up older reviews\n\n");
    }

    let mut to_delete: Vec<&PathBuf> = Vec::new();
    for (_, path) in files.iter().take(overflow) {
        match std::fs::read_to_string(path) {
            Ok(body) => {
                digest.push_str(&condense_note(path, &body));
                to_delete.push(path);
            }
            // Unreadable now — leave it; a later compaction will retry.
            Err(_) => continue,
        }
    }

    if to_delete.is_empty() {
        return Ok(());
    }
    // Preserve first…
    std::fs::write(&digest_path, digest.as_bytes())?;
    // …then delete the now-digested sources.
    for path in to_delete {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// Assemble the evaluator's brain history for a persona folder: the
/// [`READ_WINDOW`] newest note bodies verbatim, then the rolling digest when
/// present. Recent notes lead so, under the caller's 4000-char truncation, the
/// freshest coaching is what survives; the digest (condensed, long-term) trails.
/// Returns `None` when there is neither a recent note nor a digest.
fn read_history_from_dir(dir: &Path) -> Option<String> {
    let files = list_note_files(dir);
    let recent: Vec<String> = files
        .iter()
        .rev()
        .take(READ_WINDOW)
        .filter_map(|(_, p)| std::fs::read_to_string(p).ok())
        .collect();
    let digest = std::fs::read_to_string(dir.join(DIGEST_FILENAME))
        .ok()
        .filter(|s| !s.trim().is_empty());

    if recent.is_empty() && digest.is_none() {
        return None;
    }
    let mut out = recent.join("\n\n---\n\n");
    if let Some(d) = digest {
        if !out.is_empty() {
            out.push_str("\n\n---\n\n");
        }
        out.push_str("## Older reviews (rolled-up digest)\n\n");
        out.push_str(d.trim());
    }
    Some(out)
}

/// Read the persona's Director brain history from the vault: the 3 most recent
/// notes plus the rolling digest of older reviews. Plain `std::fs` (no
/// embeddings); best-effort. Returns `None` if no vault, no folder, or no
/// history. The caller applies the 4000-char truncation to the result.
pub(crate) fn read_brain_history(pool: &DbPool, persona_name: &str) -> Option<String> {
    let cfg = crate::commands::obsidian_brain::mirror_vault_root(pool)?;
    let dir = Path::new(&cfg.vault_path).join(director_vault_folder(persona_name));
    read_history_from_dir(&dir)
}

/// Write the Director's review note into the vault as durable memory (best-
/// effort). Logs + swallows write errors — the Director run must succeed even
/// if the vault is temporarily unavailable.
pub(super) fn write_brain_note(
    pool: &DbPool,
    persona_id: &str,
    persona_name: &str,
    review_md: &str,
) {
    let Some(cfg) = crate::commands::obsidian_brain::mirror_vault_root(pool) else {
        return;
    };
    let folder = director_vault_folder(persona_name);
    let rel = format!(
        "{}/{}.md",
        folder,
        chrono::Utc::now().format("%Y-%m-%d-%H%M%S")
    );
    if let Err(e) = crate::commands::obsidian_brain::mirror_write_note(
        pool,
        &cfg.vault_path,
        &rel,
        "director_verdict",
        persona_id,
        review_md,
    ) {
        tracing::warn!(error = %e, persona = %persona_id, "Director: failed to write Brain note");
        return;
    }

    // Enforce the per-persona cap: roll notes beyond the cap into the rolling
    // digest and delete the sources (best-effort; a compaction failure never
    // breaks the review — the note we just wrote is already durable).
    let dir = Path::new(&cfg.vault_path).join(&folder);
    if let Err(e) = compact_notes(&dir) {
        tracing::warn!(error = %e, persona = %persona_id, "Director: Brain note compaction failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn folder_slugifies_non_alphanumerics() {
        assert_eq!(director_vault_folder("My Bot 2.0!"), "Director/My-Bot-2-0");
        assert_eq!(director_vault_folder("plain"), "Director/plain");
        assert_eq!(director_vault_folder("---weird---"), "Director/weird");
    }

    /// Write a note file with a filename that sorts (and mtimes) chronologically
    /// for a given ordinal. Returns its path.
    fn write_note(dir: &Path, ordinal: usize, body: &str) -> std::path::PathBuf {
        let p = dir.join(format!("2026-01-{:02}-000000.md", ordinal + 1));
        fs::write(&p, body).unwrap();
        // Stagger mtimes so ordering is deterministic regardless of FS clock
        // granularity: older ordinals get older mtimes.
        let mtime = std::time::SystemTime::UNIX_EPOCH
            + std::time::Duration::from_secs(1_700_000_000 + ordinal as u64 * 60);
        filetime_set(&p, mtime);
        p
    }

    // Minimal mtime setter without pulling in the `filetime` crate: re-write is
    // cheap and `set_modified` is stable since Rust 1.75 via `File::set_modified`.
    fn filetime_set(path: &Path, t: std::time::SystemTime) {
        let f = fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_modified(t).unwrap();
    }

    fn sample_review(score: usize, titles: &[&str]) -> String {
        let stars: String = "★".repeat(score) + &"☆".repeat(5 - score);
        let mut md = format!("## Director review — {stars} ({score}/5)\n\nSummary line.\n\n");
        if !titles.is_empty() {
            md.push_str("### Coaching\n\n");
            for t in titles {
                md.push_str(&format!("#### {t} _(warning · reliability)_\n\nBody.\n\n"));
            }
        }
        md
    }

    #[test]
    fn cap_enforced_and_digest_accumulates() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        // Write MAX + 3 notes.
        for i in 0..(MAX_NOTES_PER_PERSONA + 3) {
            write_note(dir, i, &sample_review(3, &[&format!("Verdict {i}")]));
        }
        compact_notes(dir).unwrap();

        // Cap holds: only MAX note files remain (digest excluded from the count).
        let remaining = list_note_files(dir);
        assert_eq!(remaining.len(), MAX_NOTES_PER_PERSONA, "note count capped");

        // The 3 oldest were digested and deleted; the digest names them.
        let digest = fs::read_to_string(dir.join(DIGEST_FILENAME)).unwrap();
        assert!(digest.contains("Verdict 0"), "oldest note condensed into digest");
        assert!(digest.contains("Verdict 1"));
        assert!(digest.contains("Verdict 2"));
        assert!(!digest.contains("Verdict 5"), "in-window note not digested");
        // Deleted sources are gone.
        assert!(!dir.join("2026-01-01-000000.md").exists(), "oldest source deleted");

        // Accumulation: another over-cap write rolls more entries into the SAME
        // digest without dropping the earlier ones.
        for i in 100..103 {
            write_note(dir, i, &sample_review(2, &[&format!("Verdict {i}")]));
        }
        compact_notes(dir).unwrap();
        let digest2 = fs::read_to_string(dir.join(DIGEST_FILENAME)).unwrap();
        assert!(digest2.contains("Verdict 0"), "earlier digest entries preserved");
        assert!(digest2.contains("Verdict 3"), "newly overflowed entries added");
        assert_eq!(list_note_files(dir).len(), MAX_NOTES_PER_PERSONA, "still capped");
    }

    #[test]
    fn nothing_deleted_before_digested() {
        // Under the cap → no compaction, no deletion, no digest.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        for i in 0..MAX_NOTES_PER_PERSONA {
            write_note(dir, i, &sample_review(4, &[]));
        }
        compact_notes(dir).unwrap();
        assert_eq!(list_note_files(dir).len(), MAX_NOTES_PER_PERSONA);
        assert!(!dir.join(DIGEST_FILENAME).exists(), "no digest when under cap");
    }

    #[test]
    fn lazy_migration_of_large_backlog() {
        // Simulate a pre-existing vault with a big backlog written before the
        // cap existed. One compaction (as runs on the next write) rolls the
        // whole backlog down to the cap.
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let backlog = MAX_NOTES_PER_PERSONA + 40;
        for i in 0..backlog {
            write_note(dir, i, &sample_review(1, &[&format!("Old {i}")]));
        }
        compact_notes(dir).unwrap();
        assert_eq!(list_note_files(dir).len(), MAX_NOTES_PER_PERSONA, "backlog capped");
        let digest = fs::read_to_string(dir.join(DIGEST_FILENAME)).unwrap();
        // All 40 over-cap notes are represented.
        assert!(digest.contains("Old 0"));
        assert!(digest.contains("Old 39"));
    }

    #[test]
    fn read_includes_recent_and_digest() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        // Force a digest by exceeding the cap.
        for i in 0..(MAX_NOTES_PER_PERSONA + 2) {
            write_note(dir, i, &sample_review(3, &[&format!("V{i}")]));
        }
        compact_notes(dir).unwrap();

        let history = read_history_from_dir(dir).expect("history present");
        // Newest READ_WINDOW notes are the highest ordinals.
        let newest = MAX_NOTES_PER_PERSONA + 1;
        assert!(history.contains(&format!("V{newest}")), "newest note in payload");
        // The digest section is appended.
        assert!(history.contains("rolled-up digest"), "digest section present");
        assert!(history.contains("V0"), "digested oldest verdict in payload");
    }

    #[test]
    fn read_returns_none_when_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_history_from_dir(tmp.path()).is_none());
    }

    #[test]
    fn digest_excluded_from_note_scan() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_note(dir, 0, &sample_review(5, &[]));
        fs::write(dir.join(DIGEST_FILENAME), "# digest\n\n- old\n").unwrap();
        let files = list_note_files(dir);
        assert_eq!(files.len(), 1, "digest not counted as a note");
    }
}
