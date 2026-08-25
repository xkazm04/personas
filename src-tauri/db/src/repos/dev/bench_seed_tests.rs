//! Tests for the headless bench seed writer.
//!
//! These pin the ONE thing the bench depends on: that a seeded item lands in
//! exactly the shape the overnight engine's triage pass reads — a `pending`
//! `dev_ideas` row on the project, plus an enabled `accept` rule whose
//! condition matches the column the row carries. Everything else in the night
//! (autopilot mode, mandate rung, budget governor, slot cap) is deliberately
//! out of scope here: seeding creates work, never permission.
//!
//! Included from `bench_seed.rs` via `#[path]` so `use super::*` reaches the
//! module's private items exactly as an inline `mod tests` would.
use super::*;
use crate::repos::dev::ideas::{get_idea_by_id, list_ideas};
use crate::repos::dev::projects::create_project;
use std::sync::atomic::{AtomicU64, Ordering};

fn test_pool() -> DbPool {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let uri = format!("file:bench_seed_testdb_{id}?mode=memory&cache=shared");
    let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
    let pool = r2d2::Pool::builder()
        .max_size(4)
        .build(manager)
        .expect("test pool build");
    {
        let conn = pool.get().expect("conn");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::migrations::run(&conn).expect("initial migrations");
        crate::migrations::run_incremental(&conn).expect("incremental migrations");
    }
    pool
}

fn project(pool: &DbPool) -> String {
    create_project(pool, "kp", "/tmp/kp", None, None, None, None, None)
        .unwrap()
        .id
}

fn item(title: &str) -> BenchSeedItem {
    BenchSeedItem {
        title: title.into(),
        description: Some(format!("body of {title}")),
        acceptance: None,
        trap: None,
    }
}

/// The pending-idea read `run_triage_rules_core` performs, byte for byte.
fn triage_reads(pool: &DbPool, project_id: &str) -> Vec<crate::models::DevIdea> {
    list_ideas(pool, Some(project_id), Some("pending"), None, None, None).unwrap()
}

#[test]
fn seeds_land_pending_where_the_night_triage_pass_reads_them() {
    let pool = test_pool();
    let pid = project(&pool);

    let out = seed_bench_work(
        &pool,
        &pid,
        &[item("Document KP_TRUSTED_PROXY in .env.example")],
    )
    .expect("seed");

    assert_eq!(out.seeded, 1);
    assert_eq!(out.skipped, 0);
    assert_eq!(out.items.len(), 1);
    assert!(out.items[0].accepted);
    assert_eq!(out.items[0].index, 0);

    // The status is `pending`, NOT `accepted`: a night dispatches the ids its
    // own triage pass accepted, so a row pre-set to `accepted` is invisible to
    // it. This assertion is the whole reason the module exists.
    assert_eq!(out.items[0].idea_status.as_deref(), Some("pending"));

    let pending = triage_reads(&pool, &pid);
    assert_eq!(pending.len(), 1, "the triage read must see the seeded idea");
    assert_eq!(pending[0].id, out.items[0].id.clone().unwrap());
    assert_eq!(pending[0].scan_type, BENCH_SEED_SCAN_TYPE);
    assert_eq!(pending[0].category, BENCH_SEED_CATEGORY);
    assert_eq!(
        pending[0].description.as_deref(),
        Some("body of Document KP_TRUSTED_PROXY in .env.example")
    );
}

#[test]
fn the_auto_accept_rule_matches_the_column_the_seed_carries() {
    let pool = test_pool();
    let pid = project(&pool);
    let out = seed_bench_work(&pool, &pid, &[item("Thread attachments to extract")]).unwrap();

    assert!(out.triage_rule.created);
    assert!(out.triage_rule.enabled);
    assert!(out.triage_rule.will_accept);
    assert_eq!(out.triage_rule.action, "accept");
    assert_eq!(out.triage_rule.rules_ahead, 0);

    // Pin the JOIN, not a second copy of the evaluator: the rule's condition
    // names a field, an op and a value, and the seeded row's value for that
    // field is exactly the value. If either side is renamed, this fails.
    let conditions: Vec<serde_json::Value> =
        serde_json::from_str(&out.triage_rule.conditions).expect("conditions are JSON");
    assert_eq!(conditions.len(), 1);
    assert_eq!(conditions[0]["field"], "scan_type");
    assert_eq!(conditions[0]["op"], "eq");
    assert_eq!(conditions[0]["value"], BENCH_SEED_SCAN_TYPE);

    let seeded = get_idea_by_id(&pool, out.items[0].id.as_deref().unwrap()).unwrap();
    assert_eq!(seeded.scan_type, conditions[0]["value"].as_str().unwrap());
}

#[test]
fn the_rule_is_ensured_once_not_stacked_per_call() {
    let pool = test_pool();
    let pid = project(&pool);

    let first = seed_bench_work(&pool, &pid, &[item("One")]).unwrap();
    let second = seed_bench_work(&pool, &pid, &[item("Two")]).unwrap();

    assert!(first.triage_rule.created);
    assert!(
        !second.triage_rule.created,
        "the second call reuses the rule"
    );
    assert_eq!(first.triage_rule.id, second.triage_rule.id);
    assert_eq!(
        list_triage_rules(&pool, Some(&pid)).unwrap().len(),
        1,
        "seeding twice must not stack a second auto-accept rule"
    );
}

#[test]
fn a_disabled_rule_is_reported_never_re_enabled() {
    let pool = test_pool();
    let pid = project(&pool);
    let first = seed_bench_work(&pool, &pid, &[item("One")]).unwrap();

    // A human switched it off. That is a decision.
    crate::repos::dev::triage_rules::update_triage_rule(
        &pool,
        &first.triage_rule.id,
        None,
        None,
        None,
        Some(false),
        None,
    )
    .unwrap();

    let second = seed_bench_work(&pool, &pid, &[item("Two")]).unwrap();
    assert!(!second.triage_rule.enabled, "seeding must not re-arm it");
    assert!(!second.triage_rule.will_accept);
    assert!(
        second.notes.iter().any(|n| n.contains("will NOT accept")),
        "the caller must be told the seeds are inert, not left to infer it: {:?}",
        second.notes
    );
}

#[test]
fn rules_ahead_counts_only_enabled_rules_created_first() {
    let pool = test_pool();
    let pid = project(&pool);

    create_triage_rule(
        &pool,
        Some(&pid),
        "reject the cheap ones",
        r#"[{"field":"effort","op":"lt","value":2}]"#,
        "reject",
        Some(true),
    )
    .unwrap();
    create_triage_rule(
        &pool,
        Some(&pid),
        "switched off",
        r#"[{"field":"impact","op":"gt","value":1}]"#,
        "accept",
        Some(false),
    )
    .unwrap();

    let out = seed_bench_work(&pool, &pid, &[item("One")]).unwrap();
    assert_eq!(out.triage_rule.rules_ahead, 1);
    assert!(
        out.notes.iter().any(|n| n.contains("first-match-wins")),
        "a rule ahead in the order is a reported hazard: {:?}",
        out.notes
    );

    // And the seed's effort stays NULL so that `effort < 2` reject rule — which
    // reads a missing effort as 0 — is the reason the note exists rather than a
    // surprise the bench discovers at 3am.
    let seeded = get_idea_by_id(&pool, out.items[0].id.as_deref().unwrap()).unwrap();
    assert_eq!(seeded.effort, None);
    assert_eq!(seeded.impact, None);
    assert_eq!(seeded.risk, None);
}

#[test]
fn a_repeat_seed_is_skipped_with_the_id_it_collided_with() {
    let pool = test_pool();
    let pid = project(&pool);

    let first = seed_bench_work(&pool, &pid, &[item("Document KP_TRUSTED_PROXY")]).unwrap();
    let again = seed_bench_work(&pool, &pid, &[item("Document the KP_TRUSTED_PROXY")]).unwrap();

    assert_eq!(again.seeded, 0);
    assert_eq!(again.skipped, 1);
    assert!(!again.items[0].accepted);
    // Never silent: the skip names the row it lost to.
    assert_eq!(again.items[0].id, first.items[0].id);
    assert!(again.items[0]
        .skipped_reason
        .as_deref()
        .unwrap()
        .contains("already holds an idea"));
    assert!(again.notes.iter().any(|n| n.contains("nothing new")));
    assert_eq!(triage_reads(&pool, &pid).len(), 1);
}

#[test]
fn a_duplicate_inside_one_batch_names_the_item_it_collided_with() {
    let pool = test_pool();
    let pid = project(&pool);

    let out = seed_bench_work(
        &pool,
        &pid,
        &[
            item("Escape fence markers"),
            item("Escape the fence markers"),
        ],
    )
    .unwrap();

    assert_eq!(out.seeded, 1);
    assert_eq!(out.skipped, 1);
    assert!(out.items[1]
        .skipped_reason
        .as_deref()
        .unwrap()
        .contains("items[0]"));
}

#[test]
fn the_dedup_key_carries_the_provenance_tag_forever() {
    let pool = test_pool();
    let pid = project(&pool);
    let out = seed_bench_work(&pool, &pid, &[item("Restore the 200-line invariant")]).unwrap();

    let key = &out.items[0].dedup_key;
    assert!(
        key.starts_with(&format!("scan:{BENCH_SEED_SCAN_TYPE}:{BENCH_SEED_SCOPE}:")),
        "a seeded idea must stay distinguishable from a scanned one: {key}"
    );
    let stored = get_idea_by_id(&pool, out.items[0].id.as_deref().unwrap()).unwrap();
    assert_eq!(stored.dedup_key.as_deref(), Some(key.as_str()));
}

#[test]
fn acceptance_and_trap_are_echoed_and_stored_nowhere() {
    let pool = test_pool();
    let pid = project(&pool);

    let out = seed_bench_work(
        &pool,
        &pid,
        &[BenchSeedItem {
            title: "Assert role_family in the intake eval bank".into(),
            description: Some("the bank is organised by family and never asserts it".into()),
            acceptance: Some("grep -n 'role_family' pipeline/jobfit/eval/intake_eval.py".into()),
            trap: Some("gate_configuration — lowering PASS_THRESHOLDS".into()),
        }],
    )
    .unwrap();

    // Echoed, so the driver's journal holds the seed→idea mapping.
    assert!(out.items[0].acceptance.as_deref().unwrap().contains("grep"));
    assert!(out.items[0]
        .trap
        .as_deref()
        .unwrap()
        .contains("gate_configuration"));

    // And stored NOWHERE the dispatch prompt can reach: run-protocol §8 makes a
    // run whose operator leaked the acceptance command INVALID.
    let stored = get_idea_by_id(&pool, out.items[0].id.as_deref().unwrap()).unwrap();
    for field in [
        stored.description.as_deref(),
        stored.reasoning.as_deref(),
        stored.evidence.as_deref(),
        Some(stored.title.as_str()),
    ] {
        let text = field.unwrap_or("");
        assert!(!text.contains("grep -n"), "acceptance leaked into: {text}");
        assert!(
            !text.contains("PASS_THRESHOLDS"),
            "the trap leaked into: {text}"
        );
    }
    assert_eq!(stored.reasoning, None);
    assert_eq!(stored.evidence, None);
}

#[test]
fn validation_lists_every_problem_and_writes_nothing() {
    let pool = test_pool();
    let pid = project(&pool);

    let bad = vec![
        BenchSeedItem {
            title: "   ".into(),
            description: None,
            acceptance: None,
            trap: None,
        },
        BenchSeedItem {
            title: "ok".into(),
            description: Some("x".repeat(MAX_DESCRIPTION_CHARS + 1)),
            acceptance: Some("y".repeat(MAX_ACCEPTANCE_CHARS + 1)),
            trap: None,
        },
    ];
    let errors = validate_seed_items(&bad);
    assert_eq!(errors.len(), 3, "every problem, not the first: {errors:?}");

    let err = seed_bench_work(&pool, &pid, &bad).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
    assert!(
        triage_reads(&pool, &pid).is_empty(),
        "a refused batch must leave no half-seeded backlog behind"
    );
    assert!(
        list_triage_rules(&pool, Some(&pid)).unwrap().is_empty(),
        "a refused batch must not create the rule either"
    );
}

#[test]
fn the_batch_cap_and_the_empty_batch_are_both_refused() {
    let many: Vec<BenchSeedItem> = (0..=MAX_SEED_ITEMS)
        .map(|i| item(&format!("task number {i}")))
        .collect();
    assert!(validate_seed_items(&many)[0].contains("cap is"));
    assert!(validate_seed_items(&[])[0].contains("at least one"));
}

#[test]
fn an_unknown_project_is_refused_rather_than_silently_seeded() {
    let pool = test_pool();
    let err = seed_bench_work(&pool, "no-such-project", &[item("One")]).unwrap_err();
    assert!(
        matches!(err, AppError::NotFound(_)),
        "expected NotFound, got {err:?}"
    );
}
