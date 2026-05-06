//! `scan_codebase` job handler — walks a project directory, counts
//! files by language, finds outstanding TODO/FIXME/HACK markers, and
//! produces a markdown report Athena reads on her next turn.
//!
//! Designed to be cheap and read-only. Skips obvious non-source dirs
//! (`node_modules`, `target`, `.git`, build artifacts) so a typical
//! Personas-sized repo finishes in a few seconds.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use crate::companion::projects;
use crate::db::UserDbPool;
use crate::error::AppError;

/// Soft cap on TODO entries surfaced. The full list lands as a count;
/// the top N (by file:line, deterministic) appear inline.
const MAX_TODOS_INLINE: usize = 25;
/// Files larger than this are scanned for line/byte counts but NOT
/// regex-grepped for TODOs (binary blobs, generated bundles).
const TODO_SCAN_MAX_BYTES: u64 = 256 * 1024; // 256 KB

/// Hard cap on entries walked. Beyond this we stop and return a
/// partial report rather than running unbounded — protects against
/// pathological dirs (a `node_modules/` whose name was renamed, a
/// junction-link cycle, etc.) that the SKIP list missed.
const MAX_FILES_WALKED: usize = 25_000;
/// Wall-clock budget for one scan. After this the walker returns
/// what it has so the chat doesn't sit on a "running" job for hours.
const WALK_TIMEOUT_SECS: u64 = 60;

/// Skip directories that are reliably not source code. Match by name
/// (not path) — these are universal across most repos.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".next",
    ".turbo",
    ".cache",
    ".vite",
    ".idea",
    ".vscode",
    "__pycache__",
    ".pytest_cache",
    ".tox",
    ".venv",
    "venv",
    "out",
    "coverage",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    "_archive", // Personas-specific: archived docs we don't want to count as live code
];

/// Map file extensions to language buckets so the report rolls up
/// neatly ("Rust: 124 files" rather than "...rs: 124 files"). Anything
/// not in this map gets bucketed as "Other".
fn lang_bucket(ext: &str) -> &'static str {
    match ext {
        "rs" => "Rust",
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" => "Python",
        "go" => "Go",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "C++",
        "cs" => "C#",
        "rb" => "Ruby",
        "php" => "PHP",
        "sh" | "bash" | "zsh" | "fish" => "Shell",
        "sql" => "SQL",
        "md" | "mdx" => "Markdown",
        "json" => "JSON",
        "toml" => "TOML",
        "yaml" | "yml" => "YAML",
        "html" | "htm" => "HTML",
        "css" | "scss" | "sass" | "less" => "CSS",
        _ => "Other",
    }
}

#[derive(Debug, Default)]
struct ScanReport {
    file_count: usize,
    total_bytes: u64,
    by_language: BTreeMap<&'static str, (usize, u64)>, // (file_count, bytes)
    todos: Vec<TodoEntry>,
    /// When set, the walk hit a safety cap and the report is partial.
    /// Surfaced in the markdown so Athena tells the user honestly.
    bailed_reason: Option<String>,
}

#[derive(Debug)]
struct TodoEntry {
    rel_path: String,
    line_no: usize,
    text: String,
}

pub async fn run(
    pool: &UserDbPool,
    project_id: Option<&str>,
    params: &Value,
) -> Result<String, AppError> {
    // Resolve target path: explicit param first, project_id second.
    let target_path = if let Some(p) = params.get("path").and_then(|v| v.as_str()) {
        PathBuf::from(p)
    } else if let Some(pid) = project_id {
        let project = projects::get(pool, pid)?
            .ok_or_else(|| AppError::Internal(format!("scan_codebase: project `{pid}` not found")))?;
        PathBuf::from(project.path)
    } else {
        return Err(AppError::Internal(
            "scan_codebase: either `path` param or `project_id` is required".into(),
        ));
    };

    if !target_path.exists() {
        return Err(AppError::Internal(format!(
            "scan_codebase: path `{}` does not exist",
            target_path.display()
        )));
    }
    if !target_path.is_dir() {
        return Err(AppError::Internal(format!(
            "scan_codebase: path `{}` is not a directory",
            target_path.display()
        )));
    }

    // Run the walk on a blocking thread — `walkdir` is sync I/O and we
    // don't want to starve the tokio runtime for several seconds on a
    // big repo. The job worker calls us under `tokio::task::spawn`d
    // context already, but block-in-place lets us be polite about it.
    let target_clone = target_path.clone();
    let report = tokio::task::spawn_blocking(move || walk(&target_clone))
        .await
        .map_err(|e| AppError::Internal(format!("scan_codebase: join error: {e}")))??;

    // Persist scan summary on the project row so future "list projects"
    // queries can report "last scan: X". Only when project_id is
    // provided (ad-hoc paths don't update any registry row).
    if let Some(pid) = project_id {
        let summary_line = format!(
            "{} files, {} TODO/FIXME marker(s)",
            report.file_count,
            report.todos.len()
        );
        if let Err(e) = projects::record_scan(pool, pid, &summary_line) {
            tracing::warn!(project_id = %pid, error = %e, "scan_codebase: record_scan failed");
        }
    }

    Ok(format_report(&target_path, &report))
}

fn walk(root: &Path) -> Result<ScanReport, AppError> {
    let mut report = ScanReport::default();
    let mut entries_seen = 0usize;
    let started = std::time::Instant::now();
    let mut bailed = None;

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            // Use file_type() (cheap, reads cached dirent info) rather
            // than path.is_dir() (calls metadata on every entry, which
            // fails silently on broken symlinks and lets node_modules
            // descend through). The previous version walked 110k files
            // (1.4GB) because is_dir() didn't filter reliably; this one
            // catches `node_modules` etc. on the first encounter.
            !is_skip_dir_by_type(e)
        })
    {
        entries_seen += 1;
        if entries_seen > MAX_FILES_WALKED {
            bailed = Some(format!(
                "stopped at {entries_seen} entries (cap {MAX_FILES_WALKED})"
            ));
            break;
        }
        if started.elapsed().as_secs() > WALK_TIMEOUT_SECS {
            bailed = Some(format!(
                "stopped after {WALK_TIMEOUT_SECS}s wall-clock budget exceeded"
            ));
            break;
        }
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // permission errors etc. — skip silently
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let bytes = meta.len();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let bucket = lang_bucket(&ext);

        report.file_count += 1;
        report.total_bytes = report.total_bytes.saturating_add(bytes);
        let entry = report.by_language.entry(bucket).or_insert((0, 0));
        entry.0 += 1;
        entry.1 = entry.1.saturating_add(bytes);

        // TODO scan: only for source-y file types and small enough to
        // be worth reading. Generated/large files are noise here.
        if bytes <= TODO_SCAN_MAX_BYTES && is_source_lang(bucket) {
            if let Ok(content) = fs::read_to_string(path) {
                let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy();
                for (i, line) in content.lines().enumerate() {
                    if line_has_todo_marker(line) {
                        report.todos.push(TodoEntry {
                            rel_path: rel.replace('\\', "/"),
                            line_no: i + 1,
                            text: line.trim().chars().take(160).collect(),
                        });
                    }
                }
            }
        }
    }
    report.bailed_reason = bailed;
    Ok(report)
}

fn is_source_lang(bucket: &str) -> bool {
    !matches!(bucket, "JSON" | "Markdown" | "TOML" | "YAML" | "HTML" | "CSS" | "Other")
}

fn is_skip_dir_by_type(entry: &walkdir::DirEntry) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_str().unwrap_or("");
    SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(name))
}

fn line_has_todo_marker(line: &str) -> bool {
    // Look for TODO / FIXME / HACK / XXX as standalone tokens in a
    // comment context. Cheap substring check is good enough — we
    // accept some false positives in strings/identifiers in exchange
    // for not loading a regex engine for every line.
    let upper = line.to_ascii_uppercase();
    upper.contains("TODO")
        || upper.contains("FIXME")
        || upper.contains("HACK")
        || upper.contains("XXX")
}

fn format_report(root: &Path, r: &ScanReport) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "## Codebase scan: `{}`\n\n",
        root.display().to_string().replace('\\', "/")
    ));
    if let Some(ref reason) = r.bailed_reason {
        s.push_str(&format!(
            "_Note: walk **stopped early** — {reason}. The report below is partial._\n\n"
        ));
    }
    s.push_str(&format!(
        "- **Total files**: {n} (~{kb:.1} MB)\n",
        n = r.file_count,
        kb = (r.total_bytes as f64) / (1024.0 * 1024.0),
    ));

    if !r.by_language.is_empty() {
        s.push_str("- **By language** (top 8 by file count):\n");
        let mut langs: Vec<(&&str, &(usize, u64))> = r.by_language.iter().collect();
        langs.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
        for (lang, (count, bytes)) in langs.into_iter().take(8) {
            s.push_str(&format!(
                "  - {lang}: {count} files (~{kb:.1} KB)\n",
                kb = (*bytes as f64) / 1024.0,
            ));
        }
    }
    s.push('\n');

    s.push_str(&format!(
        "**Outstanding markers** (TODO / FIXME / HACK / XXX): {n} total\n\n",
        n = r.todos.len()
    ));
    if !r.todos.is_empty() {
        let shown = r.todos.iter().take(MAX_TODOS_INLINE);
        for t in shown {
            s.push_str(&format!(
                "- `{path}:{line}` — {text}\n",
                path = t.rel_path,
                line = t.line_no,
                text = t.text,
            ));
        }
        if r.todos.len() > MAX_TODOS_INLINE {
            s.push_str(&format!(
                "\n…and {extra} more.\n",
                extra = r.todos.len() - MAX_TODOS_INLINE
            ));
        }
    }
    s
}
