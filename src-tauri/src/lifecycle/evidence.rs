//! Git-derived evidence: what actually happened per step.
//!
//! - [`task_evidence`] reads a finished task's branch (stored by `finalize_task`
//!   through `db::repos::dev::lifecycle::upsert_task_evidence`; the finalize
//!   path goes through [`task_evidence_with`], which also knows the task's id,
//!   its isolation fallback reason and whether it produced output).
//! - [`commit_evidence`] reads recent commits on the base branch for manual CLI
//!   work, derived on read and never stored: ONE `git log` per base tip, cached.
//!
//! A step git cannot observe is `unknown`, never `done`. The classification
//! regexes are the same ones the contest staging used
//! (`.contest/staging/lifecycle-nextgen/gen.mjs`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use personas_engine::git_checkpoint::run_git_blocking as git;
use regex::Regex;

use crate::db::models::{
    LifecycleDoc, LifecycleEvidenceItem, LifecycleOutcome as O, LifecyclePreset,
    LifecycleSourceKind, LifecycleStepOutcome,
};

static TESTS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)((^|/)(__tests__|tests?|spec)/|\.(test|spec)\.[a-z]+$|_test\.(rs|go|py)$)")
        .expect("static regex")
});
static DOCS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)((^|/)docs?/|CHANGELOG|README|\.mdx?$)").expect("static regex")
});
static CONVENTIONAL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(\([^)]+\))?!?: ")
        .expect("static regex")
});
static PR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(#(\d+)\)|Merge pull request #(\d+)").expect("static regex"));
static ISSUE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"#\d+").expect("static regex"));

pub fn touches_tests(path: &str) -> bool {
    TESTS_RE.is_match(&path.replace('\\', "/"))
}

pub fn touches_docs(path: &str) -> bool {
    DOCS_RE.is_match(&path.replace('\\', "/"))
}

pub fn is_conventional(subject: &str) -> bool {
    CONVENTIONAL_RE.is_match(subject)
}

/// The PR number a subject references (`(#12)` squash or `Merge pull request #12`).
pub fn pr_ref(subject: &str) -> Option<String> {
    let c = PR_RE.captures(subject)?;
    c.get(1)
        .or_else(|| c.get(2))
        .map(|m| m.as_str().to_string())
}

fn out(step_id: &str, outcome: O, detail: impl Into<Option<String>>) -> LifecycleStepOutcome {
    LifecycleStepOutcome {
        step_id: step_id.to_string(),
        outcome,
        detail: detail.into(),
    }
}

fn plural(n: usize, one: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {one}s")
    }
}

/// The project's base branch as a ref that exists: the recorded one, else
/// `main`, else `master`. `None` when none resolves (or `root` is no repo).
pub fn resolve_base(root: &Path, recorded: Option<&str>) -> Option<String> {
    let recorded = recorded.map(str::trim).filter(|b| !b.is_empty());
    recorded
        .into_iter()
        .chain(["main", "master"])
        .find(|b| {
            git(
                root,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{b}"),
                ],
            )
            .is_ok()
        })
        .map(str::to_string)
}

/// The pre-commit hook that guards commits in `root`, if any (the WP1 detector's
/// reading: lefthook `pre-commit:`, husky, or a git hook).
fn pre_commit_hook(root: &Path) -> Option<String> {
    super::detect::pre_commit_hook(root)
}

/// What the caller knows about a finished task that git does not.
#[derive(Debug, Default, Clone)]
pub struct TaskFacts<'a> {
    pub task_id: Option<&'a str>,
    /// Why the run was not isolated (the task row's `worktree_fallback_reason`).
    pub fallback_reason: Option<&'a str>,
    /// Whether the task ended with a non-empty final output; `None` = not known.
    pub output_nonempty: Option<bool>,
}

/// A task's outcomes plus the one fact the auto-land needs.
#[derive(Debug, Clone)]
pub struct TaskEvidence {
    pub outcomes: Vec<LifecycleStepOutcome>,
    /// Commits `branch` carries that `base` does not; `None` = git could not say.
    pub commits_ahead: Option<usize>,
}

/// What git said about one task branch.
struct BranchRead {
    files: Vec<String>,
    subjects: Vec<String>,
}

fn read_branch(workspace: &Path, branch: &str, base: &str) -> Result<BranchRead, String> {
    let lines = |s: String| -> Vec<String> {
        s.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect()
    };
    let files = git(
        workspace,
        &["diff", "--name-only", &format!("{base}...{branch}")],
    )?;
    let subjects = git(
        workspace,
        &["log", &format!("{base}..{branch}"), "--format=%s"],
    )?;
    Ok(BranchRead {
        files: lines(files),
        subjects: lines(subjects),
    })
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    canon(a) == canon(b)
}

/// Per-step outcomes for a task that worked on `branch` (in `workspace`, which
/// may be a worktree of `root`) against `base`. The WP1 signature; the finalize
/// path uses [`task_evidence_with`].
#[cfg_attr(not(test), allow(dead_code))] // the fixed public shape; finalize needs the task facts
pub fn task_evidence(
    root: &Path,
    workspace: &Path,
    branch: &str,
    base: &str,
    doc: &LifecycleDoc,
) -> Vec<LifecycleStepOutcome> {
    task_evidence_with(
        root,
        workspace,
        Some(branch),
        base,
        doc,
        &TaskFacts::default(),
    )
    .outcomes
}

/// [`task_evidence`] with the task's own facts. `branch` is `None` when the run
/// was not isolated: its commits sit on the checkout's own branch and cannot be
/// told apart from anyone else's, so the git-read steps say so as `unknown`.
pub fn task_evidence_with(
    root: &Path,
    workspace: &Path,
    branch: Option<&str>,
    base: &str,
    doc: &LifecycleDoc,
    facts: &TaskFacts<'_>,
) -> TaskEvidence {
    let isolated = branch.is_some() && !same_dir(root, workspace);
    let read = match branch {
        Some(b) => read_branch(workspace, b, base),
        None => Err("ran in the project checkout; its commits are read as base commits".into()),
    };
    let hook = pre_commit_hook(root);
    let team = doc.preset == LifecyclePreset::Team;
    let commits_ahead = read.as_ref().ok().map(|r| r.subjects.len());

    let outcomes = doc
        .steps
        .iter()
        .map(|step| {
            let id = step.id.as_str();
            let unread = |r: &String| out(id, O::Unknown, Some(r.clone()));
            match id {
                "frame" | "recall" => {
                    out(id, O::Unknown, Some("instructed; not observable".into()))
                }
                "isolate" if isolated => out(id, O::Done, branch.map(str::to_string)),
                "isolate" => out(
                    id,
                    O::Skipped,
                    Some(
                        facts
                            .fallback_reason
                            .unwrap_or("ran in the project checkout")
                            .to_string(),
                    ),
                ),
                "sync" if isolated => out(id, O::Done, Some(format!("forked from {base} tip"))),
                "sync" => out(id, O::Unknown, None),
                "land" => out(id, O::Unknown, Some("not attempted".into())),
                "record" => match facts.output_nonempty {
                    Some(true) => out(id, O::Done, Some("final summary written".into())),
                    Some(false) => out(id, O::Skipped, Some("no final output".into())),
                    None => out(id, O::Unknown, None),
                },
                _ => match &read {
                    Err(r) if matches!(id, "link" | "gate" | "tests" | "docs" | "commit") => {
                        unread(r)
                    }
                    Err(_) => out(id, O::Unknown, Some("custom step; not observable".into())),
                    Ok(r) => branch_step(id, r, branch.unwrap_or(""), facts, hook.as_deref(), team),
                },
            }
        })
        .collect();
    TaskEvidence {
        outcomes,
        commits_ahead,
    }
}

/// A git-read step judged against a readable branch.
fn branch_step(
    id: &str,
    r: &BranchRead,
    branch: &str,
    facts: &TaskFacts<'_>,
    hook: Option<&str>,
    team: bool,
) -> LifecycleStepOutcome {
    let n = r.subjects.len();
    let count = |pred: fn(&str) -> bool| r.files.iter().filter(|f| pred(f)).count();
    match id {
        "link" => {
            let mentions =
                |s: &str| ISSUE_RE.is_match(s) || facts.task_id.is_some_and(|t| s.contains(t));
            if mentions(branch) || (n > 0 && r.subjects.iter().all(|s| mentions(s))) {
                out(
                    id,
                    O::Done,
                    Some("task reference in the branch or every commit".into()),
                )
            } else {
                out(
                    id,
                    O::Skipped,
                    Some("no task or issue reference in the branch or commits".into()),
                )
            }
        }
        "gate" => match (n, hook) {
            (0, _) => out(id, O::Unknown, Some("no commits".into())),
            (_, Some(h)) => out(id, O::Done, Some(format!("passed {h} pre-commit"))),
            (_, None) => out(
                id,
                O::Unknown,
                Some("no pre-commit hook in the repo".into()),
            ),
        },
        "tests" => match count(touches_tests) {
            0 => out(id, O::Skipped, Some("no test files changed".into())),
            k => out(id, O::Done, Some(plural(k, "test file"))),
        },
        "docs" => match count(touches_docs) {
            0 => out(id, O::Skipped, Some("no docs changed".into())),
            k => out(id, O::Done, Some(plural(k, "doc file"))),
        },
        "commit" => {
            let off = r.subjects.iter().filter(|s| !is_conventional(s)).count();
            if n == 0 {
                out(id, O::Skipped, Some("no commits".into()))
            } else if team && off > 0 {
                out(
                    id,
                    O::Skipped,
                    Some(format!("{off} of {n} commit messages not conventional")),
                )
            } else {
                out(id, O::Done, Some(plural(n, "commit")))
            }
        }
        _ => out(id, O::Unknown, Some("custom step; not observable".into())),
    }
}

// ── base-branch commits (derived on read) ───────────────────────────────────

/// One commit as `git log` printed it.
#[derive(Debug, Clone)]
struct CommitRead {
    sha: String,
    /// UTC RFC 3339, so it sorts against stored task evidence.
    occurred_at: String,
    subject: String,
    files: Vec<String>,
}

/// Cache entries kept; the oldest is evicted past this.
const CACHE_CAP: usize = 16;

/// (root, base tip sha, limit).
type CacheKey = (PathBuf, String, usize);
/// Insertion sequence (for eviction) and the parsed commits.
type CacheEntry = (u64, Arc<Vec<CommitRead>>);
static COMMIT_CACHE: LazyLock<Mutex<(u64, HashMap<CacheKey, CacheEntry>)>> =
    LazyLock::new(|| Mutex::new((0, HashMap::new())));

/// The last `limit` non-merge commits on `base`, cached per (root, base tip).
fn read_commits(root: &Path, base: &str, limit: usize) -> Option<Arc<Vec<CommitRead>>> {
    let tip = git(root, &["rev-parse", "--verify", "--quiet", base]).ok()?;
    let key = (root.to_path_buf(), tip.clone(), limit);
    if let Ok(cache) = COMMIT_CACHE.lock() {
        if let Some((_, hit)) = cache.1.get(&key) {
            return Some(hit.clone());
        }
    }
    let raw = git(
        root,
        &[
            "log",
            &format!("-{limit}"),
            "--no-merges",
            "--name-only",
            "--date=iso-strict",
            "--format=%x1e%H%x1f%cd%x1f%s",
            &tip,
        ],
    )
    .map_err(|e| tracing::debug!(root = %root.display(), base, error = %e, "lifecycle: base log unreadable"))
    .ok()?;
    let commits: Arc<Vec<CommitRead>> =
        Arc::new(raw.split('\u{1e}').filter_map(parse_commit).collect());
    if let Ok(mut cache) = COMMIT_CACHE.lock() {
        let (seq, map) = &mut *cache;
        *seq += 1;
        if map.len() >= CACHE_CAP {
            if let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (s, _))| *s)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        map.insert(key, (*seq, commits.clone()));
    }
    Some(commits)
}

fn parse_commit(chunk: &str) -> Option<CommitRead> {
    let mut lines = chunk.lines();
    let mut head = lines.next()?.split('\u{1f}');
    let sha = head.next()?.trim().to_string();
    if sha.is_empty() {
        return None;
    }
    let date = head.next()?.trim();
    let occurred_at = chrono::DateTime::parse_from_rfc3339(date)
        .map(|d| d.with_timezone(&chrono::Utc).to_rfc3339())
        .unwrap_or_else(|_| date.to_string());
    let subject = head.next().unwrap_or("").trim().to_string();
    let files = lines
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    Some(CommitRead {
        sha,
        occurred_at,
        subject,
        files,
    })
}

/// Evidence items for the last `limit` commits on `base` (PR merge commits for
/// Team), newest first.
pub fn commit_evidence(
    root: &Path,
    base: &str,
    doc: &LifecycleDoc,
    limit: usize,
) -> Vec<LifecycleEvidenceItem> {
    if limit == 0 {
        return Vec::new();
    }
    let Some(commits) = read_commits(root, base, limit) else {
        return Vec::new();
    };
    let hook = pre_commit_hook(root);
    let team = doc.preset == LifecyclePreset::Team;
    commits
        .iter()
        .map(|c| {
            let pr = pr_ref(&c.subject);
            LifecycleEvidenceItem {
                source_kind: if pr.is_some() {
                    LifecycleSourceKind::Pr
                } else {
                    LifecycleSourceKind::Commit
                },
                source_ref: pr
                    .clone()
                    .unwrap_or_else(|| c.sha.chars().take(10).collect()),
                title: c.subject.clone(),
                occurred_at: c.occurred_at.clone(),
                outcomes: doc
                    .steps
                    .iter()
                    .map(|s| commit_step(&s.id, c, pr.as_deref(), hook.as_deref(), team))
                    .collect(),
            }
        })
        .collect()
}

fn commit_step(
    id: &str,
    c: &CommitRead,
    pr: Option<&str>,
    hook: Option<&str>,
    team: bool,
) -> LifecycleStepOutcome {
    let unseen = || out(id, O::Unknown, Some("not observable from a commit".into()));
    match id {
        "frame" | "recall" | "isolate" | "sync" | "record" => unseen(),
        "link" if ISSUE_RE.is_match(&c.subject) => out(id, O::Done, Some("issue reference".into())),
        "link" => out(id, O::Skipped, Some("no task or issue reference".into())),
        "gate" => match hook {
            Some(h) => out(id, O::Done, Some(format!("passed {h} pre-commit"))),
            None => out(
                id,
                O::Unknown,
                Some("no pre-commit hook in the repo".into()),
            ),
        },
        "tests" => match c.files.iter().filter(|f| touches_tests(f)).count() {
            0 => out(id, O::Skipped, Some("no test files changed".into())),
            k => out(id, O::Done, Some(plural(k, "test file"))),
        },
        "docs" => match c.files.iter().filter(|f| touches_docs(f)).count() {
            0 => out(id, O::Skipped, Some("no docs changed".into())),
            k => out(id, O::Done, Some(plural(k, "doc file"))),
        },
        "commit" if team && !is_conventional(&c.subject) => {
            out(id, O::Skipped, Some("message not conventional".into()))
        }
        "commit" => out(id, O::Done, None),
        "land" if !team => out(id, O::Done, Some("on the base branch".into())),
        "land" => match pr {
            Some(n) => out(id, O::Done, Some(format!("pull request #{n}"))),
            None => out(id, O::Skipped, Some("no pull request reference".into())),
        },
        _ => out(id, O::Unknown, Some("custom step; not observable".into())),
    }
}

#[cfg(test)]
#[path = "evidence_tests.rs"]
mod tests;
