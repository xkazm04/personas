use std::path::Path;

use super::*;
use crate::db::models::LifecyclePreset;
use crate::db::DbPool;

/// A project rooted at `root` (a plain directory: no git, no hooks, no CI).
fn project(root: &Path) -> Result<DbPool, AppError> {
    let pool = crate::db::init_test_db()?;
    pool.get()?.execute(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p-1', 'Proj', ?1)",
        rusqlite::params![root.to_string_lossy()],
    )?;
    Ok(pool)
}

#[test]
fn a_bare_solo_repo_gets_a_prompt_naming_only_its_missing_bindings() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let pool = project(root.path())?;
    let snap = crate::lifecycle::snapshot(&pool, "p-1")?;
    let plan = plan_install(&snap).expect("a bare repo misses its repo bindings");

    assert_eq!(plan.title, "Lifecycle v0: install Recall, Gate, Commit");
    let p = &plan.prompt;
    assert!(p.starts_with("Goal: install the listed lifecycle bindings into this repository without removing or weakening anything that exists."));
    // The exact marker format the detector reads.
    assert!(p.contains("\n<!-- personas-lifecycle:begin v=0 preset=solo -->\n## Development practice (managed by Personas)\n"));
    assert!(p.contains("\n<!-- personas-lifecycle:end -->\n"));
    assert!(p.contains("- [step:recall] Recall: "));
    assert!(p.contains("- [step:gate] Gate: "));
    assert!(p.contains("- [step:commit] Commit: "));
    assert!(
        !p.contains("[step:frame]"),
        "an app-only step is not repo-bound"
    );
    assert!(
        !p.contains("[step:tests]"),
        "an advisory step is not repo-bound"
    );
    // Only the missing steps are listed as work.
    assert!(p.contains("- Recall (`recall`): CLAUDE.md block\n"));
    assert!(p.contains("- Gate (`gate`): pre-commit hook\n"));
    assert!(!p.contains("- Tests (`tests`)"));
    assert!(!p.contains("- Frame (`frame`)"));
    assert!(p.contains("- `personas-lifecycle-gate`: "));
    assert!(p.contains("- `personas-lifecycle-commit`: "));
    assert!(!p.contains("## CI"), "Solo has no CI binding");
    assert!(p.contains("## Verify\nRun the new hooks once."));
    Ok(())
}

#[test]
fn a_team_repo_is_asked_for_the_ci_jobs_it_lacks() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let pool = project(root.path())?;
    crate::lifecycle::set_preset(&pool, "p-1", LifecyclePreset::Team)?;
    let snap = crate::lifecycle::snapshot(&pool, "p-1")?;
    let plan = plan_install(&snap).expect("missing bindings");
    assert!(plan.title.starts_with("Lifecycle v1: install "));
    let p = &plan.prompt;
    assert!(p.contains("<!-- personas-lifecycle:begin v=1 preset=team -->"));
    assert!(p.contains("## CI\nCreate or update `.github/workflows/personas-lifecycle.yml`"));
    for id in ["gate", "tests", "docs"] {
        assert!(
            p.contains(&format!("- `personas-lifecycle-{id}`: ")),
            "{id}"
        );
    }
    assert!(p.contains("- Gate (`gate`): pre-commit hook, CI job\n"));
    assert!(
        p.contains("- [step:docs] Docs: "),
        "CI-bound steps are in the block"
    );
    Ok(())
}

#[test]
fn nothing_missing_plans_nothing_and_detected_mechanisms_are_left_alone() -> Result<(), AppError> {
    let root = tempfile::tempdir().unwrap();
    let pool = project(root.path())?;
    // An existing pre-commit hook covers Gate and Commit as `detected`.
    std::fs::write(
        root.path().join("lefthook.yml"),
        "pre-commit:\n  commands:\n    lint:\n      run: npm run lint\n",
    )
    .unwrap();
    let plan = plan_install(&crate::lifecycle::snapshot(&pool, "p-1")?).expect("recall missing");
    assert_eq!(plan.title, "Lifecycle v0: install Recall");
    assert!(
        !plan.prompt.contains("## Hooks"),
        "a detected hook is not reinstalled"
    );

    // Write exactly what the prompt asks for: nothing is missing any more.
    let snap = crate::lifecycle::snapshot(&pool, "p-1")?;
    std::fs::write(
        root.path().join("CLAUDE.md"),
        format!("# Repo\n\n{}\n", managed_block(&snap)),
    )
    .unwrap();
    assert_eq!(
        plan_install(&crate::lifecycle::snapshot(&pool, "p-1")?),
        None
    );
    Ok(())
}
