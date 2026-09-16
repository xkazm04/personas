//! **Where an unattended worker authors** — an isolated git worktree, never
//! the operator's own checkout.
//!
//! # The night that produced this module
//!
//! Bench sweep #23 (2026-08-26), the first App-master night on the `ascent`
//! repository. The overnight-dispatched fleet worker did exactly what the
//! unattended guardrails told it to do — *"create and work on a dedicated
//! branch named `autopilot/<short-slug>`"* — and ran
//! `git checkout -b autopilot/env-example-alert-webhook` **inside the
//! project's shared checkout** (`dev_projects.root_path`). The proposal itself
//! was good. The side effect was not: the operator's working tree, and the
//! `next dev` server running against it, were left sitting on the agent's
//! branch. Nobody switched them back until a human noticed.
//!
//! A branch switch is a whole-checkout event. In a repository a human works
//! in — and kp-style repos run several agent sessions in one tree at once —
//! there is no such thing as an agent "just" creating a branch there.
//!
//! P5a's gate runner already knew this: it runs every gate in
//! `git worktree add --detach` precisely so that a gate never disturbs a
//! shared checkout ([`crate::app_master_gates::run_declared_gates`]).
//! **Authoring is the more dangerous half and had none of that protection.**
//! This module gives it the same one.
//!
//! # What a dispatch does now
//!
//! ```text
//! before spawn:  git worktree add -b autopilot/<slug> <worktrees>/<pid>/<slug> <main>
//!                borrow_installed_deps(root_path, worktree)   ← P5a's own door
//! spawn:         fleet headless session with cwd = the worktree
//! prompt:        "you are ALREADY on branch X in an isolated worktree; commit
//!                 here; NEVER run git checkout/switch"
//! ```
//!
//! The shared checkout is not read-modified at any point: `git worktree add`
//! writes `.git/worktrees/<name>/` and a ref, and touches no file in the
//! working tree and no `HEAD`.
//!
//! # Where the worktrees live, and why not in the repo
//!
//! Under the **app data directory** (`<app_data>/worktrees/<project8>/<hash8>`,
//! honoring `PERSONAS_DATA_DIR`), never `<root_path>/.personas-worktrees/`.
//! Both directory names are short on purpose — see [`PROJECT_DIR_CHARS`].
//! The in-repo option is tempting — the worktree sits next to what it mirrors —
//! and it is the wrong one here for four reasons, in descending order of how
//! much they cost:
//!
//! 1. **The overnight engine walks `root_path` itself.** `walk_project_files`
//!    hashes the project tree every night to compute the scan delta. A second
//!    full checkout under the root — with a junctioned `node_modules` inside
//!    it — would be walked as project surface, and every night's delta and
//!    every context-map fingerprint would be measuring the agent's own
//!    scratch space.
//! 2. **It keeps the shared tree byte-identical.** Nothing new appears in the
//!    operator's `git status`, so nothing can be swept into somebody's
//!    `git add -A`, and no `.gitignore` edit is needed in a repository we do
//!    not own. (An unignored in-repo worktree is exactly the "leaves the
//!    operator's tree changed" failure this module exists to end, in a
//!    quieter form.)
//! 3. **A routine cleanup in the operator's checkout cannot destroy
//!    in-flight work.** `git clean -fdx` is a normal thing to run in one's own
//!    repo; it is not a normal thing to have delete an agent's unreviewed
//!    branch working copy.
//! 4. **It follows `PERSONAS_DATA_DIR`**, so parallel test instances get
//!    isolated worktree roots for free, the same way they get isolated DBs.
//!
//! The cost of the choice is that the worktree is not obvious from inside the
//! repository. That is paid back by recording the path on the dispatch result
//! and the night digest, and by `git worktree list` in the shared checkout,
//! which names every one of them.
//!
//! # The branch stays repo-global
//!
//! A worktree does not scope a branch. `git worktree add -b autopilot/x`
//! writes `refs/heads/autopilot/x` in the **shared** repository, so
//! [`crate::app_master_gates::list_proposal_branches`] — which discovers
//! proposals with `for-each-ref refs/heads/autopilot/*` in `root_path` — sees
//! it unchanged, and so does everything downstream of it (merge detection,
//! revert detection, the gate sweep). `a_worktree_authored_branch_is_visible_to_the_reconciler`
//! pins that rather than assuming it.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::app_master_gates::{
    borrow_installed_deps, git, resolve_main_branch, unlink_borrowed, BORROWED_DEP_DIRS,
    PROPOSAL_BRANCH_PREFIX,
};

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/// Directory under the app data dir that holds every project's authoring
/// worktrees.
pub const AUTHORING_WORKTREES_DIRNAME: &str = "worktrees";

/// Longest slug taken from an idea title. Long enough to stay recognisable in
/// `git branch`. The slug names the BRANCH only; the directory is named by
/// [`worktree_leaf_name`], so the slug's length no longer costs path budget.
pub const MAX_SLUG_CHARS: usize = 48;

/// Characters of the project id used as the per-project directory name.
///
/// The directories are short because Windows is not: `C:/Users/<u>/AppData/
/// Roaming/com.personas.desktop/worktrees/` is ~60 characters before anything
/// of ours, and the layout this replaced added a 36-character project uuid and
/// a slug of up to 48+ characters — ~150 characters before the first repo
/// file, so `git worktree add` failed on any repository with a deep tree once
/// a checked-out path crossed `MAX_PATH` (260). Eight characters of a uuid and
/// an eight-hex leaf give that ~80 characters back. The branch keeps the full,
/// readable slug; `git worktree list` maps one to the other.
pub const PROJECT_DIR_CHARS: usize = 8;

/// Hex characters of the branch-name digest used as the worktree's leaf
/// directory. A collision is not a correctness problem — [`free_slot`] skips
/// any candidate whose directory already exists.
pub const LEAF_HEX_CHARS: usize = 8;

/// How many suffixed candidates to try before giving up on a free
/// branch/directory pair. A project that has 50 live `autopilot/<same-title>`
/// worktrees has a different problem.
const MAX_SLUG_ATTEMPTS: usize = 50;

/// Default age, in days, after which an unmerged **and clean** authoring
/// worktree is retired. Unreviewed work is not deleted for being old — only a
/// worktree with nothing uncommitted in it, whose branch survives the removal
/// either way.
pub const PRUNE_AFTER_DAYS: u64 = 14;

/// Default grace window, in hours, in which a worktree is assumed to belong to
/// a session that is still running.
///
/// It exists because of a real ambiguity in git: **a freshly spawned worker's
/// worktree is clean and its branch has no commits yet, so its tip is an
/// ancestor of main — exactly like a merged proposal's.** Without this window
/// the merge rule would delete the working directory out from under an agent
/// that had been running for ten minutes. `mtime` is a weak signal, so it is
/// used only to *refuse* a removal, never to justify one.
pub const PRUNE_GRACE_HOURS: u64 = 6;

/// When an authoring worktree has finished its job.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrunePolicy {
    /// Touched more recently than this ⇒ never retired, whatever its branch
    /// says. See [`PRUNE_GRACE_HOURS`].
    pub grace: Duration,
    /// Age past which an unmerged but clean worktree is retired anyway.
    pub max_age: Duration,
}

impl Default for PrunePolicy {
    fn default() -> Self {
        Self {
            grace: Duration::from_secs(PRUNE_GRACE_HOURS * 60 * 60),
            max_age: Duration::from_secs(PRUNE_AFTER_DAYS * 24 * 60 * 60),
        }
    }
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/// A branch/directory slug from an idea title: lowercase, `[a-z0-9-]`, no
/// runs, bounded. Empty input yields `task`, so a branch is always nameable.
pub fn branch_slug(title: &str) -> String {
    let mut out = String::with_capacity(title.len().min(MAX_SLUG_CHARS));
    let mut last_dash = true; // leading dashes are runs too
    for ch in title.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
        if out.len() >= MAX_SLUG_CHARS {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "task".to_string()
    } else {
        out
    }
}

/// The proposal branch for a slug — the `autopilot/` namespace the reconciler
/// discovers by, taken from [`PROPOSAL_BRANCH_PREFIX`] rather than re-typed.
pub fn proposal_branch(slug: &str) -> String {
    format!("{PROPOSAL_BRANCH_PREFIX}{slug}")
}

/// A project id as a short directory name: its first [`PROJECT_DIR_CHARS`]
/// alphanumeric characters (ids are uuids in practice, so this is the first
/// uuid group). Two projects sharing a prefix share a directory harmlessly —
/// leaves are digests of branch names, [`free_slot`] refuses an occupied one,
/// and prune works from each repository's own worktree list.
fn project_dir_name(project_id: &str) -> String {
    let s: String = project_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(PROJECT_DIR_CHARS)
        .collect::<String>()
        .to_ascii_lowercase();
    if s.is_empty() {
        "project".to_string()
    } else {
        s
    }
}

/// The leaf directory for a branch: the first [`LEAF_HEX_CHARS`] hex digits of
/// its SHA-256. Stable across runs and toolchains (unlike `DefaultHasher`).
pub fn worktree_leaf_name(branch: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(branch.as_bytes())
        .iter()
        .take(LEAF_HEX_CHARS.div_ceil(2))
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        .chars()
        .take(LEAF_HEX_CHARS)
        .collect()
}

/// `<worktrees_root>/<project8>` — every authoring worktree for one project.
pub fn project_worktrees_dir(worktrees_root: &Path, project_id: &str) -> PathBuf {
    worktrees_root.join(project_dir_name(project_id))
}

// ---------------------------------------------------------------------------
// Preparing one
// ---------------------------------------------------------------------------

/// The isolated place an unattended worker was given to author in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthoringWorktree {
    /// `autopilot/<slug>` — created fresh, off `base_branch`, and global to
    /// the repository so the reconciler finds it.
    pub branch: String,
    /// The worktree directory. This is the session's `cwd`.
    pub path: PathBuf,
    /// The branch the new one forked from: the named base when one was asked
    /// for and resolves, otherwise the project's resolved main.
    pub base_branch: String,
    /// What was borrowed from the source checkout rather than rebuilt.
    pub borrowed: Vec<String>,
    /// Set when a named base was asked for and NOT used — the worker and the
    /// record must both be able to see that it reads a different tree than the
    /// one its brief names.
    pub base_note: Option<String>,
}

/// Create an isolated worktree on a fresh `autopilot/<slug>` branch off the
/// project's main branch, and borrow the source checkout's installed
/// dependencies into it.
///
/// **Errors are refusals, not fallbacks.** A caller that cannot get a worktree
/// must skip the dispatch, never spawn into `root_path` anyway — falling back
/// to the shared checkout is precisely the behaviour this module exists to
/// remove. The one thing that is best-effort is the dependency borrow: a
/// missing `node_modules` makes some commands fail, while a branch switch in a
/// human's tree is unrecoverable by a machine.
pub async fn prepare_authoring_worktree(
    root_path: &Path,
    worktrees_root: &Path,
    project_id: &str,
    title: &str,
    recorded_main_branch: Option<&str>,
) -> Result<AuthoringWorktree, String> {
    prepare_authoring_worktree_from(
        root_path,
        worktrees_root,
        project_id,
        title,
        recorded_main_branch,
        None,
    )
    .await
}

/// [`prepare_authoring_worktree`], forking from `named_base` instead of main
/// when the work names the branch it must start from ("branch from
/// `ship/ascent-stabilize`").
///
/// A named base that does not resolve — locally, or as `origin/<name>` — is
/// not a refusal: the worktree forks from main exactly as before, and
/// [`AuthoringWorktree::base_note`] says so, so the mismatch is recorded
/// rather than silently read as the requested tree.
pub async fn prepare_authoring_worktree_from(
    root_path: &Path,
    worktrees_root: &Path,
    project_id: &str,
    title: &str,
    recorded_main_branch: Option<&str>,
    named_base: Option<&str>,
) -> Result<AuthoringWorktree, String> {
    // A path that is not a git work tree has no branches to isolate, and git
    // would otherwise walk up to a PARENT repository and author there.
    match git(root_path, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(s) if s.trim() == "true" => {}
        _ => {
            return Err(format!(
                "{} is not a git work tree — an unattended worker authors only in an isolated \
                 worktree, so there is nothing to dispatch into",
                root_path.display()
            ))
        }
    }

    let main = resolve_main_branch(root_path, recorded_main_branch).await;
    let named_base = named_base.map(str::trim).filter(|n| !n.is_empty());
    let named = match named_base {
        Some(n) => resolve_named_base(root_path, n).await,
        None => None,
    };
    let base =
        match (&named, &main) {
            (Some(n), _) => n.clone(),
            (None, Some(m)) => m.clone(),
            (None, None) => return Err(
                "no main branch resolves in the checkout; refusing to fork an authoring branch \
                 from an unknown base"
                    .to_string(),
            ),
        };
    let base_note = match (named_base, &named) {
        (Some(asked), None) => Some(format!(
            "the work names `{asked}` as its base branch, but no such ref resolves in the \
             checkout (locally or on origin); this worktree forked from `{base}` instead"
        )),
        _ => None,
    };

    let dir = project_worktrees_dir(worktrees_root, project_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let stem = branch_slug(title);
    let (slug, path) = free_slot(root_path, &dir, &stem).await?;
    let branch = proposal_branch(&slug);
    let path_str = path.to_string_lossy().to_string();

    git(
        root_path,
        &worktree_add_args(&["-b", &branch, &path_str, &base]),
    )
    .await
    .map_err(|e| worktree_add_error(&path_str, &e))?;

    // The worker must see the repository's own resolved environment — the same
    // borrow the gate runner performs, through the same function.
    let borrowed = borrow_installed_deps(root_path, &path);
    tracing::info!(
        project_id,
        branch = %branch,
        worktree = %path.display(),
        base = %base,
        mechanism = borrowed.mechanism,
        "unattended_worktree: authoring worktree prepared ({})",
        if borrowed.linked.is_empty() {
            "nothing to borrow".to_string()
        } else {
            format!("borrowed {}", borrowed.linked.join(", "))
        }
    );

    Ok(AuthoringWorktree {
        branch,
        path,
        base_branch: base,
        borrowed: borrowed.linked,
        base_note,
    })
}

/// The commit-ish a named base resolves to: the name itself, else
/// `origin/<name>`. `None` for anything that is not a plausible ref name —
/// the name reaches `git worktree add` as a positional argument, so a value
/// that could read as an option never gets that far.
async fn resolve_named_base(root_path: &Path, name: &str) -> Option<String> {
    if !is_ref_shaped(name) {
        return None;
    }
    for candidate in [name.to_string(), format!("origin/{name}")] {
        if git(
            root_path,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{candidate}^{{commit}}"),
            ],
        )
        .await
        .is_ok()
        {
            return Some(candidate);
        }
    }
    None
}

/// A conservative subset of git's ref-name rules: `[A-Za-z0-9._/-]`, not
/// starting with `-` or `/`, no `..`, not ending in `/`, `.` or `.lock`.
pub fn is_ref_shaped(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with('-')
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.ends_with('.')
        && !name.ends_with(".lock")
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
}

/// Words that follow "branch from" in prose without naming a ref.
const NOT_A_BASE: &[&str] = &[
    "a", "an", "it", "its", "this", "that", "there", "here", "scratch", "latest", "current",
    "your", "our", "my", "which", "where",
];

/// The base branch a piece of work names in its own prose, if it names one.
///
/// Deliberately conservative — a false positive forks from the wrong tree, a
/// false negative only keeps today's behaviour. Recognised phrasings:
///
/// * `branch from <ref>` / `branched off <ref>` / `fork off of <ref>` (with an
///   optional `the` before the ref)
/// * `base branch <ref>` / `base branch: <ref>` / `base branch is <ref>` /
///   `base: <ref>`
///
/// The ref may be wrapped in backticks or quotes; trailing punctuation is
/// dropped. Anything not [`is_ref_shaped`], or a filler word ("branch from
/// scratch"), is not a base.
pub fn named_base_ref(text: &str) -> Option<String> {
    fn norm(token: &str) -> String {
        token
            .trim_matches(|c: char| !c.is_ascii_alphanumeric())
            .to_ascii_lowercase()
    }
    fn as_ref(token: &str) -> Option<String> {
        let t = token
            .trim_end_matches(|c: char| matches!(c, ',' | ';' | ':' | '!' | '?' | ')' | ']'))
            .trim_matches(|c: char| matches!(c, '`' | '\'' | '"' | '(' | '['))
            .trim_end_matches('.');
        let t = t.trim_matches(|c: char| matches!(c, '`' | '\'' | '"'));
        (is_ref_shaped(t) && !NOT_A_BASE.contains(&t.to_ascii_lowercase().as_str()))
            .then(|| t.to_string())
    }
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let word = |i: usize| tokens.get(i).map(|t| norm(t)).unwrap_or_default();
    for i in 0..tokens.len() {
        let w = word(i);
        let mut j = if matches!(
            w.as_str(),
            "branch" | "branched" | "branching" | "fork" | "forked" | "forking"
        ) && matches!(word(i + 1).as_str(), "from" | "off")
        {
            let mut j = i + 2;
            if word(i + 1) == "off" && word(j) == "of" {
                j += 1;
            }
            j
        } else if w == "base" && tokens[i].ends_with(':') {
            i + 1
        } else if w == "base" && norm(tokens.get(i + 1).copied().unwrap_or("")) == "branch" {
            let mut j = i + 2;
            if word(j) == "is" {
                j += 1;
            }
            j
        } else {
            continue;
        };
        if word(j) == "the" {
            j += 1;
        }
        if let Some(r) = tokens.get(j).and_then(|t| as_ref(t)) {
            return Some(r);
        }
    }
    None
}

/// `git worktree add <rest…>`, with `core.longpaths` on under Windows so a
/// deep repository checks out past `MAX_PATH`. The `-c` travels to the
/// checkout git runs as a child process through `GIT_CONFIG_PARAMETERS`.
fn worktree_add_args<'a>(rest: &[&'a str]) -> Vec<&'a str> {
    let mut args: Vec<&'a str> = Vec::with_capacity(rest.len() + 4);
    if cfg!(windows) {
        args.extend(["-c", "core.longpaths=true"]);
    }
    args.extend(["worktree", "add"]);
    args.extend_from_slice(rest);
    args
}

/// A refusal that names the path and its length, so a path-limit failure is
/// legible as one rather than as an opaque checkout error.
fn worktree_add_error(path: &str, err: &str) -> String {
    format!(
        "could not create the authoring worktree at {path} ({} chars before any repository \
         file{}): {err}",
        path.chars().count(),
        if cfg!(windows) {
            "; Windows refuses paths past 260 chars where long paths are not enabled"
        } else {
            ""
        }
    )
}

/// Re-enter the worktree a previous attempt at the SAME work was given,
/// instead of minting a fresh `-2`/`-3` branch for it.
///
/// A retried, resumed or restart-recovered step used to call
/// [`prepare_authoring_worktree`] again, so every attempt forked a competing
/// branch and the earlier attempt's commits and uncommitted files were left
/// behind in a directory nothing would ever look at again. Two cases re-attach:
///
/// * **the directory still exists** and is checked out on `branch` — it is
///   used as-is, dirty files included (that is the work being resumed);
/// * **the directory is gone** (retired while clean) but `branch` still
///   exists — the branch is checked out again at the same path, so the retry
///   continues from its commits.
///
/// Anything else — a path outside `worktrees_root`, a branch outside the
/// `autopilot/` namespace, a directory on another branch, a branch that no
/// longer exists — is an `Err`, and the caller prepares a fresh worktree.
pub async fn reattach_authoring_worktree(
    root_path: &Path,
    worktrees_root: &Path,
    path: &Path,
    branch: &str,
    base_branch: &str,
) -> Result<AuthoringWorktree, String> {
    let path_str = path.to_string_lossy().to_string();
    if !branch.starts_with(PROPOSAL_BRANCH_PREFIX) || !path_is_under(&path_str, worktrees_root) {
        return Err(format!(
            "{branch} @ {path_str} is not an authoring worktree this app created"
        ));
    }
    if path.is_dir() {
        let head = git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .map_err(|e| format!("{path_str} is not a readable worktree: {e}"))?;
        if head.trim() != branch {
            return Err(format!(
                "{path_str} is checked out on `{}`, not `{branch}`",
                head.trim()
            ));
        }
    } else {
        let refname = format!("refs/heads/{branch}");
        git(root_path, &["rev-parse", "--verify", "--quiet", &refname])
            .await
            .map_err(|_| format!("branch {branch} no longer exists"))?;
        // A retired directory can leave an administrative entry behind that
        // would make git report the branch as still checked out.
        let _ = git(root_path, &["worktree", "prune"]).await;
        git(root_path, &worktree_add_args(&[&path_str, branch]))
            .await
            .map_err(|e| worktree_add_error(&path_str, &e))?;
    }
    let borrowed = borrow_installed_deps(root_path, path);
    tracing::info!(
        branch = %branch,
        worktree = %path.display(),
        "unattended_worktree: re-attached the previous attempt's authoring worktree"
    );
    Ok(AuthoringWorktree {
        branch: branch.to_string(),
        path: path.to_path_buf(),
        base_branch: base_branch.to_string(),
        borrowed: borrowed.linked,
        base_note: None,
    })
}

/// The first `<slug>` whose branch does not exist AND whose directory does
/// not, so two dispatches of the same title never collide. The directory is
/// the branch's digest leaf ([`worktree_leaf_name`]), not the slug.
async fn free_slot(
    root_path: &Path,
    project_dir: &Path,
    stem: &str,
) -> Result<(String, PathBuf), String> {
    for n in 1..=MAX_SLUG_ATTEMPTS {
        let slug = if n == 1 {
            stem.to_string()
        } else {
            format!("{stem}-{n}")
        };
        let path = project_dir.join(worktree_leaf_name(&proposal_branch(&slug)));
        if path.exists() {
            continue;
        }
        let refname = format!("refs/heads/{}", proposal_branch(&slug));
        if git(root_path, &["rev-parse", "--verify", "--quiet", &refname])
            .await
            .is_ok()
        {
            continue;
        }
        return Ok((slug, path));
    }
    Err(format!(
        "no free `{}{stem}` branch/worktree slot after {MAX_SLUG_ATTEMPTS} attempts",
        PROPOSAL_BRANCH_PREFIX
    ))
}

// ---------------------------------------------------------------------------
// Retiring finished ones
// ---------------------------------------------------------------------------

/// What one prune pass did. Every removal is named; nothing is summarised into
/// a count the operator cannot check.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PruneReport {
    /// `branch @ path` for each worktree removed.
    pub removed: Vec<String>,
    /// Worktrees left in place (live work, or unmerged and still recent).
    pub kept: usize,
    pub errors: Vec<String>,
}

/// One entry of `git worktree list --porcelain`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeEntry {
    pub path: String,
    /// `None` for a detached worktree (the gate runner's, for instance).
    pub branch: Option<String>,
}

/// Parse `git worktree list --porcelain`: blank-line-separated stanzas whose
/// first line is `worktree <path>` and whose `branch` line, when present, is a
/// full refname. Pure, so the shape of git's output is pinned by a test rather
/// than by a live repository.
pub fn parse_worktree_list(out: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut current: Option<WorktreeEntry> = None;
    for line in out.lines() {
        let line = line.trim_end();
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(e) = current.take() {
                entries.push(e);
            }
            current = Some(WorktreeEntry {
                path: p.trim().to_string(),
                branch: None,
            });
        } else if let Some(b) = line.strip_prefix("branch ") {
            if let Some(e) = current.as_mut() {
                e.branch = Some(
                    b.trim()
                        .strip_prefix("refs/heads/")
                        .unwrap_or(b.trim())
                        .to_string(),
                );
            }
        }
    }
    if let Some(e) = current.take() {
        entries.push(e);
    }
    entries
}

/// Case/separator-tolerant "is `candidate` inside `root`".
///
/// git reports worktree paths with forward slashes on Windows while
/// `PathBuf::join` produces backslashes, so a raw `starts_with` answers `false`
/// for a path that plainly is inside. Both sides are canonicalised when the
/// filesystem allows it, and compared as normalised strings otherwise.
///
/// The `\\?\` verbatim prefix Windows canonicalisation adds is stripped: a
/// path that does NOT exist yet cannot be canonicalised, so one side would
/// carry the prefix and the other would not — which is how a retired
/// worktree's own directory once failed to be recognised as ours.
fn path_is_under(candidate: &str, root: &Path) -> bool {
    fn norm(p: &Path) -> String {
        let resolved = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let s = resolved.to_string_lossy().replace('\\', "/");
        let s = s
            .strip_prefix("//?/UNC/")
            .map(|rest| format!("//{rest}"))
            .unwrap_or_else(|| s.strip_prefix("//?/").unwrap_or(&s).to_string());
        let s = s.trim_end_matches('/').to_string();
        if cfg!(windows) {
            s.to_lowercase()
        } else {
            s
        }
    }
    let root = norm(root);
    if root.is_empty() {
        return false;
    }
    let cand = norm(Path::new(candidate));
    cand == root || cand.starts_with(&format!("{root}/"))
}

/// Best-effort retirement of authoring worktrees that have finished their job.
///
/// Three conditions, and all three must hold:
///
/// 1. **Nothing uncommitted in it.** Unreviewed work is never deleted for being
///    inconvenient; if the directory holds something the branch does not, the
///    worktree stays.
/// 2. **Not touched inside `policy.grace`.** See [`PRUNE_GRACE_HOURS`] — this
///    is what keeps the merge rule from deleting a running worker's directory.
/// 3. **Either its branch is an ancestor of `main_branch`** (the human took the
///    proposal, or it never authored anything — either way there is nothing
///    here that is not also in the repository) **or it is older than
///    `policy.max_age`** (the session is long gone).
///
/// **Branches are never deleted.** The proposal ledger, the merge/revert
/// observations and the reconciler all key on the branch; removing the working
/// copy costs nothing, removing the branch would erase the record.
///
/// Only worktrees **under `worktrees_root`** and on an `autopilot/*` branch are
/// ever considered, so the operator's own worktrees and the gate runner's
/// detached temporaries are untouched.
pub async fn prune_authoring_worktrees(
    root_path: &Path,
    worktrees_root: &Path,
    main_branch: &str,
    policy: PrunePolicy,
) -> PruneReport {
    let mut report = PruneReport::default();
    let listing = match git(root_path, &["worktree", "list", "--porcelain"]).await {
        Ok(o) => o,
        Err(e) => {
            report.errors.push(e);
            return report;
        }
    };

    for entry in parse_worktree_list(&listing) {
        let Some(branch) = entry.branch.clone() else {
            continue; // detached — the gate runner's, not ours
        };
        if !branch.starts_with(PROPOSAL_BRANCH_PREFIX)
            || !path_is_under(&entry.path, worktrees_root)
        {
            continue;
        }
        let path = PathBuf::from(&entry.path);
        let settled = !is_newer_than(&path, policy.grace) && is_clean(&path).await;
        let finished = git(
            root_path,
            &["merge-base", "--is-ancestor", &branch, main_branch],
        )
        .await
        .is_ok()
            || is_older_than(&path, policy.max_age);
        if !(settled && finished) {
            report.kept += 1;
            continue;
        }
        // Unlink the borrowed environment FIRST. `git worktree remove --force`
        // deletes recursively, and a recursive delete that walked into a
        // junction would delete the operator's real `node_modules`.
        for name in BORROWED_DEP_DIRS {
            unlink_borrowed(&path, name);
        }
        match git(root_path, &["worktree", "remove", "--force", &entry.path]).await {
            Ok(_) => report.removed.push(format!("{branch} @ {}", entry.path)),
            Err(e) => report.errors.push(e),
        }
    }
    if !report.removed.is_empty() {
        let _ = git(root_path, &["worktree", "prune"]).await;
        tracing::info!(
            "unattended_worktree: retired {} finished authoring worktree(s): {}",
            report.removed.len(),
            report.removed.join(", ")
        );
    }
    report
}

/// Directory mtime as a proxy for "when this worktree was last touched".
///
/// A proxy, and named as one: git writes into `.git`, not the worktree root,
/// so a worktree whose agent only committed reads older than it really is.
/// That is why the two readings are used asymmetrically — [`is_newer_than`]
/// can only *refuse* a removal, [`is_older_than`] can only justify one for a
/// worktree that is already clean and past the grace window.
fn worktree_age(path: &Path) -> Option<Duration> {
    let meta = std::fs::metadata(path).ok()?;
    SystemTime::now().duration_since(meta.modified().ok()?).ok()
}

fn is_older_than(path: &Path, max_age: Duration) -> bool {
    worktree_age(path).map(|age| age > max_age).unwrap_or(false)
}

/// Touched inside `window`. An unreadable mtime counts as *recent* — the
/// direction that keeps a worktree rather than deletes one.
fn is_newer_than(path: &Path, window: Duration) -> bool {
    match worktree_age(path) {
        Some(age) => age < window,
        None => true,
    }
}

/// Nothing uncommitted in the worktree. A worktree git cannot answer about is
/// treated as dirty — the conservative direction.
async fn is_clean(path: &Path) -> bool {
    git(path, &["status", "--porcelain"])
        .await
        .map(|o| o.trim().is_empty())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Real `git`, against a real throwaway repository — the same discipline
    // `app_master_gates::tests` uses. The claim under test is a claim about
    // what git does to a checkout, and a mock would pin our belief about it
    // instead of the behaviour that cost an operator a night.

    struct Repo {
        dir: tempfile::TempDir,
    }

    impl Repo {
        fn new() -> Option<Self> {
            let dir = tempfile::tempdir().ok()?;
            let r = Repo { dir };
            r.git(&["init", "--initial-branch=main"])?;
            r.git(&["config", "user.email", "t@example.com"])?;
            r.git(&["config", "user.name", "T"])?;
            r.git(&["config", "commit.gpgsign", "false"])?;
            r.commit("README.md", "hello", "chore: initial")?;
            Some(r)
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }

        fn git(&self, args: &[&str]) -> Option<String> {
            git_in(self.dir.path(), args)
        }

        fn commit(&self, file: &str, body: &str, message: &str) -> Option<String> {
            std::fs::write(self.dir.path().join(file), body).ok()?;
            self.git(&["add", file])?;
            self.git(&["commit", "-m", message])?;
            self.git(&["rev-parse", "HEAD"])
        }
    }

    fn git_in(cwd: &Path, args: &[&str]) -> Option<String> {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    // -- naming, pure ---------------------------------------------------------

    #[test]
    fn a_title_becomes_a_bounded_branch_safe_slug() {
        assert_eq!(
            branch_slug("Document KP's trusted-proxy env example"),
            "document-kp-s-trusted-proxy-env-example"
        );
        assert_eq!(
            branch_slug("  --Fix   the flaky retry test!! "),
            "fix-the-flaky-retry-test"
        );
        // Never empty — a branch must always be nameable.
        assert_eq!(branch_slug(""), "task");
        assert_eq!(branch_slug("!!!"), "task");
        // Bounded, and never left with a trailing dash from the cut.
        let long = branch_slug(&"word ".repeat(60));
        assert!(long.len() <= MAX_SLUG_CHARS, "{}", long.len());
        assert!(!long.ends_with('-'));
        // The namespace the reconciler discovers by, not a re-typed literal.
        assert_eq!(proposal_branch("abc"), "autopilot/abc");
        assert!(proposal_branch("abc").starts_with(PROPOSAL_BRANCH_PREFIX));
    }

    #[test]
    fn worktree_directories_are_short_whatever_the_title_and_project_id() {
        let root = Path::new("C:/data/worktrees");
        let project = "0a2d4613-6c45-4e64-912d-83a3635bc14f";
        let dir = project_worktrees_dir(root, project);
        assert_eq!(dir, root.join("0a2d4613"));
        let branch = proposal_branch(&branch_slug(&"a very long idea title ".repeat(10)));
        let leaf = worktree_leaf_name(&branch);
        assert_eq!(leaf.len(), LEAF_HEX_CHARS);
        assert!(leaf.chars().all(|c| c.is_ascii_hexdigit()));
        // Stable, and distinct for the suffixed retry of the same title.
        assert_eq!(leaf, worktree_leaf_name(&branch));
        assert_ne!(leaf, worktree_leaf_name(&format!("{branch}-2")));
        // The whole per-worktree suffix is 17 chars, where it was up to ~88.
        let suffix = dir.join(&leaf);
        let suffix = suffix.strip_prefix(root).unwrap().to_string_lossy().len();
        assert_eq!(suffix, PROJECT_DIR_CHARS + 1 + LEAF_HEX_CHARS);
        assert_eq!(project_dir_name("--"), "project");
        // Only Windows gets the long-path switch; the rest passes through.
        let args = worktree_add_args(&["-b", "autopilot/x", "p", "main"]);
        assert_eq!(
            &args[args.len() - 6..],
            &["worktree", "add", "-b", "autopilot/x", "p", "main"]
        );
        assert_eq!(args.contains(&"core.longpaths=true"), cfg!(windows));
        assert!(worktree_add_error("C:/x", "boom").contains("(4 chars"));
    }

    #[test]
    fn a_named_base_branch_is_read_from_prose_conservatively() {
        assert_eq!(
            named_base_ref("Stabilize the login flow. Branch from `ship/ascent-stabilize`.")
                .as_deref(),
            Some("ship/ascent-stabilize")
        );
        assert_eq!(
            named_base_ref("please branch off of release/2.1, then fix it").as_deref(),
            Some("release/2.1")
        );
        assert_eq!(
            named_base_ref("Forked from the develop branch").as_deref(),
            Some("develop")
        );
        assert_eq!(
            named_base_ref("Base branch: ship/x\nDo the thing").as_deref(),
            Some("ship/x")
        );
        assert_eq!(
            named_base_ref("base: 'feature/y'").as_deref(),
            Some("feature/y")
        );
        // Prose that is not a ref, and prose with no base at all.
        assert_eq!(named_base_ref("Rewrite the branch from scratch"), None);
        assert_eq!(named_base_ref("Pick the data off a queue"), None);
        assert_eq!(named_base_ref("Fix the retry test"), None);
        assert_eq!(named_base_ref(""), None);
        // Nothing that could read as a git option ever comes back.
        assert_eq!(named_base_ref("branch from --upload-pack=evil"), None);
        assert!(!is_ref_shaped("a..b"));
        assert!(!is_ref_shaped("x.lock"));
        assert!(is_ref_shaped("ship/ascent-stabilize"));
    }

    #[tokio::test]
    async fn a_named_base_is_forked_from_and_an_unresolvable_one_is_recorded() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);

        repo.git(&["checkout", "-b", "ship/stabilize"]).unwrap();
        let ship_tip = repo.commit("s.txt", "s", "feat: ship line").unwrap();
        repo.git(&["checkout", "main"]).unwrap();
        let main_tip = repo.git(&["rev-parse", "HEAD"]).unwrap();

        let on_ship = prepare_authoring_worktree_from(
            repo.path(),
            &wt_root,
            "p",
            "on ship",
            Some("main"),
            Some("ship/stabilize"),
        )
        .await
        .unwrap();
        assert_eq!(on_ship.base_branch, "ship/stabilize");
        assert_eq!(on_ship.base_note, None);
        assert_eq!(
            git_in(&on_ship.path, &["rev-parse", "HEAD"]).unwrap(),
            ship_tip
        );

        let missing = prepare_authoring_worktree_from(
            repo.path(),
            &wt_root,
            "p",
            "on nothing",
            Some("main"),
            Some("ship/gone"),
        )
        .await
        .unwrap();
        assert_eq!(missing.base_branch, "main");
        assert_eq!(
            git_in(&missing.path, &["rev-parse", "HEAD"]).unwrap(),
            main_tip
        );
        let note = missing.base_note.clone().expect("the mismatch is recorded");
        assert!(
            note.contains("ship/gone") && note.contains("`main`"),
            "{note}"
        );

        cleanup(&repo, &on_ship);
        cleanup(&repo, &missing);
    }

    #[test]
    fn worktree_list_porcelain_is_parsed_into_path_and_branch() {
        let out = "worktree C:/repo\nHEAD abc123\nbranch refs/heads/main\n\
                   \n\
                   worktree C:/data/worktrees/p1/fix-a\nHEAD def456\nbranch refs/heads/autopilot/fix-a\n\
                   \n\
                   worktree C:/tmp/gate/wt\nHEAD 999\ndetached\n";
        let entries = parse_worktree_list(out);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert_eq!(entries[1].path, "C:/data/worktrees/p1/fix-a");
        assert_eq!(entries[1].branch.as_deref(), Some("autopilot/fix-a"));
        // A detached worktree (the gate runner's) carries no branch and is
        // therefore never a prune candidate.
        assert_eq!(entries[2].branch, None);
        assert!(parse_worktree_list("").is_empty());
    }

    // -- the isolation guarantee ---------------------------------------------

    #[tokio::test]
    async fn a_dispatch_authors_in_a_worktree_and_leaves_the_shared_checkout_untouched() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);

        // The operator's resolved environment, and the state of their tree
        // BEFORE the dispatch — this is the thing sweep #23 lost.
        std::fs::create_dir_all(repo.path().join("node_modules")).unwrap();
        std::fs::write(repo.path().join("node_modules").join("marker"), "installed").unwrap();
        let head_before = repo.git(&["rev-parse", "HEAD"]).unwrap();
        let branch_before = repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]).unwrap();
        let status_before = repo.git(&["status", "--porcelain"]).unwrap();
        assert_eq!(branch_before, "main");

        let wt = prepare_authoring_worktree(
            repo.path(),
            &wt_root,
            "proj-1",
            "Document the trusted-proxy env example",
            Some("main"),
        )
        .await
        .expect("a worktree should be prepared");

        // 1. The shared checkout did not move. Not its branch, not its HEAD.
        assert_eq!(
            repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]).unwrap(),
            "main"
        );
        assert_eq!(repo.git(&["rev-parse", "HEAD"]).unwrap(), head_before);

        // 2. The worker got a fresh branch off main, checked out somewhere else.
        assert_eq!(
            wt.branch,
            "autopilot/document-the-trusted-proxy-env-example"
        );
        assert_eq!(wt.base_branch, "main");
        assert!(wt.path.is_dir());
        assert_eq!(
            git_in(&wt.path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap(),
            wt.branch
        );
        assert_eq!(
            git_in(&wt.path, &["rev-parse", "HEAD"]).unwrap(),
            head_before,
            "the authoring branch forks from the main branch tip"
        );

        // 3. The worktree is OUTSIDE the repository — nothing new for the
        //    operator's `git status`, and nothing for the night's own file walk.
        assert!(!path_is_under(&wt.path.to_string_lossy(), repo.path()));
        assert!(path_is_under(&wt.path.to_string_lossy(), &wt_root));
        assert_eq!(
            repo.git(&["status", "--porcelain"]).unwrap(),
            status_before,
            "the dispatch added nothing to the operator's `git status`"
        );

        // 4. Dependencies are borrowed, not rebuilt — and the source's own copy
        //    survives (the borrow is a link; the target is never touched).
        assert!(
            wt.borrowed.iter().any(|b| b == "node_modules"),
            "borrowed: {:?}",
            wt.borrowed
        );
        assert!(wt.path.join("node_modules").join("marker").exists());
        assert!(repo.path().join("node_modules").join("marker").exists());

        cleanup(&repo, &wt);
    }

    #[tokio::test]
    async fn a_worktree_authored_branch_is_visible_to_the_reconciler() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);

        let wt = prepare_authoring_worktree(repo.path(), &wt_root, "p", "fix the retry test", None)
            .await
            .unwrap();

        // Sweep #23: a dispatch that authors NOTHING has a branch and no
        // commits, and must not read as an opened proposal.
        let pool = personas_db::init_test_db().unwrap();
        let record = |branch: &str, commits: &[crate::app_master_gates::ProposalCommit]| {
            let head = git_in(repo.path(), &["rev-parse", branch]).unwrap();
            crate::app_master_gates::upsert_proposal(
                &pool, "proj-wt", "p-1", branch, &head, None, commits,
            )
            .unwrap();
        };
        let (_, empty) = crate::app_master_gates::branch_commits(repo.path(), "main", &wt.branch)
            .await
            .unwrap();
        assert!(empty.is_empty(), "nothing authored yet");
        record(&wt.branch, &empty);
        let counts = crate::app_master_gates::proposal_counts_since(
            &pool,
            "proj-wt",
            Some("p-1"),
            "2000-01-01T00:00:00+00:00",
        )
        .unwrap();
        assert_eq!((counts.opened, counts.seen), (0, 1));

        // The worker commits, in its own worktree.
        std::fs::write(wt.path.join("retry.txt"), "fixed").unwrap();
        git_in(&wt.path, &["add", "retry.txt"]).unwrap();
        git_in(&wt.path, &["commit", "-m", "fix: the retry test"]).unwrap();

        // Branches are repository-global: the reconciler runs `for-each-ref` in
        // the SHARED checkout and still sees the proposal, with its commits.
        let branches = crate::app_master_gates::list_proposal_branches(repo.path())
            .await
            .unwrap();
        assert_eq!(branches, vec![wt.branch.clone()]);
        let (base, commits) =
            crate::app_master_gates::branch_commits(repo.path(), "main", &wt.branch)
                .await
                .unwrap();
        assert!(base.is_some());
        assert_eq!(
            commits
                .iter()
                .map(|c| c.subject.as_str())
                .collect::<Vec<_>>(),
            vec!["fix: the retry test"]
        );

        // …and the work authored INSIDE the worktree is what the delivery
        // reading counts, seen from the shared checkout.
        record(&wt.branch, &commits);
        let counts = crate::app_master_gates::proposal_counts_since(
            &pool,
            "proj-wt",
            Some("p-1"),
            "2000-01-01T00:00:00+00:00",
        )
        .unwrap();
        assert_eq!((counts.opened, counts.seen), (1, 1));

        cleanup(&repo, &wt);
    }

    #[tokio::test]
    async fn two_dispatches_of_the_same_title_never_collide() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);

        let a = prepare_authoring_worktree(repo.path(), &wt_root, "p", "same title", None)
            .await
            .unwrap();
        let b = prepare_authoring_worktree(repo.path(), &wt_root, "p", "same title", None)
            .await
            .unwrap();
        assert_eq!(a.branch, "autopilot/same-title");
        assert_eq!(b.branch, "autopilot/same-title-2");
        assert_ne!(a.path, b.path);

        cleanup(&repo, &a);
        cleanup(&repo, &b);
    }

    #[tokio::test]
    async fn a_retry_reattaches_the_previous_worktree_instead_of_forking_a_new_branch() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);

        let first = prepare_authoring_worktree(repo.path(), &wt_root, "p", "step one", None)
            .await
            .unwrap();
        std::fs::write(first.path.join("half.txt"), "in progress").unwrap();

        // Directory still there: re-entered as-is, uncommitted work included.
        let again =
            reattach_authoring_worktree(repo.path(), &wt_root, &first.path, &first.branch, "main")
                .await
                .unwrap();
        assert_eq!(again.branch, first.branch);
        assert_eq!(again.path, first.path);
        assert!(again.path.join("half.txt").exists());

        // Directory retired but branch kept: checked out again at the same path,
        // carrying the commit the earlier attempt made.
        git_in(&first.path, &["add", "half.txt"]).unwrap();
        git_in(&first.path, &["commit", "-m", "wip: half"]).unwrap();
        cleanup(&repo, &first);
        assert!(!first.path.exists());
        let revived =
            reattach_authoring_worktree(repo.path(), &wt_root, &first.path, &first.branch, "main")
                .await
                .unwrap();
        assert!(revived.path.join("half.txt").exists());
        assert_eq!(
            git_in(&revived.path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap(),
            first.branch
        );
        let branches = crate::app_master_gates::list_proposal_branches(repo.path())
            .await
            .unwrap();
        assert_eq!(
            branches,
            vec![first.branch.clone()],
            "no -2 branch was minted"
        );

        // Not ours, or gone: refused so the caller prepares a fresh one.
        assert!(reattach_authoring_worktree(
            repo.path(),
            &wt_root,
            &data.path().join("elsewhere"),
            &first.branch,
            "main"
        )
        .await
        .is_err());
        cleanup(&repo, &revived);
        repo.git(&["branch", "-D", &first.branch]).unwrap();
        assert!(reattach_authoring_worktree(
            repo.path(),
            &wt_root,
            &first.path,
            &first.branch,
            "main"
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn a_non_git_project_is_refused_rather_than_dispatched_into() {
        if !git_available() {
            return;
        }
        let plain = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let err = prepare_authoring_worktree(
            plain.path(),
            &data.path().join(AUTHORING_WORKTREES_DIRNAME),
            "p",
            "anything",
            None,
        )
        .await
        .expect_err("a non-repository must be refused, never dispatched into");
        assert!(err.contains("not a git work tree"), "{err}");
    }

    // -- prune ----------------------------------------------------------------

    #[tokio::test]
    async fn prune_retires_merged_worktrees_and_keeps_live_work() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);

        let merged = prepare_authoring_worktree(repo.path(), &wt_root, "p", "landed", None)
            .await
            .unwrap();
        std::fs::write(merged.path.join("a.txt"), "a").unwrap();
        git_in(&merged.path, &["add", "a.txt"]).unwrap();
        git_in(&merged.path, &["commit", "-m", "fix: landed"]).unwrap();
        repo.git(&["merge", "--no-ff", "-m", "Merge landed", &merged.branch])
            .unwrap();

        // A worker mid-task: its branch has no commits yet (so its tip IS an
        // ancestor of main, exactly like a merged one) and it has uncommitted
        // files. Nothing about it may be swept.
        let live = prepare_authoring_worktree(repo.path(), &wt_root, "p", "in flight", None)
            .await
            .unwrap();
        std::fs::write(live.path.join("b.txt"), "b").unwrap();

        // Inside the grace window nothing is retired at all — a just-spawned
        // worker's worktree is clean on a commit-less branch and is otherwise
        // indistinguishable from a merged proposal.
        let fresh =
            prune_authoring_worktrees(repo.path(), &wt_root, "main", PrunePolicy::default()).await;
        assert!(fresh.removed.is_empty(), "{fresh:?}");
        assert_eq!(fresh.kept, 2);

        // Grace zero: the rest of this test is about the branch rules.
        let policy = PrunePolicy {
            grace: Duration::ZERO,
            ..PrunePolicy::default()
        };
        let report = prune_authoring_worktrees(repo.path(), &wt_root, "main", policy).await;

        assert_eq!(report.removed.len(), 1, "{report:?}");
        assert!(report.removed[0].starts_with(&merged.branch));
        assert!(!merged.path.exists());
        // Unreviewed, uncommitted work is never deleted for being unmerged.
        assert_eq!(report.kept, 1);
        assert!(live.path.exists());
        // The branch survives the working copy — the ledger keys on it.
        assert!(repo
            .git(&["rev-parse", "--verify", &merged.branch])
            .is_some());

        cleanup(&repo, &live);
    }

    #[tokio::test]
    async fn prune_never_touches_a_worktree_outside_its_root() {
        if !git_available() {
            return;
        }
        let Some(repo) = Repo::new() else { return };
        let data = tempfile::tempdir().unwrap();
        let wt_root = data.path().join(AUTHORING_WORKTREES_DIRNAME);
        let elsewhere = tempfile::tempdir().unwrap();

        // Somebody's own `autopilot/*` worktree, merged, but not ours to remove.
        let theirs = elsewhere.path().join("mine");
        repo.git(&[
            "worktree",
            "add",
            "-b",
            "autopilot/hand-made",
            &theirs.to_string_lossy(),
            "main",
        ])
        .unwrap();

        let report = prune_authoring_worktrees(
            repo.path(),
            &wt_root,
            "main",
            PrunePolicy {
                grace: Duration::ZERO,
                ..PrunePolicy::default()
            },
        )
        .await;
        assert!(report.removed.is_empty(), "{report:?}");
        assert_eq!(report.kept, 0, "it was never even a candidate");
        assert!(theirs.exists());

        repo.git(&["worktree", "remove", "--force", &theirs.to_string_lossy()]);
    }

    /// Unlink before removing, exactly as production does — a recursive delete
    /// that walked into the junction would take the source's `node_modules`.
    fn cleanup(repo: &Repo, wt: &AuthoringWorktree) {
        for name in BORROWED_DEP_DIRS {
            unlink_borrowed(&wt.path, name);
        }
        repo.git(&["worktree", "remove", "--force", &wt.path.to_string_lossy()]);
    }
}
