//! The Scopes section: absorption counted through the router, the arming flag
//! on the payload, and the spend steps.

use super::*;
use crate::db::models::{MandateChange, MandateSignInput};
use crate::db::{init_test_db, init_test_user_db, PoolExt};

fn seed(status: &str, ideas: usize) -> DbPool {
    let pool = init_test_db().expect("test db");
    let conn = pool.conn("scopes test").unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
            VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
         INSERT INTO dev_projects (id, name, root_path) VALUES ('proj','Proj','/tmp/scopes-proj');
         INSERT INTO persona_responsibilities
            (id, persona_id, title, domain, scope_rung, status, project_id, source,
             budget_monthly_usd, created_at, updated_at)
         VALUES ('c1','steward','App master','software_engineering',2,'{status}','proj',
                 'kp-hire',20.0,datetime('now'),datetime('now'));"
    ))
    .unwrap();
    for i in 0..ideas {
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, status,
                                    created_at, updated_at)
             VALUES (?1,'proj','manual','feature',?2,'pending',datetime('now'),datetime('now'))",
            [format!("idea-{i}"), format!("Idea {i}")],
        )
        .unwrap();
    }
    drop(conn);
    pool
}

#[test]
fn a_missing_scope_lists_the_asks_it_would_absorb_through_the_router() {
    let pool = seed("active", 2);
    let user_db = init_test_user_db().unwrap();
    let s = scopes_of(&pool, &user_db, "c1").unwrap();
    assert!(!s.signed);
    assert_eq!(s.asks, 2);
    let accept = s
        .rows
        .iter()
        .find(|r| r.scope == DecideScope::IdeaAccept)
        .unwrap();
    assert!(!accept.held);
    assert_eq!(
        accept.absorbs, 2,
        "signing with idea.accept takes both ideas"
    );
    assert_eq!(accept.absorbed[0].item_id, "idea:idea-0");
    assert_eq!(accept.absorbed[0].title.as_deref(), Some("Idea 0"));
    let reject = s
        .rows
        .iter()
        .find(|r| r.scope == DecideScope::IdeaReject)
        .unwrap();
    assert_eq!(
        reject.absorbs, 0,
        "the router files ideas under idea.accept only"
    );
    assert!(s
        .rows
        .iter()
        .all(|r| r.arms == (r.scope == DecideScope::Dispatch)));
    assert_eq!(s.merge.widen_to, Some(MergePolicy::GateGreenCouncilReady));
    assert_eq!(s.merge.narrow_to, None);
    assert_eq!(s.spend.cap_usd, Some(20.0));
    assert_eq!(s.spend.widen_to_usd, 25.0);
    assert_eq!(s.spend.narrow_to_usd, Some(15.0));
}

#[test]
fn a_held_scope_counts_its_acts_and_absorbs_nothing() {
    let pool = seed("draft", 1);
    mandates::sign(
        &pool,
        "c1",
        &MandateSignInput {
            decide_scopes: vec![DecideScope::IdeaAccept],
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let user_db = init_test_user_db().unwrap();
    let s = scopes_of(&pool, &user_db, "c1").unwrap();
    assert!(s.signed);
    assert_eq!(s.asks, 0, "the idea waits for the steward now");
    let accept = s
        .rows
        .iter()
        .find(|r| r.scope == DecideScope::IdeaAccept)
        .unwrap();
    assert!(accept.held);
    assert_eq!(accept.absorbs, 0);
    // Narrowing through the amend door sends it back to the operator.
    mandates::amend(
        &pool,
        "c1",
        &MandateChange::NarrowScope {
            scopes: vec![DecideScope::IdeaAccept],
        },
        None,
    )
    .unwrap();
    let s = scopes_of(&pool, &user_db, "c1").unwrap();
    assert_eq!(s.asks, 1);
}

#[test]
fn spend_steps_round_to_whole_steps_and_never_remove_the_cap() {
    assert_eq!(spend_widen_to(None, Some(3.2)), 10.0);
    assert_eq!(spend_widen_to(None, None), 5.0);
    assert_eq!(spend_widen_to(Some(40.0), None), 50.0);
    assert_eq!(spend_widen_to(Some(8.0), None), 15.0);
    assert_eq!(spend_narrow_to(Some(40.0)), Some(35.0));
    assert_eq!(spend_narrow_to(Some(5.0)), None);
    assert_eq!(spend_narrow_to(None), None);
}

#[test]
fn an_unknown_mandate_is_not_found() {
    let pool = seed("active", 0);
    let user_db = init_test_user_db().unwrap();
    assert!(matches!(
        scopes_of(&pool, &user_db, "nope"),
        Err(AppError::NotFound(_))
    ));
}
