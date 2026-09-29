use super::*;
use crate::db::models::{LifecyclePreset, LifecycleStep};
use crate::lifecycle::presets::preset_doc;
use LifecycleBindingKind as K;
use LifecycleBindingState as S;

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("mkdir");
    }
    std::fs::write(path, text).expect("write");
}

/// The (state, detail) of `step`'s binding of `kind`.
fn state_of(
    root: &Path,
    doc: &LifecycleDoc,
    pending: bool,
    step: &str,
    kind: LifecycleBindingKind,
) -> (LifecycleBindingState, Option<String>) {
    let views = detect_bindings(root, doc, 1, pending);
    let i = doc.steps.iter().position(|s| s.id == step).expect(step);
    let v = views[i].iter().find(|v| v.kind == kind).expect("binding");
    (v.state, v.detail.clone())
}

fn solo() -> LifecycleDoc {
    preset_doc(LifecyclePreset::Solo)
}

fn team() -> LifecycleDoc {
    preset_doc(LifecyclePreset::Team)
}

/// A doc whose `commit` step is bound to claude_md, to test the non-recall path.
fn with_claude_md_commit() -> LifecycleDoc {
    let mut doc = solo();
    let commit: &mut LifecycleStep = doc.steps.iter_mut().find(|s| s.id == "commit").expect("c");
    commit.bindings = vec![K::ClaudeMd];
    doc
}

#[test]
fn shape_follows_the_doc() {
    let dir = tempfile::tempdir().expect("tmp");
    let doc = team();
    let views = detect_bindings(dir.path(), &doc, 0, false);
    assert_eq!(views.len(), doc.steps.len());
    for (step, v) in doc.steps.iter().zip(&views) {
        assert_eq!(v.len(), step.bindings.len(), "{}", step.id);
    }
}

#[test]
fn app_is_live_and_advisory_is_advisory() {
    let dir = tempfile::tempdir().expect("tmp");
    assert_eq!(
        state_of(dir.path(), &solo(), false, "frame", K::App).0,
        S::Live
    );
    assert_eq!(
        state_of(dir.path(), &solo(), false, "tests", K::Advisory).0,
        S::Advisory
    );
}

#[test]
fn claude_md_block_with_marker_is_live() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        "CLAUDE.md",
        "# Repo\n<!-- personas-lifecycle:begin v=1 preset=solo -->\n- [step:recall] read\n<!-- personas-lifecycle:end -->\n",
    );
    let (state, detail) = state_of(dir.path(), &solo(), false, "recall", K::ClaudeMd);
    assert_eq!(state, S::Live);
    assert_eq!(detail.as_deref(), Some("CLAUDE.md"));
}

#[test]
fn claude_md_block_in_dot_claude_counts() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        ".claude/CLAUDE.md",
        "<!-- personas-lifecycle:begin v=1 preset=solo -->\n[step:commit]\n<!-- personas-lifecycle:end -->",
    );
    let doc = with_claude_md_commit();
    assert_eq!(
        state_of(dir.path(), &doc, false, "commit", K::ClaudeMd).0,
        S::Live
    );
}

#[test]
fn marker_outside_the_block_does_not_count() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        "CLAUDE.md",
        "[step:commit]\n<!-- personas-lifecycle:begin v=1 preset=solo -->\n<!-- personas-lifecycle:end -->",
    );
    let doc = with_claude_md_commit();
    assert_eq!(
        state_of(dir.path(), &doc, false, "commit", K::ClaudeMd).0,
        S::Missing
    );
    assert_eq!(
        state_of(dir.path(), &doc, true, "commit", K::ClaudeMd).0,
        S::Pending
    );
}

#[test]
fn recall_without_block_is_detected_from_any_instruction_file() {
    let dir = tempfile::tempdir().expect("tmp");
    write(dir.path(), "AGENTS.md", "# agents");
    let (state, detail) = state_of(dir.path(), &solo(), false, "recall", K::ClaudeMd);
    assert_eq!(state, S::Detected);
    assert_eq!(detail.as_deref(), Some("AGENTS.md"));
}

#[test]
fn claude_md_absent_is_missing_or_pending() {
    let dir = tempfile::tempdir().expect("tmp");
    assert_eq!(
        state_of(dir.path(), &solo(), false, "recall", K::ClaudeMd).0,
        S::Missing
    );
    assert_eq!(
        state_of(dir.path(), &solo(), true, "recall", K::ClaudeMd).0,
        S::Pending
    );
}

#[test]
fn lefthook_with_personas_command_is_live() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        "lefthook.yml",
        "pre-commit:\n  commands:\n    personas-lifecycle-gate:\n      run: npm test\n",
    );
    let (state, detail) = state_of(dir.path(), &solo(), false, "gate", K::Hook);
    assert_eq!(state, S::Live);
    assert_eq!(detail.as_deref(), Some("lefthook.yml"));
    // commit has no personas command but the pre-commit section counts.
    let (state, detail) = state_of(dir.path(), &solo(), false, "commit", K::Hook);
    assert_eq!(state, S::Detected);
    assert_eq!(detail.as_deref(), Some("lefthook.yml pre-commit"));
}

#[test]
fn lefthook_without_personas_commands_is_detected_for_gate() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        "lefthook.yaml",
        "pre-commit:\n  commands:\n    lint:\n      run: eslint\n",
    );
    assert_eq!(
        state_of(dir.path(), &solo(), false, "gate", K::Hook).0,
        S::Detected
    );
}

#[test]
fn husky_and_git_pre_commit_are_detected() {
    let dir = tempfile::tempdir().expect("tmp");
    write(dir.path(), ".husky/pre-commit", "npm test");
    let (state, detail) = state_of(dir.path(), &solo(), false, "gate", K::Hook);
    assert_eq!(
        (state, detail.as_deref()),
        (S::Detected, Some(".husky/pre-commit"))
    );

    let dir = tempfile::tempdir().expect("tmp");
    write(dir.path(), ".git/hooks/pre-commit.sample", "#!/bin/sh");
    assert_eq!(
        state_of(dir.path(), &solo(), false, "gate", K::Hook).0,
        S::Missing,
        "a .sample hook does not count"
    );
    write(dir.path(), ".git/hooks/pre-commit", "#!/bin/sh");
    assert_eq!(
        state_of(dir.path(), &solo(), false, "gate", K::Hook).0,
        S::Detected
    );
}

#[test]
fn a_hook_step_other_than_gate_or_commit_is_never_detected() {
    let dir = tempfile::tempdir().expect("tmp");
    write(dir.path(), ".husky/pre-commit", "npm test");
    let mut doc = solo();
    doc.steps
        .iter_mut()
        .find(|s| s.id == "tests")
        .expect("t")
        .bindings = vec![K::Hook];
    assert_eq!(
        state_of(dir.path(), &doc, true, "tests", K::Hook).0,
        S::Pending
    );
}

#[test]
fn ci_workflow_mentioning_the_step_is_live() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        CI_WORKFLOW,
        "on: pull_request\njobs:\n  personas-lifecycle-gate:\n    runs-on: ubuntu-latest\n",
    );
    let (state, detail) = state_of(dir.path(), &team(), false, "gate", K::Ci);
    assert_eq!((state, detail.as_deref()), (S::Live, Some(CI_WORKFLOW)));
    // `tests` is not named, but the workflow triggers on pull_request.
    assert_eq!(
        state_of(dir.path(), &team(), false, "tests", K::Ci).0,
        S::Detected
    );
}

#[test]
fn any_pull_request_workflow_is_detected() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        ".github/workflows/ci.yml",
        "on:\n  pull_request:\n",
    );
    let (state, detail) = state_of(dir.path(), &team(), false, "docs", K::Ci);
    assert_eq!(
        (state, detail.as_deref()),
        (S::Detected, Some(".github/workflows/ci.yml"))
    );
}

#[test]
fn ci_absent_is_missing_or_pending() {
    let dir = tempfile::tempdir().expect("tmp");
    write(
        dir.path(),
        ".github/workflows/nightly.yml",
        "on: schedule\n",
    );
    assert_eq!(
        state_of(dir.path(), &team(), false, "tests", K::Ci).0,
        S::Missing
    );
    assert_eq!(
        state_of(dir.path(), &team(), true, "tests", K::Ci).0,
        S::Pending
    );
}

#[test]
fn mentions_word_respects_boundaries() {
    assert!(mentions_word("personas-lifecycle-docs:", "docs"));
    assert!(!mentions_word("mydocs", "docs"));
    assert!(!mentions_word("gateway", "gate"));
}
