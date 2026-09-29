use std::path::Path;

use personas_engine::git_checkpoint::run_git_blocking as git;

use super::*;
use crate::db::models::LifecycleOutcome;
use crate::lifecycle::presets::preset_doc;

/// A repository with one commit on `main`; `None` when git is unavailable.
fn repo_at(dir: &Path) -> Option<()> {
    git(dir, &["init", "--initial-branch=main"]).ok()?;
    git(dir, &["config", "user.email", "t@example.com"]).ok()?;
    git(dir, &["config", "user.name", "T"]).ok()?;
    std::fs::write(dir.join("README.md"), "hello").ok()?;
    git(dir, &["add", "-A"]).ok()?;
    git(dir, &["commit", "-m", "chore: initial"]).ok()?;
    Some(())
}

/// Write `files` in `dir` and commit them with `msg`.
fn commit(dir: &Path, files: &[&str], msg: &str) {
    for f in files {
        let p = dir.join(f);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, format!("{f} {msg}")).unwrap();
    }
    git(dir, &["add", "-A"]).unwrap();
    git(dir, &["commit", "-m", msg]).unwrap();
}

fn outcome_of<'a>(outcomes: &'a [LifecycleStepOutcome], id: &str) -> &'a LifecycleStepOutcome {
    outcomes
        .iter()
        .find(|o| o.step_id == id)
        .unwrap_or_else(|| panic!("no outcome for {id}: {outcomes:?}"))
}

#[test]
fn the_classifiers_read_paths_and_subjects_like_the_contest_staging() {
    assert!(touches_tests("src/__tests__/a.ts"));
    assert!(touches_tests("src/lib/x.test.tsx"));
    assert!(touches_tests("crate/tests/it.rs"));
    assert!(touches_tests("engine/src/foo_test.rs"));
    assert!(touches_tests("src\\spec\\a.ts"));
    assert!(!touches_tests("src/latest/a.ts"));
    assert!(touches_docs("docs/guide.md"));
    assert!(touches_docs("CHANGELOG.md"));
    assert!(touches_docs("pkg/README"));
    assert!(!touches_docs("src/main.rs"));
    assert!(is_conventional("feat(lifecycle): a thing"));
    assert!(is_conventional("fix!: breaking"));
    assert!(!is_conventional("Feat: capitalised"));
    assert!(!is_conventional("wip stuff"));
    assert_eq!(pr_ref("feat: squash (#12)").as_deref(), Some("12"));
    assert_eq!(
        pr_ref("Merge pull request #7 from o/b").as_deref(),
        Some("7")
    );
    assert_eq!(pr_ref("fix #3 without parens"), None);
}

#[test]
fn a_task_branch_touching_a_test_and_a_doc_reads_as_done_for_both() {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return;
    };
    let wt_parent = tempfile::tempdir().unwrap();
    let wt = wt_parent.path().join("wt");
    git(
        root.path(),
        &[
            "worktree",
            "add",
            "-b",
            "autopilot/x",
            &wt.to_string_lossy(),
        ],
    )
    .unwrap();
    commit(
        &wt,
        &["src/__tests__/a.test.ts", "docs/guide.md"],
        "feat: add a",
    );

    let doc = preset_doc(LifecyclePreset::Solo);
    let o = task_evidence(root.path(), &wt, "autopilot/x", "main", &doc);
    assert_eq!(o.len(), doc.steps.len(), "one outcome per step, in order");
    assert_eq!(o[0].step_id, doc.steps[0].id);
    assert_eq!(outcome_of(&o, "frame").outcome, LifecycleOutcome::Unknown);
    assert_eq!(outcome_of(&o, "isolate").outcome, LifecycleOutcome::Done);
    assert_eq!(
        outcome_of(&o, "isolate").detail.as_deref(),
        Some("autopilot/x")
    );
    assert_eq!(outcome_of(&o, "sync").outcome, LifecycleOutcome::Done);
    assert_eq!(outcome_of(&o, "tests").outcome, LifecycleOutcome::Done);
    assert_eq!(outcome_of(&o, "docs").outcome, LifecycleOutcome::Done);
    assert_eq!(outcome_of(&o, "commit").outcome, LifecycleOutcome::Done);
    // No hook in a fresh repo: the gate is not observable, never `done`.
    assert_eq!(outcome_of(&o, "gate").outcome, LifecycleOutcome::Unknown);
    assert_eq!(outcome_of(&o, "land").outcome, LifecycleOutcome::Unknown);
    assert_eq!(outcome_of(&o, "record").outcome, LifecycleOutcome::Unknown);

    // A pre-commit hook in the repo turns a committed gate into `done`.
    std::fs::write(root.path().join(".git/hooks/pre-commit"), "#!/bin/sh\n").unwrap();
    let o = task_evidence(root.path(), &wt, "autopilot/x", "main", &doc);
    assert_eq!(outcome_of(&o, "gate").outcome, LifecycleOutcome::Done);
    assert!(outcome_of(&o, "gate")
        .detail
        .as_deref()
        .unwrap()
        .contains("pre-commit"));
    let _ = git(
        root.path(),
        &["worktree", "remove", "--force", &wt.to_string_lossy()],
    );
}

#[test]
fn team_commit_requires_every_message_conventional_and_link_a_reference() {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return;
    };
    let wt_parent = tempfile::tempdir().unwrap();
    let wt = wt_parent.path().join("wt");
    git(
        root.path(),
        &["worktree", "add", "-b", "task/y", &wt.to_string_lossy()],
    )
    .unwrap();
    commit(&wt, &["src/a.rs"], "feat: a for t-42");
    commit(&wt, &["src/b.rs"], "wip stuff t-42");

    let doc = preset_doc(LifecyclePreset::Team);
    let facts = TaskFacts {
        task_id: Some("t-42"),
        ..Default::default()
    };
    let ev = task_evidence_with(root.path(), &wt, Some("task/y"), "main", &doc, &facts);
    assert_eq!(ev.commits_ahead, Some(2));
    let c = outcome_of(&ev.outcomes, "commit");
    assert_eq!(c.outcome, LifecycleOutcome::Skipped);
    assert_eq!(
        c.detail.as_deref(),
        Some("1 of 2 commit messages not conventional")
    );
    assert_eq!(
        outcome_of(&ev.outcomes, "link").outcome,
        LifecycleOutcome::Done
    );
    assert_eq!(
        outcome_of(&ev.outcomes, "tests").outcome,
        LifecycleOutcome::Skipped
    );

    // Solo does not ask for conventional messages.
    let solo = task_evidence(
        root.path(),
        &wt,
        "task/y",
        "main",
        &preset_doc(LifecyclePreset::Solo),
    );
    assert_eq!(outcome_of(&solo, "commit").outcome, LifecycleOutcome::Done);
    let _ = git(
        root.path(),
        &["worktree", "remove", "--force", &wt.to_string_lossy()],
    );
}

#[test]
fn an_unisolated_task_says_why_and_reads_nothing_it_cannot_attribute() {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return;
    };
    let facts = TaskFacts {
        fallback_reason: Some("not a git work tree"),
        output_nonempty: Some(true),
        ..Default::default()
    };
    let doc = preset_doc(LifecyclePreset::Solo);
    let ev = task_evidence_with(root.path(), root.path(), None, "main", &doc, &facts);
    let iso = outcome_of(&ev.outcomes, "isolate");
    assert_eq!(iso.outcome, LifecycleOutcome::Skipped);
    assert_eq!(iso.detail.as_deref(), Some("not a git work tree"));
    assert_eq!(
        outcome_of(&ev.outcomes, "tests").outcome,
        LifecycleOutcome::Unknown
    );
    assert_eq!(
        outcome_of(&ev.outcomes, "commit").outcome,
        LifecycleOutcome::Unknown
    );
    assert_eq!(
        outcome_of(&ev.outcomes, "record").outcome,
        LifecycleOutcome::Done
    );
    assert_eq!(ev.commits_ahead, None);
}

#[test]
fn base_commits_become_evidence_newest_first_with_pr_refs_for_team() {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return;
    };
    commit(root.path(), &["src/a.rs", "src/a_test.rs"], "feat: a (#12)");
    commit(root.path(), &["docs/b.md"], "update docs");

    let team = preset_doc(LifecyclePreset::Team);
    let items = commit_evidence(root.path(), "main", &team, 20);
    assert_eq!(items.len(), 3, "every non-merge commit up to the limit");
    assert_eq!(items[0].title, "update docs", "newest first");
    assert_eq!(items[0].source_kind, LifecycleSourceKind::Commit);
    assert_eq!(
        outcome_of(&items[0].outcomes, "docs").outcome,
        LifecycleOutcome::Done
    );
    assert_eq!(
        outcome_of(&items[0].outcomes, "commit").outcome,
        LifecycleOutcome::Skipped
    );
    assert_eq!(
        outcome_of(&items[0].outcomes, "land").outcome,
        LifecycleOutcome::Skipped
    );
    assert_eq!(
        outcome_of(&items[0].outcomes, "gate").outcome,
        LifecycleOutcome::Unknown
    );
    let pr = &items[1];
    assert_eq!(pr.source_kind, LifecycleSourceKind::Pr);
    assert_eq!(pr.source_ref, "12");
    assert_eq!(
        outcome_of(&pr.outcomes, "tests").outcome,
        LifecycleOutcome::Done
    );
    assert_eq!(
        outcome_of(&pr.outcomes, "land").outcome,
        LifecycleOutcome::Done
    );
    assert_eq!(
        outcome_of(&pr.outcomes, "frame").outcome,
        LifecycleOutcome::Unknown
    );
    assert!(
        pr.occurred_at.ends_with("+00:00"),
        "UTC: {}",
        pr.occurred_at
    );

    let solo = commit_evidence(root.path(), "main", &preset_doc(LifecyclePreset::Solo), 2);
    assert_eq!(solo.len(), 2, "the limit holds");
    assert_eq!(
        outcome_of(&solo[0].outcomes, "land").outcome,
        LifecycleOutcome::Done
    );
    assert_eq!(
        outcome_of(&solo[0].outcomes, "commit").outcome,
        LifecycleOutcome::Done
    );

    // Cached per tip: a second read is the same data; a new commit is seen.
    assert_eq!(commit_evidence(root.path(), "main", &team, 20), items);
    commit(root.path(), &["c.rs"], "fix: c");
    assert_eq!(commit_evidence(root.path(), "main", &team, 20).len(), 4);
    assert!(commit_evidence(root.path(), "no-such-branch", &team, 20).is_empty());
}

#[test]
fn the_base_resolves_to_a_branch_that_exists() {
    let root = tempfile::tempdir().unwrap();
    let Some(()) = repo_at(root.path()) else {
        return;
    };
    assert_eq!(
        resolve_base(root.path(), Some("develop")).as_deref(),
        Some("main")
    );
    git(root.path(), &["branch", "develop"]).unwrap();
    assert_eq!(
        resolve_base(root.path(), Some("develop")).as_deref(),
        Some("develop")
    );
    assert_eq!(resolve_base(root.path(), None).as_deref(), Some("main"));
    let plain = tempfile::tempdir().unwrap();
    assert_eq!(resolve_base(plain.path(), None), None);
}
