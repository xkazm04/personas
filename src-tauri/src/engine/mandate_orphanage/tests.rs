//! The orphanage: clusters per project, the deterministic draft (once, and not
//! again after a drop until new orphans arrive), adopt, and archive.

use super::*;
use crate::db::{init_test_db, init_test_user_db};
use crate::engine::mandate_lanes::build_snapshot;

/// One mandate on `proj` (so the fleet has a card), and `n` ideas on `orph`,
/// which no mandate holds. `app_master` pins an App Master persona to `orph`.
fn seed(n: usize, app_master: bool) -> DbPool {
    let pool = init_test_db().expect("test db");
    let conn = pool.conn("orphanage test").unwrap();
    conn.execute_batch(
        "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
            VALUES ('steward','App Master Proj','sp',1,datetime('now'),datetime('now'));
         INSERT INTO dev_projects (id, name, root_path) VALUES ('proj','Proj','/tmp/o-proj');
         INSERT INTO dev_projects (id, name, root_path) VALUES ('orph','Orph','/tmp/o-orph');
         INSERT INTO persona_responsibilities
            (id, persona_id, title, domain, scope_rung, status, project_id, source,
             created_at, updated_at)
         VALUES ('c1','steward','App Master Proj','software_engineering',2,'active','proj',
                 'operator',datetime('now'),datetime('now'));
         INSERT INTO dev_ideas (id, project_id, scan_type, category, title, status,
                                created_at, updated_at)
         VALUES ('home-idea','proj','manual','feature','Home','pending',
                 datetime('now'),datetime('now'));",
    )
    .unwrap();
    if app_master {
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, design_context, created_at, updated_at)
             VALUES ('am-orph','App Master Orph','sp',1,'{\"devProjectId\":\"orph\"}',
                     datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
    }
    for i in 0..n {
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, status,
                                    created_at, updated_at)
             VALUES (?1,'orph','manual','feature','Orphan','pending',datetime('now'),datetime('now'))",
            [format!("o-{i}")],
        )
        .unwrap();
    }
    drop(conn);
    pool
}

#[test]
fn clusters_group_orphans_per_project_and_fire_against_the_flow() {
    let pool = seed(4, false);
    let user_db = init_test_user_db().unwrap();
    let c = clusters(&pool, &user_db).unwrap();
    assert_eq!(c.per_card, 1.0, "one item on one card");
    assert_eq!(c.clusters.len(), 1);
    let o = &c.clusters[0];
    assert_eq!(
        (o.project_id.as_str(), o.project_name.as_deref()),
        ("orph", Some("Orph"))
    );
    assert_eq!(o.items, 4);
    assert_eq!(o.kinds[0].kind, "idea");
    assert_eq!(o.item_ids.len(), 4);
    assert!(o.why.is_some(), "4 orphans against 1 per card is large");
    assert!(o.steward.is_none(), "no persona works on orph");
}

#[test]
fn the_sweep_drafts_once_and_never_a_second_draft_while_one_is_open() {
    let pool = seed(4, true);
    let user_db = init_test_user_db().unwrap();
    let steward = clusters(&pool, &user_db).unwrap().clusters[0]
        .steward
        .clone()
        .unwrap();
    assert_eq!(steward.source, StewardSource::AppMaster);

    let first = draft_sweep(&pool, &user_db);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].verdict, "drafted");
    let again = draft_sweep(&pool, &user_db);
    assert!(
        again.is_empty(),
        "idempotent: the project holds a draft now"
    );
    let drafts: Vec<_> = mandates::list(&pool)
        .unwrap()
        .into_iter()
        .filter(|s| s.project_id == "orph")
        .collect();
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].source, "athena");

    // It reaches the operator as a Sign card; its orphans are held on it.
    let snap = build_snapshot(&pool, &user_db).unwrap();
    assert!(snap
        .items
        .iter()
        .any(|e| e.item_id == format!("mandate:{}", drafts[0].charter_id)));
    assert!(snap.items.iter().all(|e| e.lane != Lane::Orphan));
}

#[test]
fn a_dropped_draft_is_not_redrafted_until_new_orphans_arrive() {
    let pool = seed(4, true);
    let user_db = init_test_user_db().unwrap();
    let act = draft_sweep(&pool, &user_db).remove(0);
    // Dropped a moment after the orphans arrived.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    mandates::drop_draft(&pool, &act.charter_id, Some("not now"), None).unwrap();
    assert!(
        draft_sweep(&pool, &user_db).is_empty(),
        "declined, nothing new"
    );
    std::thread::sleep(std::time::Duration::from_millis(1100));
    pool.conn("orphanage test")
        .unwrap()
        .execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, status,
                                    created_at, updated_at)
             VALUES ('o-new','orph','manual','feature','Newer','pending',datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
    assert_eq!(
        draft_sweep(&pool, &user_db).len(),
        1,
        "new orphans since the drop"
    );
}

#[test]
fn without_a_steward_the_sweep_waits_and_the_operator_names_one() {
    let pool = seed(4, false);
    let user_db = init_test_user_db().unwrap();
    assert!(draft_sweep(&pool, &user_db).is_empty());
    assert!(matches!(
        draft(&pool, &user_db, "orph", None),
        Err(AppError::Validation(_))
    ));
    let act = draft(&pool, &user_db, "orph", Some("steward")).unwrap();
    let m = mandates::get(&pool, &act.charter_id).unwrap().unwrap();
    assert!(m.origin.unwrap().borrowed_steward);
    // The borrowed steward's home project still routes its own items.
    let r = routed(&pool, &user_db).unwrap();
    assert_eq!(
        r.book.project_of_persona("steward").as_deref(),
        Some("proj")
    );
}

#[test]
fn adopt_moves_the_project_under_a_mandate_and_archive_hides_orphans_without_deleting() {
    let pool = seed(3, false);
    let user_db = init_test_user_db().unwrap();
    adopt(&pool, &user_db, "orph", "c1").unwrap();
    let snap = build_snapshot(&pool, &user_db).unwrap();
    assert!(
        snap.items.iter().all(|e| e.lane != Lane::Orphan),
        "adopted: no orphans left"
    );

    let pool = seed(3, false);
    assert_eq!(archive(&pool, &user_db, "orph").unwrap(), 3);
    let c = clusters(&pool, &user_db).unwrap();
    assert!(c.clusters.is_empty(), "archived from the lane");
    let pending: i64 = pool
        .conn("orphanage test")
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = 'orph' AND status = 'pending'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pending, 3, "archived, not deleted");
    assert!(matches!(
        archive(&pool, &user_db, "orph"),
        Err(AppError::Validation(_))
    ));
}
