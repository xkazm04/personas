//! Advisory context-balance audit.
//!
//! Grades a project's contexts/groups against the canonical granularity policy
//! (parity with Vibeman's `audit.ts`). Advisory ONLY — it never blocks a scan
//! or a save. It is the feedback signal that tells a maintainer where the
//! context map has drifted: oversized/undersized contexts, groups whose context
//! count is out of range, missing/invalid categorization, and file overlap
//! (a file mapped into more than one context).

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

use super::context_generation::{CONTEXT_CATEGORIES, GROUP_DOMAINS};
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

// Granularity policy (default tier). Mirrors Vibeman's `policy.ts` defaults.
const MIN_FILES_PER_CONTEXT: usize = 5;
const MAX_FILES_PER_CONTEXT: usize = 15;
const MIN_CONTEXTS_PER_GROUP: usize = 3;
const MAX_CONTEXTS_PER_GROUP: usize = 6;
/// Cap on per-file overlap findings so a badly-overlapping map can't produce a
/// thousand-line report. The total count is still reported in `totals`.
const MAX_OVERLAP_FINDINGS: usize = 25;

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
) -> ContextAuditReport {
    let mut findings: Vec<ContextAuditFinding> = Vec::new();
    let mut files_mapped = 0usize;
    let mut uncategorized = 0usize;
    let mut file_owners: HashMap<String, Vec<String>> = HashMap::new();

    // --- Per-context checks (size + categorization) ---
    for c in contexts {
        let files = parse_files(&c.file_paths);
        files_mapped += files.len();
        for f in &files {
            file_owners.entry(f.clone()).or_default().push(c.name.clone());
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
                format!("{count} contexts (> {MAX_CONTEXTS_PER_GROUP}). Consider splitting the group."),
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
    let mut overlaps: Vec<(&String, &Vec<String>)> =
        file_owners.iter().filter(|(_, owners)| owners.len() > 1).collect();
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
        },
        findings,
    }
}

/// Tauri command: run the advisory audit for a project. Never mutates state.
#[tauri::command]
pub fn dev_tools_audit_contexts(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<ContextAuditReport, AppError> {
    require_auth_sync(&state)?;
    let groups = repo::list_context_groups(&state.db, &project_id)?;
    let contexts = repo::list_contexts_by_project(&state.db, &project_id, None)?;
    Ok(audit(&project_id, &groups, &contexts))
}
