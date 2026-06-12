//! Identity layer engine (F1 / direction 7): the evolving profile of the user
//! (and Athena's self-model) in `identity.md`.
//!
//! The constitution (static character) lives separately at
//! `companion-brain/constitution.md` and is never modified by the companion.
//! This module governs *only* the identity layer that grows with the user — and
//! it grows by **anchored diffs**, never a whole-file rewrite: Athena proposes
//! `AppendBullet` / `ReplaceBullet` / `RemoveBullet` against a named section,
//! each gated by an approval card. Targeted edits keep the rest of the profile
//! intact and make every change reviewable per-claim. (The user's own direct
//! edit, via the BrainViewer, is the separate full-content escape hatch — they
//! are the editor of record.)

use crate::error::AppError;

/// The anchored edit operations Athena may propose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffOp {
    /// Add a new bullet to the end of the named section.
    AppendBullet,
    /// Replace the bullet matching `anchor_text` with `new_text`.
    ReplaceBullet,
    /// Remove the bullet matching `anchor_text`.
    RemoveBullet,
}

impl DiffOp {
    fn from_str(s: &str) -> Option<DiffOp> {
        match s.trim().to_ascii_lowercase().as_str() {
            "append" | "append_bullet" | "appendbullet" => Some(DiffOp::AppendBullet),
            "replace" | "replace_bullet" | "replacebullet" => Some(DiffOp::ReplaceBullet),
            "remove" | "remove_bullet" | "removebullet" => Some(DiffOp::RemoveBullet),
            _ => None,
        }
    }
}

/// One anchored edit to the identity doc.
#[derive(Debug, Clone)]
pub struct IdentityDiff {
    /// Heading path the bullet lives under, e.g. `"About Michal / How he works"`
    /// (the `#` heading, then `/`, then the `##` heading). Must already exist.
    pub section: String,
    pub op: DiffOp,
    /// The exact bullet text to match (for Replace / Remove). Matched by trimmed
    /// equality or prefix, so a stored provenance suffix `(ep_xxx)` still matches.
    pub anchor_text: Option<String>,
    /// The bullet text to add (Append) or swap in (Replace). Should end with the
    /// source episode ids in parens, e.g. `"prefers terse replies (ep_ab12)"`.
    pub new_text: Option<String>,
    pub rationale: String,
}

/// Max length of a single identity bullet — keeps the profile skimmable and
/// blocks a diff that tries to paste a wall of text.
pub const MAX_BULLET_CHARS: usize = 280;
/// Max diffs in one `update_identity` op — one approval card shouldn't carry an
/// unreadable batch.
pub const MAX_DIFFS_PER_OP: usize = 5;

impl IdentityDiff {
    /// Parse a diff from the op's JSON. Structural only — does not check the
    /// target section/anchor exists (that needs the live doc; see
    /// [`validate_against`] / [`apply_to`]).
    pub fn from_json(v: &serde_json::Value) -> Result<IdentityDiff, AppError> {
        let section = v
            .get("section")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::Validation("identity diff: missing `section`".into()))?
            .to_string();
        let op_str = v
            .get("op")
            .and_then(|x| x.as_str())
            .ok_or_else(|| AppError::Validation("identity diff: missing `op`".into()))?;
        let op = DiffOp::from_str(op_str).ok_or_else(|| {
            AppError::Validation(format!(
                "identity diff: `op` must be append|replace|remove, got `{op_str}`"
            ))
        })?;
        let anchor_text = v
            .get("anchor_text")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let new_text = v
            .get("new_text")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let rationale = v
            .get("rationale")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        // Field requirements per op.
        match op {
            DiffOp::AppendBullet => {
                require_new_text(&new_text)?;
            }
            DiffOp::ReplaceBullet => {
                require_anchor(&anchor_text)?;
                require_new_text(&new_text)?;
            }
            DiffOp::RemoveBullet => {
                require_anchor(&anchor_text)?;
            }
        }
        Ok(IdentityDiff {
            section,
            op,
            anchor_text,
            new_text,
            rationale,
        })
    }

    /// A short human-readable before→after line for the approval card.
    pub fn preview(&self) -> String {
        match self.op {
            DiffOp::AppendBullet => format!(
                "**{}** · add: “{}”",
                self.section,
                self.new_text.as_deref().unwrap_or("")
            ),
            DiffOp::ReplaceBullet => format!(
                "**{}** · “{}” → “{}”",
                self.section,
                self.anchor_text.as_deref().unwrap_or(""),
                self.new_text.as_deref().unwrap_or("")
            ),
            DiffOp::RemoveBullet => format!(
                "**{}** · remove: “{}”",
                self.section,
                self.anchor_text.as_deref().unwrap_or("")
            ),
        }
    }
}

fn require_new_text(new_text: &Option<String>) -> Result<(), AppError> {
    match new_text {
        Some(t) if t.chars().count() <= MAX_BULLET_CHARS => Ok(()),
        Some(_) => Err(AppError::Validation(format!(
            "identity diff: bullet exceeds {MAX_BULLET_CHARS} chars"
        ))),
        None => Err(AppError::Validation(
            "identity diff: this op requires `new_text`".into(),
        )),
    }
}

fn require_anchor(anchor: &Option<String>) -> Result<(), AppError> {
    if anchor.is_some() {
        Ok(())
    } else {
        Err(AppError::Validation(
            "identity diff: replace/remove require `anchor_text`".into(),
        ))
    }
}

/// `(heading_line_index, end_index_exclusive)` of the section whose heading path
/// equals `target` (`"<# heading> / <## heading>"`). `None` if absent.
fn section_range(lines: &[String], target: &str) -> Option<(usize, usize)> {
    let mut h1 = String::new();
    let mut start: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("## ") {
            if let Some(s) = start {
                return Some((s, i));
            }
            if format!("{} / {}", h1, rest.trim()) == target {
                start = Some(i);
            }
        } else if let Some(rest) = t.strip_prefix("# ") {
            // A new top-level heading closes an in-progress section.
            if let Some(s) = start {
                return Some((s, i));
            }
            h1 = rest.trim().to_string();
        }
    }
    start.map(|s| (s, lines.len()))
}

/// Find the bullet line in `[start, end)` matching `anchor` (trimmed equality or
/// prefix so a `(ep_xxx)` provenance suffix still matches).
fn find_bullet(lines: &[String], start: usize, end: usize, anchor: &str) -> Option<usize> {
    for (offset, line) in lines[start..end].iter().enumerate() {
        if let Some(b) = line.trim_start().strip_prefix("- ") {
            let b = b.trim();
            if b == anchor || b.starts_with(anchor) {
                return Some(start + offset);
            }
        }
    }
    None
}

/// Validate a diff against the current doc lines without mutating — used for a
/// dry-run before the approval card is built. Returns the same errors `apply_to`
/// would.
pub fn validate_against(lines: &[String], diff: &IdentityDiff) -> Result<(), AppError> {
    let (hidx, end) = section_range(lines, &diff.section).ok_or_else(|| {
        AppError::Validation(format!("identity: section `{}` does not exist", diff.section))
    })?;
    if matches!(diff.op, DiffOp::ReplaceBullet | DiffOp::RemoveBullet) {
        let anchor = diff.anchor_text.as_deref().unwrap_or("");
        find_bullet(lines, hidx + 1, end, anchor).ok_or_else(|| {
            AppError::Validation(format!(
                "identity: bullet `{anchor}` not found in `{}`",
                diff.section
            ))
        })?;
    }
    Ok(())
}

/// Apply one diff to the doc lines in place. Validates as it goes (section +
/// anchor must exist); on any failure the lines are left untouched.
pub fn apply_to(lines: &mut Vec<String>, diff: &IdentityDiff) -> Result<(), AppError> {
    let (hidx, end) = section_range(lines, &diff.section).ok_or_else(|| {
        AppError::Validation(format!("identity: section `{}` does not exist", diff.section))
    })?;
    match diff.op {
        DiffOp::AppendBullet => {
            let text = diff.new_text.as_deref().unwrap_or("").trim();
            // Insert after the section's last existing bullet, else right under
            // the heading.
            let mut insert_at = hidx + 1;
            for i in (hidx + 1)..end {
                if lines[i].trim_start().starts_with("- ") {
                    insert_at = i + 1;
                }
            }
            lines.insert(insert_at, format!("- {text}"));
        }
        DiffOp::ReplaceBullet => {
            let anchor = diff.anchor_text.as_deref().unwrap_or("");
            let text = diff.new_text.as_deref().unwrap_or("").trim();
            let idx = find_bullet(lines, hidx + 1, end, anchor).ok_or_else(|| {
                AppError::Validation(format!(
                    "identity: bullet `{anchor}` not found in `{}`",
                    diff.section
                ))
            })?;
            lines[idx] = format!("- {text}");
        }
        DiffOp::RemoveBullet => {
            let anchor = diff.anchor_text.as_deref().unwrap_or("");
            let idx = find_bullet(lines, hidx + 1, end, anchor).ok_or_else(|| {
                AppError::Validation(format!(
                    "identity: bullet `{anchor}` not found in `{}`",
                    diff.section
                ))
            })?;
            lines.remove(idx);
        }
    }
    Ok(())
}

/// Bump the `updated:` frontmatter line to `now` (RFC3339). No-op if there's no
/// frontmatter `updated:` field.
pub fn bump_updated(lines: &mut [String], now: &str) {
    for line in lines.iter_mut() {
        if line.trim_start().starts_with("updated:") {
            *line = format!("updated: {now}");
            return;
        }
    }
}

// ── disk I/O (thin wrappers over the pure logic above) ────────────────────

fn identity_path() -> Result<std::path::PathBuf, AppError> {
    Ok(crate::companion::disk::brain_root()?.join("identity.md"))
}

fn make_backup_name() -> String {
    format!(
        "identity.bak-{}-{}.md",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3f"),
        uuid::Uuid::new_v4()
    )
}

/// Full-content write of identity.md with a timestamped backup. The intake's
/// first-draft path (`{content}`) and the user's direct BrainViewer edit both
/// use this. Returns the backup file name (empty when there was no prior file).
pub fn write_full(content: &str) -> Result<String, AppError> {
    let path = identity_path()?;
    let root = crate::companion::disk::brain_root()?;
    let backup = if path.exists() {
        let name = make_backup_name();
        std::fs::copy(&path, root.join(&name))
            .map_err(|e| AppError::Internal(format!("identity backup failed: {e}")))?;
        name
    } else {
        String::new()
    };
    std::fs::write(&path, content)?;
    Ok(backup)
}

/// Apply a batch of parsed diffs to identity.md on disk: apply each (skipping any
/// that fail validation), and — only if at least one applied — back up once,
/// bump `updated`, and write. Returns `(applied previews, skipped reasons,
/// backup name)`. Errors (writing nothing) only when NO diff applied.
pub fn apply_diffs_on_disk(
    diffs: &[IdentityDiff],
) -> Result<(Vec<String>, Vec<String>, String), AppError> {
    let path = identity_path()?;
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();

    let mut applied = Vec::new();
    let mut failed = Vec::new();
    for d in diffs {
        match apply_to(&mut lines, d) {
            Ok(()) => applied.push(d.preview()),
            Err(e) => failed.push(format!("{} — {e}", d.preview())),
        }
    }
    if applied.is_empty() {
        return Err(AppError::Validation(format!(
            "no identity diffs applied: {}",
            failed.join("; ")
        )));
    }

    let root = crate::companion::disk::brain_root()?;
    let backup = if path.exists() {
        let name = make_backup_name();
        let _ = std::fs::copy(&path, root.join(&name));
        name
    } else {
        String::new()
    };
    bump_updated(&mut lines, &chrono::Utc::now().to_rfc3339());
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    std::fs::write(&path, out)?;
    Ok((applied, failed, backup))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> Vec<String> {
        let md = "---\ntype: identity\nupdated: \"2026-01-01\"\n---\n\n# About Michal\n\n## Who he is\n- (seeded from intake interview)\n\n## How he works\n- likes terse replies (ep_aa11)\n- (rhythms, patterns)\n\n# About me\n\n## What I've gotten wrong\n- (catalogue of corrections)\n";
        md.lines().map(String::from).collect()
    }

    #[test]
    fn parse_requires_fields_per_op() {
        assert!(IdentityDiff::from_json(&serde_json::json!({"section":"x","op":"append"})).is_err());
        assert!(IdentityDiff::from_json(&serde_json::json!({"section":"x","op":"remove"})).is_err());
        assert!(IdentityDiff::from_json(
            &serde_json::json!({"section":"x","op":"append","new_text":"y","rationale":"z"})
        )
        .is_ok());
        // Over-long bullet rejected.
        let long = "a".repeat(MAX_BULLET_CHARS + 1);
        assert!(IdentityDiff::from_json(
            &serde_json::json!({"section":"x","op":"append","new_text":long})
        )
        .is_err());
    }

    #[test]
    fn append_adds_after_last_bullet() {
        let mut lines = doc();
        let diff = IdentityDiff {
            section: "About Michal / How he works".into(),
            op: DiffOp::AppendBullet,
            anchor_text: None,
            new_text: Some("prefers mornings (ep_bb22)".into()),
            rationale: "he said so".into(),
        };
        apply_to(&mut lines, &diff).unwrap();
        let joined = lines.join("\n");
        assert!(joined.contains("- prefers mornings (ep_bb22)"));
        // Inserted under the right section (after the placeholder bullet, before
        // the next # heading).
        let pos_new = joined.find("prefers mornings").unwrap();
        let pos_aboutme = joined.find("# About me").unwrap();
        assert!(pos_new < pos_aboutme);
    }

    #[test]
    fn replace_matches_anchor_prefix() {
        let mut lines = doc();
        let diff = IdentityDiff {
            section: "About Michal / How he works".into(),
            op: DiffOp::ReplaceBullet,
            anchor_text: Some("likes terse replies".into()), // prefix of the stored bullet w/ (ep_aa11)
            new_text: Some("strongly prefers terse replies (ep_aa11, ep_cc33)".into()),
            rationale: "reinforced".into(),
        };
        apply_to(&mut lines, &diff).unwrap();
        let joined = lines.join("\n");
        assert!(joined.contains("strongly prefers terse replies"));
        assert!(!joined.contains("- likes terse replies (ep_aa11)"));
    }

    #[test]
    fn remove_and_missing_anchor_errors() {
        let mut lines = doc();
        let ok = IdentityDiff {
            section: "About Michal / How he works".into(),
            op: DiffOp::RemoveBullet,
            anchor_text: Some("(rhythms, patterns)".into()),
            new_text: None,
            rationale: "stale".into(),
        };
        apply_to(&mut lines, &ok).unwrap();
        assert!(!lines.join("\n").contains("rhythms, patterns"));

        let bad = IdentityDiff {
            section: "About Michal / How he works".into(),
            op: DiffOp::RemoveBullet,
            anchor_text: Some("nonexistent bullet".into()),
            new_text: None,
            rationale: "x".into(),
        };
        assert!(apply_to(&mut lines.clone(), &bad).is_err());
    }

    #[test]
    fn unknown_section_errors() {
        let lines = doc();
        let diff = IdentityDiff {
            section: "About Michal / Nope".into(),
            op: DiffOp::AppendBullet,
            anchor_text: None,
            new_text: Some("x".into()),
            rationale: "y".into(),
        };
        assert!(validate_against(&lines, &diff).is_err());
    }

    #[test]
    fn bump_updated_rewrites_frontmatter() {
        let mut lines = doc();
        bump_updated(&mut lines, "2026-06-12T00:00:00Z");
        assert!(lines.iter().any(|l| l == "updated: 2026-06-12T00:00:00Z"));
    }
}
