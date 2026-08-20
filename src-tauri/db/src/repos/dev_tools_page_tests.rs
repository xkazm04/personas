//! Keyset-pagination + retry-lineage tests for the unified Backlog / Run Desk
//! (P1 + P3 of the triage-unification plan).
//!
//! These pin the properties an OFFSET-paginated read cannot give us: a page
//! boundary that stays correct while rows are inserted mid-triage, ties broken
//! by `id` so two ideas written in the same instant can never hide each other,
//! counts that describe the WHOLE filtered set rather than the loaded page, and
//! a retry that is traceably the same work rather than a new unrelated task.
//!
//! Included from `dev_tools.rs` via `#[path]` so `use super::*` reaches the
//! repo's private items exactly as an inline `mod tests` would.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

fn test_pool() -> DbPool {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let uri = format!("file:page_testdb_{id}?mode=memory&cache=shared");
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

fn project(pool: &DbPool, name: &str) -> String {
    create_project(
        pool,
        name,
        &format!("/tmp/{name}"),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
    .id
}

/// Insert an idea and pin its `created_at` so ordering is deterministic
/// (real inserts share a timestamp far too often to test a keyset with).
#[allow(clippy::too_many_arguments)]
fn seed_idea(
    pool: &DbPool,
    project_id: &str,
    title: &str,
    category: &str,
    status: &str,
    origin: Option<&str>,
    created_at: &str,
) -> String {
    let idea = create_idea(
        pool,
        Some(project_id),
        None,
        "bug-hunter",
        Some(category),
        title,
        None,
        None,
        Some(status),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    pool.get()
        .unwrap()
        .execute(
            "UPDATE dev_ideas SET created_at = ?1, origin = ?2 WHERE id = ?3",
            params![created_at, origin, idea.id],
        )
        .unwrap();
    idea.id
}

fn ts(day: u32) -> String {
    format!("2026-01-{day:02}T00:00:00Z")
}

// ---------------------------------------------------------------------------
// triage_ideas — keyset
// ---------------------------------------------------------------------------

#[test]
fn keyset_walks_every_row_exactly_once() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    for day in 1..=7u32 {
        seed_idea(
            &pool,
            &pid,
            &format!("idea {day}"),
            "technical",
            "pending",
            None,
            &ts(day),
        );
    }

    let filter = TriageFilter {
        project_id: Some(pid.clone()),
        ..Default::default()
    };

    let mut seen: Vec<String> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0;
    loop {
        let page = triage_ideas(&pool, &filter, Some(3), cursor.as_deref()).unwrap();
        pages += 1;
        seen.extend(page.ideas.iter().map(|i| i.title.clone()));
        // Newest first, within and across pages.
        assert!(
            page.ideas
                .windows(2)
                .all(|w| w[0].created_at >= w[1].created_at),
            "page is not sorted newest-first"
        );
        match page.cursor {
            Some(c) if page.has_more => cursor = Some(c),
            _ => break,
        }
        assert!(pages < 10, "keyset failed to terminate");
    }

    assert_eq!(pages, 3, "7 rows at 3/page is 3 pages");
    assert_eq!(seen.len(), 7, "every row is visited");
    let unique: HashSet<&String> = seen.iter().collect();
    assert_eq!(unique.len(), 7, "no row is visited twice");
    assert_eq!(seen.first().unwrap(), "idea 7", "newest first");
    assert_eq!(seen.last().unwrap(), "idea 1", "oldest last");
}

#[test]
fn keyset_breaks_created_at_ties_by_id() {
    // Same timestamp on every row: without the `id` tiebreaker the second page
    // re-serves (or skips) rows, which is exactly how a triage queue starts
    // showing the same card twice.
    let pool = test_pool();
    let pid = project(&pool, "p");
    for n in 0..6 {
        seed_idea(
            &pool,
            &pid,
            &format!("tie {n}"),
            "technical",
            "pending",
            None,
            &ts(3),
        );
    }

    let filter = TriageFilter {
        project_id: Some(pid.clone()),
        ..Default::default()
    };
    let first = triage_ideas(&pool, &filter, Some(4), None).unwrap();
    assert!(first.has_more);
    let second = triage_ideas(&pool, &filter, Some(4), first.cursor.as_deref()).unwrap();

    assert_eq!(first.ideas.len(), 4);
    assert_eq!(second.ideas.len(), 2);
    let mut ids: Vec<&str> = first
        .ideas
        .iter()
        .chain(second.ideas.iter())
        .map(|i| i.id.as_str())
        .collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(
        ids.len(),
        6,
        "tied timestamps must not duplicate or drop rows"
    );
}

#[test]
fn last_page_reports_no_cursor() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_idea(&pool, &pid, "only", "technical", "pending", None, &ts(1));

    let page = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(pid),
            ..Default::default()
        },
        Some(10),
        None,
    )
    .unwrap();
    assert!(!page.has_more);
    assert!(
        page.cursor.is_none(),
        "a last page must not hand out a cursor"
    );
}

#[test]
fn malformed_cursor_is_rejected_not_ignored() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_idea(&pool, &pid, "a", "technical", "pending", None, &ts(1));
    let err = triage_ideas(&pool, &TriageFilter::default(), Some(5), Some("garbage"));
    assert!(
        matches!(err, Err(AppError::Validation(_))),
        "a cursor without the `|` separator must error, not silently restart the page"
    );
}

// ---------------------------------------------------------------------------
// triage_ideas — filters
// ---------------------------------------------------------------------------

#[test]
fn status_defaults_to_pending() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_idea(&pool, &pid, "p1", "technical", "pending", None, &ts(1));
    seed_idea(&pool, &pid, "a1", "technical", "accepted", None, &ts(2));

    let page = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(pid),
            ..Default::default()
        },
        None,
        None,
    )
    .unwrap();
    assert_eq!(page.ideas.len(), 1);
    assert_eq!(page.ideas[0].title, "p1");
}

#[test]
fn no_project_id_is_a_cross_project_read() {
    let pool = test_pool();
    let a = project(&pool, "a");
    let b = project(&pool, "b");
    seed_idea(&pool, &a, "from a", "technical", "pending", None, &ts(1));
    seed_idea(&pool, &b, "from b", "technical", "pending", None, &ts(2));

    let all = triage_ideas(&pool, &TriageFilter::default(), None, None).unwrap();
    assert_eq!(
        all.ideas.len(),
        2,
        "None project_id means cross-project, not empty"
    );

    let scoped = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(a),
            ..Default::default()
        },
        None,
        None,
    )
    .unwrap();
    assert_eq!(scoped.ideas.len(), 1);
    assert_eq!(scoped.ideas[0].title, "from a");
}

#[test]
fn scanner_origin_is_the_pseudo_value_for_null() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_idea(&pool, &pid, "classic", "technical", "pending", None, &ts(1));
    seed_idea(
        &pool,
        &pid,
        "sensor",
        "technical",
        "pending",
        Some("doc_rot"),
        &ts(2),
    );

    let scanner = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(pid.clone()),
            origin: Some(TRIAGE_SCANNER_ORIGIN.to_string()),
            ..Default::default()
        },
        None,
        None,
    )
    .unwrap();
    assert_eq!(scanner.ideas.len(), 1);
    assert_eq!(scanner.ideas[0].title, "classic");

    let sensor = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(pid),
            origin: Some("doc_rot".to_string()),
            ..Default::default()
        },
        None,
        None,
    )
    .unwrap();
    assert_eq!(sensor.ideas.len(), 1);
    assert_eq!(sensor.ideas[0].title, "sensor");
}

#[test]
fn category_filter_narrows_the_page() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_idea(&pool, &pid, "tech", "technical", "pending", None, &ts(1));
    seed_idea(&pool, &pid, "u1", "user", "pending", None, &ts(2));

    let page = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(pid),
            category: Some("user".to_string()),
            ..Default::default()
        },
        None,
        None,
    )
    .unwrap();
    assert_eq!(page.ideas.len(), 1);
    assert_eq!(page.ideas[0].title, "u1");
}

// ---------------------------------------------------------------------------
// triage_ideas — counts
// ---------------------------------------------------------------------------

#[test]
fn counts_ignore_the_status_filter_and_survive_pagination() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    for n in 0..5 {
        seed_idea(
            &pool,
            &pid,
            &format!("p{n}"),
            "technical",
            "pending",
            None,
            &ts(n + 1),
        );
    }
    seed_idea(&pool, &pid, "a", "user", "accepted", None, &ts(7));
    seed_idea(
        &pool,
        &pid,
        "r",
        "user",
        "rejected",
        Some("doc_rot"),
        &ts(8),
    );
    seed_idea(&pool, &pid, "z", "user", "archived", None, &ts(9));

    // A single small page must still report the whole filtered set's buckets —
    // that is the entire reason counts are separate from the page.
    let page = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(pid),
            ..Default::default()
        },
        Some(2),
        None,
    )
    .unwrap();

    assert_eq!(page.ideas.len(), 2, "page respects the limit");
    assert!(page.has_more);
    assert_eq!(page.counts.total, 8);
    assert_eq!(page.counts.pending, 5);
    assert_eq!(page.counts.accepted, 1);
    assert_eq!(page.counts.rejected, 1);
    assert_eq!(page.counts.archived, 1);
    assert_eq!(page.counts.by_category.get("technical"), Some(&5));
    assert_eq!(page.counts.by_category.get("user"), Some(&3));
    assert_eq!(
        page.counts.by_origin.get(TRIAGE_SCANNER_ORIGIN),
        Some(&7),
        "NULL-origin rows are bucketed under the `scanner` pseudo-origin"
    );
    assert_eq!(page.counts.by_origin.get("doc_rot"), Some(&1));
}

#[test]
fn counts_are_scoped_to_the_project() {
    let pool = test_pool();
    let a = project(&pool, "a");
    let b = project(&pool, "b");
    seed_idea(&pool, &a, "a1", "technical", "pending", None, &ts(1));
    seed_idea(&pool, &b, "b1", "technical", "pending", None, &ts(2));
    seed_idea(&pool, &b, "b2", "technical", "pending", None, &ts(3));

    let page = triage_ideas(
        &pool,
        &TriageFilter {
            project_id: Some(b),
            ..Default::default()
        },
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        page.counts.total, 2,
        "another project's backlog must not leak in"
    );
}

// ---------------------------------------------------------------------------
// tasks_page
// ---------------------------------------------------------------------------

fn seed_task(
    pool: &DbPool,
    project_id: &str,
    title: &str,
    status: &str,
    created_at: &str,
) -> String {
    let task = create_task(
        pool,
        Some(project_id),
        title,
        None,
        None,
        None,
        Some(status),
        None,
    )
    .unwrap();
    pool.get()
        .unwrap()
        .execute(
            "UPDATE dev_tasks SET created_at = ?1 WHERE id = ?2",
            params![created_at, task.id],
        )
        .unwrap();
    task.id
}

#[test]
fn tasks_page_paginates_and_counts_every_status() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_task(&pool, &pid, "t1", "queued", &ts(1));
    seed_task(&pool, &pid, "t2", "queued", &ts(2));
    seed_task(&pool, &pid, "t3", "running", &ts(3));
    seed_task(&pool, &pid, "t4", "failed", &ts(4));

    let page = tasks_page(
        &pool,
        Some(&pid),
        Some(&["queued".to_string()]),
        Some(1),
        None,
    )
    .unwrap();
    assert_eq!(page.tasks.len(), 1);
    assert_eq!(page.tasks[0].title, "t2", "newest queued first");
    assert!(page.has_more);
    // Counts describe the project, not the status filter.
    assert_eq!(page.counts.get("queued"), Some(&2));
    assert_eq!(page.counts.get("running"), Some(&1));
    assert_eq!(page.counts.get("failed"), Some(&1));

    let next = tasks_page(
        &pool,
        Some(&pid),
        Some(&["queued".to_string()]),
        Some(1),
        page.cursor.as_deref(),
    )
    .unwrap();
    assert_eq!(next.tasks.len(), 1);
    assert_eq!(next.tasks[0].title, "t1");
    assert!(!next.has_more);
}

#[test]
fn tasks_page_treats_an_empty_status_list_as_no_filter() {
    // An empty vec must not compile to `status IN ()` (a SQL error) nor to
    // "match nothing" — a cleared filter chip should show everything.
    let pool = test_pool();
    let pid = project(&pool, "p");
    seed_task(&pool, &pid, "t1", "queued", &ts(1));
    seed_task(&pool, &pid, "t2", "completed", &ts(2));

    let page = tasks_page(&pool, Some(&pid), Some(&[]), None, None).unwrap();
    assert_eq!(page.tasks.len(), 2);
}

// ---------------------------------------------------------------------------
// retry lineage
// ---------------------------------------------------------------------------

#[test]
fn retry_copies_the_task_and_records_lineage() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    let idea = seed_idea(&pool, &pid, "src", "technical", "accepted", None, &ts(1));

    let original = create_task(
        &pool,
        Some(&pid),
        "Fix the null path",
        Some("do the thing"),
        Some(&idea),
        None,
        Some("failed"),
        Some("campaign"),
    )
    .unwrap();
    assert_eq!(original.attempt, 1);
    assert!(original.parent_task_id.is_none());

    let retry = retry_task(&pool, &original.id).unwrap();
    assert_ne!(retry.id, original.id);
    assert_eq!(
        retry.title, original.title,
        "the title is copied verbatim — a `[Retry] ` prefix would change the prompt the executor runs"
    );
    assert_eq!(retry.description, original.description);
    assert_eq!(retry.source_idea_id, original.source_idea_id);
    assert_eq!(retry.depth, original.depth);
    assert_eq!(retry.project_id, original.project_id);
    assert_eq!(retry.status, "queued");
    assert_eq!(retry.parent_task_id.as_deref(), Some(original.id.as_str()));
    assert_eq!(retry.attempt, 2);

    // The original is untouched — a retry is a new row, not a reset.
    let reread = get_task_by_id(&pool, &original.id).unwrap();
    assert_eq!(reread.status, "failed");
    assert_eq!(reread.attempt, 1);
}

#[test]
fn retry_of_a_retry_keeps_counting() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    let t1 = create_task(&pool, Some(&pid), "work", None, None, None, None, None).unwrap();
    let t2 = retry_task(&pool, &t1.id).unwrap();
    let t3 = retry_task(&pool, &t2.id).unwrap();

    assert_eq!(t3.attempt, 3);
    assert_eq!(
        t3.parent_task_id.as_deref(),
        Some(t2.id.as_str()),
        "lineage points at the immediate parent, not the root"
    );
}

#[test]
fn retry_of_a_missing_task_is_not_found() {
    let pool = test_pool();
    assert!(matches!(
        retry_task(&pool, "nope"),
        Err(AppError::NotFound(_))
    ));
}

// ---------------------------------------------------------------------------
// status normalization + auto-run ledger
// ---------------------------------------------------------------------------

#[test]
fn legacy_pending_task_status_is_normalized_to_queued() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    let task = create_task(&pool, Some(&pid), "legacy", None, None, None, None, None).unwrap();
    pool.get()
        .unwrap()
        .execute(
            "UPDATE dev_tasks SET status = 'pending' WHERE id = ?1",
            params![task.id],
        )
        .unwrap();

    // Re-running the incremental migrations is what a boot does.
    {
        let conn = pool.get().unwrap();
        crate::migrations::run_incremental(&conn).unwrap();
    }

    assert_eq!(get_task_by_id(&pool, &task.id).unwrap().status, "queued");
}

#[test]
fn auto_run_row_survives_start_and_finish() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    assert!(latest_auto_run(&pool, Some(&pid)).unwrap().is_none());

    start_auto_run(&pool, "run-1", &pid, 4).unwrap();
    let live = latest_auto_run(&pool, Some(&pid)).unwrap().unwrap();
    assert_eq!(live.status, "running");
    assert_eq!(live.snapshot_size, 4);
    assert!(live.finished_at.is_none());

    finish_auto_run(&pool, "run-1", "completed", 3, 1, 0, 2, "exhausted").unwrap();
    let done = latest_auto_run(&pool, Some(&pid)).unwrap().unwrap();
    assert_eq!(done.status, "completed");
    assert_eq!((done.completed, done.failed, done.skipped), (3, 1, 0));
    assert_eq!(done.iterations, 2);
    assert_eq!(done.termination_reason.as_deref(), Some("exhausted"));
    assert!(done.finished_at.is_some());
}

#[test]
fn cancelling_never_leaves_the_row_running() {
    let pool = test_pool();
    let pid = project(&pool, "p");
    start_auto_run(&pool, "run-2", &pid, 1).unwrap();
    set_auto_run_status(&pool, "run-2", "cancelled").unwrap();

    let row = latest_auto_run(&pool, Some(&pid)).unwrap().unwrap();
    assert_eq!(row.status, "cancelled");
    assert!(
        row.finished_at.is_some(),
        "a cancelled run must be closed out or the banner rehydrates forever"
    );
}
