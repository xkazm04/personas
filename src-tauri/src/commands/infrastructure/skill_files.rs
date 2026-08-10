//! Skill file browser — lists, reads, and updates `.claude/skills/` files.
//!
//! Used by the dev-tools Skills tab to manage Claude Code skill definitions
//! without requiring terminal access.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use ts_rs::TS;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Sidecar provenance file written next to a skill's `SKILL.md` on install.
/// Records where the skill was copied from and the content hash at install
/// time, so a later scan can classify the installed copy as in-sync / diverged
/// / local-only. Chosen over frontmatter mutation deliberately: the install
/// must NOT rewrite the user's `SKILL.md` body (that would itself register as
/// drift and risk corrupting hand-authored content). The file is dot-prefixed
/// so it's excluded from the skill's reference-file listing and content hash.
const PROVENANCE_FILE: &str = ".personas-skill-meta.json";

/// Excluded from the content hash (and the reference-file listing) like the
/// provenance sidecar: lessons are per-copy run history, not method content.
/// Including them would mark every copy "diverged" from its source the moment
/// any project appends a lesson, drowning the real method-drift signal the
/// hash exists to carry. The intentional-change signal lives in SKILL.md's
/// `version:` frontmatter, which IS hashed. Matched case-insensitively;
/// `copy_dir_recursive` still copies it, so lessons travel on install.
const LESSONS_FILE: &str = "LESSONS.md";

/// Per-skill sync-state tokens surfaced in [`SkillEntry::sync_state`]. Kept in
/// lockstep with the frontend token map in `SkillLibraryRow`.
const SYNC_IN_SYNC: &str = "in_sync";
const SYNC_DIVERGED: &str = "diverged";
const SYNC_LOCAL_ONLY: &str = "local_only";

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    /// Skill directory name (e.g. "research", "add-template")
    pub name: String,
    /// Full path to the skill directory
    pub path: String,
    /// Content of SKILL.md (the main skill definition)
    pub description: Option<String>,
    /// Number of reference files in the skill directory (excluding SKILL.md)
    pub reference_file_count: i32,
    /// Names of reference files
    pub reference_files: Vec<String>,
    /// Provenance-derived sync state vs the source the skill was installed from:
    /// `"in_sync"` (installed copy still matches its source), `"diverged"`
    /// (hashes differ — the copy or its source changed), or `"local_only"`
    /// (no provenance sidecar — hand-authored or installed before tracking).
    pub sync_state: String,
    /// Where this skill was installed from, when provenance exists:
    /// `"global"` (the user-global library) or `"project"`. `None` for
    /// local-only skills.
    pub source_kind: Option<String>,
    /// Canonical category from the frontmatter `category:` field — one of
    /// "Development" / "Testing" / "Maintenance" / "Data" / "Other" (the share
    /// LLM assigns it when generalizing into the library). `None` when the
    /// frontmatter has no recognizable category; the UI groups those under
    /// "Other".
    pub category: Option<String>,
    /// Memory binding from the frontmatter `memory:` field — `"project"`
    /// (ledger via outbox), `"vault"` (Obsidian-first, still mirrors through
    /// the outbox) or `"none"`. `None` = undeclared → dispatches carry no
    /// MEMORY BLOCK (opt-in; docs/plans/skill-memory-unification.md §3.4).
    pub memory: Option<String>,
    /// Frontmatter `contexts: tracked` — the skill declares its method walks
    /// the context map and anchors its memory to contexts (drives the Skills
    /// Management UI's coverage rows; evidence via skill-attributed nodes is
    /// the runtime complement).
    pub context_tracked: bool,
    /// Frontmatter `version:` — "major.minor" (e.g. "1.0", "2.3"). Minor =
    /// prompt refinement from a skill reflection; major = methodic redesign
    /// (docs/skill-standard.md). `None` = unversioned (pre-standard skill;
    /// the UI renders it as an implicit "1.0"). Malformed values normalize
    /// to `None` like the other closed-set frontmatter fields.
    pub version: Option<String>,
}

/// On-disk provenance sidecar ([`PROVENANCE_FILE`]). Internal — not exported to
/// TS; the frontend consumes the derived [`SkillEntry::sync_state`] instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SkillProvenance {
    /// `"global"` or `"project"`.
    source_kind: String,
    /// Registered source project id when `source_kind == "project"`.
    source_project_id: Option<String>,
    /// Absolute path of the source skill directory at install time.
    source_path: String,
    /// Content hash of the source skill directory at install time.
    content_hash: String,
    /// RFC3339 timestamp of the install.
    installed_at: String,
}

/// One file-level entry in an install diff preview.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileDelta {
    /// Relative path within the skill directory.
    pub file: String,
    /// `"changed"`, `"added"` (in source, not target), or `"removed"`
    /// (in target, not source).
    pub status: String,
    /// Source file size in bytes (0 when `status == "removed"`).
    pub source_bytes: i64,
    /// Target file size in bytes (0 when `status == "added"`).
    pub target_bytes: i64,
}

/// Diff summary returned by [`skill_files_install_preview`] so the UI can show
/// what a re-install would overwrite BEFORE it commits the copy.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallPreview {
    pub skill_name: String,
    /// Absolute path the skill would be installed to.
    pub target_path: String,
    /// Whether a skill already exists at the target (a re-install / overwrite).
    pub target_exists: bool,
    pub changed_count: i32,
    pub added_count: i32,
    pub removed_count: i32,
    /// Per-file deltas (capped for display).
    pub deltas: Vec<SkillFileDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileContent {
    pub skill_name: String,
    pub file_name: String,
    pub content: String,
}

/// Outcome of installing (copying) a skill into a target project's
/// `.claude/skills`. Returned by [`skill_files_install`].
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallResult {
    /// Whether files were written. `false` with `reason = "exists"` means the
    /// skill already exists in the target and `overwrite` was not set.
    pub installed: bool,
    /// Absolute path of the installed skill directory (or single-file `.md`).
    pub target_path: String,
    /// Number of files copied (0 when `installed == false`).
    pub file_count: i32,
    /// Machine reason token when `installed == false` (currently only
    /// `"exists"`). `None` on success.
    pub reason: Option<String>,
}

// ============================================================================
// Helpers
// ============================================================================

/// Resolve the `.claude/skills` directory.
///
/// When `project_id` is provided we look up that specific row's `root_path`
/// — this is the path users get when they pick a project in the dev-tools
/// Skills tab. With no `project_id` we fall back to scanning all projects
/// (preserves legacy callers that haven't been updated to forward the
/// active id yet) and finally the current working directory.
fn skills_dir(state: &AppState, project_id: Option<&str>) -> Result<PathBuf, AppError> {
    let candidates: Vec<PathBuf> = {
        let mut c = Vec::new();
        if let Ok(conn) = state.db.get() {
            if let Some(id) = project_id {
                if let Ok(rp) = conn.query_row::<String, _, _>(
                    "SELECT root_path FROM dev_projects WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                ) {
                    c.push(PathBuf::from(&rp).join(".claude").join("skills"));
                }
            } else if let Ok(mut projects) =
                conn.prepare("SELECT root_path FROM dev_projects LIMIT 5")
            {
                if let Ok(mut rows) = projects.query([]) {
                    while let Ok(Some(row)) = rows.next() {
                        if let Ok(rp) = row.get::<_, String>(0) {
                            c.push(PathBuf::from(&rp).join(".claude").join("skills"));
                        }
                    }
                }
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            c.push(cwd.join(".claude").join("skills"));
        }
        c
    };

    for candidate in &candidates {
        if candidate.is_dir() {
            return Ok(candidate.clone());
        }
    }

    Err(AppError::NotFound(
        "No .claude/skills directory found. Make sure a dev project with Claude Code skills is configured.".into(),
    ))
}

/// Resolve `~/.claude/skills` — the user-global Claude Code skills library,
/// available to every project. `None` if the home dir can't be resolved.
pub(crate) fn global_skills_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("skills"))
}

/// App-owned "system" skills the app itself dispatches (Onboard, …). These MUST
/// ship with the app — they can't rely on the user's global library — so they
/// are git-tracked in the repo's `.claude/skills/` AND bundled into the
/// installer (tauri.conf `bundle.resources` → `<resource_dir>/skills/`).
const SYSTEM_SKILLS: &[&str] = &[
    "passport-onboard",
    "project-populate",
    // Portable localization loop (draft → typed MQM estimate → gated refine);
    // repo specifics live in the target repo's docs/i18n/contract.md.
    "i18n-translate",
    // The consolidated multi-lens context sweep (reads a context once, judges
    // through every matched lens), generated by scan-agents-to-skills.mjs.
    // The 22 single-lens scan-* skills were retired 2026-08-04 — the sweep is
    // the only scan entry point; deep passes run `/scan-sweep --lenses <key>`.
    "scan-sweep",
    // Executes ONE Ship milestone and reports back through
    // `dev_tools_ship_milestone_ingest` — the app dispatches it from the Ship
    // tab, so it cannot depend on the operator's global library.
    "ship-milestone",
];

/// Is `name` an app-owned system skill (sourced from the bundle/repo, never the
/// user's global library)?
pub(crate) fn is_system_skill(name: &str) -> bool {
    SYSTEM_SKILLS.contains(&name)
}

/// Resolve the directory that holds the app's bundled system skills, in order:
///   1. Tauri resource dir (`<res>/skills`) — the packaged installer AND
///      `tauri dev` (Tauri copies `bundle.resources` to the target dir).
///   2. The current working directory's `.claude/skills` — a CLONED REPO run
///      from source (the case that was previously broken: a fresh clone has no
///      global copy of passport-onboard).
///   3. The user-global library — last resort so a hand-installed copy still
///      works.
/// Returns the first candidate that actually contains files.
fn system_skills_dir(app: &AppHandle) -> Option<PathBuf> {
    // 1. Bundled resource dir — the packaged installer (and dev, when the sync
    //    script has populated `src-tauri/resources/skills`).
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("skills");
        if p.is_dir() {
            return Some(p);
        }
    }
    // 2. Cloned repo / run-from-source: the process cwd under `tauri dev` is
    //    `src-tauri`, not the repo root, so WALK UP looking for a `.claude/
    //    skills` dir. This is the case the bug report hit — a fresh clone has
    //    the git-tracked skills but no global copy.
    if let Ok(cwd) = std::env::current_dir() {
        let mut cur: Option<&Path> = Some(cwd.as_path());
        for _ in 0..6 {
            let Some(dir) = cur else { break };
            let p = dir.join(".claude").join("skills");
            if p.is_dir() {
                return Some(p);
            }
            cur = dir.parent();
        }
    }
    // 3. Last resort: a hand-installed global copy.
    global_skills_dir().filter(|p| p.is_dir())
}

/// Resolve a registered project's `.claude/skills` directory from its id.
/// Errors `NotFound` if the project id isn't in `dev_projects`.
fn project_skills_dir(state: &AppState, project_id: &str) -> Result<PathBuf, AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;
    let root_path = conn
        .query_row::<String, _, _>(
            "SELECT root_path FROM dev_projects WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("project not found: {project_id}")))?;
    Ok(PathBuf::from(&root_path).join(".claude").join("skills"))
}

/// Reject skill names that aren't a single safe path segment. Guards the
/// install path against writing outside the target `.claude/skills`.
fn validate_skill_name(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains(':')
    {
        return Err(AppError::Validation(format!("invalid skill name: {name}")));
    }
    Ok(())
}

/// Recursively copy `src` into `dst`, returning the count of files written.
/// Creates `dst` (and parents) as needed. Used to install a skill directory
/// (SKILL.md + reference files, possibly nested) into a target repo.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<i32, AppError> {
    std::fs::create_dir_all(dst)
        .map_err(|e| AppError::Internal(format!("create target dir failed: {e}")))?;
    let mut count = 0;
    let read_dir = std::fs::read_dir(src)
        .map_err(|e| AppError::Internal(format!("read source dir failed: {e}")))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            count += copy_dir_recursive(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)
                .map_err(|e| AppError::Internal(format!("copy file failed: {e}")))?;
            count += 1;
        }
    }
    Ok(count)
}

/// Collect the files under a skill `dir` as a map of `relative_path -> size`,
/// excluding the [`PROVENANCE_FILE`] sidecar. Deterministic (BTreeMap keeps
/// paths sorted). Returns an empty map when the dir is unreadable.
fn collect_skill_files(dir: &Path) -> BTreeMap<String, u64> {
    fn walk(base: &Path, cur: &Path, out: &mut BTreeMap<String, u64>) {
        let Ok(read_dir) = std::fs::read_dir(cur) else {
            return;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                let fname = path.file_name().and_then(|n| n.to_str());
                if fname == Some(PROVENANCE_FILE)
                    || fname.is_some_and(|n| n.eq_ignore_ascii_case(LESSONS_FILE))
                {
                    continue;
                }
                let rel = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                out.insert(rel, size);
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

/// Content hash of a skill directory: SHA-256 over each file's relative path
/// and bytes, in sorted order, excluding the provenance sidecar. Returns `None`
/// if the directory can't be read. Two directories with identical file trees
/// hash equal regardless of filesystem walk order.
pub(crate) fn hash_skill_dir(dir: &Path) -> Option<String> {
    if !dir.is_dir() {
        return None;
    }
    let files = collect_skill_files(dir);
    let mut hasher = Sha256::new();
    for rel in files.keys() {
        let bytes = std::fs::read(dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))).ok()?;
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
    }
    Some(hex::encode(hasher.finalize()))
}

/// Write the [`PROVENANCE_FILE`] sidecar into an installed skill directory.
/// Best-effort — an I/O failure is logged and swallowed (the copy already
/// succeeded; provenance is a nice-to-have that degrades the skill to
/// `local_only` if absent).
fn write_provenance(target_dir: &Path, source_dir: &Path, source_kind: &str, source_project_id: Option<&str>) {
    let Some(content_hash) = hash_skill_dir(source_dir) else {
        return;
    };
    let prov = SkillProvenance {
        source_kind: source_kind.to_string(),
        source_project_id: source_project_id.map(str::to_string),
        source_path: source_dir.to_string_lossy().into_owned(),
        content_hash,
        installed_at: chrono::Utc::now().to_rfc3339(),
    };
    match serde_json::to_string_pretty(&prov) {
        Ok(json) => {
            if let Err(e) = std::fs::write(target_dir.join(PROVENANCE_FILE), json) {
                tracing::warn!(error = %e, dir = %target_dir.display(), "skill_files: failed to write provenance sidecar");
            }
        }
        Err(e) => tracing::warn!(error = %e, "skill_files: failed to serialize provenance"),
    }
}

/// Read the provenance sidecar from an installed skill directory, if present.
fn read_provenance(skill_dir: &Path) -> Option<SkillProvenance> {
    let raw = std::fs::read_to_string(skill_dir.join(PROVENANCE_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Classify an installed skill directory's sync state against the source it was
/// installed from. `local_only` when no provenance; `in_sync` when the installed
/// copy still hashes equal to its current source; `diverged` otherwise
/// (installed copy edited, source changed upstream, or source now unreadable).
fn classify_sync_state(skill_dir: &Path) -> (String, Option<String>) {
    let Some(prov) = read_provenance(skill_dir) else {
        return (SYNC_LOCAL_ONLY.to_string(), None);
    };
    let source_kind = Some(prov.source_kind.clone());
    let installed_hash = hash_skill_dir(skill_dir);
    let source_hash = hash_skill_dir(Path::new(&prov.source_path));
    let state = match (installed_hash, source_hash) {
        (Some(inst), Some(src)) if inst == src => SYNC_IN_SYNC,
        _ => SYNC_DIVERGED,
    };
    (state.to_string(), source_kind)
}

/// Scan a `.claude/skills` directory into [`SkillEntry`] rows. Returns an
/// empty vec when the directory is missing or unreadable — callers that need
/// a hard error (the project-scoped list) resolve + check the dir first via
/// [`skills_dir`]; the global list tolerates a missing library.
pub(crate) fn scan_skills_dir(dir: &Path) -> Vec<SkillEntry> {
    let mut entries = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return entries;
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            // Single-file skill (e.g. skill-name.md directly in skills/)
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                let content = std::fs::read_to_string(&path).ok();
                let desc = content.as_deref().and_then(extract_skill_description);
                let category = content.as_deref().and_then(extract_skill_category);
                let memory = content.as_deref().and_then(extract_skill_memory);
                let context_tracked = content
                    .as_deref()
                    .map(extract_skill_context_tracked)
                    .unwrap_or(false);
                let version = content.as_deref().and_then(extract_skill_version);
                entries.push(SkillEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    description: desc,
                    reference_file_count: 0,
                    reference_files: vec![],
                    // Single-file `<name>.md` skills carry no provenance sidecar
                    // (nowhere to put one without a dir); always local-only.
                    sync_state: SYNC_LOCAL_ONLY.to_string(),
                    source_kind: None,
                    category,
                    memory,
                    context_tracked,
                    version,
                });
            }
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Look for SKILL.md or skill.md
        let skill_md = path.join("SKILL.md");
        let skill_md_alt = path.join("skill.md");
        let skill_md_path = if skill_md.exists() {
            Some(skill_md)
        } else if skill_md_alt.exists() {
            Some(skill_md_alt)
        } else {
            None
        };

        let description = skill_md_path
            .as_ref()
            .and_then(|p| read_first_line_description(p));
        let (category, memory, context_tracked, version) = skill_md_path
            .as_ref()
            .map(|p| read_skill_meta(p))
            .unwrap_or((None, None, false, None));

        // Count reference files (everything except SKILL.md, the internal
        // provenance sidecar and the lessons log — the latter two are
        // engine/reflection-managed, not method content).
        let mut ref_files = Vec::new();
        if let Ok(sub_entries) = std::fs::read_dir(&path) {
            for sub in sub_entries.flatten() {
                let fname = sub.file_name().to_string_lossy().to_string();
                if fname.to_lowercase() != "skill.md"
                    && fname != PROVENANCE_FILE
                    && !fname.eq_ignore_ascii_case(LESSONS_FILE)
                {
                    ref_files.push(fname);
                }
            }
        }

        let (sync_state, source_kind) = classify_sync_state(&path);

        entries.push(SkillEntry {
            name,
            path: path.to_string_lossy().to_string(),
            description,
            reference_file_count: ref_files.len() as i32,
            reference_files: ref_files,
            sync_state,
            source_kind,
            category,
            memory,
            context_tracked,
            version,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

fn read_first_line_description(skill_md_path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(skill_md_path).ok()?;
    extract_skill_description(&content)
}

/// The closed category set skills sort into (workbench grouping). The share
/// LLM picks one when generalizing a skill into the library; anything else in
/// the frontmatter normalizes to `None` (grouped as "Other" in the UI).
const SKILL_CATEGORIES: [&str; 5] = ["Development", "Testing", "Maintenance", "Data", "Other"];

/// Memory bindings a skill may declare (`memory:` frontmatter — see
/// docs/plans/skill-memory-unification.md §3.4).
const SKILL_MEMORY_BINDINGS: [&str; 3] = ["project", "vault", "none"];

/// Raw value of a `key:` line inside the YAML frontmatter block, trimmed and
/// unquoted. Absent frontmatter or key → None.
fn extract_frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }
    let prefix = format!("{key}:");
    for line in lines {
        let t = line.trim();
        if t == "---" {
            break;
        }
        if let Some(rest) = t.strip_prefix(&prefix) {
            let v = rest.trim().trim_matches(['"', '\'']).trim();
            return Some(v.to_string());
        }
    }
    None
}

/// Read the frontmatter `category:` field and normalize it (case-insensitive)
/// to the canonical set above. Absent frontmatter / key / unknown value → None.
fn extract_skill_category(content: &str) -> Option<String> {
    let v = extract_frontmatter_value(content, "category")?;
    SKILL_CATEGORIES
        .iter()
        .find(|c| c.eq_ignore_ascii_case(&v))
        .map(|c| (*c).to_string())
}

/// Read the frontmatter `memory:` binding, normalized lowercase to the known
/// set. Absent / unknown → None (undeclared — no MEMORY BLOCK on dispatch).
fn extract_skill_memory(content: &str) -> Option<String> {
    let v = extract_frontmatter_value(content, "memory")?;
    SKILL_MEMORY_BINDINGS
        .iter()
        .find(|m| m.eq_ignore_ascii_case(&v))
        .map(|m| (*m).to_string())
}

/// Frontmatter `contexts: tracked` (or `true`) — the context-map declaration.
fn extract_skill_context_tracked(content: &str) -> bool {
    extract_frontmatter_value(content, "contexts")
        .map(|v| v.eq_ignore_ascii_case("tracked") || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Frontmatter `version:` normalized to canonical "major.minor" — both
/// segments must be non-empty and all-digit (`2.1` ✓, `v2`, `1.0.3`, `two.1`
/// → None). Note `extract_frontmatter_value` matches `version:` at line start
/// inside the frontmatter block only; keys like `min-version:` cannot
/// false-match (strip_prefix on the trimmed line), though an indented
/// `version:` inside a nested YAML block would — acceptable with the shape
/// check.
fn extract_skill_version(content: &str) -> Option<String> {
    let v = extract_frontmatter_value(content, "version")?;
    let mut parts = v.splitn(2, '.');
    let is_num = |s: &str| !s.is_empty() && s.len() <= 4 && s.bytes().all(|b| b.is_ascii_digit());
    match (parts.next(), parts.next()) {
        (Some(maj), Some(min)) if is_num(maj) && is_num(min) => Some(format!("{maj}.{min}")),
        _ => None,
    }
}

/// Parse a canonical "major.minor" version into comparable numbers. `None` or
/// unparseable → `(1, 0)` — the implicit version of a pre-standard skill.
/// Exercised by unit tests; reserved for backend drift verdicts (today the
/// frontend ports the same semantics in `trace/traceModel.ts::driftOf`).
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn parse_skill_version(v: Option<&str>) -> (u32, u32) {
    let Some(v) = v else { return (1, 0) };
    let mut parts = v.splitn(2, '.');
    match (
        parts.next().and_then(|s| s.parse::<u32>().ok()),
        parts.next().and_then(|s| s.parse::<u32>().ok()),
    ) {
        (Some(maj), Some(min)) => (maj, min),
        _ => (1, 0),
    }
}

/// Category + memory binding + context declaration + version over a SKILL.md
/// path (one read, all fields).
fn read_skill_meta(skill_md_path: &Path) -> (Option<String>, Option<String>, bool, Option<String>) {
    match std::fs::read_to_string(skill_md_path) {
        Ok(content) => (
            extract_skill_category(&content),
            extract_skill_memory(&content),
            extract_skill_context_tracked(&content),
            extract_skill_version(&content),
        ),
        Err(_) => (None, None, false, None),
    }
}

/// Short description for a skill's SKILL.md. Prefers the YAML frontmatter
/// `description:` field (Claude Code skills are frontmatter-first); falls back
/// to the first non-empty, non-heading body line. Without this, a frontmatter
/// skill would surface its `---` delimiter as the description.
///
/// `pub(crate)` so the companion prompt's skill index
/// (`companion::prompt::scan_skill_index`) parses skill descriptions the
/// exact same way the Skills UI does, instead of growing a second parser
/// that drifts.
pub(crate) fn extract_skill_description(content: &str) -> Option<String> {
    let lines: Vec<&str> = content.lines().collect();
    let has_frontmatter = lines.first().map(|l| l.trim()) == Some("---");

    if has_frontmatter {
        // Scan the frontmatter block for `description:`.
        for line in &lines[1..] {
            let t = line.trim();
            if t == "---" {
                break;
            }
            if let Some(rest) = t.strip_prefix("description:") {
                let v = rest.trim().trim_matches(['"', '\'']).trim();
                if !v.is_empty() {
                    return Some(v.chars().take(200).collect());
                }
            }
        }
        // No description key — fall through to the first body line after the
        // closing `---`.
        if let Some(close) = lines.iter().skip(1).position(|l| l.trim() == "---") {
            for line in &lines[close + 2..] {
                let t = line.trim();
                if t.is_empty() || t.starts_with('#') {
                    continue;
                }
                return Some(t.chars().take(200).collect());
            }
        }
        return None;
    }

    // No frontmatter: first non-empty, non-heading line.
    lines
        .iter()
        .map(|l| l.trim())
        .find(|t| !t.is_empty() && !t.starts_with('#'))
        .map(|t| t.chars().take(200).collect())
}

// ============================================================================
// Commands
// ============================================================================

#[tauri::command]
pub fn skill_files_list(
    state: State<'_, Arc<AppState>>,
    project_id: Option<String>,
) -> Result<Vec<SkillEntry>, AppError> {
    require_auth_sync(&state)?;

    let dir = skills_dir(&state, project_id.as_deref())?;
    Ok(scan_skills_dir(&dir))
}

/// List skills from the user-global library (`~/.claude/skills`) — the
/// source for the Fleet skill drawer's "Global library" view. Returns an
/// empty list (not an error) when the user has no global skills yet.
#[tauri::command]
pub fn skill_files_list_global(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<SkillEntry>, AppError> {
    require_auth_sync(&state)?;

    let Some(dir) = global_skills_dir() else {
        return Ok(Vec::new());
    };
    Ok(scan_skills_dir(&dir))
}

/// Install (copy) a skill into a target project's `.claude/skills`.
///
/// `source_project_id = None` reads from the global library
/// (`~/.claude/skills`); `Some(id)` reads from that project's skills. The
/// skill may be a directory (`<name>/SKILL.md` + reference files) or a
/// single-file `<name>.md`. With `overwrite = false`, an existing target
/// skill is left untouched and the result carries `reason = "exists"`.
#[tauri::command]
pub fn skill_files_install(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    source_project_id: Option<String>,
    target_project_id: String,
    overwrite: bool,
) -> Result<SkillInstallResult, AppError> {
    require_auth_sync(&state)?;
    install_skill_copy(
        &state,
        &skill_name,
        source_project_id.as_deref(),
        &target_project_id,
        overwrite,
    )
}

/// Auth-free core of [`skill_files_install`], shared with the companion's
/// `skill_sync` executor (`approval_exec_knowledge.rs`) — one copy path, one
/// provenance stamp, one registry refresh, whichever consent surface asked.
pub(crate) fn install_skill_copy(
    state: &AppState,
    skill_name: &str,
    source_project_id: Option<&str>,
    target_project_id: &str,
    overwrite: bool,
) -> Result<SkillInstallResult, AppError> {
    let skill_name = skill_name.to_string();
    validate_skill_name(&skill_name)?;

    let source_dir = match source_project_id {
        Some(pid) => project_skills_dir(state, pid)?,
        None => {
            global_skills_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?
        }
    };
    let target_skills = project_skills_dir(state, target_project_id)?;

    // A skill is either a directory or a single `<name>.md` file.
    let src_dir = source_dir.join(&skill_name);
    let src_md = source_dir.join(format!("{skill_name}.md"));

    if src_dir.is_dir() {
        let target_dir = target_skills.join(&skill_name);
        if target_dir.exists() && !overwrite {
            return Ok(SkillInstallResult {
                installed: false,
                target_path: target_dir.to_string_lossy().into_owned(),
                file_count: 0,
                reason: Some("exists".into()),
            });
        }
        let file_count = copy_dir_recursive(&src_dir, &target_dir)?;
        // Stamp provenance so a later scan can detect drift. Source kind mirrors
        // where we read from: global library vs a registered project.
        let (source_kind, source_pid) = match source_project_id {
            Some(pid) => ("project", Some(pid)),
            None => ("global", None),
        };
        write_provenance(&target_dir, &src_dir, source_kind, source_pid);
        refresh_skill_registry_file(state, target_project_id);
        Ok(SkillInstallResult {
            installed: true,
            target_path: target_dir.to_string_lossy().into_owned(),
            file_count,
            reason: None,
        })
    } else if src_md.is_file() {
        std::fs::create_dir_all(&target_skills)
            .map_err(|e| AppError::Internal(format!("create target dir failed: {e}")))?;
        let target_md = target_skills.join(format!("{skill_name}.md"));
        if target_md.exists() && !overwrite {
            return Ok(SkillInstallResult {
                installed: false,
                target_path: target_md.to_string_lossy().into_owned(),
                file_count: 0,
                reason: Some("exists".into()),
            });
        }
        std::fs::copy(&src_md, &target_md)
            .map_err(|e| AppError::Internal(format!("copy file failed: {e}")))?;
        Ok(SkillInstallResult {
            installed: true,
            target_path: target_md.to_string_lossy().into_owned(),
            file_count: 1,
            reason: None,
        })
    } else {
        Err(AppError::NotFound(format!(
            "source skill not found: {skill_name}"
        )))
    }
}

/// Install an app-owned SYSTEM skill (e.g. passport-onboard) into a target
/// project, sourcing it from the bundled/repo location (`system_skills_dir`)
/// rather than the user's global library — so it works on a fresh clone and a
/// clean installer, neither of which has the skill in `~/.claude/skills`. Only
/// skills in `SYSTEM_SKILLS` are allowed through this door.
#[tauri::command]
pub fn skill_files_install_system(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    target_project_id: String,
    overwrite: bool,
) -> Result<SkillInstallResult, AppError> {
    require_auth_sync(&state)?;
    validate_skill_name(&skill_name)?;
    if !is_system_skill(&skill_name) {
        return Err(AppError::Validation(format!(
            "'{skill_name}' is not an app system skill"
        )));
    }

    let source_dir = system_skills_dir(&app).ok_or_else(|| {
        AppError::NotFound(
            "app system-skills directory not found (bundle + repo + global all missing)".into(),
        )
    })?;
    let target_skills = project_skills_dir(&state, &target_project_id)?;
    let src_dir = source_dir.join(&skill_name);

    if !src_dir.is_dir() {
        return Err(AppError::NotFound(format!(
            "system skill '{skill_name}' not found under {}",
            source_dir.display()
        )));
    }
    let target_dir = target_skills.join(&skill_name);
    if target_dir.exists() && !overwrite {
        return Ok(SkillInstallResult {
            installed: false,
            target_path: target_dir.to_string_lossy().into_owned(),
            file_count: 0,
            reason: Some("exists".into()),
        });
    }
    let file_count = copy_dir_recursive(&src_dir, &target_dir)?;
    write_provenance(&target_dir, &src_dir, "system", None);
    refresh_skill_registry_file(&state, &target_project_id);
    Ok(SkillInstallResult {
        installed: true,
        target_path: target_dir.to_string_lossy().into_owned(),
        file_count,
        reason: None,
    })
}

/// Best-effort refresh of the target repo's `.personas/skill-registry.json`
/// after an install changed what's on disk (docs/skill-standard.md). Never
/// fails the install — the context scan and the pre-dispatch export are the
/// other refresh points.
pub(crate) fn refresh_skill_registry_file(state: &AppState, project_id: &str) {
    let root = crate::db::repos::dev_tools::get_project_by_id(&state.db, project_id)
        .map(|p| p.root_path);
    if let Ok(root) = root {
        if let Err(e) =
            super::skill_registry_export::write_skill_registry(&state.db, project_id, &root)
        {
            tracing::warn!(error = %e, project = %project_id, "skill_files: registry file refresh failed");
        }
    }
}

/// Publish a project's copy of a skill INTO the user-global workspace library
/// (`~/.claude/skills`) — the write half of the skill-standard's sync ritual
/// (docs/skill-standard.md), called from the companion's `skill_sync`
/// executor. Guarded: the source copy's declared `version:` must be AHEAD of
/// the library's (a publish that isn't a version bump is either a no-op or an
/// unreviewed overwrite — both refused; bump the version first, that is what
/// "the improvement was actually applied" means in the standard). A skill the
/// library never carried publishes freely — that is an add, not an overwrite.
/// No provenance sidecar is written into the library: the library is a
/// source, not an install.
///
/// Returns `(published_version, file_count)`.
pub(crate) fn publish_skill_to_library(
    state: &AppState,
    skill_name: &str,
    source_project_id: &str,
) -> Result<(String, i32), AppError> {
    validate_skill_name(skill_name)?;
    let source_skills = project_skills_dir(state, source_project_id)?;
    let library = global_skills_dir()
        .ok_or_else(|| AppError::Internal("no home directory for the skill library".into()))?;

    let src_dir = source_skills.join(skill_name);
    let src_md = source_skills.join(format!("{skill_name}.md"));
    let (src_version_raw, is_dir) = if src_dir.is_dir() {
        (
            std::fs::read_to_string(src_dir.join("SKILL.md"))
                .ok()
                .as_deref()
                .and_then(extract_skill_version),
            true,
        )
    } else if src_md.is_file() {
        (
            std::fs::read_to_string(&src_md)
                .ok()
                .as_deref()
                .and_then(extract_skill_version),
            false,
        )
    } else {
        return Err(AppError::NotFound(format!(
            "skill `{skill_name}` not found in the source project"
        )));
    };

    let lib_dir = library.join(skill_name);
    let lib_md = library.join(format!("{skill_name}.md"));
    let lib_version_raw = if lib_dir.is_dir() {
        Some(
            std::fs::read_to_string(lib_dir.join("SKILL.md"))
                .ok()
                .as_deref()
                .and_then(extract_skill_version),
        )
    } else if lib_md.is_file() {
        Some(
            std::fs::read_to_string(&lib_md)
                .ok()
                .as_deref()
                .and_then(extract_skill_version),
        )
    } else {
        None // not in the library at all — publishing is an add
    };
    if let Some(lib_version) = &lib_version_raw {
        let src_v = parse_skill_version(src_version_raw.as_deref());
        let lib_v = parse_skill_version(lib_version.as_deref());
        if src_v <= lib_v {
            return Err(AppError::Validation(format!(
                "publish refused: the project copy of `{skill_name}` declares version {} but \
                 the library already carries {}. A publish must be a version bump — apply the \
                 improvement, bump `version:` in SKILL.md, then publish.",
                src_version_raw.as_deref().unwrap_or("1.0 (unversioned)"),
                lib_version.as_deref().unwrap_or("1.0 (unversioned)"),
            )));
        }
    }

    let file_count = if is_dir {
        copy_dir_recursive(&src_dir, &lib_dir)?
    } else {
        std::fs::create_dir_all(&library)
            .map_err(|e| AppError::Internal(format!("create library dir failed: {e}")))?;
        std::fs::copy(&src_md, &lib_md)
            .map_err(|e| AppError::Internal(format!("copy file failed: {e}")))?;
        1
    };
    Ok((src_version_raw.unwrap_or_else(|| "1.0".into()), file_count))
}

/// Stamp (or re-stamp) the provenance sidecar on an ALREADY-INSTALLED skill —
/// the closing patch for the LLM adopt/share lane, which writes skill files
/// through a Dev-runner task rather than `skill_files_install` and therefore
/// never wrote the sidecar, leaving LLM-adopted skills stuck at `local_only`
/// (docs/plans/workspace-knowledge-center.md P4 seam). Called by the frontend
/// on the adopt task's success event. Best-effort by design: returns `false`
/// (not an error) when the source or target directory is missing, mirroring
/// `write_provenance`'s own degrade-to-local-only posture. The stamped copy
/// will typically classify `diverged` (the LLM customized it) — that is
/// honest; version compare distinguishes "customized" from "stale".
#[tauri::command]
pub fn skill_files_stamp_provenance(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    target_project_id: String,
    source_project_id: Option<String>,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    validate_skill_name(&skill_name)?;

    let source_dir = match source_project_id.as_deref() {
        Some(pid) => project_skills_dir(&state, pid)?,
        None => {
            global_skills_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?
        }
    };
    let src_dir = source_dir.join(&skill_name);
    let target_dir = project_skills_dir(&state, &target_project_id)?.join(&skill_name);
    if !src_dir.is_dir() || !target_dir.is_dir() {
        return Ok(false);
    }
    let (source_kind, source_pid) = match source_project_id.as_deref() {
        Some(pid) => ("project", Some(pid)),
        None => ("global", None),
    };
    write_provenance(&target_dir, &src_dir, source_kind, source_pid);
    Ok(true)
}

/// Preview what a (re-)install of `skill_name` into `target_project_id` would
/// change, WITHOUT writing anything. Compares the source skill's files against
/// whatever is already at the target so the UI can show a diff summary before
/// the user commits an overwrite. Directory skills only; single-file `.md`
/// skills return an empty diff with `target_exists` reflecting presence.
#[tauri::command]
pub fn skill_files_install_preview(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    source_project_id: Option<String>,
    target_project_id: String,
) -> Result<SkillInstallPreview, AppError> {
    require_auth_sync(&state)?;
    validate_skill_name(&skill_name)?;

    let source_dir = match source_project_id.as_deref() {
        Some(pid) => project_skills_dir(&state, pid)?,
        None => {
            global_skills_dir().ok_or_else(|| AppError::Internal("no home directory".into()))?
        }
    };
    let target_skills = project_skills_dir(&state, &target_project_id)?;

    let src_dir = source_dir.join(&skill_name);
    let src_md = source_dir.join(format!("{skill_name}.md"));

    if src_dir.is_dir() {
        let target_dir = target_skills.join(&skill_name);
        let target_exists = target_dir.exists();
        let source_files = collect_skill_files(&src_dir);
        let target_files = if target_exists {
            collect_skill_files(&target_dir)
        } else {
            BTreeMap::new()
        };

        let mut deltas = Vec::new();
        let (mut changed, mut added, mut removed) = (0i32, 0i32, 0i32);
        for (file, &src_bytes) in &source_files {
            match target_files.get(file) {
                Some(&tgt_bytes) if tgt_bytes == src_bytes => {} // unchanged
                Some(&tgt_bytes) => {
                    changed += 1;
                    deltas.push(SkillFileDelta {
                        file: file.clone(),
                        status: "changed".into(),
                        source_bytes: src_bytes as i64,
                        target_bytes: tgt_bytes as i64,
                    });
                }
                None => {
                    added += 1;
                    deltas.push(SkillFileDelta {
                        file: file.clone(),
                        status: "added".into(),
                        source_bytes: src_bytes as i64,
                        target_bytes: 0,
                    });
                }
            }
        }
        for (file, &tgt_bytes) in &target_files {
            if !source_files.contains_key(file) {
                removed += 1;
                deltas.push(SkillFileDelta {
                    file: file.clone(),
                    status: "removed".into(),
                    source_bytes: 0,
                    target_bytes: tgt_bytes as i64,
                });
            }
        }
        // Cap the per-file list for display; the counts remain exact.
        deltas.truncate(50);

        Ok(SkillInstallPreview {
            skill_name,
            target_path: target_dir.to_string_lossy().into_owned(),
            target_exists,
            changed_count: changed,
            added_count: added,
            removed_count: removed,
            deltas,
        })
    } else if src_md.is_file() {
        let target_md = target_skills.join(format!("{skill_name}.md"));
        let target_exists = target_md.exists();
        let source_bytes = std::fs::metadata(&src_md).map(|m| m.len()).unwrap_or(0);
        let target_bytes = std::fs::metadata(&target_md).map(|m| m.len()).unwrap_or(0);
        let file = format!("{skill_name}.md");
        let (deltas, changed) = if !target_exists {
            (
                vec![SkillFileDelta {
                    file,
                    status: "added".into(),
                    source_bytes: source_bytes as i64,
                    target_bytes: 0,
                }],
                0,
            )
        } else if source_bytes != target_bytes {
            (
                vec![SkillFileDelta {
                    file,
                    status: "changed".into(),
                    source_bytes: source_bytes as i64,
                    target_bytes: target_bytes as i64,
                }],
                1,
            )
        } else {
            (Vec::new(), 0)
        };
        Ok(SkillInstallPreview {
            skill_name,
            target_path: target_md.to_string_lossy().into_owned(),
            target_exists,
            changed_count: changed,
            added_count: if !target_exists { 1 } else { 0 },
            removed_count: 0,
            deltas,
        })
    } else {
        Err(AppError::NotFound(format!(
            "source skill not found: {skill_name}"
        )))
    }
}

#[tauri::command]
pub fn skill_files_read(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    file_name: String,
    project_id: Option<String>,
) -> Result<SkillFileContent, AppError> {
    require_auth_sync(&state)?;

    let dir = skills_dir(&state, project_id.as_deref())?;
    let file_path = dir.join(&skill_name).join(&file_name);

    // Also try the skill as a direct .md file
    let file_path = if file_path.exists() {
        file_path
    } else {
        let alt = dir.join(format!("{skill_name}.md"));
        if alt.exists() && file_name == format!("{skill_name}.md") {
            alt
        } else {
            return Err(AppError::NotFound(format!(
                "Skill file not found: {skill_name}/{file_name}"
            )));
        }
    };

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Internal(format!("Failed to read skill file: {e}")))?;

    Ok(SkillFileContent {
        skill_name,
        file_name,
        content,
    })
}

#[tauri::command]
pub fn skill_files_write(
    state: State<'_, Arc<AppState>>,
    skill_name: String,
    file_name: String,
    content: String,
    project_id: Option<String>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;

    let dir = skills_dir(&state, project_id.as_deref())?;
    let file_path = dir.join(&skill_name).join(&file_name);

    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "Skill file not found: {skill_name}/{file_name}. Cannot create new files from UI."
        )));
    }

    // Validate the path is still within the skills directory (prevent path traversal)
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to canonicalize skills dir: {e}")))?;
    let canonical_file = file_path
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("Failed to canonicalize file path: {e}")))?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(AppError::Validation("Path traversal detected".into()));
    }

    std::fs::write(&file_path, &content)
        .map_err(|e| AppError::Internal(format!("Failed to write skill file: {e}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_skill_category_normalizes_and_rejects() {
        let md = "---\nname: x\ncategory: development\ndescription: d\n---\nBody";
        assert_eq!(extract_skill_category(md).as_deref(), Some("Development"));
        let quoted = "---\ncategory: \"Testing\"\n---\nBody";
        assert_eq!(extract_skill_category(quoted).as_deref(), Some("Testing"));
        // Unknown value, missing key, and no frontmatter all → None.
        assert_eq!(extract_skill_category("---\ncategory: Gardening\n---\n"), None);
        assert_eq!(extract_skill_category("---\nname: x\n---\n"), None);
        assert_eq!(extract_skill_category("# Just a heading\ncategory: Data"), None);
    }

    #[test]
    fn extract_skill_memory_normalizes_and_rejects() {
        let md = "---\nname: x\nmemory: Project\n---\nBody";
        assert_eq!(extract_skill_memory(md).as_deref(), Some("project"));
        assert_eq!(extract_skill_memory("---\nmemory: vault\n---\n").as_deref(), Some("vault"));
        assert_eq!(extract_skill_memory("---\nmemory: cloud\n---\n"), None);
        assert_eq!(extract_skill_memory("---\nname: x\n---\n"), None);
    }

    #[test]
    fn validate_skill_name_accepts_simple_segments() {
        assert!(validate_skill_name("research").is_ok());
        assert!(validate_skill_name("add-template").is_ok());
        assert!(validate_skill_name("code_review").is_ok());
    }

    #[test]
    fn validate_skill_name_rejects_traversal_and_separators() {
        assert!(validate_skill_name("").is_err());
        assert!(validate_skill_name("..").is_err());
        assert!(validate_skill_name("../evil").is_err());
        assert!(validate_skill_name("a/b").is_err());
        assert!(validate_skill_name("a\\b").is_err());
        assert!(validate_skill_name("C:\\windows").is_err());
    }

    #[test]
    fn extract_description_prefers_frontmatter() {
        let md = "---\nname: scan-security-auditor\ndescription: \"Find security holes.\"\n---\n# Security Auditor\nbody text\n";
        assert_eq!(extract_skill_description(md).as_deref(), Some("Find security holes."));
    }

    #[test]
    fn extract_description_frontmatter_without_desc_uses_body() {
        let md = "---\nname: x\n---\n# Heading\nFirst real line.\n";
        assert_eq!(extract_skill_description(md).as_deref(), Some("First real line."));
    }

    #[test]
    fn extract_description_no_frontmatter_uses_first_line() {
        let md = "# Title\nDo the thing.\n";
        assert_eq!(extract_skill_description(md).as_deref(), Some("Do the thing."));
    }

    fn write_skill(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn hash_skill_dir_excludes_provenance_and_is_stable() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("skill");
        write_skill(&dir, "---\nname: x\n---\n# X\n");
        let h1 = hash_skill_dir(&dir).unwrap();
        // Adding the provenance sidecar must NOT change the content hash.
        std::fs::write(dir.join(PROVENANCE_FILE), "{\"noise\":true}").unwrap();
        let h2 = hash_skill_dir(&dir).unwrap();
        assert_eq!(h1, h2, "provenance sidecar excluded from hash");
        // Editing real content DOES change it.
        write_skill(&dir, "---\nname: x\n---\n# X changed\n");
        assert_ne!(h1, hash_skill_dir(&dir).unwrap());
    }

    #[test]
    fn extract_skill_version_normalizes_and_rejects() {
        assert_eq!(
            extract_skill_version("---\nname: x\nversion: 2.1\n---\nBody").as_deref(),
            Some("2.1")
        );
        assert_eq!(
            extract_skill_version("---\nversion: \"10.42\"\n---\n").as_deref(),
            Some("10.42")
        );
        // Malformed shapes all normalize to None.
        for bad in ["v2", "1", "1.0.3", "two.one", "1.", ".5", "12345.0", ""] {
            let md = format!("---\nversion: {bad}\n---\n");
            assert_eq!(extract_skill_version(&md), None, "should reject {bad:?}");
        }
        // Missing key / no frontmatter.
        assert_eq!(extract_skill_version("---\nname: x\n---\n"), None);
        assert_eq!(extract_skill_version("version: 1.0\n"), None);
    }

    #[test]
    fn parse_skill_version_defaults_to_one_zero() {
        assert_eq!(parse_skill_version(Some("2.3")), (2, 3));
        assert_eq!(parse_skill_version(Some("10.0")), (10, 0));
        assert_eq!(parse_skill_version(None), (1, 0));
        assert_eq!(parse_skill_version(Some("garbage")), (1, 0));
        // Ordering works with plain tuple comparison.
        assert!(parse_skill_version(Some("2.0")) > parse_skill_version(Some("1.9")));
        assert!(parse_skill_version(Some("1.10")) > parse_skill_version(Some("1.9")));
    }

    #[test]
    fn hash_skill_dir_excludes_lessons_file() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        write_skill(&a, "---\nname: x\nversion: 1.0\n---\n# X\n");
        write_skill(&b, "---\nname: x\nversion: 1.0\n---\n# X\n");
        // Dirs differing ONLY in LESSONS.md (any casing) hash equal.
        std::fs::write(a.join("LESSONS.md"), "# Lessons — x\n\n## 1.0 — 2026-08-07 — personas\n- note\n").unwrap();
        std::fs::write(b.join("lessons.md"), "different lessons entirely\n").unwrap();
        assert_eq!(hash_skill_dir(&a), hash_skill_dir(&b), "LESSONS.md excluded from hash");
        // And a lessons append never flips sync_state.
        let source = tmp.path().join("src");
        let target = tmp.path().join("dst");
        write_skill(&source, "---\nname: x\n---\n# X\n");
        copy_dir_recursive(&source, &target).unwrap();
        write_provenance(&target, &source, "global", None);
        std::fs::write(target.join("LESSONS.md"), "## 1.0 — 2026-08-07 — personas\n- lesson\n").unwrap();
        assert_eq!(classify_sync_state(&target).0, SYNC_IN_SYNC);
    }

    #[test]
    fn classify_sync_state_local_only_without_provenance() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("skill");
        write_skill(&dir, "# hand-authored\n");
        let (state, kind) = classify_sync_state(&dir);
        assert_eq!(state, SYNC_LOCAL_ONLY);
        assert!(kind.is_none());
    }

    #[test]
    fn classify_sync_state_in_sync_then_diverged() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        let target = tmp.path().join("target");
        write_skill(&source, "---\nname: x\n---\n# X\nbody\n");
        // Simulate an install: copy + provenance stamp.
        copy_dir_recursive(&source, &target).unwrap();
        write_provenance(&target, &source, "global", None);

        let (state, kind) = classify_sync_state(&target);
        assert_eq!(state, SYNC_IN_SYNC, "fresh install matches its source");
        assert_eq!(kind.as_deref(), Some("global"));

        // Upstream source changes → diverged.
        write_skill(&source, "---\nname: x\n---\n# X v2\nnew body\n");
        assert_eq!(classify_sync_state(&target).0, SYNC_DIVERGED);

        // Bring target in line again, then locally edit the target → diverged.
        std::fs::write(target.join("SKILL.md"), "---\nname: x\n---\n# X v2\nnew body\n").unwrap();
        assert_eq!(classify_sync_state(&target).0, SYNC_IN_SYNC);
        std::fs::write(target.join("SKILL.md"), "---\nname: x\n---\n# locally hacked\n").unwrap();
        assert_eq!(classify_sync_state(&target).0, SYNC_DIVERGED);
    }
}
