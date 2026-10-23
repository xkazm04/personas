//! The re-read end to end: counted from routed items, shipped as a Sign entry
//! and on the mandate, quieted by Keep until its use grows past the marker.

use super::*;
use crate::db::models::{CharterActor, MandateSignInput, NewCharterAct, RereadCode, RereadMove};
use crate::db::repos::core::mandates;
use crate::db::{init_test_db, init_test_user_db, PoolExt};
use crate::engine::mandate_lanes::build_snapshot;

fn seed(ideas: usize) -> DbPool {
    let pool = init_test_db().expect("test db");
    let conn = pool.conn("reread test").unwrap();
    conn.execute_batch(
        "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
            VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
         INSERT INTO dev_projects (id, name, root_path) VALUES ('proj','Proj','/tmp/reread-proj');
         INSERT INTO persona_responsibilities
            (id, persona_id, title, domain, scope_rung, status, project_id, source,
             created_at, updated_at)
         VALUES ('c1','steward','App master','software_engineering',2,'active','proj',
                 'kp-hire',datetime('now'),datetime('now'));",
    )
    .unwrap();
    for i in 0..ideas {
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, status,
                                    created_at, updated_at)
             VALUES (?1,'proj','manual','feature','An idea','pending',datetime('now'),datetime('now'))",
            [format!("idea-{i}")],
        )
        .unwrap();
    }
    drop(conn);
    pool
}

fn sign_report_read(pool: &DbPool) {
    mandates::sign(
        pool,
        "c1",
        &MandateSignInput {
            decide_scopes: vec![DecideScope::ReportRead],
            ..Default::default()
        },
        None,
    )
    .unwrap();
}

fn steward_act(pool: &DbPool, item: &str) {
    charter_acts::append(
        pool,
        &NewCharterAct {
            charter_id: "c1".into(),
            item_kind: "report".into(),
            item_id: item.into(),
            verdict: "filed as evidence".into(),
            actor: CharterActor::Router,
            scope: Some(DecideScope::ReportRead),
            reversible: true,
            cost_usd: None,
            shown_json: None,
            origin_device: None,
        },
    )
    .unwrap();
}

fn reread_of_c1(pool: &DbPool) -> Option<MandateReread> {
    let user_db = init_test_user_db().unwrap();
    let mut list = mandates::list(pool).unwrap();
    annotate(pool, &user_db, &mut list);
    list.into_iter()
        .find(|s| s.charter_id == "c1")
        .unwrap()
        .reread
}

#[test]
fn an_unsigned_mandate_is_never_reread_however_much_it_asks() {
    let pool = seed(8);
    assert_eq!(reread_of_c1(&pool), None);
}

#[test]
fn one_kind_dominating_the_asks_rereads_and_suggests_widening_it() {
    let pool = seed(5);
    sign_report_read(&pool);
    let r = reread_of_c1(&pool).expect("re-read");
    assert_eq!(r.code, RereadCode::Dominant);
    assert_eq!(r.asks, 5);
    assert_eq!(r.lead_scope, Some(DecideScope::IdeaAccept));
    assert_eq!(
        r.lead_absorbs, 5,
        "every idea leaves Breach once idea.accept is held"
    );
    let s = r.suggest.unwrap();
    assert_eq!(
        (s.action, s.scope),
        (RereadMove::Widen, Some(DecideScope::IdeaAccept))
    );

    let user_db = init_test_user_db().unwrap();
    let snap = build_snapshot(&pool, &user_db).unwrap();
    let e = snap
        .items
        .iter()
        .find(|e| e.item_id == "mandate-reread:c1")
        .expect("a re-read Sign entry");
    assert_eq!((e.lane, e.item_kind.as_str()), (Lane::Sign, "mandate"));
    assert_eq!(e.coalesce_key, "c1:sign:reread");
}

#[test]
fn keep_quiets_the_reread_until_the_acts_reach_twice_the_marker() {
    let pool = seed(5);
    sign_report_read(&pool);
    steward_act(&pool, "r1");
    assert!(reread_of_c1(&pool).is_some());
    mandates::keep(&pool, "c1", "dominant", None).unwrap();
    assert_eq!(reread_of_c1(&pool), None, "kept at 1 act");
    let user_db = init_test_user_db().unwrap();
    let snap = build_snapshot(&pool, &user_db).unwrap();
    assert!(snap.items.iter().all(|e| e.item_id != "mandate-reread:c1"));
    // The use grows past the marker (2 x 1) and the trigger fires again.
    steward_act(&pool, "r2");
    let r = reread_of_c1(&pool).expect("re-fired past the marker");
    assert_eq!(r.kept_at_acts, Some(1));
}

#[test]
fn absorption_is_counted_through_the_router_not_estimated() {
    let pool = seed(3);
    sign_report_read(&pool);
    let user_db = init_test_user_db().unwrap();
    let r = routed(&pool, &user_db).unwrap();
    let s = r.book.summaries[0].clone();
    let view = view_of(&r, &s).unwrap();
    let asks = asks_of(&r, "c1");
    assert_eq!(asks.len(), 3);
    assert_eq!(absorbed(&asks, view, DecideScope::IdeaAccept).len(), 3);
    assert_eq!(absorbed(&asks, view, DecideScope::Dispatch).len(), 0);
}
