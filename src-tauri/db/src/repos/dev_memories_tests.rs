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
        crate::migrations::run(&conn).expect("initial migrations");
        crate::migrations::run_incremental(&conn).expect("incremental migrations");
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
    record(
        &pool,
        "p",
        "learned",
        "L",
        "an observation",
        9,
        "task_outcome",
        Some("t1"),
    )
    .unwrap();
    record(
        &pool,
        "p",
        "decision",
        "D",
        "a settled do",
        4,
        "idea_decision",
        Some("i1"),
    )
    .unwrap();
    record(
        &pool,
        "p",
        "constraint",
        "C",
        "a durable dont",
        4,
        "idea_decision",
        Some("i2"),
    )
    .unwrap();

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
    record(
        &pool,
        "p1",
        "learned",
        "Mine",
        "x",
        5,
        "task_outcome",
        Some("t1"),
    )
    .unwrap();
    record(
        &pool,
        "p2",
        "learned",
        "Theirs",
        "y",
        5,
        "task_outcome",
        Some("t2"),
    )
    .unwrap();
    let mine = get_for_injection(&pool, "p1", 10).unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].title, "Mine");
}

#[test]
fn recent_by_kind_filters_and_orders() {
    let pool = test_pool();
    record(
        &pool,
        "p",
        "decision",
        "A decision",
        "x",
        5,
        "idea_decision",
        Some("i1"),
    )
    .unwrap();
    record(
        &pool,
        "p",
        "learned",
        "An outcome",
        "y",
        5,
        "task_outcome",
        Some("t1"),
    )
    .unwrap();
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
    assert!(
        render_for_prompt(&[], 300).is_none(),
        "nothing to inject -> None"
    );
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

// ---------------------------------------------------------------------------
// App master proposal episodes (kp `docs/concepts/app-master.md` §8.2)
// ---------------------------------------------------------------------------

/// The reconciler re-walks every known proposal branch every 30 minutes,
/// forever. Each observed FATE must cost exactly one row, whatever the tick
/// count — otherwise the App master's project memory fills with the same
/// sentence and the injection budget is spent restating one merge.
#[test]
fn app_master_proposal_episodes_cost_one_row_per_fate() {
    let pool = test_pool();
    let branch = "autopilot/fix-retry";

    let write = |source_id: &str, category: &str, title: &str| {
        record(
            &pool,
            "proj-app-master",
            category,
            title,
            "One factual sentence about what happened on the branch.",
            6,
            "app_master_proposal",
            Some(source_id),
        )
    };

    // Ten reconcile ticks over the same three fates.
    for _ in 0..10 {
        write(
            &format!("{branch}:recorded"),
            "decision",
            "Proposal opened: autopilot/fix-retry",
        )
        .unwrap();
        write(
            &format!("{branch}:merged"),
            "decision",
            "Proposal merged: autopilot/fix-retry",
        )
        .unwrap();
        write(
            &format!("{branch}:reverted"),
            "constraint",
            "Proposal reverted: autopilot/fix-retry",
        )
        .unwrap();
    }

    let rows = list_recent_by_kind(&pool, "proj-app-master", "app_master_proposal", 50).unwrap();
    assert_eq!(rows.len(), 3, "one row per fate, not per tick");

    // A re-gate after the branch MOVES is a different observation and must land
    // — the tip rides in the source_id precisely so it is not suppressed as a
    // duplicate of the previous tip's tally.
    write(
        &format!("{branch}:gates@1111111"),
        "decision",
        "Gates green on autopilot/fix-retry",
    )
    .unwrap()
    .expect("first tip's tally lands");
    write(
        &format!("{branch}:gates@2222222"),
        "constraint",
        "Gates failed on autopilot/fix-retry",
    )
    .unwrap()
    .expect("the moved tip's tally is a NEW observation");
    // …but re-gating the SAME tip is still one row.
    assert!(
        write(
            &format!("{branch}:gates@1111111"),
            "decision",
            "Gates green on autopilot/fix-retry",
        )
        .unwrap()
        .is_none(),
        "the same tip gated twice must not inflate the record"
    );

    let rows = list_recent_by_kind(&pool, "proj-app-master", "app_master_proposal", 50).unwrap();
    assert_eq!(rows.len(), 5);

    // Two proposals on the same project never collide: the branch is the first
    // half of the key.
    write(
        "autopilot/other:merged",
        "decision",
        "Proposal merged: autopilot/other",
    )
    .unwrap()
    .expect("a different branch is a different episode");

    // Constraints lead the injection order, so the revert — the most valuable
    // thing this lane records — is what the next dispatch reads first.
    let injected = get_for_injection(&pool, "proj-app-master", 12).unwrap();
    assert_eq!(
        injected.first().map(|m| m.category.as_str()),
        Some("constraint")
    );
}

/// `app_master_proposal` is a declared source kind, not a string a call site
/// invented — the repo refuses anything outside `DEV_MEMORY_SOURCES`.
#[test]
fn app_master_proposal_is_a_declared_source_kind() {
    let pool = test_pool();
    assert!(record(
        &pool,
        "p",
        "decision",
        "Proposal opened: autopilot/x",
        "Branch-only: nothing was pushed or merged.",
        4,
        "app_master_proposal",
        Some("autopilot/x:recorded"),
    )
    .is_ok());
    assert!(
        record(
            &pool,
            "p",
            "decision",
            "T",
            "C",
            4,
            "app_master_proposals",
            None
        )
        .is_err(),
        "a near-miss spelling is refused, not silently accepted"
    );
}

// ---------------------------------------------------------------------------
// Decay-scored packing (sweep #357)
//
// The injection budget used to be spent in query order and stopped at the
// first line that did not fit, so a stale high-importance note could consume
// it and drop the constraint recorded this morning. These pin that the budget
// now goes to the most valuable survivors.
// ---------------------------------------------------------------------------

fn mem(id: &str, category: &str, importance: i32, content: &str, age_days: i64) -> DevMemory {
    let ts = (chrono::Utc::now() - chrono::Duration::days(age_days)).to_rfc3339();
    DevMemory {
        id: id.to_string(),
        project_id: "p".to_string(),
        category: category.to_string(),
        title: id.to_string(),
        content: content.to_string(),
        importance,
        source_kind: "task_outcome".to_string(),
        source_id: Some(id.to_string()),
        created_at: ts.clone(),
        updated_at: ts,
    }
}

#[test]
fn a_fresh_constraint_beats_an_old_padded_observation() {
    let now = chrono::Utc::now();
    // The observation is recorded at max importance and is 200 days old; the
    // constraint is lower-importance and fresh. Under the old category-then-
    // importance order with a one-line budget, the observation was already
    // second — but it is the SIZE that used to matter: it fit first in query
    // order for any caller that did not sort by category.
    let rows = vec![
        mem("old-note", "learned", 10, &"padding ".repeat(30), 200),
        mem(
            "new-rule",
            "constraint",
            6,
            "never touch the shared index",
            0,
        ),
    ];
    let packed = pack_by_decay(&rows, 120, now);
    assert_eq!(packed.len(), 1, "budget fits exactly one line");
    assert_eq!(packed[0].id, "new-rule");
}

#[test]
fn between_two_constraints_the_higher_decay_score_wins() {
    let now = chrono::Utc::now();
    let rows = vec![
        mem("stale", "constraint", 8, "x", 900),
        mem("recent", "constraint", 8, "y", 5),
    ];
    let packed = pack_by_decay(&rows, 40, now);
    assert_eq!(packed.len(), 1);
    assert_eq!(packed[0].id, "recent", "equal importance, fresher wins");

    // And the score itself is ordered, not just the pick.
    assert!(decay_score(&rows[1], now) > decay_score(&rows[0], now));
}

#[test]
fn a_constraint_outlives_an_observation_of_equal_age_and_importance() {
    let now = chrono::Utc::now();
    // Same importance, same age: only the category half-life separates them,
    // which is the whole point of reusing the persona-memory table.
    let constraint = mem("c", "constraint", 5, "x", 120);
    let observation = mem("o", "learned", 5, "x", 120);
    assert!(decay_score(&constraint, now) > decay_score(&observation, now));
}

#[test]
fn an_oversized_entry_is_skipped_not_a_full_stop() {
    let now = chrono::Utc::now();
    let rows = vec![
        mem("huge", "constraint", 10, &"z".repeat(500), 0),
        mem("small", "constraint", 9, "fits", 0),
    ];
    // The budget admits the top-ranked entry unconditionally, then keeps
    // packing; a middle entry that does not fit must not discard the rest.
    let rows2 = vec![
        mem("first", "constraint", 10, "fits", 0),
        mem("huge", "constraint", 9, &"z".repeat(500), 0),
        mem("last", "constraint", 8, "fits", 0),
    ];
    assert_eq!(pack_by_decay(&rows, 50, now).len(), 1);
    let packed = pack_by_decay(&rows2, 60, now);
    let ids: Vec<&str> = packed.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, vec!["first", "last"]);
}

#[test]
fn packing_is_deterministic_for_equal_scores() {
    let now = chrono::Utc::now();
    let rows = vec![
        mem("b-id", "constraint", 5, "x", 0),
        mem("a-id", "constraint", 5, "x", 0),
    ];
    let first = pack_by_decay(&rows, 30, now);
    let again = pack_by_decay(&rows, 30, now);
    assert_eq!(first[0].id, again[0].id);
    assert_eq!(first[0].id, "a-id", "ties break on id, not on input order");
}

#[test]
fn an_empty_project_still_renders_nothing() {
    assert!(render_for_prompt(&[], 900).is_none());
    assert!(pack_by_decay(&[], 900, chrono::Utc::now()).is_empty());
}
