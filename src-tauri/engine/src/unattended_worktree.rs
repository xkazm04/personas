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
//! Under the **app data directory** (`<app_data>/worktrees/<project_id>/<slug>`,
//! honoring `PERSONAS_DATA_DIR`), never `<root_path>/.personas-worktrees/`.
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
/// `git branch`, short enough that `<root>/<project>/<slug>` plus a deep repo
/// path stays inside Windows' path limits.
pub const MAX_SLUG_CHARS: usize = 48;

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

/// A project id as a directory name. Ids are uuids in practice; this is a
/// guard, not a transformation.
fn project_dir_name(project_id: &str) -> String {
    let s: String = project_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "unknown-project".to_string()
    } else {
        s
    }
}

/// `<worktrees_root>/<project_id>` — every authoring worktree for one project.
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
    /// The branch the new one forked from (the project's resolved main).
    pub base_branch: String,
    /// What was borrowed from the source checkout rather than rebuilt.
    pub borrowed: Vec<String>,
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

    let base = resolve_main_branch(root_path, recorded_main_branch)
        .await
        .ok_or_else(|| {
            "no main branch resolves in the checkout; refusing to fork an authoring branch from \
             an unknown base"
                .to_string()
        })?;

    let dir = project_worktrees_dir(worktrees_root, project_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let stem = branch_slug(title);
    let (slug, path) = free_slot(root_path, &dir, &stem).await?;
    let branch = proposal_branch(&slug);
    let path_str = path.to_string_lossy().to_string();

    git(
        root_path,
        &["worktree", "add", "-b", &branch, &path_str, &base],
    )
    .await
    .map_err(|e| format!("could not create the authoring worktree: {e}"))?;

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
    })
}

/// The first `<slug>` whose branch does not exist AND whose directory does
/// not, so two dispatches of the same title never collide.
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
        let path = project_dir.join(&slug);
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
fn path_is_under(candidate: &str, root: &Path) -> bool {
    fn norm(p: &Path) -> String {
        let resolved = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let s = resolved.to_string_lossy().replace('\\', "/");
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
