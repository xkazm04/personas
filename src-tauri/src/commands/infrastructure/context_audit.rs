//! Advisory context-balance audit.
//!
//! Grades a project's contexts/groups against the canonical granularity policy
//! (parity with Vibeman's `audit.ts`). Advisory ONLY — it never blocks a scan
//! or a save. It is the feedback signal that tells a maintainer where the
//! context map has drifted: oversized/undersized contexts, groups whose context
//! count is out of range, missing/invalid categorization, and file overlap
//! (a file mapped into more than one context).

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use super::context_generation::{CONTEXT_CATEGORIES, GROUP_DOMAINS};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Cap on per-context dangling-file findings so a badly-drifted map can't
/// produce a thousand-line report. The total count is still reported in `totals`.
const MAX_DANGLING_FINDINGS: usize = 25;

/// Cap on listed unmapped files, like every other file-shaped finding: an
/// unscanned tree would otherwise emit one row per file.
const MAX_UNMAPPED_FINDINGS: usize = 25;

/// Share of the on-disk tree that may be unowned before the map is judged
/// incomplete rather than merely imperfect.
///
/// A floor rather than zero because a real repository always carries files no
/// context should claim (generated output, fixtures, one-off scripts), and a
/// map that covers 97% of the tree is not the failure this check is for. The
/// failure is a map that covers 9% and still grades `balanced`, because the
/// audit only ever looked at what the map already named: it proved mapped
/// paths still exist and never asked what exists that the map does not name.
const UNMAPPED_COVERAGE_FLOOR_PCT: usize = 5;

// Granularity policy (default tier). Mirrors Vibeman's `policy.ts` defaults.
const MIN_FILES_PER_CONTEXT: usize = 5;
const MAX_FILES_PER_CONTEXT: usize = 15;
const MIN_CONTEXTS_PER_GROUP: usize = 3;
const MAX_CONTEXTS_PER_GROUP: usize = 6;
/// Cap on per-file overlap findings so a badly-overlapping map can't produce a
/// thousand-line report. The total count is still reported in `totals`.
const MAX_OVERLAP_FINDINGS: usize = 25;
/// Cap on unresolved-cross-ref findings. Same reason as its two siblings above,
/// and the same omission that let one consolidation emit a 449-line wall: a
/// 449-line report is not a report. The exact total stays in
/// `totals.unresolved_cross_refs`, and a trailing `…_truncated` note says how
/// many were withheld — so the cap never hides the size of the problem.
const MAX_CROSS_REF_FINDINGS: usize = 25;

// Serialized to the frontend via serde; the TS contract is the inline
// `ContextAuditReport` in `src/api/devTools/devTools.ts` (not a ts_rs binding,
// so it never becomes an orphan flagged by check-unused-bindings).
#[derive(Debug, Clone, Serialize)]
pub struct ContextAuditFinding {
    /// "error" | "warn" | "info"
    pub severity: String,
    /// Machine-readable finding kind, e.g. "oversized_context".
    pub kind: String,
    /// The offending context/group/file name (empty for project-level notes).
    pub target: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextAuditTotals {
    pub groups: usize,
    pub contexts: usize,
    pub files_mapped: usize,
    pub uncategorized_contexts: usize,
    pub groups_missing_domain: usize,
    pub overlapping_files: usize,
    /// Referential integrity: mapped `file_paths` that no longer exist on disk.
    pub dangling_files: usize,
    /// Referential integrity: `cross_refs` naming a context that doesn't exist.
    pub unresolved_cross_refs: usize,
    /// Freshness: contexts with ≥1 mapped file whose content changed since the
    /// last scan (current on-disk hash ≠ cached hash). The map may be stale.
    pub stale_contexts: usize,
    /// Coverage: source files on disk that NO context claims. The exact count,
    /// never capped — the listed findings are capped, this number is not.
    /// `0` when the audit ran without a disk walk (`audit_from_db`).
    #[serde(default)]
    pub unmapped_files: usize,
    /// Source files the walk found, so a consumer can turn `unmapped_files`
    /// into a coverage ratio without re-walking. `0` without a disk walk.
    #[serde(default)]
    pub files_on_disk: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextAuditReport {
    pub project_id: String,
    pub generated_at: String,
    /// True when there are no `error`/`warn` findings — the map is within policy.
    pub balanced: bool,
    pub totals: ContextAuditTotals,
    pub findings: Vec<ContextAuditFinding>,
}

fn finding(severity: &str, kind: &str, target: &str, message: String) -> ContextAuditFinding {
    ContextAuditFinding {
        severity: severity.to_string(),
        kind: kind.to_string(),
        target: target.to_string(),
        message,
    }
}

fn parse_files(s: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(s).unwrap_or_default()
}

/// Pure audit over already-loaded groups + contexts. Deterministic output
/// (findings are emitted in a stable order) so callers can diff reports.
pub fn audit(
    project_id: &str,
    groups: &[crate::db::models::DevContextGroup],
    contexts: &[crate::db::models::DevContext],
    // Referential-integrity + freshness inputs. `None` skips the corresponding
    // check (e.g. the project root is unavailable) so the audit degrades
    // gracefully to the pure structural checks. `existing_files` is the set of
    // source-file paths currently on disk (relative, forward-slash); the two
    // hash maps are the current on-disk hashes and the last-scan cache.
    existing_files: Option<&HashSet<String>>,
    current_hashes: Option<&HashMap<String, String>>,
    cached_hashes: Option<&HashMap<String, String>>,
) -> ContextAuditReport {
    let mut findings: Vec<ContextAuditFinding> = Vec::new();
    let mut files_mapped = 0usize;
    let mut uncategorized = 0usize;
    let mut file_owners: HashMap<String, Vec<String>> = HashMap::new();

    // Name set for cross-ref resolution — a `cross_refs` entry must name a real
    // context. Built once up front so the per-context loop is O(refs).
    let context_names: HashSet<&str> = contexts.iter().map(|c| c.name.as_str()).collect();
    let mut dangling_files = 0usize;
    let mut dangling_emitted = 0usize;
    let mut unresolved_cross_refs = 0usize;
    let mut cross_ref_emitted = 0usize;
    let mut stale_contexts = 0usize;

    // --- Per-context checks (size + categorization + integrity + freshness) ---
    for c in contexts {
        let files = parse_files(&c.file_paths);
        files_mapped += files.len();
        for f in &files {
            file_owners
                .entry(f.clone())
                .or_default()
                .push(c.name.clone());
        }

        // Referential integrity: mapped file no longer exists on disk. Capped
        // so a wholesale directory move can't flood the report.
        if let Some(existing) = existing_files {
            for f in &files {
                if !existing.contains(f) {
                    dangling_files += 1;
                    if dangling_emitted < MAX_DANGLING_FINDINGS {
                        dangling_emitted += 1;
                        findings.push(finding(
                            "warn",
                            "dangling_file_path",
                            f.as_str(),
                            format!(
                                "Mapped by context \"{}\" but not found on disk. Rescan to prune.",
                                c.name
                            ),
                        ));
                    }
                }
            }
        }

        // Freshness: any mapped file whose current content differs from the
        // last scan means this context's decomposition may be stale.
        if let (Some(cur), Some(cache)) = (current_hashes, cached_hashes) {
            let drifted = files.iter().any(|f| match (cur.get(f), cache.get(f)) {
                (Some(now), Some(then)) => now != then,
                _ => false,
            });
            if drifted {
                stale_contexts += 1;
                findings.push(finding(
                    "info",
                    "stale_context",
                    &c.name,
                    "Mapped files changed since the last scan — rescan to refresh this context."
                        .to_string(),
                ));
            }
        }

        // Referential integrity: cross_refs must name real contexts. Capped so
        // one bad consolidation can't bury every other finding.
        for r in parse_files(c.cross_refs.as_deref().unwrap_or("[]")) {
            if !context_names.contains(r.as_str()) {
                unresolved_cross_refs += 1;
                if cross_ref_emitted < MAX_CROSS_REF_FINDINGS {
                    cross_ref_emitted += 1;
                    findings.push(finding(
                        "warn",
                        "unresolved_cross_ref",
                        &c.name,
                        format!("cross_ref \"{r}\" names no existing context."),
                    ));
                }
            }
        }

        let n = files.len();
        if n == 0 {
            findings.push(finding(
                "error",
                "empty_context",
                &c.name,
                "Maps zero files — assign files or remove the context.".to_string(),
            ));
        } else if n > MAX_FILES_PER_CONTEXT {
            findings.push(finding(
                "warn",
                "oversized_context",
                &c.name,
                format!("{n} files (> {MAX_FILES_PER_CONTEXT}). Split at a clean boundary."),
            ));
        } else if n < MIN_FILES_PER_CONTEXT {
            findings.push(finding(
                "warn",
                "undersized_context",
                &c.name,
                format!(
                    "{n} files (< {MIN_FILES_PER_CONTEXT}). Consider merging with a sibling sharing a DB table / API namespace."
                ),
            ));
        }

        match c.category.as_deref() {
            None => {
                uncategorized += 1;
                findings.push(finding(
                    "warn",
                    "uncategorized_context",
                    &c.name,
                    "Missing category (ui|api|lib|data|test|config).".to_string(),
                ));
            }
            Some(cat) if !CONTEXT_CATEGORIES.contains(&cat) => {
                uncategorized += 1;
                findings.push(finding(
                    "error",
                    "invalid_category",
                    &c.name,
                    format!("Category \"{cat}\" is not in the taxonomy."),
                ));
            }
            _ => {}
        }
    }

    // --- Per-group checks (count + domain) ---
    let mut groups_missing_domain = 0usize;
    for g in groups {
        let count = contexts
            .iter()
            .filter(|c| c.group_id.as_deref() == Some(g.id.as_str()))
            .count();
        if count == 0 {
            findings.push(finding(
                "info",
                "empty_group",
                &g.name,
                "Group has no contexts.".to_string(),
            ));
        } else if count > MAX_CONTEXTS_PER_GROUP {
            findings.push(finding(
                "warn",
                "group_too_many_contexts",
                &g.name,
                format!(
                    "{count} contexts (> {MAX_CONTEXTS_PER_GROUP}). Consider splitting the group."
                ),
            ));
        } else if count < MIN_CONTEXTS_PER_GROUP {
            findings.push(finding(
                "warn",
                "group_too_few_contexts",
                &g.name,
                format!("{count} contexts (< {MIN_CONTEXTS_PER_GROUP}). Consider merging."),
            ));
        }

        match g.domain.as_deref() {
            None => {
                groups_missing_domain += 1;
                findings.push(finding(
                    "warn",
                    "group_missing_domain",
                    &g.name,
                    "Missing domain (feature|infrastructure|shared|integration|data).".to_string(),
                ));
            }
            Some(d) if !GROUP_DOMAINS.contains(&d) => {
                groups_missing_domain += 1;
                findings.push(finding(
                    "error",
                    "invalid_domain",
                    &g.name,
                    format!("Domain \"{d}\" is not in the taxonomy."),
                ));
            }
            _ => {}
        }
    }

    // --- File overlap (deterministic: sort offending files by name) ---
    let mut overlaps: Vec<(&String, &Vec<String>)> = file_owners
        .iter()
        .filter(|(_, owners)| owners.len() > 1)
        .collect();
    overlaps.sort_by(|a, b| a.0.cmp(b.0));
    let overlapping_files = overlaps.len();
    for (file, owners) in overlaps.iter().take(MAX_OVERLAP_FINDINGS) {
        findings.push(finding(
            "warn",
            "file_overlap",
            file.as_str(),
            format!(
                "Mapped in {} contexts: {}. Each file should belong to exactly one context.",
                owners.len(),
                owners.join(", ")
            ),
        ));
    }
    if overlapping_files > MAX_OVERLAP_FINDINGS {
        findings.push(finding(
            "info",
            "file_overlap_truncated",
            "",
            format!(
                "{} more overlapping files not listed.",
                overlapping_files - MAX_OVERLAP_FINDINGS
            ),
        ));
    }
    // --- Coverage: what is on disk that the map does not name ---
    //
    // The audit's other file checks all start FROM the map, so whatever the map
    // omits is invisible to them by construction. This is the one check that
    // starts from the tree.
    let mut unmapped_files = 0usize;
    let mut files_on_disk = 0usize;
    if let Some(existing) = existing_files {
        files_on_disk = existing.len();
        let mut unmapped: Vec<&String> = existing
            .iter()
            .filter(|f| !file_owners.contains_key(*f))
            .collect();
        unmapped.sort();
        unmapped_files = unmapped.len();
        if unmapped_files > 0 {
            // Above the floor the map is incomplete, which is a `warn` and
            // therefore costs `balanced`. At or below it, the count is still
            // reported — as `info`, so a tidy map is not failed by its own
            // generated fixtures.
            let over_floor = unmapped_files * 100 > files_on_disk * UNMAPPED_COVERAGE_FLOOR_PCT;
            let severity = if over_floor { "warn" } else { "info" };
            for f in unmapped.iter().take(MAX_UNMAPPED_FINDINGS) {
                findings.push(finding(
                    severity,
                    "unmapped_file",
                    f.as_str(),
                    "On disk but claimed by no context. Rescan, or assign it to one.".to_string(),
                ));
            }
            if unmapped_files > MAX_UNMAPPED_FINDINGS {
                findings.push(finding(
                    "info",
                    "unmapped_file_truncated",
                    "",
                    format!(
                        "{} more unmapped files not listed ({unmapped_files} of {files_on_disk} on disk are unowned).",
                        unmapped_files - MAX_UNMAPPED_FINDINGS
                    ),
                ));
            }
        }
    }

    if dangling_files > MAX_DANGLING_FINDINGS {
        findings.push(finding(
            "info",
            "dangling_file_path_truncated",
            "",
            format!(
                "{} more dangling files not listed.",
                dangling_files - MAX_DANGLING_FINDINGS
            ),
        ));
    }
    if unresolved_cross_refs > MAX_CROSS_REF_FINDINGS {
        findings.push(finding(
            "info",
            "unresolved_cross_ref_truncated",
            "",
            format!(
                "{} more unresolved cross-refs not listed.",
                unresolved_cross_refs - MAX_CROSS_REF_FINDINGS
            ),
        ));
    }

    let balanced = !findings
        .iter()
        .any(|f| f.severity == "error" || f.severity == "warn");

    ContextAuditReport {
        project_id: project_id.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        balanced,
        totals: ContextAuditTotals {
            groups: groups.len(),
            contexts: contexts.len(),
            files_mapped,
            uncategorized_contexts: uncategorized,
            groups_missing_domain,
            overlapping_files,
            dangling_files,
            unresolved_cross_refs,
            stale_contexts,
            unmapped_files,
            files_on_disk,
        },
        findings,
    }
}

/// Run the structural + referential half of the audit straight from the DB.
///
/// Skips the on-disk walk, so `dangling_file_path` and `stale_context` are not
/// evaluated — which is exactly right for the automatic callers (a scan has
/// just pruned dangling paths and refreshed the hash cache; a consolidation
/// never touches the filesystem). Cheap enough to run on every one of them.
pub fn audit_from_db(
    pool: &crate::db::DbPool,
    project_id: &str,
) -> Result<ContextAuditReport, AppError> {
    let groups = repo::list_context_groups(pool, project_id)?;
    let contexts = repo::list_contexts_by_project(pool, project_id, None)?;
    Ok(audit(project_id, &groups, &contexts, None, None, None))
}

/// One line naming what the audit found, for an operator-facing log or bridge
/// response. Referential integrity first: a dead pointer is read as ground
/// truth by the next agent, which is worse than a context being the wrong size.
///
/// This is Layer-1 operator text (scan stream / loopback bridge), never React
/// copy — the UI renders `kind` codes through i18n, not these sentences.
pub fn summarize(report: &ContextAuditReport) -> String {
    let t = &report.totals;
    let mut parts: Vec<String> = Vec::new();
    if t.unresolved_cross_refs > 0 {
        parts.push(format!(
            "{} unresolved cross-ref(s)",
            t.unresolved_cross_refs
        ));
    }
    if t.dangling_files > 0 {
        parts.push(format!("{} dangling file path(s)", t.dangling_files));
    }
    if t.overlapping_files > 0 {
        parts.push(format!(
            "{} file(s) in more than one context",
            t.overlapping_files
        ));
    }
    if t.unmapped_files > 0 {
        parts.push(format!(
            "{} file(s) on disk owned by no context (of {})",
            t.unmapped_files, t.files_on_disk
        ));
    }
    if t.uncategorized_contexts > 0 {
        parts.push(format!(
            "{} uncategorized context(s)",
            t.uncategorized_contexts
        ));
    }
    if t.groups_missing_domain > 0 {
        parts.push(format!(
            "{} group(s) missing a domain",
            t.groups_missing_domain
        ));
    }
    let head = format!("{} context(s) in {} group(s)", t.contexts, t.groups);
    if parts.is_empty() {
        format!("{head} — within policy")
    } else {
        format!("{head} — {}", parts.join(", "))
    }
}

/// Walk the project root and build the integrity/freshness inputs for `audit`:
/// the set of source files currently on disk plus their current hashes.
/// Returns `(existing_files, current_hashes)`. Errors degrade to empty inputs
/// (the audit then skips the disk-backed checks) rather than failing.
fn scan_current_state(root: &std::path::Path) -> (HashSet<String>, HashMap<String, String>) {
    match super::incremental_scan::walk_project_files(root) {
        Ok(entries) => {
            let existing = entries.iter().map(|e| e.path.clone()).collect();
            let hashes = entries.into_iter().map(|e| (e.path, e.sha256)).collect();
            (existing, hashes)
        }
        Err(e) => {
            tracing::warn!(error = %e, "context audit: project walk failed; skipping disk checks");
            (HashSet::new(), HashMap::new())
        }
    }
}

/// Tauri command: run the audit for a project. Never mutates state — this is
/// the read-only integrity+freshness report. The referential-integrity checks
/// (dangling files, staleness) walk the project root; the walk is offloaded so
/// the IPC handler doesn't park a Tokio worker. If the root can't be resolved
/// or walked, the audit degrades to the structural checks only.
#[tauri::command]
pub async fn dev_tools_audit_contexts(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<ContextAuditReport, AppError> {
    require_auth(&state).await?;
    let groups = repo::list_context_groups(&state.db, &project_id)?;
    let contexts = repo::list_contexts_by_project(&state.db, &project_id, None)?;
    let cached = repo::get_file_hashes(&state.db, &project_id).unwrap_or_default();

    // Resolve the project root; missing project => structural-only audit.
    let (existing, current) = match repo::get_project_by_id(&state.db, &project_id) {
        Ok(project) => {
            let root = PathBuf::from(&project.root_path);
            tokio::task::spawn_blocking(move || scan_current_state(&root))
                .await
                .map_err(|e| AppError::Internal(format!("audit walk join error: {e}")))?
        }
        Err(_) => (HashSet::new(), HashMap::new()),
    };

    let existing_opt = if existing.is_empty() {
        None
    } else {
        Some(&existing)
    };
    let hashes_opt = if current.is_empty() {
        None
    } else {
        Some(&current)
    };
    let cached_opt = if cached.is_empty() {
        None
    } else {
        Some(&cached)
    };

    Ok(audit(
        &project_id,
        &groups,
        &contexts,
        existing_opt,
        hashes_opt,
        cached_opt,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::DevContext;

    fn ctx(name: &str, files: &[&str], cross_refs: &[&str]) -> DevContext {
        DevContext {
            id: format!("id-{name}"),
            project_id: "p".into(),
            group_id: None,
            name: name.into(),
            description: None,
            file_paths: serde_json::to_string(files).unwrap(),
            entry_points: None,
            db_tables: None,
            keywords: None,
            api_surface: None,
            cross_refs: Some(serde_json::to_string(cross_refs).unwrap()),
            tech_stack: None,
            category: Some("lib".into()),
            business_feature: None,
            pinned: false,
            created_at: "t".into(),
            updated_at: "t".into(),
        }
    }

    fn has(report: &ContextAuditReport, kind: &str) -> bool {
        report.findings.iter().any(|f| f.kind == kind)
    }

    #[test]
    fn dangling_file_flagged_when_not_on_disk() {
        let c = ctx("alpha", &["src/live.rs", "src/gone.rs"], &[]);
        let existing: HashSet<String> = ["src/live.rs".to_string()].into_iter().collect();
        let r = audit("p", &[], &[c], Some(&existing), None, None);
        assert!(has(&r, "dangling_file_path"));
        assert_eq!(r.totals.dangling_files, 1);
    }

    #[test]
    fn no_dangling_check_without_disk_input() {
        let c = ctx("alpha", &["src/gone.rs"], &[]);
        let r = audit("p", &[], &[c], None, None, None);
        assert!(!has(&r, "dangling_file_path"));
        assert_eq!(r.totals.dangling_files, 0);
    }

    #[test]
    fn unresolved_cross_ref_flagged() {
        let a = ctx("alpha", &["a.rs"], &["beta", "ghost"]);
        let b = ctx("beta", &["b.rs"], &[]);
        let r = audit("p", &[], &[a, b], None, None, None);
        assert!(has(&r, "unresolved_cross_ref"));
        assert_eq!(
            r.totals.unresolved_cross_refs, 1,
            "only 'ghost' is unresolved"
        );
    }

    #[test]
    fn unresolved_cross_refs_are_capped_but_the_total_is_not() {
        let ghosts: Vec<String> = (0..80).map(|i| format!("ghost-{i}")).collect();
        let refs: Vec<&str> = ghosts.iter().map(String::as_str).collect();
        let a = ctx("alpha", &["a.rs"], &refs);
        let r = audit("p", &[], &[a], None, None, None);
        assert_eq!(
            r.totals.unresolved_cross_refs, 80,
            "the true total is always reported"
        );
        assert_eq!(
            r.findings
                .iter()
                .filter(|f| f.kind == "unresolved_cross_ref")
                .count(),
            MAX_CROSS_REF_FINDINGS,
            "findings are capped like dangling_file_path and file_overlap"
        );
        let note = r
            .findings
            .iter()
            .find(|f| f.kind == "unresolved_cross_ref_truncated")
            .expect("a cap that hides its own size is worse than no cap");
        assert!(
            note.message.contains("55"),
            "says how many were withheld: {}",
            note.message
        );
    }

    #[test]
    fn summarize_names_the_integrity_problems_first() {
        let a = ctx("alpha", &["a.rs"], &["ghost"]);
        let r = audit("p", &[], &[a], None, None, None);
        let line = summarize(&r);
        assert!(line.contains("1 unresolved cross-ref"), "{line}");
    }

    #[test]
    fn stale_context_flagged_on_hash_drift() {
        let c = ctx("alpha", &["a.rs"], &[]);
        let cur: HashMap<String, String> = [("a.rs".to_string(), "newsha".to_string())]
            .into_iter()
            .collect();
        let cache: HashMap<String, String> = [("a.rs".to_string(), "oldsha".to_string())]
            .into_iter()
            .collect();
        let r = audit("p", &[], &[c], None, Some(&cur), Some(&cache));
        assert!(has(&r, "stale_context"));
        assert_eq!(r.totals.stale_contexts, 1);
    }

    #[test]
    fn fresh_context_not_flagged_when_hash_matches() {
        let c = ctx("alpha", &["a.rs"], &[]);
        let same: HashMap<String, String> = [("a.rs".to_string(), "sha".to_string())]
            .into_iter()
            .collect();
        let r = audit("p", &[], &[c], None, Some(&same), Some(&same));
        assert!(!has(&r, "stale_context"));
    }

    /// The hole this check closes: every other file finding starts FROM the
    /// map, so a map that names 1 of 20 files on disk passed the audit with no
    /// warning at all. Coverage is the one question that has to start from the
    /// tree.
    #[test]
    fn files_on_disk_that_no_context_claims_are_counted_and_cost_balanced() {
        let c = ctx("alpha", &["src/a.rs"], &[]);
        let existing: HashSet<String> = (0..20)
            .map(|i| format!("src/f{i}.rs"))
            .chain(["src/a.rs".to_string()])
            .collect();
        let r = audit("p", &[], &[c], Some(&existing), None, None);
        assert_eq!(r.totals.unmapped_files, 20);
        assert_eq!(r.totals.files_on_disk, 21);
        assert!(has(&r, "unmapped_file"));
        assert!(!r.balanced, "a map that owns 1 of 21 files is not balanced");
    }

    /// A tidy map is not failed by the handful of files no context should own.
    /// Below the floor the count is still reported, as `info`.
    #[test]
    fn a_handful_of_unowned_files_is_reported_without_failing_the_map() {
        // 100 files with 2 unowned = 2%, comfortably under the floor.
        let tree = MAX_UNMAPPED_FINDINGS * 4;
        let files: Vec<String> = (0..tree).map(|i| format!("src/f{i}.rs")).collect();
        let mapped: Vec<&str> = files.iter().take(tree - 2).map(|s| s.as_str()).collect();
        // Five contexts so the per-context size checks stay quiet.
        let contexts: Vec<_> = mapped
            .chunks(10)
            .enumerate()
            .map(|(i, chunk)| ctx(&format!("c{i}"), chunk, &[]))
            .collect();
        let existing: HashSet<String> = files.iter().cloned().collect();
        let r = audit("p", &[], &contexts, Some(&existing), None, None);
        assert_eq!(r.totals.unmapped_files, 2, "2 of 100 is under the 5% floor");
        assert!(has(&r, "unmapped_file"), "still reported");
        assert!(
            r.findings
                .iter()
                .filter(|f| f.kind == "unmapped_file")
                .all(|f| f.severity == "info"),
            "under the floor it is info, not warn"
        );
    }

    /// The listing is capped like every other file finding; the TOTAL is not.
    #[test]
    fn the_unmapped_listing_is_capped_but_the_count_is_exact() {
        let c = ctx("alpha", &["src/a.rs"], &[]);
        let existing: HashSet<String> = (0..MAX_UNMAPPED_FINDINGS + 7)
            .map(|i| format!("src/f{i}.rs"))
            .collect();
        let r = audit("p", &[], &[c], Some(&existing), None, None);
        assert_eq!(r.totals.unmapped_files, MAX_UNMAPPED_FINDINGS + 7);
        assert_eq!(
            r.findings
                .iter()
                .filter(|f| f.kind == "unmapped_file")
                .count(),
            MAX_UNMAPPED_FINDINGS
        );
        assert!(has(&r, "unmapped_file_truncated"));
    }

    /// Without a disk walk there is no tree to compare against, so the check
    /// reports nothing rather than guessing zero coverage.
    #[test]
    fn no_coverage_check_without_disk_input() {
        let c = ctx("alpha", &["src/a.rs"], &[]);
        let r = audit("p", &[], &[c], None, None, None);
        assert_eq!(r.totals.unmapped_files, 0);
        assert_eq!(r.totals.files_on_disk, 0);
        assert!(!has(&r, "unmapped_file"));
    }
}
