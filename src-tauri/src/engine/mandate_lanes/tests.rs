//! The snapshot: literal ids in the frontend's schemes, lanes from the router,
//! filed items as evidence, drafts as Sign entries, held counts, and the
//! council gate tethered to the frontend rule.

use super::*;
use crate::db::models::{CreateReportInput, DecideScope, MandateSignInput};
use crate::db::repos::communication::manual_reviews::UnanchoredReviewInput;
use crate::db::repos::core::mandates;
use crate::db::{init_test_db, init_test_user_db, PoolExt};
use crate::engine::mandate_sweep::{sweep_unlatched, PoolReviewDoor};

fn seed(status: &str) -> DbPool {
    let pool = init_test_db().expect("test db");
    pool.conn("lanes test")
        .unwrap()
        .execute_batch(&format!(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
             INSERT INTO dev_projects (id, name, root_path)
                VALUES ('proj','Proj','/tmp/lanes-proj');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, owner, source,
                 created_at, updated_at)
             VALUES ('c1','steward','App master','software_engineering',2,'{status}','proj',
                     'ana@example.com','kp-hire',datetime('now'),datetime('now'));
             INSERT INTO dev_ideas (id, project_id, scan_type, category, title, status,
                                    created_at, updated_at)
             VALUES ('idea-1','proj','manual','feature','Add a thing','pending',
                     datetime('now'),datetime('now'));"
        ))
        .unwrap();
    pool
}

fn report(pool: &DbPool) -> String {
    reports::create(
        pool,
        CreateReportInput {
            persona_id: "steward".into(),
            execution_id: None,
            title: Some("Digest".into()),
            content: "ok".into(),
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

fn review(pool: &DbPool, severity: &str) -> String {
    manual_reviews::create_unanchored(
        pool,
        UnanchoredReviewInput {
            persona_id: "steward",
            title: "A review",
            description: None,
            severity,
            context_data: None,
        },
    )
    .unwrap()
    .id
}

fn entry<'a>(snap: &'a DecisionLanesSnapshot, id: &str) -> &'a LaneEntry {
    snap.items
        .iter()
        .find(|e| e.item_id == id)
        .unwrap_or_else(|| panic!("no entry {id} in {:#?}", snap.items))
}

#[test]
fn ids_follow_the_frontend_schemes_and_unsigned_lanes_apply() {
    let pool = seed("active");
    let user_db = init_test_user_db().expect("user db");
    let rep = report(&pool);
    let rev = review(&pool, "info");
    let snap = build_snapshot(&pool, &user_db).unwrap();
    assert!(snap.failed_sources.is_empty(), "{:?}", snap.failed_sources);

    // Literal ids: `report:<id>`, `review:<id>`, `idea:<id>`.
    let r = entry(&snap, &format!("report:{rep}"));
    assert_eq!(r.item_kind, "report");
    assert_eq!((r.lane, r.clause), (Lane::Accept, LaneClause::None));
    assert_eq!(r.charter_id.as_deref(), Some("c1"));
    assert_eq!(r.coalesce_key, "c1:accept:none");
    assert_eq!(r.project_id.as_deref(), Some("proj"));

    let v = entry(&snap, &format!("review:{rev}"));
    assert_eq!((v.lane, v.clause), (Lane::Breach, LaneClause::Unsigned));

    let i = entry(&snap, "idea:idea-1");
    assert_eq!(i.item_kind, "idea");
    assert_eq!((i.lane, i.clause), (Lane::Breach, LaneClause::Unsigned));
    assert_eq!(i.irreversible, None);

    assert_eq!(snap.charters.len(), 1);
    assert_eq!(snap.charters[0].envelope_version, 0);
}

#[test]
fn filed_items_are_evidence_and_reverted_ones_return_to_their_lane() {
    let pool = seed("active");
    let user_db = init_test_user_db().expect("user db");
    mandates::sign(
        &pool,
        "c1",
        &MandateSignInput {
            decide_scopes: vec![DecideScope::ReportRead, DecideScope::IdeaAccept],
            ..Default::default()
        },
        None,
    )
    .unwrap();
    let rep = report(&pool);

    // Before the sweep the router would file it: its lane is evidence already.
    let snap = build_snapshot(&pool, &user_db).unwrap();
    assert_eq!(entry(&snap, &format!("report:{rep}")).lane, Lane::Evidence);
    // Inside the envelope, a judgment call waits for the steward.
    let i = entry(&snap, "idea:idea-1");
    assert_eq!(
        (i.lane, i.coalesce_key.as_str()),
        (Lane::Steward, "c1:steward:none")
    );

    let filed = sweep_unlatched(&pool, &PoolReviewDoor(&pool));
    assert_eq!(filed.acts.len(), 1);
    // Read now, so it left the unread source entirely.
    let snap = build_snapshot(&pool, &user_db).unwrap();
    assert!(snap
        .items
        .iter()
        .all(|e| e.item_id != format!("report:{rep}")));

    // Reverted: unread again, and back in Accept, not re-filed.
    crate::engine::mandate_sweep::revert_with_undo(&pool, &filed.acts[0].id).unwrap();
    let snap = build_snapshot(&pool, &user_db).unwrap();
    let r = entry(&snap, &format!("report:{rep}"));
    assert_eq!((r.lane, r.clause), (Lane::Accept, LaneClause::None));
}

#[test]
fn a_draft_mandate_is_a_sign_entry_and_holds_its_project_s_items() {
    let pool = seed("draft");
    let user_db = init_test_user_db().expect("user db");
    review(&pool, "high");
    let snap = build_snapshot(&pool, &user_db).unwrap();
    let m = entry(&snap, "mandate:c1");
    assert_eq!(m.item_kind, "mandate");
    assert_eq!((m.lane, m.clause), (Lane::Sign, LaneClause::None));
    assert_eq!(m.coalesce_key, "c1:sign:none");
    assert_eq!(entry(&snap, "idea:idea-1").lane, Lane::Held);
    let c = &snap.charters[0];
    assert_eq!(c.status, "draft");
    assert_eq!(c.held, 2, "the idea and the review are held on the draft");
}

#[test]
fn goals_awaiting_acceptance_are_accept_entries() {
    let pool = seed("active");
    let user_db = init_test_user_db().expect("user db");
    pool.conn("lanes test")
        .unwrap()
        .execute(
            "INSERT INTO dev_goals (id, project_id, title, status, created_at, updated_at)
             VALUES ('g-1','proj','Ship it','awaiting_acceptance',datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
    let snap = build_snapshot(&pool, &user_db).unwrap();
    let g = entry(&snap, "goal:g-1");
    assert_eq!(g.item_kind, "goal");
    assert_eq!((g.lane, g.clause), (Lane::Accept, LaneClause::None));
    assert_eq!(g.charter_id.as_deref(), Some("c1"));
}

#[test]
fn no_mandate_makes_orphans_per_project() {
    let pool = seed("retired");
    let user_db = init_test_user_db().expect("user db");
    let snap = build_snapshot(&pool, &user_db).unwrap();
    let i = entry(&snap, "idea:idea-1");
    assert_eq!(
        (i.lane, i.coalesce_key.as_str()),
        (Lane::Orphan, "orphan:proj")
    );
    assert!(snap.charters.is_empty());
}

#[test]
fn council_gate_matches_the_frontend_rule() {
    assert!(council_decidable(
        "ready",
        Some("major"),
        "use_case",
        Some("full")
    ));
    assert!(council_decidable("ready", None, "architecture", None));
    assert!(!council_decidable(
        "ready",
        Some("major"),
        "use_case",
        Some("lite")
    ));
    assert!(!council_decidable(
        "ready",
        Some("standard"),
        "use_case",
        Some("full")
    ));
    assert!(!council_decidable(
        "machine_pass",
        Some("major"),
        "use_case",
        Some("full")
    ));
    // Tether: the frontend's `decidable` still says exactly this.
    let ts = include_str!("../../../../src/features/companions/curator/council/councilRules.ts");
    assert!(ts.contains(
        "return subject.state === 'ready' && (subject.tier === 'major' || subject.kind === 'architecture');"
    ));
    assert!(ts.contains("return awaitsYou(subject) && subject.mode !== 'lite';"));
}
