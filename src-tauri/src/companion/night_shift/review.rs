//! Review station — post-session classification for night-shift work.
//!
//! On fleet-session exit the `session_review` job gathers the repo's git
//! facts (current branch, default branch, commits ahead, dirty tree, default
//! branch drift) and [`classify`] turns them into a verdict:
//!
//! - **ship-to-branch** — commits landed on a non-default branch, working
//!   tree clean, default branch untouched. The branch is ready for a HUMAN
//!   merge; the station never pushes or merges (branch-only invariant).
//! - **park-for-human** — something needs eyes: the session wrote to the
//!   default branch (invariant breach — flagged loudly), or left nothing.
//! - **retry-with-feedback** — recoverable mess (uncommitted work), worth a
//!   re-run with the failure note. v1 records the recommendation; re-dispatch
//!   is a future night's concern (multi-night campaigns are deferred).
//!
//! v1 honesty note: "the repo's known gates" are approximated by the git
//! facts + the worker's own instruction to run repo checks before finishing.
//! There is no per-project stored gate-command registry to invoke yet; when
//! one exists this module is where it plugs in.

use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

/// Git facts gathered for one session's repo. Pure data so [`classify`] is
/// unit-testable without a repo.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFacts {
    pub current_branch: String,
    pub default_branch: String,
    /// Commits on HEAD that are not on the default branch.
    pub commits_ahead: u32,
    /// Uncommitted changes present (`git status --porcelain` non-empty).
    pub dirty: bool,
    /// The default branch moved past its state at review time relative to
    /// HEAD's merge-base — i.e. the session (or something) committed to it.
    /// v1 proxy: HEAD *is* the default branch and has local commits.
    pub on_default_branch: bool,
    /// Short diffstat tail for the report.
    pub diffstat: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    ShipToBranch,
    ParkForHuman,
    RetryWithFeedback,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::ShipToBranch => "ship_to_branch",
            Verdict::ParkForHuman => "park_for_human",
            Verdict::RetryWithFeedback => "retry_with_feedback",
        }
    }
}

/// The pure classifier. Conservative by construction: park is the default
/// when nothing affirmatively qualifies for ship or retry.
pub fn classify(facts: &RepoFacts) -> (Verdict, String) {
    if facts.on_default_branch && facts.commits_ahead > 0 {
        return (
            Verdict::ParkForHuman,
            format!(
                "INVARIANT BREACH: {} commit(s) landed directly on default branch `{}` — \
                 parked for human inspection, nothing shipped.",
                facts.commits_ahead, facts.default_branch
            ),
        );
    }
    if facts.commits_ahead > 0 && !facts.dirty && !facts.on_default_branch {
        return (
            Verdict::ShipToBranch,
            format!(
                "{} commit(s) on `{}`, tree clean, default branch untouched — branch ready \
                 for your merge.",
                facts.commits_ahead, facts.current_branch
            ),
        );
    }
    if facts.dirty {
        return (
            Verdict::RetryWithFeedback,
            format!(
                "Session left uncommitted changes on `{}` — worth a retry with the note \
                 'commit your work on the night branch before ending'.",
                facts.current_branch
            ),
        );
    }
    (
        Verdict::ParkForHuman,
        "No commits and no changes — the session produced nothing shippable; parked.".to_string(),
    )
}

/// Gather [`RepoFacts`] by running read-only git commands in `cwd`.
pub async fn gather_facts(cwd: &str) -> Result<RepoFacts, AppError> {
    if cwd.trim().is_empty() || !Path::new(cwd).is_dir() {
        return Err(AppError::Internal(format!(
            "session review: cwd `{cwd}` is not an accessible directory"
        )));
    }
    let current_branch = git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    let default_branch = detect_default_branch(cwd).await;
    let dirty = !git(cwd, &["status", "--porcelain"])
        .await?
        .trim()
        .is_empty();
    let on_default_branch = current_branch == default_branch;
    let range = format!("{default_branch}..HEAD");
    let commits_ahead = if on_default_branch {
        // Ahead of the remote default if one exists; otherwise 0-vs-self.
        git(
            cwd,
            &[
                "rev-list",
                "--count",
                &format!("origin/{default_branch}..HEAD"),
            ],
        )
        .await
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0)
    } else {
        git(cwd, &["rev-list", "--count", &range])
            .await
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0)
    };
    let diffstat = if on_default_branch {
        String::new()
    } else {
        git(
            cwd,
            &["diff", "--shortstat", &format!("{default_branch}...HEAD")],
        )
        .await
        .unwrap_or_default()
        .trim()
        .to_string()
    };
    Ok(RepoFacts {
        current_branch,
        default_branch,
        commits_ahead,
        dirty,
        on_default_branch,
        diffstat,
    })
}

async fn detect_default_branch(cwd: &str) -> String {
    // origin/HEAD when set, else main if it exists, else master.
    if let Ok(sym) = git(
        cwd,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .await
    {
        if let Some(name) = sym.trim().strip_prefix("origin/") {
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    for candidate in ["main", "master"] {
        if git(cwd, &["rev-parse", "--verify", "--quiet", candidate])
            .await
            .is_ok()
        {
            return candidate.to_string();
        }
    }
    "main".to_string()
}

/// Run one read-only git command in `cwd`, returning trimmed stdout.
async fn git(cwd: &str, args: &[&str]) -> Result<String, AppError> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.args(args).current_dir(cwd);
    // No console window flash on Windows (tokio's Command exposes
    // `creation_flags` directly on that platform).
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd
        .output()
        .await
        .map_err(|e| AppError::Internal(format!("git {args:?} in `{cwd}`: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Internal(format!(
            "git {:?} in `{}` exited {}: {}",
            args,
            cwd,
            out.status
                .code()
                .map(|c| c.to_string())
                .unwrap_or("?".into()),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> RepoFacts {
        RepoFacts {
            current_branch: "night/2026-07-30-shift".into(),
            default_branch: "main".into(),
            commits_ahead: 3,
            dirty: false,
            on_default_branch: false,
            diffstat: "4 files changed".into(),
        }
    }

    #[test]
    fn clean_branch_commits_ship() {
        let (v, why) = classify(&facts());
        assert_eq!(v, Verdict::ShipToBranch);
        assert!(why.contains("ready"));
    }

    #[test]
    fn default_branch_commits_park_with_breach_flag() {
        let f = RepoFacts {
            current_branch: "main".into(),
            on_default_branch: true,
            ..facts()
        };
        let (v, why) = classify(&f);
        assert_eq!(v, Verdict::ParkForHuman);
        assert!(why.contains("INVARIANT BREACH"));
    }

    #[test]
    fn dirty_tree_retries_with_feedback() {
        let f = RepoFacts {
            dirty: true,
            ..facts()
        };
        let (v, _) = classify(&f);
        assert_eq!(v, Verdict::RetryWithFeedback);
    }

    #[test]
    fn dirty_tree_on_branch_with_commits_still_retries_not_ships() {
        // Commits exist but the tree is dirty — not shippable as-is.
        let f = RepoFacts {
            dirty: true,
            commits_ahead: 2,
            ..facts()
        };
        let (v, _) = classify(&f);
        assert_eq!(v, Verdict::RetryWithFeedback);
    }

    #[test]
    fn nothing_done_parks() {
        let f = RepoFacts {
            commits_ahead: 0,
            ..facts()
        };
        let (v, why) = classify(&f);
        assert_eq!(v, Verdict::ParkForHuman);
        assert!(why.contains("nothing shippable"));
    }
}
