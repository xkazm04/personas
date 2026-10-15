//! The sweep against real fixtures: a signed envelope files once, records,
//! and files nothing the second time; the attention loop does not matter; an
//! unsigned envelope files nothing; an irreversible item is never filed; and
//! revert restores every source row the router changed.

use super::*;
use crate::db::models::{
    CharterActFilter, CreateAuditIncidentInput, CreateReportInput, MandateSignInput,
};
use crate::db::repos::communication::manual_reviews::UnanchoredReviewInput;
use crate::db::{init_test_db, PoolExt};

fn seed() -> DbPool {
    let pool = init_test_db().expect("test db");
    pool.conn("sweep test")
        .unwrap()
        .execute_batch(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now')),
                       ('other','Other','sp',1,datetime('now'),datetime('now'));
             INSERT INTO dev_projects (id, name, root_path)
                VALUES ('proj','Proj','/tmp/sweep-proj');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, owner, source,
                 created_at, updated_at)
             VALUES ('c1','steward','App master','software_engineering',2,'active','proj',
                     'ana@example.com','kp-hire',datetime('now'),datetime('now'));",
        )
        .unwrap();
    pool
}

fn sign(pool: &DbPool, scopes: Vec<DecideScope>) {
    mandates::sign(
        pool,
        "c1",
        &MandateSignInput {
            decide_scopes: scopes,
            ..Default::default()
        },
        None,
    )
    .unwrap();
}

fn all_router_scopes(pool: &DbPool) {
    sign(
        pool,
        vec![
            DecideScope::ReportRead,
            DecideScope::ReviewInfo,
            DecideScope::IncidentTriage,
        ],
    );
}

fn report(pool: &DbPool, persona: &str) -> String {
    reports::create(
        pool,
        CreateReportInput {
            persona_id: persona.into(),
            execution_id: None,
            title: Some("Nightly digest".into()),
            content: "All green".into(),
            content_type: None,
            priority: None,
            metadata: None,
            thread_id: None,
            use_case_id: None,
        },
    )
    .unwrap()
    .id
}

fn review(pool: &DbPool, severity: &str, context: Option<&str>) -> String {
    manual_reviews::create_unanchored(
        pool,
        UnanchoredReviewInput {
            persona_id: "steward",
            title: "Looks fine",
            description: None,
            severity,
            context_data: context,
        },
    )
    .unwrap()
    .id
}

fn incident(pool: &DbPool, severity: &str, source_id: &str) -> String {
    audit_incidents::promote(
        pool,
        CreateAuditIncidentInput {
            source_table: "persona_blocker".into(),
            source_id: source_id.into(),
            persona_id: Some("steward".into()),
            persona_name: Some("Steward".into()),
            execution_id: None,
            severity: severity.into(),
            kind: "blocker".into(),
            title: format!("Blocked on {source_id}"),
            detail: None,
        },
    )
    .unwrap()
    .expect("a fresh incident is created")
}

fn router_acts(pool: &DbPool) -> Vec<CharterAct> {
    charter_acts::list(
        pool,
        &CharterActFilter {
            actor: Some(CharterActor::Router),
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn a_signed_envelope_files_once_records_and_never_twice() {
    let pool = seed();
    all_router_scopes(&pool);
    let rep = report(&pool, "steward");
    let rev = review(&pool, "info", None);
    let inc = incident(&pool, "low", "exec-1");

    let first = sweep_unlatched(&pool, &PoolReviewDoor(&pool));
    assert_eq!(first.acts.len(), 3, "{first:?}");
    assert_eq!(first.failed, 0);

    // The doors moved the source rows.
    assert!(reports::get_by_id(&pool, &rep).unwrap().is_read);
    assert_eq!(
        manual_reviews::get_by_id(&pool, &rev).unwrap().status,
        ManualReviewStatus::Approved
    );
    assert_eq!(
        audit_incidents::get_by_id(&pool, &inc).unwrap().status,
        "acknowledged"
    );

    // Each act names the router, the scope, the charter and its version.
    let acts = router_acts(&pool);
    assert_eq!(acts.len(), 3);
    for a in &acts {
        assert_eq!(a.charter_id, "c1");
        assert_eq!(a.envelope_version, 1);
        assert_eq!(a.actor, CharterActor::Router);
        let shown: serde_json::Value =
            serde_json::from_str(a.shown_json.as_deref().unwrap()).unwrap();
        assert_eq!(shown["lane"], "evidence");
        assert_eq!(shown["projectId"], "proj");
    }
    let by_kind = |k: &str| acts.iter().find(|a| a.item_kind == k).unwrap();
    assert_eq!(by_kind("report").item_id, rep);
    assert_eq!(by_kind("report").scope.as_deref(), Some("report.read"));
    assert!(by_kind("report").reversible);
    assert_eq!(by_kind("review").scope.as_deref(), Some("review.info"));
    assert!(
        !by_kind("review").reversible,
        "no door returns a review to pending"
    );
    assert_eq!(
        by_kind("incident").scope.as_deref(),
        Some("incident.triage")
    );
    assert!(by_kind("incident").reversible);

    // A second run acts on nothing: reports and reviews left their queues, and
    // the still-open-listed incident is already acted.
    let second = sweep_unlatched(&pool, &PoolReviewDoor(&pool));
    assert!(second.acts.is_empty(), "{second:?}");
    assert_eq!(router_acts(&pool).len(), 3);
}

#[test]
fn the_sweep_files_with_the_attention_loop_off() {
    let pool = seed();
    crate::db::repos::core::settings::set(
        &pool,
        crate::db::settings_keys::AUTONOMOUS_ATTENTION_LOOP,
        "false",
    )
    .unwrap();
    assert!(!personas_engine::autonomy::global_enabled(
        &pool,
        personas_engine::autonomy::Action::AttentionLoop
    ));
    sign(&pool, vec![DecideScope::ReportRead]);
    report(&pool, "steward");
    assert_eq!(sweep_unlatched(&pool, &PoolReviewDoor(&pool)).acts.len(), 1);
}

#[test]
fn an_unsigned_envelope_files_nothing() {
    let pool = seed();
    let rep = report(&pool, "steward");
    let rev = review(&pool, "info", None);
    let inc = incident(&pool, "low", "exec-2");
    let out = sweep_unlatched(&pool, &PoolReviewDoor(&pool));
    assert!(out.acts.is_empty());
    assert_eq!(out.considered, 0, "an unsigned book is not even read");
    assert!(!reports::get_by_id(&pool, &rep).unwrap().is_read);
    assert_eq!(
        manual_reviews::get_by_id(&pool, &rev).unwrap().status,
        ManualReviewStatus::Pending
    );
    assert_eq!(
        audit_incidents::get_by_id(&pool, &inc).unwrap().status,
        "open"
    );
    assert!(router_acts(&pool).is_empty());
}

#[test]
fn a_suspended_mandate_files_nothing() {
    let pool = seed();
    all_router_scopes(&pool);
    mandates::suspend(&pool, "c1", None).unwrap();
    report(&pool, "steward");
    assert!(sweep_unlatched(&pool, &PoolReviewDoor(&pool))
        .acts
        .is_empty());
}

#[test]
fn crossings_are_left_for_the_operator() {
    let pool = seed();
    all_router_scopes(&pool);
    let high = review(&pool, "high", None);
    let ask = review(
        &pool,
        "info",
        Some(r#"{"source":"app_master_ask","projectId":"proj","kind":"decision"}"#),
    );
    let stop = incident(&pool, "critical", "exec-3");
    let other_persona_report = report(&pool, "other");
    let out = sweep_unlatched(&pool, &PoolReviewDoor(&pool));
    assert!(out.acts.is_empty(), "{out:?}");
    for id in [&high, &ask] {
        assert_eq!(
            manual_reviews::get_by_id(&pool, id).unwrap().status,
            ManualReviewStatus::Pending
        );
    }
    assert_eq!(
        audit_incidents::get_by_id(&pool, &stop).unwrap().status,
        "open"
    );
    assert!(
        !reports::get_by_id(&pool, &other_persona_report)
            .unwrap()
            .is_read
    );
}

/// Belt and braces under the router's rule: even if an input claimed an
/// irreversible class, `file_one` refuses before the gate or any door.
#[test]
fn an_irreversible_item_is_never_filed() {
    let pool = seed();
    all_router_scopes(&pool);
    let rep = report(&pool, "steward");
    let book = LaneBook::load(&pool).unwrap();
    let r = reports::get_by_id(&pool, &rep).unwrap();
    for irr in [
        Irreversible::Merge,
        Irreversible::Spend,
        Irreversible::OutboundMessage,
        Irreversible::Deletion,
    ] {
        let mut input = report_input(&r, &book);
        input.irreversible = Some(irr);
        let route = book.route(&input);
        assert!(route.act.is_none(), "{irr:?}");
        let c = Candidate {
            input,
            title: String::new(),
        };
        let forced = file_one(
            &pool,
            &PoolReviewDoor(&pool),
            &c,
            &route,
            RouterAct::MarkReportRead,
        );
        assert!(matches!(forced, Ok(None)), "{irr:?}: {forced:?}");
    }
    assert!(!reports::get_by_id(&pool, &rep).unwrap().is_read);
    assert!(router_acts(&pool).is_empty());
}

#[test]
fn reverting_a_router_act_restores_the_source_row_and_is_not_re_acted() {
    let pool = seed();
    all_router_scopes(&pool);
    let rep = report(&pool, "steward");
    let inc = incident(&pool, "medium", "exec-4");
    let rev = review(&pool, "low", None);
    assert_eq!(sweep_unlatched(&pool, &PoolReviewDoor(&pool)).acts.len(), 3);
    let acts = router_acts(&pool);
    let act = |k: &str| acts.iter().find(|a| a.item_kind == k).unwrap().id.clone();

    // Report: back to unread.
    let undo = revert_with_undo(&pool, &act("report")).unwrap();
    assert_eq!(undo.item_kind, "act.revert");
    assert!(!reports::get_by_id(&pool, &rep).unwrap().is_read);
    // Incident: reopened.
    revert_with_undo(&pool, &act("incident")).unwrap();
    assert_eq!(
        audit_incidents::get_by_id(&pool, &inc).unwrap().status,
        "open"
    );
    // Review: no inverse door, so revert refuses and the review stays approved.
    let refused = revert_with_undo(&pool, &act("review")).unwrap_err();
    assert!(matches!(refused, AppError::Forbidden(_)), "{refused:?}");
    assert_eq!(
        manual_reviews::get_by_id(&pool, &rev).unwrap().status,
        ManualReviewStatus::Approved
    );

    // The operator took them back: the next sweep does not re-file them.
    let again = sweep_unlatched(&pool, &PoolReviewDoor(&pool));
    assert!(again.acts.is_empty(), "{again:?}");
    assert_eq!(again.already_acted, 2);
    assert!(!reports::get_by_id(&pool, &rep).unwrap().is_read);
    assert_eq!(
        audit_incidents::get_by_id(&pool, &inc).unwrap().status,
        "open"
    );
}

#[test]
fn reverting_an_incident_someone_moved_on_refuses_and_keeps_the_act() {
    let pool = seed();
    sign(&pool, vec![DecideScope::IncidentTriage]);
    let inc = incident(&pool, "low", "exec-5");
    assert_eq!(sweep_unlatched(&pool, &PoolReviewDoor(&pool)).acts.len(), 1);
    audit_incidents::resolve(&pool, &inc, Some("fixed")).unwrap();
    let act_id = router_acts(&pool)[0].id.clone();
    let refused = revert_with_undo(&pool, &act_id).unwrap_err();
    assert!(matches!(refused, AppError::Validation(_)), "{refused:?}");
    assert_eq!(
        audit_incidents::get_by_id(&pool, &inc).unwrap().status,
        "resolved"
    );
    assert!(charter_acts::get(&pool, &act_id)
        .unwrap()
        .unwrap()
        .reverted_at
        .is_none());
}

#[test]
fn approval_ops_map_to_irreversible_classes_from_the_closed_catalog() {
    let cases = [
        ("delete_fact", Some(Irreversible::Deletion)),
        ("delete_procedural", Some(Irreversible::Deletion)),
        ("delete_goal", Some(Irreversible::Deletion)),
        ("delete_ritual", Some(Irreversible::Deletion)),
        ("dev_merge", Some(Irreversible::Merge)),
        ("write_fact", None),
        ("run_persona", None),
        ("use_connector", None),
        ("browser_act", None),
        ("fleet_kill", None),
        ("no_such_op", None),
    ];
    // Tether: every mapped op is a real member of the dispatcher's closed
    // catalog, spelled exactly as it is there.
    let catalog = include_str!("../../companion/dispatcher/catalog.rs");
    for (op, want) in cases {
        assert_eq!(approval_irreversible(op), want, "{op}");
        if want.is_some() {
            assert!(
                catalog.contains(&format!("\"{op}\",")),
                "{op} is not in ALLOWED_ACTIONS"
            );
        }
    }
}

#[test]
fn the_book_maps_a_steward_to_its_one_project_only() {
    let pool = seed();
    pool.conn("sweep test")
        .unwrap()
        .execute_batch(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('p2','P2','/tmp/sweep-p2');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, owner, source,
                 created_at, updated_at)
             VALUES ('c2','other','App master','software_engineering',2,'draft','p2',
                     'ana@example.com','kp-hire',datetime('now'),datetime('now')),
                    ('c3','other','App master','software_engineering',2,'draft','p3',
                     'ana@example.com','kp-hire',datetime('now'),datetime('now'));",
        )
        .unwrap();
    let book = LaneBook::load(&pool).unwrap();
    assert_eq!(book.project_of_persona("steward").as_deref(), Some("proj"));
    assert_eq!(
        book.project_of_persona("other"),
        None,
        "two projects: ambiguous"
    );
    assert_eq!(book.project_of_persona("nobody"), None);
    assert_eq!(
        book.charter(Some("p2")).unwrap().status,
        CharterStatus::Draft
    );
}

#[test]
fn a_sweep_already_running_makes_the_next_one_a_no_op_and_the_latch_releases() {
    let pool = seed();
    sign(&pool, vec![DecideScope::ReportRead]);
    let rep = report(&pool, "steward");
    // The only test that touches the process latch; every other test runs the
    // unlatched body so parallel test threads never skip each other.
    SWEEPING.store(true, Ordering::SeqCst);
    let skipped = sweep(&pool, &PoolReviewDoor(&pool));
    SWEEPING.store(false, Ordering::SeqCst);
    assert!(skipped.acts.is_empty());
    assert!(!reports::get_by_id(&pool, &rep).unwrap().is_read);
    let ran = sweep(&pool, &PoolReviewDoor(&pool));
    assert_eq!(ran.acts.len(), 1);
    assert!(
        !SWEEPING.load(Ordering::SeqCst),
        "the latch is released after a run"
    );
}
