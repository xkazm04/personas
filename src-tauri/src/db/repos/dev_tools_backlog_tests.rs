//! Phase 1 of `docs/plans/backlog-memory-loop.md` — the backlog memory spine.
//!
//! These pin the two invariants the whole loop rests on: a GENERATED idea the
//! project already holds (in ANY status) is never stacked again, and an idea
//! that aged out is archived reversibly rather than deleted.
//!
//! Included from `dev_tools.rs` via `#[path]` so `use super::*` reaches the
//! repo's private items exactly as an inline `mod tests` would.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

fn test_pool() -> DbPool {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let uri = format!("file:backlog_mem_testdb_{id}?mode=memory&cache=shared");
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

fn project(pool: &DbPool) -> String {
    create_project(pool, "Proj", "/tmp/proj", None, None, None, None, None)
        .unwrap()
        .id
}

/// Backdate a row so the aging pass can see it without sleeping.
fn backdate_idea(pool: &DbPool, idea_id: &str, days: i64) {
    let when = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    pool.get()
        .unwrap()
        .execute(
            "UPDATE dev_ideas SET created_at = ?1 WHERE id = ?2",
            params![when, idea_id],
        )
        .unwrap();
}

#[test]
fn normalize_collapses_rewordings_and_keeps_verbs() {
    // Filler words differ, subject identical -> same token.
    assert_eq!(
        normalize_idea_title("Add retry to the fetch helper"),
        normalize_idea_title("Add retry for fetch helper"),
    );
    // Punctuation / casing are not identity.
    assert_eq!(
        normalize_idea_title("Extract  DimTile!"),
        normalize_idea_title("extract dim tile"),
    );
    // Verbs ARE identity — opposite intents must never collide.
    assert_ne!(
        normalize_idea_title("Add retry to fetch"),
        normalize_idea_title("Remove retry from fetch"),
    );
}

#[test]
fn dedup_key_is_scope_sensitive() {
    let a = scan_dedup_key("bug-hunter", Some("ctx-1"), "Guard the null path");
    let b = scan_dedup_key("bug-hunter", Some("ctx-2"), "Guard the null path");
    let all = scan_dedup_key("bug-hunter", None, "Guard the null path");
    assert_ne!(a, b, "same title in two contexts is two ideas");
    assert!(all.starts_with("scan:bug-hunter:all:"));
}

#[test]
fn gate_suppresses_across_every_status() {
    // A human "no" and an aged-out item are as durable as a live one:
    // re-proposing either must be suppressed, not stacked.
    for status in ["pending", "accepted", "rejected", "archived"] {
        let pool = test_pool();
        let pid = project(&pool);
        let key = scan_dedup_key("bug-hunter", None, "Guard the null path");

        let first = create_idea_deduped(
            &pool,
            &pid,
            None,
            "bug-hunter",
            Some("technical"),
            "Guard the null path",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            &key,
        )
        .unwrap()
        .expect("first insert lands");
        update_idea(
            &pool,
            &first.id,
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

        let second = create_idea_deduped(
            &pool,
            &pid,
            None,
            "bug-hunter",
            Some("technical"),
            "Guard the null path",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            &key,
        )
        .unwrap();
        assert!(
            second.is_none(),
            "status {status}: duplicate must be suppressed"
        );

        let all = list_ideas(&pool, Some(&pid), None, None, Some(50), None).unwrap();
        assert_eq!(all.len(), 1, "status {status}: exactly one row survives");
    }
}

#[test]
fn gate_admits_a_genuinely_different_idea() {
    let pool = test_pool();
    let pid = project(&pool);
    let mk = |title: &str, scope: Option<&str>| {
        let key = scan_dedup_key("bug-hunter", scope, title);
        create_idea_deduped(
            &pool,
            &pid,
            None,
            "bug-hunter",
            Some("technical"),
            title,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            &key,
        )
        .unwrap()
    };
    assert!(mk("Guard the null path", None).is_some());
    assert!(
        mk("Cache the context map", None).is_some(),
        "new subject -> new idea"
    );
    assert!(
        mk("Guard the null path", Some("ctx-9")).is_some(),
        "same title, different scope -> new idea"
    );
}

#[test]
fn ungated_create_idea_still_allows_hand_written_duplicates() {
    // A human typing the same thing twice on purpose is a decision, not a
    // defect — only GENERATED ideas go through the gate.
    let pool = test_pool();
    let pid = project(&pool);
    for _ in 0..2 {
        create_idea(
            &pool,
            Some(&pid),
            None,
            "manual",
            Some("technical"),
            "Same thing",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    }
    let all = list_ideas(&pool, Some(&pid), None, None, Some(50), None).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn aging_archives_only_stale_untouched_pending_ideas() {
    let pool = test_pool();
    let pid = project(&pool);
    let mk = |title: &str| {
        create_idea(
            &pool,
            Some(&pid),
            None,
            "bug-hunter",
            Some("technical"),
            title,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    };

    let stale = mk("Stale and untouched");
    let fresh = mk("Fresh");
    let stale_accepted = mk("Stale but accepted");
    let stale_with_task = mk("Stale but became work");

    backdate_idea(&pool, &stale.id, 60);
    backdate_idea(&pool, &stale_accepted.id, 60);
    backdate_idea(&pool, &stale_with_task.id, 60);
    update_idea(
        &pool,
        &stale_accepted.id,
        None,
        None,
        Some("accepted"),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    create_task(
        &pool,
        Some(&pid),
        "Do it",
        None,
        Some(&stale_with_task.id),
        None,
        None,
        None,
    )
    .unwrap();

    let archived = archive_stale_ideas(&pool, Some(&pid), 30).unwrap();
    assert_eq!(archived, 1, "only the stale, pending, task-less idea ages out");

    assert_eq!(get_idea_by_id(&pool, &stale.id).unwrap().status, "archived");
    assert_eq!(get_idea_by_id(&pool, &fresh.id).unwrap().status, "pending");
    assert_eq!(
        get_idea_by_id(&pool, &stale_accepted.id).unwrap().status,
        "accepted"
    );
    assert_eq!(
        get_idea_by_id(&pool, &stale_with_task.id).unwrap().status,
        "pending"
    );
}

#[test]
fn archived_idea_keeps_its_key_so_it_cannot_be_re_proposed() {
    // Archival must never reopen the duplication door.
    let pool = test_pool();
    let pid = project(&pool);
    let key = scan_dedup_key("bug-hunter", None, "Guard the null path");
    let idea = create_idea_deduped(
        &pool,
        &pid,
        None,
        "bug-hunter",
        Some("technical"),
        "Guard the null path",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &key,
    )
    .unwrap()
    .unwrap();
    backdate_idea(&pool, &idea.id, 60);

    assert_eq!(archive_stale_ideas(&pool, Some(&pid), 30).unwrap(), 1);
    let again = create_idea_deduped(
        &pool,
        &pid,
        None,
        "bug-hunter",
        Some("technical"),
        "Guard the null path",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &key,
    )
    .unwrap();
    assert!(again.is_none(), "an archived idea is still remembered");
}

#[test]
fn aging_rejects_a_nonpositive_window() {
    let pool = test_pool();
    assert!(archive_stale_ideas(&pool, None, 0).is_err());
}
