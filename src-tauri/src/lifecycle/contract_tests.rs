use super::*;
use crate::db::models::LifecyclePreset;
use crate::lifecycle::presets::preset_doc;

const BRANCH: &str = "autopilot/fix-the-retry-test-in-the-scheduler";

fn run_desk(gh: bool) -> ContractContext {
    ContractContext::RunDesk {
        branch: BRANCH.to_string(),
        gh_authenticated: gh,
    }
}

fn contexts() -> Vec<ContractContext> {
    vec![
        run_desk(true),
        run_desk(false),
        ContractContext::Unattended,
        ContractContext::FleetRow,
    ]
}

#[test]
fn the_solo_run_desk_block_names_the_version_and_one_land_sentence() {
    let block = render_contract(&preset_doc(LifecyclePreset::Solo), 3, run_desk(true));
    assert!(block.starts_with("## Development practice (lifecycle v3, solo)\nBefore you start:\n"));
    assert!(block.contains("\nAfter the work:\n"));
    assert!(block.contains("- Frame: Restate the task goal"));
    assert!(
        block.contains("- Tests (expected): Add or update tests"),
        "{block}"
    );
    assert!(block.contains("- Docs (expected): "));
    assert!(block.contains(&format!(
        "- Land: Commit your work on `{BRANCH}` and stop; the app lands it into the base branch when you finish.\n"
    )));
    assert_eq!(
        block.matches("lands it into the base branch").count(),
        1,
        "ONE sentence"
    );
    assert!(block.ends_with('\n'));
}

#[test]
fn the_team_run_desk_block_lands_through_the_ship_rule() {
    let doc = preset_doc(LifecyclePreset::Team);
    for gh in [true, false] {
        let block = render_contract(&doc, 1, run_desk(gh));
        assert!(block.contains("(lifecycle v1, team)"));
        assert!(block.contains("- Link: "));
        let land = block
            .lines()
            .find(|l| l.starts_with("- Land: "))
            .expect("a land line");
        assert!(land.contains("gh pr create"), "{land}");
        assert!(land.contains(BRANCH));
        assert!(land.contains("may NOT merge"));
        assert!(
            !land.starts_with("- Land: 2."),
            "the rule number is stripped: {land}"
        );
        assert_eq!(land.contains("NOT authenticated on this machine"), !gh);
        assert!(
            !block.contains("it merges only after one review"),
            "replaced, not duplicated"
        );
    }
}

#[test]
fn unattended_omits_isolate_and_land_and_defers_to_the_guardrails() {
    for preset in [LifecyclePreset::Solo, LifecyclePreset::Team] {
        let block = render_contract(&preset_doc(preset), 2, ContractContext::Unattended);
        assert!(!block.contains("- Isolate"), "{block}");
        assert!(!block.contains("- Land"), "{block}");
        assert!(block.contains("- Where to work and how to land: follow the guardrails above."));
        assert!(block.contains("- Gate: "));
    }
}

#[test]
fn a_fleet_row_keeps_isolate_and_drops_land() {
    let block = render_contract(
        &preset_doc(LifecyclePreset::Solo),
        0,
        ContractContext::FleetRow,
    );
    assert!(block.contains("(lifecycle v0, solo)"));
    assert!(block.contains("- Isolate: "));
    assert!(!block.contains("- Land"));
    assert!(!block.contains("guardrails above"));
}

/// The block rides on every prompt: its own text stays within 1,200 chars for
/// both presets in every context. The Team Run Desk land line is the engine's
/// `worktree_ship_rule` verbatim (the brief's reuse requirement), which alone
/// is 430-730 chars, so it is measured on top of the ceiling, not inside it.
#[test]
fn the_block_stays_under_the_prompt_ceiling() {
    for preset in [LifecyclePreset::Solo, LifecyclePreset::Team] {
        for ctx in contexts() {
            let block = render_contract(&preset_doc(preset), 12, ctx.clone());
            let reused = match (&ctx, preset) {
                (
                    ContractContext::RunDesk {
                        gh_authenticated, ..
                    },
                    LifecyclePreset::Team,
                ) => one_line(&personas_engine::unattended::worktree_ship_rule(
                    BRANCH,
                    *gh_authenticated,
                ))
                .chars()
                .count(),
                _ => 0,
            };
            let own = block.chars().count() - reused;
            assert!(own <= 1_200, "{preset:?} {ctx:?}: {own} chars\n{block}");
        }
    }
}

#[test]
fn custom_steps_use_their_label_and_empty_docs_render_nothing() {
    let mut doc = preset_doc(LifecyclePreset::Solo);
    doc.steps
        .retain(|s| s.phase == crate::db::models::LifecyclePhase::After);
    doc.steps.push(crate::db::models::LifecycleStep {
        id: "x-perf".into(),
        phase: crate::db::models::LifecyclePhase::After,
        label: Some("Perf budget".into()),
        rule: "Keep the bundle under budget.".into(),
        bindings: vec![crate::db::models::LifecycleBindingKind::Advisory],
        params: Default::default(),
    });
    let block = render_contract(&doc, 4, ContractContext::FleetRow);
    assert!(
        !block.contains("Before you start:"),
        "an empty phase has no heading"
    );
    assert!(block.contains("- Perf budget (expected): Keep the bundle under budget."));

    doc.steps.clear();
    assert_eq!(render_contract(&doc, 4, ContractContext::FleetRow), "");
    assert_eq!(append_block("task", ""), "task");
    assert_eq!(append_block("task\n", "## block\n"), "task\n\n## block");
}

#[test]
fn a_project_without_a_stored_version_gets_the_solo_default_contract(
) -> Result<(), crate::error::AppError> {
    let pool = crate::db::init_test_db()?;
    let root = tempfile::tempdir().unwrap();
    let nested = root.path().join("sub");
    std::fs::create_dir_all(&nested).unwrap();
    pool.get()?.execute(
        "INSERT INTO dev_projects (id, name, root_path) VALUES ('p-1', 'Proj', ?1)",
        rusqlite::params![root.path().to_string_lossy()],
    )?;
    let block = contract_for_project(&pool, "p-1", ContractContext::Unattended);
    assert!(
        block.starts_with("## Development practice (lifecycle v0, solo)"),
        "{block}"
    );
    assert_eq!(
        contract_for_project(&pool, "missing", ContractContext::FleetRow),
        ""
    );
    assert_eq!(run_desk_contract(&pool, "missing", "autopilot/x"), "");
    assert_eq!(
        project_id_for_cwd(&pool, &nested.to_string_lossy()).as_deref(),
        Some("p-1")
    );
    let elsewhere = tempfile::tempdir().unwrap();
    assert_eq!(
        project_id_for_cwd(&pool, &elsewhere.path().to_string_lossy()),
        None
    );
    let rd = run_desk_contract(&pool, "p-1", "autopilot/x");
    assert!(rd.contains("Commit your work on `autopilot/x` and stop"));
    Ok(())
}
