//! Doc-rot telemetry (Brainiac-adoption P2 — docs/plans/brainiac-adoption-
//! skills-memory-docs.md).
//!
//! Brainiac's document layer marks a page `dirty_at` the moment an underlying
//! memory changes, and its `document_reads` log carries `was_dirty` so rot
//! that is actually being CONSUMED ranks first. Repo docs are authored files,
//! not projections — so the local analog of `dirty_at` is a deterministic GIT
//! signal: a doc is dirty when its coupled source scope has commits newer than
//! the doc's own last commit.
//!
//! Coupling, in order of authority:
//!   1. an explicit doc-map manifest (`scripts/docs/feature-doc-map.json`,
//!      entries `{doc, sourceGlobs}`) — the "freshness is managed" signal;
//!   2. a heuristic: repo paths the doc itself references (tokens starting
//!      with a real top-level dir), verified to exist;
//!   3. neither → the doc is UNSCOPED: tracked but never dirty-able. Unknown
//!      coupling is not rot — inventing it would make the signal cry wolf.
//!
//! One bounded `git log --name-only` per repo builds a path → newest-commit
//! map; everything else is in-memory. Reads come from the transcript miner
//! (skill_usage.rs), stamped `was_dirty` against this table at insert time.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Commit horizon for the per-path newest-commit map. A doc/source untouched
/// this deep reads as "older than the horizon" (ts 0), which biases toward
/// dirty only when a coupled source DID change inside the horizon — honest.
const GIT_LOG_HORIZON: u32 = 5000;
/// Max docs tracked per repo (docs/** + README) — beyond this, we truncate
/// and say so in the summary rather than walk a wiki forever.
const MAX_DOCS_PER_REPO: usize = 400;
/// Re-scan throttle: a project scanned more recently than this is skipped
/// unless `force` — the wall remounts far more often than docs rot.
const RESCAN_MIN_HOURS: i64 = 6;
/// Cap on referenced-path prefixes the heuristic extracts per doc.
const MAX_SCOPE_PREFIXES: usize = 20;
/// Cap on changed-source paths carried as evidence per dirty doc.
const MAX_CHANGED_EVIDENCE: usize = 10;

#[derive(Debug, Default, Serialize)]
pub struct DocRotScanSummary {
    pub projects_scanned: u32,
    /// Skipped because their last scan is fresher than the throttle.
    pub projects_skipped_fresh: u32,
    /// Skipped because `git log` failed (not a repo / git missing).
    pub projects_no_git: u32,
    pub docs_tracked: u32,
    pub dirty: u32,
    pub docs_truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct DocRotRow {
    pub project_id: String,
    /// Repo-relative, forward slashes.
    pub doc_path: String,
    /// NULL coupling = unscoped (tracked, never dirty-able).
    pub unscoped: bool,
    pub last_doc_commit: Option<String>,
    pub last_source_commit: Option<String>,
    /// The local `dirty_at` — set while coupled sources are newer than the doc.
    pub dirty_since: Option<String>,
    /// Changed source paths newer than the doc (evidence, capped).
    pub changed_sources: Vec<String>,
    pub scanned_at: String,
    pub reads_30d: i64,
    /// Reads that happened while the doc was already dirty — rot being
    /// consumed (Brainiac's harm-ranking signal).
    pub dirty_reads_30d: i64,
    pub last_read_at: Option<String>,
}

// ============================================================================
// Git + filesystem groundwork
// ============================================================================

fn fmt_unix(ts: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default()
}

/// path (repo-relative, forward slashes) → newest commit unix ts, from one
/// bounded `git log`. None when git fails (not a repo, git absent).
fn git_recent_paths(root: &Path) -> Option<HashMap<String, i64>> {
    let out = std::process::Command::new("git")
        .args([
            "log",
            &format!("-n{GIT_LOG_HORIZON}"),
            "--format=\u{1}%ct",
            "--name-only",
        ])
        .current_dir(root)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut map: HashMap<String, i64> = HashMap::new();
    let mut current_ts: i64 = 0;
    for line in text.lines() {
        if let Some(ts) = line.strip_prefix('\u{1}') {
            current_ts = ts.trim().parse().unwrap_or(0);
        } else if !line.trim().is_empty() {
            // newest-first log → first occurrence IS the newest commit.
            map.entry(line.trim().to_string()).or_insert(current_ts);
        }
    }
    Some(map)
}

/// docs/**/*.md(x) (bounded) + root README.md, repo-relative forward slashes.
fn list_docs(root: &Path) -> (Vec<String>, bool) {
    let mut docs: Vec<String> = Vec::new();
    let mut truncated = false;
    if root.join("README.md").is_file() {
        docs.push("README.md".into());
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.join("docs"), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            if docs.len() >= MAX_DOCS_PER_REPO {
                truncated = true;
                return (docs, truncated);
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if depth < 5 && !name.starts_with('.') {
                    stack.push((path, depth + 1));
                }
            } else {
                let lower = name.to_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".mdx") {
                    if let Ok(rel) = path.strip_prefix(root) {
                        docs.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
    }
    (docs, truncated)
}

/// Static prefix of a glob — everything before the first wildcard, trimmed to
/// its directory part. "src/features/teams/**" → "src/features/teams/".
fn glob_prefix(glob: &str) -> String {
    let cut = glob.find(['*', '?']).unwrap_or(glob.len());
    let head = &glob[..cut];
    match head.rfind('/') {
        Some(i) => head[..=i].to_string(),
        None => head.to_string(),
    }
}

/// Doc-map manifest → doc path → coupled source prefixes.
fn parse_doc_map(root: &Path) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    for rel in ["scripts/docs/feature-doc-map.json", "docs/feature-doc-map.json", "feature-doc-map.json"] {
        let Ok(txt) = std::fs::read_to_string(root.join(rel)) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) else { continue };
        let entries = v.get("entries").and_then(|e| e.as_array()).cloned()
            .or_else(|| v.as_array().cloned())
            .unwrap_or_default();
        for e in entries {
            let Some(doc) = e.get("doc").and_then(|d| d.as_str()) else { continue };
            let globs: Vec<String> = e
                .get("sourceGlobs")
                .and_then(|g| g.as_array())
                .map(|a| a.iter().filter_map(|s| s.as_str()).map(glob_prefix).filter(|p| !p.is_empty()).collect())
                .unwrap_or_default();
            if !globs.is_empty() {
                out.insert(doc.to_string(), globs);
            }
        }
        break; // first manifest wins
    }
    out
}

/// Heuristic coupling: repo paths the doc TEXT references. A token must start
/// with a real top-level dir and resolve to something that exists — invented
/// coupling would make the rot signal meaningless.
fn heuristic_scope(root: &Path, doc_rel: &str, top_dirs: &[String]) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(root.join(doc_rel)) else { return Vec::new() };
    let text = if text.len() > 131_072 { &text[..131_072] } else { &text[..] };
    let mut prefixes: Vec<String> = Vec::new();
    for top in top_dirs {
        if top == "docs" {
            continue; // docs referencing docs is navigation, not coupling
        }
        let needle = format!("{top}/");
        let mut rest = text;
        while let Some(pos) = rest.find(&needle) {
            let tail = &rest[pos..];
            let token: String = tail
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '.'))
                .collect();
            rest = &rest[pos + needle.len()..];
            let token = token.trim_end_matches(['.', '/']);
            if token.len() <= needle.len() {
                continue;
            }
            // Couple to the token's DIRECTORY (a file reference couples to its
            // folder — sibling churn is what makes prose stale).
            let dir = match token.rfind('/') {
                Some(i) if root.join(&token[..i]).is_dir() => format!("{}/", &token[..i]),
                _ if root.join(token).is_dir() => format!("{token}/"),
                _ => continue,
            };
            if !prefixes.iter().any(|p| dir.starts_with(p.as_str())) {
                prefixes.retain(|p| !p.starts_with(&dir));
                prefixes.push(dir);
                if prefixes.len() >= MAX_SCOPE_PREFIXES {
                    return prefixes;
                }
            }
        }
    }
    prefixes
}

// ============================================================================
// The scan
// ============================================================================

struct DocVerdict {
    doc_path: String,
    scope: Option<Vec<String>>,
    doc_ts: i64,
    source_ts: i64,
    dirty_since_ts: Option<i64>,
    changed: Vec<String>,
}

fn judge_doc(
    doc: &str,
    scope: Option<&Vec<String>>,
    path_ts: &HashMap<String, i64>,
) -> DocVerdict {
    let doc_ts = *path_ts.get(doc).unwrap_or(&0);
    let mut source_ts = 0i64;
    let mut changed: Vec<(i64, String)> = Vec::new();
    if let Some(prefixes) = scope {
        for (path, &ts) in path_ts {
            if path == doc {
                continue;
            }
            if prefixes.iter().any(|p| path.starts_with(p.as_str())) {
                source_ts = source_ts.max(ts);
                if ts > doc_ts {
                    changed.push((ts, path.clone()));
                }
            }
        }
    }
    // dirty_since = the OLDEST source change the doc hasn't caught up with —
    // "stale since June", not "stale as of the latest commit".
    changed.sort();
    let dirty_since_ts = changed.first().map(|(ts, _)| *ts);
    let changed: Vec<String> = changed
        .into_iter()
        .rev() // newest first for evidence display
        .take(MAX_CHANGED_EVIDENCE)
        .map(|(_, p)| p)
        .collect();
    DocVerdict {
        doc_path: doc.to_string(),
        scope: scope.cloned(),
        doc_ts,
        source_ts,
        dirty_since_ts,
        changed,
    }
}

#[tauri::command]
pub fn doc_rot_scan(
    state: State<'_, Arc<AppState>>,
    force: Option<bool>,
) -> Result<DocRotScanSummary, AppError> {
    require_auth_sync(&state)?;
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;
    let force = force.unwrap_or(false);
    let mut summary = DocRotScanSummary::default();

    let projects: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, root_path FROM dev_projects")
            .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;
        rows.flatten().collect()
    };

    for (pid, root_str) in &projects {
        // Throttle — rot moves at commit speed, not remount speed.
        if !force {
            let fresh: bool = conn
                .query_row(
                    "SELECT MAX(scanned_at) >= datetime('now', ?2) FROM doc_status WHERE project_id = ?1",
                    rusqlite::params![pid, format!("-{RESCAN_MIN_HOURS} hours")],
                    |r| r.get::<_, Option<bool>>(0),
                )
                .ok()
                .flatten()
                .unwrap_or(false);
            if fresh {
                summary.projects_skipped_fresh += 1;
                continue;
            }
        }

        let root = Path::new(root_str);
        let Some(path_ts) = git_recent_paths(root) else {
            summary.projects_no_git += 1;
            continue;
        };
        let (docs, truncated) = list_docs(root);
        summary.docs_truncated |= truncated;
        let doc_map = parse_doc_map(root);
        let top_dirs: Vec<String> = std::fs::read_dir(root)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| !n.starts_with('.') && n != "node_modules" && n != "target")
                    .collect()
            })
            .unwrap_or_default();

        for doc in &docs {
            let mapped = doc_map.get(doc).cloned();
            let scope = match mapped {
                Some(s) => Some(s),
                None => {
                    let h = heuristic_scope(root, doc, &top_dirs);
                    if h.is_empty() { None } else { Some(h) }
                }
            };
            let v = judge_doc(doc, scope.as_ref(), &path_ts);
            let scope_json = v.scope.as_ref().map(|s| serde_json::to_string(s).unwrap_or_default());
            let changed_json = serde_json::to_string(&v.changed).unwrap_or_else(|_| "[]".into());
            let dirty_since = v.dirty_since_ts.map(fmt_unix);
            if dirty_since.is_some() {
                summary.dirty += 1;
            }
            conn.execute(
                "INSERT INTO doc_status
                   (project_id, doc_path, coupled_scope, last_doc_commit, last_source_commit,
                    dirty_since, changed_sources, scanned_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
                 ON CONFLICT(project_id, doc_path) DO UPDATE SET
                   coupled_scope = excluded.coupled_scope,
                   last_doc_commit = excluded.last_doc_commit,
                   last_source_commit = excluded.last_source_commit,
                   -- keep the EARLIEST dirty stamp while still dirty; clear when clean
                   dirty_since = CASE
                     WHEN excluded.dirty_since IS NULL THEN NULL
                     WHEN doc_status.dirty_since IS NOT NULL AND doc_status.dirty_since < excluded.dirty_since
                       THEN doc_status.dirty_since
                     ELSE excluded.dirty_since END,
                   changed_sources = excluded.changed_sources,
                   scanned_at = datetime('now')",
                rusqlite::params![
                    pid,
                    v.doc_path,
                    scope_json,
                    (v.doc_ts > 0).then(|| fmt_unix(v.doc_ts)),
                    (v.source_ts > 0).then(|| fmt_unix(v.source_ts)),
                    dirty_since,
                    changed_json,
                ],
            )?;
            summary.docs_tracked += 1;
        }

        // A deleted doc is a projection of nothing — drop its row (its read
        // events stay; they're history).
        let placeholders = if docs.is_empty() {
            "''".to_string()
        } else {
            docs.iter().map(|_| "?").collect::<Vec<_>>().join(",")
        };
        let sql = format!(
            "DELETE FROM doc_status WHERE project_id = ?1 AND doc_path NOT IN ({placeholders})"
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(pid.clone())];
        for d in &docs {
            params.push(Box::new(d.clone()));
        }
        conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))?;

        summary.projects_scanned += 1;
    }

    Ok(summary)
}

#[tauri::command]
pub fn doc_rot_overview(state: State<'_, Arc<AppState>>) -> Result<Vec<DocRotRow>, AppError> {
    require_auth_sync(&state)?;
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("db connection failed: {e}")))?;

    let mut stmt = conn
        .prepare(
            "SELECT s.project_id, s.doc_path, s.coupled_scope, s.last_doc_commit,
                    s.last_source_commit, s.dirty_since, s.changed_sources, s.scanned_at,
                    (SELECT COUNT(*) FROM doc_read_events e
                      WHERE e.project_id = s.project_id AND lower(e.doc_path) = lower(s.doc_path)
                        AND e.read_at >= datetime('now','-30 days')),
                    (SELECT COUNT(*) FROM doc_read_events e
                      WHERE e.project_id = s.project_id AND lower(e.doc_path) = lower(s.doc_path)
                        AND e.was_dirty = 1 AND e.read_at >= datetime('now','-30 days')),
                    (SELECT MAX(e.read_at) FROM doc_read_events e
                      WHERE e.project_id = s.project_id AND lower(e.doc_path) = lower(s.doc_path))
             FROM doc_status s
             ORDER BY s.project_id, s.doc_path",
        )
        .map_err(|e| AppError::Internal(format!("prepare failed: {e}")))?;

    let rows = stmt
        .query_map([], |r| {
            let scope: Option<String> = r.get(2)?;
            let changed_json: Option<String> = r.get(6)?;
            Ok(DocRotRow {
                project_id: r.get(0)?,
                doc_path: r.get(1)?,
                unscoped: scope.is_none(),
                last_doc_commit: r.get(3)?,
                last_source_commit: r.get(4)?,
                dirty_since: r.get(5)?,
                changed_sources: changed_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default(),
                scanned_at: r.get(7)?,
                reads_30d: r.get(8)?,
                dirty_reads_30d: r.get(9)?,
                last_read_at: r.get(10)?,
            })
        })
        .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;

    Ok(rows.flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::{glob_prefix, judge_doc};
    use std::collections::HashMap;

    #[test]
    fn glob_prefix_cuts_at_first_wildcard_to_dir() {
        assert_eq!(glob_prefix("src/features/teams/**"), "src/features/teams/");
        assert_eq!(glob_prefix("src-tauri/src/engine/director.rs"), "src-tauri/src/engine/");
        assert_eq!(glob_prefix("docs/*.md"), "docs/");
    }

    #[test]
    fn judge_marks_dirty_only_when_scoped_sources_are_newer() {
        let mut ts = HashMap::new();
        ts.insert("docs/a.md".to_string(), 100i64);
        ts.insert("src/x/one.rs".to_string(), 200i64);
        ts.insert("src/x/two.rs".to_string(), 150i64);
        ts.insert("src/y/other.rs".to_string(), 999i64); // outside scope
        let scope = vec!["src/x/".to_string()];
        let v = judge_doc("docs/a.md", Some(&scope), &ts);
        assert_eq!(v.doc_ts, 100);
        assert_eq!(v.source_ts, 200);
        // stale since the OLDEST un-absorbed change (150), newest first as evidence
        assert_eq!(v.dirty_since_ts, Some(150));
        assert_eq!(v.changed, vec!["src/x/one.rs".to_string(), "src/x/two.rs".to_string()]);
    }

    #[test]
    fn unscoped_docs_are_never_dirty() {
        let mut ts = HashMap::new();
        ts.insert("docs/a.md".to_string(), 100i64);
        ts.insert("src/x/one.rs".to_string(), 200i64);
        let v = judge_doc("docs/a.md", None, &ts);
        assert_eq!(v.dirty_since_ts, None);
        assert!(v.changed.is_empty());
    }

    #[test]
    fn a_doc_caught_up_is_clean() {
        let mut ts = HashMap::new();
        ts.insert("docs/a.md".to_string(), 300i64);
        ts.insert("src/x/one.rs".to_string(), 200i64);
        let scope = vec!["src/x/".to_string()];
        let v = judge_doc("docs/a.md", Some(&scope), &ts);
        assert_eq!(v.dirty_since_ts, None);
    }
}
