//! Phase 2 of `docs/plans/backlog-memory-loop.md` — the development loop's
//! project-scoped memory. These pin the properties the loop depends on: one
//! memory per source event (a retried task cannot inflate the record), ordering
//! that spends the injection budget on constraints first, and a render step
//! that can never crowd out the prompt it is injected into.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

fn test_pool() -> DbPool {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let uri = format!("file:dev_mem_testdb_{id}?mode=memory&cache=shared");
    let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
    let pool = r2d2::Pool::builder()
        .max_size(4)
        .build(manager)
        .expect("test pool build");
    {
        let conn = pool.get().expect("conn");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrations::run(&conn).expect("initial migrations");
        crate::db::migrations::run_incremental(&conn).expect("incremental migrations");
    }
    pool
}

#[test]
fn records_and_reads_back() {
    let pool = test_pool();
    let m = record(
        &pool,
        "proj-1",
        "constraint",
        "Human rejected: inline the parser",
        "Rejected because the parser is shared with the CLI.",
        8,
        "idea_decision",
        Some("idea-1"),
    )
    .unwrap()
    .expect("first write lands");
    assert_eq!(m.project_id, "proj-1");
    assert_eq!(m.category, "constraint");
    assert_eq!(m.source_kind, "idea_decision");

    let all = get_for_injection(&pool, "proj-1", 10).unwrap();
    assert_eq!(all.len(), 1);
}

#[test]
fn one_memory_per_source_event() {
    // A retried task or a double-clicked triage button must not inflate what
    // the project believes it has learned.
    let pool = test_pool();
    let write = || {
        record(
            &pool,
            "proj-1",
            "learned",
            "Task completed: add retry",
            "It worked.",
            5,
            "task_outcome",
            Some("task-1"),
        )
        .unwrap()
    };
    assert!(write().is_some(), "first write lands");
    assert!(write().is_none(), "same source event is a no-op");
    assert_eq!(get_for_injection(&pool, "proj-1", 10).unwrap().len(), 1);
}

#[test]
fn sourceless_memories_are_not_deduped() {
    // The unique index is partial (source_id IS NOT NULL), so free-standing
    // notes stay appendable.
    let pool = test_pool();
    for _ in 0..2 {
        assert!(record(
            &pool,
            "proj-1",
            "context",
            "Ad-hoc note",
            "Something worth remembering.",
            3,
            "scan_funnel",
            None,
        )
        .unwrap()
        .is_some());
    }
    assert_eq!(get_for_injection(&pool, "proj-1", 10).unwrap().len(), 2);
}

#[test]
fn injection_puts_constraints_first_then_decisions() {
    let pool = test_pool();
    record(&pool, "p", "learned", "L", "an observation", 9, "task_outcome", Some("t1")).unwrap();
    record(&pool, "p", "decision", "D", "a settled do", 4, "idea_decision", Some("i1")).unwrap();
    record(&pool, "p", "constraint", "C", "a durable dont", 4, "idea_decision", Some("i2")).unwrap();

    let ordered = get_for_injection(&pool, "p", 10).unwrap();
    let cats: Vec<&str> = ordered.iter().map(|m| m.category.as_str()).collect();
    assert_eq!(
        cats,
        vec!["constraint", "decision", "learned"],
        "category rank must outrank raw importance"
    );
}

#[test]
fn injection_is_project_scoped() {
    let pool = test_pool();
    record(&pool, "p1", "learned", "Mine", "x", 5, "task_outcome", Some("t1")).unwrap();
    record(&pool, "p2", "learned", "Theirs", "y", 5, "task_outcome", Some("t2")).unwrap();
    let mine = get_for_injection(&pool, "p1", 10).unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].title, "Mine");
}

#[test]
fn recent_by_kind_filters_and_orders() {
    let pool = test_pool();
    record(&pool, "p", "decision", "A decision", "x", 5, "idea_decision", Some("i1")).unwrap();
    record(&pool, "p", "learned", "An outcome", "y", 5, "task_outcome", Some("t1")).unwrap();
    let outcomes = list_recent_by_kind(&pool, "p", "task_outcome", 10).unwrap();
    assert_eq!(outcomes.len(), 1);
    assert_eq!(outcomes[0].title, "An outcome");
}

#[test]
fn render_respects_the_character_budget() {
    let pool = test_pool();
    for i in 0..20 {
        record(
            &pool,
            "p",
            "learned",
            &format!("Memory number {i}"),
            &"padding ".repeat(20),
            5,
            "task_outcome",
            Some(&format!("t{i}")),
        )
        .unwrap();
    }
    let rows = get_for_injection(&pool, "p", 20).unwrap();
    let rendered = render_for_prompt(&rows, 300).expect("some memories render");
    assert!(
        rendered.len() <= 300,
        "budget must cap the block, got {}",
        rendered.len()
    );
    assert!(render_for_prompt(&[], 300).is_none(), "nothing to inject -> None");
}

#[test]
fn rejects_invalid_input() {
    let pool = test_pool();
    assert!(record(&pool, "", "learned", "T", "C", 5, "task_outcome", None).is_err());
    assert!(record(&pool, "p", "learned", "", "C", 5, "task_outcome", None).is_err());
    assert!(
        record(&pool, "p", "learned", "T", "C", 5, "not_a_source", None).is_err(),
        "unknown source kinds are refused, mirroring FINDING_ORIGINS"
    );
}
