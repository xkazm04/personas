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
//!   3. neither → the doc is UNVERIFIABLE: tracked, never dirty-able, and
//!      REPORTED AS SUCH. Unknown coupling is not rot — but it is not health
//!      either, and rendering it as "clean" was this detector's biggest lie.
//!
//! Two signals, not one:
//!   • STALE — the git one above (coupled sources newer than the doc).
//!   • BROKEN — content: the doc names a repo path that no longer exists
//!     though its parent directory does. Git timestamps cannot express this,
//!     and it is exactly the case the coupling heuristic used to swallow: a
//!     doc whose every reference has been renamed away coupled to nothing,
//!     went unscoped, and so read as clean. Deliberately mechanical — a
//!     missing path, never a semantic contradiction.
//!
//! Which docs. `list_docs` fills a bounded budget in PRIORITY order, because
//! a flat depth-first walk spent the whole budget on the deepest generated
//! report tree it happened to enter first (measured on this repo: 0 of 37
//! doc-map-managed docs were reachable, and `docs/features/**` was entirely
//! absent — the highest-authority coupling tier was dead in practice):
//!   1. root README + every doc-map-managed doc;
//!   2. co-located docs — a `*.md` in a directory that also holds source, i.e.
//!      the DESIGN.md sitting beside the feature it describes;
//!   3. the rest of `docs/**`, breadth-first with a per-directory cap so one
//!      generated tree cannot crowd out the maintained pages.
//! Everything is sorted, so the truncated set is stable run to run (the scan
//! deletes rows for docs it no longer lists — an unstable order would thrash).
//!
//! NOT in scope, by decision: Rust `//!` module headers (and doc comments
//! generally). They have no git history independent of the source file they
//! live in, so the only coupling available is the file's own directory —
//! precisely the dir-level rule that marked 78% of docs dirty on the first
//! fleet scan. They are also unaddressable by `doc_read_events`, which keys on
//! a document path. And the motivating example (`companion/mod.rs`'s "Phase 0
//! scaffold … real wiring lands in subsequent phases", over 87 files) is a
//! SEMANTIC claim naming no vanished path — neither signal here would catch
//! it, so including headers would buy noise and not that defect.
//!
//! One bounded `git log --name-only` per repo builds a path → newest-commit
//! map; everything else is in-memory. Reads come from the transcript miner
//! (skill_usage.rs), stamped `was_dirty` against this table at insert time.

use std::collections::{HashMap, HashSet};
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
/// Max docs tracked per repo — beyond this we truncate and say so in the
/// summary rather than walk a wiki forever. Spent in priority order (see the
/// module header), so truncation drops the least-authoritative pages first.
const MAX_DOCS_PER_REPO: usize = 400;
/// Docs taken from any ONE directory before moving on. Stops a generated
/// report tree (this repo: 711 pages under `docs/harness/`) from eating the
/// whole budget and starving the maintained pages.
const MAX_DOCS_PER_DIR: usize = 20;
/// Directory depth bound for both walks.
const MAX_WALK_DEPTH: usize = 8;
/// Directories visited per walk, so a pathological tree cannot stall a scan.
const MAX_DIRS_VISITED: usize = 5000;
/// Cap on missing referenced paths carried as evidence per doc.
const MAX_BROKEN_REFS: usize = 10;
/// Extensions that make a directory "code": a `*.md` sitting in one is a
/// co-located doc, describing the thing next to it.
const SOURCE_EXTS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "kt", "swift", "rb", "php",
    "c", "cc", "cpp", "h", "hpp", "cs", "sql", "vue", "svelte",
];
/// Never walked, and never treated as a broken reference: build output and
/// vendored deps are gitignored, so their absence is normal, not rot.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", "out", "coverage", "vendor", "test-results", "tmp",
];
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
    /// Tracked docs whose coupling could not be established — the detector
    /// could not judge them. Reported so "unjudged" never passes for "clean".
    pub unverifiable: u32,
    /// Tracked docs naming at least one repo path that no longer exists.
    pub broken: u32,
    pub docs_truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct DocRotRow {
    pub project_id: String,
    /// Repo-relative, forward slashes.
    pub doc_path: String,
    /// NULL coupling = unscoped (tracked, never dirty-able).
    pub unscoped: bool,
    /// The verdict a UI must render. `broken` (names a path that is gone) >
    /// `stale` (coupled sources are newer) > `unverifiable` (no coupling could
    /// be established — NOT a clean bill of health) > `clean`. Exists so an
    /// unjudged doc cannot be displayed as a healthy one.
    pub status: &'static str,
    /// Referenced repo paths that no longer exist (content evidence, capped).
    pub broken_refs: Vec<String>,
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

fn is_markdown(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".mdx")
}

fn is_source(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| SOURCE_EXTS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn skippable_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

/// One directory's entries, sorted for a deterministic walk: (subdir names,
/// markdown file names, "holds source" flag).
fn read_dir_sorted(dir: &Path) -> (Vec<String>, Vec<String>, bool) {
    let mut dirs: Vec<String> = Vec::new();
    let mut mds: Vec<String> = Vec::new();
    let mut has_source = false;
    let Ok(rd) = std::fs::read_dir(dir) else {
        return (dirs, mds, has_source);
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if !skippable_dir(&name) {
                dirs.push(name);
            }
        } else if is_markdown(&name) {
            mds.push(name);
        } else if is_source(&name) {
            has_source = true;
        }
    }
    dirs.sort();
    mds.sort();
    (dirs, mds, has_source)
}

fn rel_of(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|r| r.to_string_lossy().replace('\\', "/"))
}

/// Co-located docs: `*.md` in a directory that also holds source files — the
/// DESIGN.md beside the feature it describes. `docs/` is excluded (tier 3
/// covers it) and build output is never entered.
fn collect_colocated(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut visited = 0usize;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        visited += 1;
        if visited > MAX_DIRS_VISITED {
            break;
        }
        let (subdirs, mds, has_source) = read_dir_sorted(&dir);
        if has_source {
            for name in &mds {
                if let Some(rel) = rel_of(root, &dir.join(name)) {
                    out.push(rel);
                }
            }
        }
        if depth < MAX_WALK_DEPTH {
            for name in subdirs {
                if depth == 0 && name == "docs" {
                    continue;
                }
                stack.push((dir.join(name), depth + 1));
            }
        }
    }
    out.sort();
    out
}

/// `docs/**/*.md(x)`, breadth-first (shallow pages — the maintained ones —
/// first) with a per-directory cap so one generated tree cannot crowd the
/// budget.
fn collect_docs_tree(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut visited = 0usize;
    let mut level: Vec<PathBuf> = vec![root.join("docs")];
    let mut depth = 0usize;
    while !level.is_empty() && depth <= MAX_WALK_DEPTH {
        let mut next: Vec<PathBuf> = Vec::new();
        for dir in &level {
            visited += 1;
            if visited > MAX_DIRS_VISITED {
                return out;
            }
            let (subdirs, mds, _) = read_dir_sorted(dir);
            for name in mds.iter().take(MAX_DOCS_PER_DIR) {
                if let Some(rel) = rel_of(root, &dir.join(name)) {
                    out.push(rel);
                }
            }
            for name in subdirs {
                next.push(dir.join(name));
            }
        }
        level = next;
        depth += 1;
    }
    out
}

/// The docs this scan will track, highest authority first, bounded by
/// `MAX_DOCS_PER_REPO`. `managed` is the doc-map's own doc list. Returns
/// `(docs, truncated)`.
fn list_docs(root: &Path, managed: &[String]) -> (Vec<String>, bool) {
    let mut candidates: Vec<String> = Vec::new();
    if root.join("README.md").is_file() {
        candidates.push("README.md".into());
    }
    let mut managed_sorted: Vec<String> = managed
        .iter()
        .filter(|d| root.join(d).is_file())
        .cloned()
        .collect();
    managed_sorted.sort();
    candidates.extend(managed_sorted);
    candidates.extend(collect_colocated(root));
    candidates.extend(collect_docs_tree(root));

    let mut seen: HashSet<String> = HashSet::new();
    let mut docs: Vec<String> = Vec::new();
    let mut truncated = false;
    for rel in candidates {
        if !seen.insert(rel.clone()) {
            continue;
        }
        if docs.len() >= MAX_DOCS_PER_REPO {
            truncated = true;
            break;
        }
        docs.push(rel);
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

/// What a doc's TEXT claims about the repo.
#[derive(Debug, Default, PartialEq)]
struct DocRefs {
    /// Referenced paths that EXIST → the coupling scope (git signal).
    scope: Vec<String>,
    /// Referenced paths that do NOT exist, though their parent directory does
    /// → the doc names something that was renamed or deleted (content signal).
    broken: Vec<String>,
}

/// Characters that, sitting immediately after a path token, mean the token was
/// CUT SHORT rather than ended: a glob, a template hole, a shell variable.
/// `public/illustrations/explore/domain-*-{dark,light}.svg` tokenizes to
/// `.../domain-`, which of course does not exist — and is not rot.
const TRUNCATING_NEXT: &[char] =
    &['*', '{', '<', '[', '(', '$', '%', '?', '+', '=', '~', '#', '@', '!', '\\'];

/// A missing token is only reported when its PARENT DIRECTORY still exists.
/// That is the renamed/deleted-target shape, and it is what keeps this from
/// firing on illustrative or planned paths: `src/app/routes/x.ts` in a repo
/// with no `src/app/routes` is a sketch, not rot. Build-output roots are
/// excluded outright — they are gitignored, so absence there is normal.
fn is_broken_ref(root: &Path, token: &str) -> bool {
    let first = token.split('/').next().unwrap_or("");
    if SKIP_DIRS.contains(&first) {
        return false;
    }
    // An ellipsis or relative segment is prose (`src/.../File.tsx`), and
    // Windows happily resolves `src/...` to a directory, so this must be
    // rejected before any filesystem probe.
    if token
        .split('/')
        .any(|seg| seg.is_empty() || seg.chars().all(|c| c == '.'))
    {
        return false;
    }
    let Some((parent, leaf)) = token.rsplit_once('/') else {
        return false;
    };
    if leaf.is_empty() || !parent.contains('/') {
        // A one-segment parent (`src/gone.ts`) is too weak a claim to act on:
        // every top-level dir exists, so it would flag any generic example.
        return false;
    }
    let parent_dir = root.join(parent);
    if !parent_dir.is_dir() {
        return false;
    }
    // Last guard: the tokenizer stops at the first character it cannot carry,
    // so a real entry with a SPACE in it (`docs/features/plugins/dev tools/`)
    // arrives here as the prefix `.../dev`. If the leaf is a strict prefix of
    // something that does exist beside it, the reference is truncated, not
    // broken.
    let Ok(rd) = std::fs::read_dir(&parent_dir) else {
        return false;
    };
    !rd.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().to_string();
        name.len() > leaf.len() && name.starts_with(leaf)
    })
}

/// Repo paths the doc TEXT references, split into coupling (exists) and
/// broken (does not). A token must start with a real top-level dir.
fn scan_references(root: &Path, doc_rel: &str, top_dirs: &[String]) -> DocRefs {
    let mut refs = DocRefs::default();
    let Ok(text) = std::fs::read_to_string(root.join(doc_rel)) else { return refs };
    // Slicing straight to 131_072 panics when that byte lands mid-codepoint —
    // one em-dash in the wrong place would take down the whole scan.
    let mut cut = 131_072.min(text.len());
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let text = &text[..cut];
    for top in top_dirs {
        // A doc referencing docs is navigation, not coupling — but a link to a
        // page that is GONE is still rot, so `docs/` is scanned for broken
        // refs and skipped for scope.
        let couples = top != "docs";
        let needle = format!("{top}/");
        let mut rest = text;
        while let Some(pos) = rest.find(&needle) {
            let tail = &rest[pos..];
            let raw: String = tail
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '.'))
                .collect();
            // The character the tokenizer stopped on tells us whether the path
            // ENDED or was cut short by a glob/template.
            let truncated = tail[raw.len()..]
                .chars()
                .next()
                .is_some_and(|c| TRUNCATING_NEXT.contains(&c));
            rest = &rest[pos + needle.len()..];
            let token = raw.trim_end_matches(['.', '/']);
            if token.len() <= needle.len() {
                continue;
            }
            // Precision rule (learned from the first fleet scan, where
            // dir-level coupling marked 78% of all docs dirty): a FILE
            // reference couples to that file exactly; only a DIRECTORY
            // reference couples to the directory.
            let target = if root.join(token).is_file() {
                Some(token.to_string())
            } else if root.join(token).is_dir() {
                Some(format!("{token}/"))
            } else {
                // The old blind spot: a vanished token coupled to nothing and
                // the doc went unscoped — silently clean. Now it is evidence.
                if !truncated
                    && refs.broken.len() < MAX_BROKEN_REFS
                    && !refs.broken.iter().any(|b| b == token)
                    && is_broken_ref(root, token)
                {
                    refs.broken.push(token.to_string());
                }
                None
            };
            let (Some(target), true) = (target, couples) else { continue };
            if refs.scope.len() >= MAX_SCOPE_PREFIXES {
                continue;
            }
            if !refs.scope.iter().any(|p| target.starts_with(p.as_str())) {
                refs.scope.retain(|p| !p.starts_with(&target));
                refs.scope.push(target);
            }
        }
    }
    refs
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
        let doc_map = parse_doc_map(root);
        let managed: Vec<String> = doc_map.keys().cloned().collect();
        let (docs, truncated) = list_docs(root, &managed);
        summary.docs_truncated |= truncated;
        let top_dirs: Vec<String> = std::fs::read_dir(root)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| !skippable_dir(n))
                    .collect()
            })
            .unwrap_or_default();

        for doc in &docs {
            // Content signal first — it is read from the doc regardless of how
            // the doc is coupled, and it is the ONLY signal for a doc whose
            // every reference has been renamed away.
            let refs = scan_references(root, doc, &top_dirs);
            let scope = match doc_map.get(doc).cloned() {
                Some(s) => Some(s),
                None if refs.scope.is_empty() => None,
                None => Some(refs.scope.clone()),
            };
            let v = judge_doc(doc, scope.as_ref(), &path_ts);
            let scope_json = v.scope.as_ref().map(|s| serde_json::to_string(s).unwrap_or_default());
            let changed_json = serde_json::to_string(&v.changed).unwrap_or_else(|_| "[]".into());
            let broken_json = serde_json::to_string(&refs.broken).unwrap_or_else(|_| "[]".into());
            let dirty_since = v.dirty_since_ts.map(fmt_unix);
            if dirty_since.is_some() {
                summary.dirty += 1;
            }
            if !refs.broken.is_empty() {
                summary.broken += 1;
            }
            if scope.is_none() && refs.broken.is_empty() {
                summary.unverifiable += 1;
            }
            conn.execute(
                "INSERT INTO doc_status
                   (project_id, doc_path, coupled_scope, last_doc_commit, last_source_commit,
                    dirty_since, changed_sources, broken_refs, scanned_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
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
                   broken_refs = excluded.broken_refs,
                   scanned_at = datetime('now')",
                rusqlite::params![
                    pid,
                    v.doc_path,
                    scope_json,
                    (v.doc_ts > 0).then(|| fmt_unix(v.doc_ts)),
                    (v.source_ts > 0).then(|| fmt_unix(v.source_ts)),
                    dirty_since,
                    changed_json,
                    broken_json,
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

/// The single place a doc's verdict is named. `unverifiable` is its own rung
/// on purpose: an unscoped doc is one the detector could not judge, and
/// collapsing that into `clean` is what let the highest-risk docs — the ones
/// naming paths that moved — read as healthy.
fn doc_status_label(unscoped: bool, dirty: bool, broken: &[String]) -> &'static str {
    if !broken.is_empty() {
        "broken"
    } else if dirty {
        "stale"
    } else if unscoped {
        "unverifiable"
    } else {
        "clean"
    }
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
                    s.broken_refs,
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
            let broken_json: Option<String> = r.get(8)?;
            let dirty_since: Option<String> = r.get(5)?;
            let broken_refs: Vec<String> = broken_json
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default();
            Ok(DocRotRow {
                project_id: r.get(0)?,
                doc_path: r.get(1)?,
                unscoped: scope.is_none(),
                status: doc_status_label(scope.is_none(), dirty_since.is_some(), &broken_refs),
                broken_refs,
                last_doc_commit: r.get(3)?,
                last_source_commit: r.get(4)?,
                dirty_since,
                changed_sources: changed_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default(),
                scanned_at: r.get(7)?,
                reads_30d: r.get(9)?,
                dirty_reads_30d: r.get(10)?,
                last_read_at: r.get(11)?,
            })
        })
        .map_err(|e| AppError::Internal(format!("query failed: {e}")))?;

    Ok(rows.flatten().collect())
}

#[cfg(test)]
mod tests {
    use super::{
        doc_status_label, glob_prefix, is_broken_ref, judge_doc, list_docs, scan_references,
        MAX_DOCS_PER_DIR,
    };
    use std::collections::HashMap;
    use std::path::Path;

    /// A throwaway tree: `(relative path, contents)` pairs, dirs implied.
    fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (rel, body) in files {
            let path = dir.path().join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        dir
    }

    fn top_dirs(root: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(root)
            .unwrap()
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        v.sort();
        v
    }

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

    /// Still true, and still deliberate — the GIT signal cannot speak about a
    /// doc it has no scope for. What changed is that this no longer means the
    /// doc is fine: `doc_status_label` reports it as `unverifiable`, and the
    /// content check below can condemn it independently of any coupling.
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
    fn unscoped_is_reported_as_unverifiable_not_clean() {
        assert_eq!(doc_status_label(true, false, &[]), "unverifiable");
        assert_eq!(doc_status_label(false, false, &[]), "clean");
        // A doc the detector could not judge and one it judged healthy must
        // never share a label — that equivalence was the detector's big lie.
        assert_ne!(
            doc_status_label(true, false, &[]),
            doc_status_label(false, false, &[]),
        );
    }

    #[test]
    fn broken_refs_outrank_staleness_and_survive_being_unscoped() {
        let gone = vec!["src/x/gone.rs".to_string()];
        assert_eq!(doc_status_label(false, true, &gone), "broken");
        // The compounding blind spot: every reference renamed away → no
        // coupling at all → used to be silently clean. Now it is condemned.
        assert_eq!(doc_status_label(true, false, &gone), "broken");
        assert_eq!(doc_status_label(false, true, &[]), "stale");
    }

    #[test]
    fn scan_references_splits_existing_coupling_from_vanished_paths() {
        let dir = tree(&[
            ("src/x/one.rs", "fn main() {}"),
            ("docs/a.md", "see src/x/one.rs and src/x/renamed_away.rs"),
        ]);
        let root = dir.path();
        let refs = scan_references(root, "docs/a.md", &top_dirs(root));
        assert_eq!(refs.scope, vec!["src/x/one.rs".to_string()]);
        assert_eq!(refs.broken, vec!["src/x/renamed_away.rs".to_string()]);
    }

    #[test]
    fn a_doc_whose_every_reference_vanished_is_unscoped_and_broken() {
        let dir = tree(&[
            ("src/x/one.rs", "fn main() {}"),
            ("docs/a.md", "the panel lives in src/x/OldPanel.tsx"),
        ]);
        let root = dir.path();
        let refs = scan_references(root, "docs/a.md", &top_dirs(root));
        assert!(refs.scope.is_empty(), "nothing it names exists → no coupling");
        assert_eq!(refs.broken, vec!["src/x/OldPanel.tsx".to_string()]);
        assert_eq!(doc_status_label(true, false, &refs.broken), "broken");
    }

    /// Precision guards. Each of these fired in the wild would be the 78%
    /// false-positive scan all over again, so they are pinned.
    #[test]
    fn broken_ref_check_refuses_weak_claims() {
        let dir = tree(&[
            ("src/x/one.rs", "fn main() {}"),
            ("dist/keep.js", "0"),
            ("docs/a.md", "x"),
        ]);
        let root = dir.path();
        // A one-segment parent is any top-level dir — too weak to act on.
        assert!(!is_broken_ref(root, "src/gone.rs"));
        // A path whose parent directory does not exist is a sketch, not rot.
        assert!(!is_broken_ref(root, "src/planned/future/thing.rs"));
        // Build output is gitignored — its absence is normal.
        assert!(!is_broken_ref(root, "dist/assets/gone.js"));
        // An ellipsis placeholder is prose. (Windows resolves `src/...` to a
        // real directory, so this must be rejected before the fs probe.)
        assert!(!is_broken_ref(root, "src/.../File.tsx"));
        // The real shape: parent still stands, the target moved out from it.
        assert!(is_broken_ref(root, "src/x/gone.rs"));
    }

    /// The tokenizer stops at the first character it cannot carry, so both a
    /// glob and a directory name containing a space arrive here truncated.
    /// Neither is rot, and both fired on this repo before these guards.
    #[test]
    fn truncated_tokens_are_not_broken_references() {
        let dir = tree(&[
            ("src/x/one.rs", "fn main() {}"),
            ("public/img/domain-dark.svg", "<svg/>"),
            ("src/plugins/dev tools/index.ts", "export {}"),
            (
                "docs/a.md",
                "icons at public/img/domain-*-{dark,light}.svg; \
                 code in src/plugins/dev tools/index.ts; \
                 and src/x/really_gone.rs",
            ),
        ]);
        let root = dir.path();
        let refs = scan_references(root, "docs/a.md", &top_dirs(root));
        assert_eq!(
            refs.broken,
            vec!["src/x/really_gone.rs".to_string()],
            "only the genuinely vanished path may be reported"
        );
    }

    #[test]
    fn docs_links_couple_to_nothing_but_still_report_broken_pages() {
        let dir = tree(&[
            ("src/x/one.rs", "fn main() {}"),
            ("docs/guides/live.md", "hi"),
            ("docs/a.md", "see docs/guides/live.md and docs/guides/deleted.md"),
        ]);
        let root = dir.path();
        let refs = scan_references(root, "docs/a.md", &top_dirs(root));
        assert!(refs.scope.is_empty(), "docs→docs is navigation, not coupling");
        assert_eq!(refs.broken, vec!["docs/guides/deleted.md".to_string()]);
    }

    #[test]
    fn co_located_docs_are_in_scope_and_outrank_the_docs_tree() {
        let dir = tree(&[
            ("README.md", "root"),
            ("src/features/thing/DESIGN.md", "beside the code"),
            ("src/features/thing/Thing.tsx", "export {}"),
            ("src/features/prose-only/NOTES.md", "no code here"),
            ("docs/guide.md", "a page"),
            ("node_modules/pkg/README.md", "vendored"),
            ("node_modules/pkg/index.js", "0"),
        ]);
        let (docs, truncated) = list_docs(dir.path(), &[]);
        assert!(!truncated);
        assert!(docs.contains(&"src/features/thing/DESIGN.md".to_string()));
        assert!(docs.contains(&"docs/guide.md".to_string()));
        assert!(
            !docs.contains(&"src/features/prose-only/NOTES.md".to_string()),
            "a markdown file with no source beside it is not a co-located doc"
        );
        assert!(
            !docs.iter().any(|d| d.starts_with("node_modules/")),
            "vendored docs are never tracked"
        );
        // Priority order: README, then co-located, then the docs/ tree.
        let pos = |p: &str| docs.iter().position(|d| d == p).unwrap();
        assert_eq!(pos("README.md"), 0);
        assert!(pos("src/features/thing/DESIGN.md") < pos("docs/guide.md"));
    }

    #[test]
    fn doc_map_managed_docs_are_never_starved_by_the_budget() {
        // A generated report tree far larger than the budget, plus one
        // doc-map-managed page. Depth-first, the managed page was unreachable
        // (measured on this repo: 0 of 37 were in the search space).
        let mut files: Vec<(String, String)> = Vec::new();
        for run in 0..40 {
            for i in 0..25 {
                files.push((format!("docs/harness/run{run:02}/r{i:04}.md"), "generated".into()));
            }
        }
        files.push(("docs/features/api/README.md".into(), "managed".into()));
        let refs: Vec<(&str, &str)> = files.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let dir = tree(&refs);
        let managed = vec!["docs/features/api/README.md".to_string()];
        let (docs, truncated) = list_docs(dir.path(), &managed);
        assert!(truncated, "1000 generated pages must exhaust the budget");
        assert_eq!(
            docs[0], "docs/features/api/README.md",
            "the managed doc must survive truncation — it is the highest-authority coupling there is"
        );
        // ...and no single directory may spend more than its share.
        let from_one = docs.iter().filter(|d| d.starts_with("docs/harness/run00/")).count();
        assert!(from_one <= MAX_DOCS_PER_DIR, "per-directory cap not applied: {from_one}");
    }

    #[test]
    fn doc_selection_is_stable_across_runs() {
        let mut files: Vec<(String, String)> = Vec::new();
        for i in 0..40 {
            files.push((format!("docs/area{}/p{i:03}.md", i % 5), "x".into()));
        }
        let refs: Vec<(&str, &str)> = files.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let dir = tree(&refs);
        // An unstable order would thrash doc_status: the scan DELETEs rows for
        // docs it no longer lists.
        let (a, _) = list_docs(dir.path(), &[]);
        let (b, _) = list_docs(dir.path(), &[]);
        assert_eq!(a, b);
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

    /// Measurement harness. Runs the REAL scan pipeline against the working
    /// tree this crate lives in and prints found / judged / unscoped / dirty —
    /// the numbers any change to the coupling rules must be reported against
    /// (the first fleet scan's 78% dirty rate is the standing counter-example).
    ///
    /// `#[ignore]` because it walks a real checkout and shells out to git.
    /// Run it explicitly:
    ///   node scripts/build/run-rust-tests.mjs -- --ignored --nocapture doc_rot_measure
    #[test]
    #[ignore]
    fn doc_rot_measure_against_this_repo() {
        use std::path::Path;
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .to_path_buf();
        let Some(path_ts) = super::git_recent_paths(&root) else {
            println!("MEASURE: git unavailable — skipped");
            return;
        };
        let doc_map = super::parse_doc_map(&root);
        let managed: Vec<String> = doc_map.keys().cloned().collect();
        let (docs, truncated) = super::list_docs(&root, &managed);
        let top_dirs: Vec<String> = std::fs::read_dir(&root)
            .map(|rd| {
                rd.flatten()
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| !super::skippable_dir(n))
                    .collect()
            })
            .unwrap_or_default();

        let (mut mapped, mut heuristic, mut dirty) = (0u32, 0u32, 0u32);
        let (mut colocated, mut unverifiable, mut broken_docs) = (0u32, 0u32, 0u32);
        let mut samples: Vec<String> = Vec::new();
        for doc in &docs {
            if !doc.starts_with("docs/") && doc != "README.md" {
                colocated += 1;
            }
            let refs = super::scan_references(&root, doc, &top_dirs);
            let scope = match doc_map.get(doc).cloned() {
                Some(s) => {
                    mapped += 1;
                    Some(s)
                }
                None if refs.scope.is_empty() => None,
                None => {
                    heuristic += 1;
                    Some(refs.scope.clone())
                }
            };
            let v = super::judge_doc(doc, scope.as_ref(), &path_ts);
            if v.dirty_since_ts.is_some() {
                dirty += 1;
            }
            if !refs.broken.is_empty() {
                broken_docs += 1;
                if samples.len() < 20 {
                    samples.push(format!("{doc} → {}", refs.broken.join(", ")));
                }
            } else if scope.is_none() {
                unverifiable += 1;
            }
        }
        let judged = mapped + heuristic;
        let pct = |n: u32| if docs.is_empty() { 0.0 } else { n as f64 * 100.0 / docs.len() as f64 };
        println!("=== doc-rot measurement: {} ===", root.display());
        println!("  docs found      : {} (truncated: {truncated})", docs.len());
        println!("    co-located    : {colocated}");
        println!("  judged (scoped) : {judged}  [doc-map {mapped} / heuristic {heuristic}]");
        println!("  UNVERIFIABLE    : {unverifiable}  ({:.1}%)", pct(unverifiable));
        println!("  broken refs     : {broken_docs}  ({:.1}%)", pct(broken_docs));
        println!("  dirty (stale)   : {dirty}  ({:.1}% of found)", pct(dirty));
        println!(
            "  dirty-rate among judged: {:.1}%",
            if judged == 0 { 0.0 } else { dirty as f64 * 100.0 / judged as f64 }
        );
        println!("  --- broken-ref sample (precision eyeball) ---");
        for s in &samples {
            println!("    {s}");
        }
    }
}
