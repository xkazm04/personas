//! Binding detection: read the repo (the far-side oracle) and say, per step and
//! per binding, whether the binding is `live`, merely `detected` (an existing
//! mechanism covers it), `pending` (the version's install task is not terminal)
//! or `missing`. Never takes a session's word for it.
//!
//! Pure file reads, each capped at [`MAX_READ_BYTES`]. The repo facts are read
//! once per call, then every step is judged against them.
//!
//! Markers the install task must write (WP2 contract):
//! - CLAUDE.md managed block: `<!-- personas-lifecycle:begin v=<N> preset=<p> -->`
//!   ... one line per repo-bound step containing `[step:<id>]` ...
//!   `<!-- personas-lifecycle:end -->`, in root `CLAUDE.md` or `.claude/CLAUDE.md`.
//! - lefthook commands named `personas-lifecycle-<id>`.
//! - `.github/workflows/personas-lifecycle.yml` naming each step id as a word
//!   (jobs named `personas-lifecycle-<id>` satisfy that).

use std::io::Read;
use std::path::{Path, PathBuf};

use crate::db::models::{
    LifecycleBindingKind, LifecycleBindingState, LifecycleBindingView, LifecycleDoc,
};

/// Read at most this much of any file.
pub const MAX_READ_BYTES: u64 = 256 * 1024;
/// Inspect at most this many workflow files.
const MAX_WORKFLOWS: usize = 64;

pub const BLOCK_BEGIN: &str = "<!-- personas-lifecycle:begin v=";
pub const BLOCK_END: &str = "<!-- personas-lifecycle:end -->";
pub const CI_WORKFLOW: &str = ".github/workflows/personas-lifecycle.yml";

fn read_capped(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(MAX_READ_BYTES).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// The managed block's inner text (between the markers), if present.
fn managed_block(text: &str) -> Option<&str> {
    let start = text.find(BLOCK_BEGIN)?;
    let rest = &text[start..];
    let end = rest.find(BLOCK_END)?;
    Some(&rest[..end])
}

/// `id` appears as a whole word (bounded by non-alphanumerics).
fn mentions_word(text: &str, id: &str) -> bool {
    text.match_indices(id).any(|(i, _)| {
        let before = text[..i].chars().next_back();
        let after = text[i + id.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_alphanumeric())
            && !after.is_some_and(|c| c.is_ascii_alphanumeric())
    })
}

/// The hooks directory git uses for `root` (a worktree's `.git` is a file
/// pointing at its gitdir; hooks live in the common dir).
fn git_hooks_dir(root: &Path) -> Option<PathBuf> {
    let dot_git = root.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git.join("hooks"));
    }
    let pointer = read_capped(&dot_git)?;
    let gitdir = pointer.trim().strip_prefix("gitdir:")?.trim();
    let gitdir = root.join(gitdir);
    let common = read_capped(&gitdir.join("commondir"))
        .map(|c| gitdir.join(c.trim()))
        .unwrap_or(gitdir);
    Some(common.join("hooks"))
}

/// Everything the detector needs, read once.
#[derive(Default)]
struct RepoFacts {
    /// (file label, managed block inner text) of the first CLAUDE.md holding one.
    block: Option<(String, String)>,
    /// First instruction file that exists at all (CLAUDE.md / AGENTS.md).
    instruction_file: Option<String>,
    /// (file label, text) of lefthook.yml / lefthook.yaml.
    lefthook: Option<(String, String)>,
    /// A pre-commit hook that is not ours: lefthook `pre-commit:`, husky, or git.
    pre_commit: Option<String>,
    /// The personas-lifecycle workflow's text.
    ci_workflow: Option<String>,
    /// First workflow triggered on `pull_request`.
    pr_workflow: Option<String>,
}

fn read_facts(root: &Path) -> RepoFacts {
    let mut facts = RepoFacts::default();
    for rel in ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"] {
        let Some(text) = read_capped(&root.join(rel)) else {
            continue;
        };
        if facts.instruction_file.is_none() {
            facts.instruction_file = Some(rel.to_string());
        }
        if facts.block.is_none() && rel != "AGENTS.md" {
            if let Some(block) = managed_block(&text) {
                facts.block = Some((rel.to_string(), block.to_string()));
            }
        }
    }
    for rel in ["lefthook.yml", "lefthook.yaml"] {
        if let Some(text) = read_capped(&root.join(rel)) {
            facts.lefthook = Some((rel.to_string(), text));
            break;
        }
    }
    let lefthook_pre_commit = facts.lefthook.as_ref().and_then(|(rel, text)| {
        text.lines()
            .any(|l| l.trim_end().starts_with("pre-commit:"))
            .then(|| format!("{rel} pre-commit"))
    });
    facts.pre_commit = lefthook_pre_commit
        .or_else(|| {
            root.join(".husky/pre-commit")
                .is_file()
                .then(|| ".husky/pre-commit".to_string())
        })
        .or_else(|| {
            git_hooks_dir(root)
                .filter(|dir| dir.join("pre-commit").is_file())
                .map(|_| ".git/hooks/pre-commit".to_string())
        });
    facts.ci_workflow = read_capped(&root.join(CI_WORKFLOW));
    if let Ok(entries) = std::fs::read_dir(root.join(".github/workflows")) {
        let mut names: Vec<String> = entries
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".yml") || n.ends_with(".yaml"))
            .collect();
        names.sort();
        facts.pr_workflow = names.into_iter().take(MAX_WORKFLOWS).find_map(|n| {
            let text = read_capped(&root.join(".github/workflows").join(&n))?;
            text.contains("pull_request")
                .then(|| format!(".github/workflows/{n}"))
        });
    }
    facts
}

fn view(
    kind: LifecycleBindingKind,
    state: LifecycleBindingState,
    detail: Option<String>,
) -> LifecycleBindingView {
    LifecycleBindingView {
        kind,
        state,
        detail,
    }
}

/// Per step (same order as `doc.steps`), per binding (same order as
/// `step.bindings`). `version` is the document's version, used to name a
/// managed block written for an older one in its detail.
pub fn detect_bindings(
    root: &Path,
    doc: &LifecycleDoc,
    version: i64,
    install_pending: bool,
) -> Vec<Vec<LifecycleBindingView>> {
    use LifecycleBindingKind as K;
    use LifecycleBindingState as S;
    let facts = read_facts(root);
    let absent = if install_pending {
        S::Pending
    } else {
        S::Missing
    };
    doc.steps
        .iter()
        .map(|step| {
            let id = step.id.as_str();
            step.bindings
                .iter()
                .map(|&kind| match kind {
                    K::App => view(kind, S::Live, None),
                    K::Advisory => view(kind, S::Advisory, None),
                    K::ClaudeMd => {
                        let marker = format!("[step:{id}]");
                        if let Some((file, block)) = facts
                            .block
                            .as_ref()
                            .filter(|(_, block)| block.contains(&marker))
                        {
                            let stale = !block.starts_with(&format!("{BLOCK_BEGIN}{version} "));
                            let detail = if stale && version > 0 {
                                format!("{file} (block from an earlier version)")
                            } else {
                                file.clone()
                            };
                            view(kind, S::Live, Some(detail))
                        } else if let Some(file) =
                            facts.instruction_file.as_ref().filter(|_| id == "recall")
                        {
                            view(kind, S::Detected, Some(file.clone()))
                        } else {
                            view(kind, absent, None)
                        }
                    }
                    K::Hook => {
                        let name = format!("personas-lifecycle-{id}");
                        if let Some((file, _)) =
                            facts.lefthook.as_ref().filter(|(_, t)| t.contains(&name))
                        {
                            view(kind, S::Live, Some(file.clone()))
                        } else if let Some(hook) = facts
                            .pre_commit
                            .as_ref()
                            .filter(|_| id == "gate" || id == "commit")
                        {
                            view(kind, S::Detected, Some(hook.clone()))
                        } else {
                            view(kind, absent, None)
                        }
                    }
                    K::Ci => {
                        if facts
                            .ci_workflow
                            .as_deref()
                            .is_some_and(|t| mentions_word(t, id))
                        {
                            view(kind, S::Live, Some(CI_WORKFLOW.to_string()))
                        } else if let Some(wf) = facts.pr_workflow.as_ref() {
                            view(kind, S::Detected, Some(wf.clone()))
                        } else {
                            view(kind, absent, None)
                        }
                    }
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
#[path = "detect_tests.rs"]
mod tests;
