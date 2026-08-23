//! Writing imported project skill files back to disk, safely.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ----------------------------------------------------------------------------
// Skills-to-disk (post-commit)
// ----------------------------------------------------------------------------

/// A skill file's rel path: a safe bundle path (see `helpers::is_safe_rel_path`,
/// which this module's own segment rules were folded into) that is also not the
/// provenance sidecar — that file is ours to write, never theirs to supply.
pub(crate) fn is_safe_skill_rel_path(rel: &str) -> bool {
    is_safe_rel_path(rel) && rel.split('/').next_back() != Some(SKILL_PROVENANCE_FILE)
}

/// Hash a set of skill files exactly like the export side does (sorted
/// rel_path/content pairs, NUL-separated) so import can detect drift against
/// `SkillFileExport::content_hash`.
pub(crate) fn hash_skill_entries(files: &[SkillFileEntry]) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    for f in files {
        hasher.update(f.rel_path.as_bytes());
        hasher.update([0u8]);
        hasher.update(f.content.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

/// Export-equivalent hash of an on-disk skill directory (None when missing or
/// empty). Used to decide whether a local skill differs from the incoming one.
pub(crate) fn hash_existing_skill_dir(dir: &std::path::Path) -> Option<String> {
    if !dir.is_dir() {
        return None;
    }
    let mut files = Vec::new();
    // Drop reasons are irrelevant here: this hash only has to match what the
    // exporter would have produced from the same directory.
    collect_skill_dir_files(dir, dir, &mut files, &mut Vec::new(), 0);
    if files.is_empty() {
        return None;
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Some(hash_skill_entries(&files))
}

/// Write a project's bundled skills under `<root_path>/.claude/skills/`.
/// `overwrite` is true only under the "replace" resolution; in every other
/// mode an existing skill with different content wins and the incoming copy
/// is skipped with a warning. A missing project folder defers the whole set.
pub(crate) fn write_project_skills(
    root_path: &str,
    skills: &[SkillFileExport],
    overwrite: bool,
    result: &mut PortabilityImportResult,
) {
    if skills.is_empty() {
        return;
    }
    let root = std::path::Path::new(root_path);
    if !root.is_dir() {
        result.skills_deferred += skills.len() as u32;
        result.warnings.push(format!(
            "Project folder '{}' not found; {} skill(s) were not written to disk (fix the path in Project Manager and re-import)",
            root_path,
            skills.len()
        ));
        return;
    }
    let skills_dir = root.join(".claude").join("skills");

    'skills: for skill in skills {
        if !is_safe_rel_segment(&skill.name) {
            result
                .warnings
                .push(format!("Skill '{}': unsafe name; skipped", skill.name));
            continue;
        }
        let files: Vec<&SkillFileEntry> = skill
            .files
            .iter()
            .filter(|f| {
                let ok = is_safe_skill_rel_path(&f.rel_path);
                if !ok {
                    result.warnings.push(format!(
                        "Skill '{}': unsafe file path '{}'; file skipped",
                        skill.name, f.rel_path
                    ));
                }
                ok
            })
            .collect();
        if files.is_empty() {
            continue;
        }

        let single_file = files.len() == 1 && files[0].rel_path == format!("{}.md", skill.name);

        if single_file {
            let target = skills_dir.join(format!("{}.md", skill.name));
            let existing = read_skill_file(&target);
            let differs = target.exists() && existing.as_deref() != Some(files[0].content.as_str());
            if target.exists() && !differs {
                continue; // identical — nothing to do
            }
            if differs && !overwrite {
                result.warnings.push(format!(
                    "Skill '{}': a local copy with different content exists; incoming copy skipped",
                    skill.name
                ));
                continue;
            }
            if let Err(e) = std::fs::create_dir_all(&skills_dir)
                .and_then(|()| std::fs::write(&target, files[0].content.as_bytes()))
            {
                result
                    .warnings
                    .push(format!("Skill '{}': write failed: {e}", skill.name));
                continue;
            }
            if differs {
                result.warnings.push(format!(
                    "Skill '{}': local copy overwritten (replace)",
                    skill.name
                ));
            }
            result.skills_written += 1;
            continue;
        }

        // Directory-form skill.
        let target_dir = skills_dir.join(&skill.name);
        let existing_hash = hash_existing_skill_dir(&target_dir);
        let differs = existing_hash
            .as_deref()
            .is_some_and(|h| h != skill.content_hash);
        if existing_hash.is_some() && !differs {
            continue; // identical — nothing to do
        }
        if differs && !overwrite {
            result.warnings.push(format!(
                "Skill '{}': a local copy with different content exists; incoming copy skipped",
                skill.name
            ));
            continue;
        }
        for f in &files {
            let mut target = target_dir.clone();
            for seg in f.rel_path.split('/') {
                target.push(seg);
            }
            let write = target
                .parent()
                .map_or(Ok(()), std::fs::create_dir_all)
                .and_then(|()| std::fs::write(&target, f.content.as_bytes()));
            if let Err(e) = write {
                result.warnings.push(format!(
                    "Skill '{}' file '{}': write failed: {e}",
                    skill.name, f.rel_path
                ));
                continue 'skills;
            }
        }
        if differs {
            result.warnings.push(format!(
                "Skill '{}': local copy overwritten (replace)",
                skill.name
            ));
        }

        // Provenance sidecar — same JSON shape as skill_files::write_provenance,
        // with source_kind "bundle", NO absolute source path, and a hash
        // recomputed over the just-written directory.
        let content_hash =
            crate::commands::infrastructure::skill_files::hash_skill_dir(&target_dir)
                .unwrap_or_default();
        let prov = serde_json::json!({
            "source_kind": "bundle",
            "source_project_id": null,
            "source_path": "",
            "content_hash": content_hash,
            "installed_at": chrono::Utc::now().to_rfc3339(),
        });
        if let Err(e) = std::fs::write(
            target_dir.join(SKILL_PROVENANCE_FILE),
            serde_json::to_string_pretty(&prov).unwrap_or_default(),
        ) {
            result.warnings.push(format!(
                "Skill '{}': provenance sidecar write failed: {e}",
                skill.name
            ));
        }
        result.skills_written += 1;
    }
}
