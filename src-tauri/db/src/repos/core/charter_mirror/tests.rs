//! Tests for the mandate mirror store: idempotent apply, the home rule, the
//! one-way revert transition, retention, and unpairing.

use super::*;
use crate::init_test_db;
use crate::models::{
    CharterActor, MandateSignInput, MergePolicy, NewCharterAct, MIRROR_ACTS_PER_JOB,
};
use crate::repos::core::{charter_acts, mandates};
use crate::repos::resources::owned_devices;

const HOME: &str = "home-peer";

/// A home DB holding one signed charter `c1`, and its summary.
fn home_with_charter() -> (DbPool, MandateSummary) {
    let pool = init_test_db().unwrap();
    {
        let conn = pool.conn("mirror test").unwrap();
        conn.execute_batch(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
             INSERT INTO dev_projects (id, name, root_path)
                VALUES ('proj','Proj','/tmp/mirror-proj');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, source,
                 budget_monthly_usd, created_at, updated_at)
             VALUES ('c1', 'steward', 'App master for proj', 'software_engineering', 2, 'draft',
                     'proj', 'kp-hire', 5.0, datetime('now'), datetime('now'));",
        )
        .unwrap();
    }
    mandates::sign(
        &pool,
        "c1",
        &MandateSignInput {
            decide_scopes: vec![],
            merge_policy: MergePolicy::Never,
            budget_monthly_usd: Some(20.0),
        },
        None,
    )
    .unwrap();
    let summary = mandates::get(&pool, "c1").unwrap().unwrap();
    (pool, summary)
}

fn peer() -> DbPool {
    let pool = init_test_db().unwrap();
    owned_devices::register_owned_device(&pool, HOME, "group", "Desk").unwrap();
    pool
}

fn payload(home: &DbPool, sent_at_ms: f64) -> CharterMirrorPayload {
    CharterMirrorPayload {
        charter: mandates::get(home, "c1").unwrap().unwrap(),
        acts: charter_acts::list(
            home,
            &CharterActFilter {
                charter_id: Some("c1".into()),
                limit: Some(MIRROR_ACTS_PER_JOB as u32),
                ..Default::default()
            },
        )
        .unwrap(),
        sent_at_ms,
    }
}

fn steward_act(home: &DbPool, item: &str) -> CharterAct {
    charter_acts::append(
        home,
        &NewCharterAct {
            charter_id: "c1".into(),
            item_kind: "report".into(),
            item_id: item.into(),
            verdict: "read".into(),
            actor: CharterActor::Steward,
            scope: None,
            reversible: true,
            cost_usd: None,
            shown_json: None,
            origin_device: None,
        },
    )
    .unwrap()
}

#[test]
fn a_mirror_is_stored_marked_and_a_redelivery_is_a_no_op() {
    let (home, _) = home_with_charter();
    let peer = peer();
    let p = payload(&home, 1000.0);

    let first = apply(&peer, HOME, "Desk", &p).unwrap();
    assert!(first.summary_updated);
    assert_eq!(first.new_acts.len(), 1, "the sign act");

    let again = apply(&peer, HOME, "Desk", &p).unwrap();
    assert!(!again.changed(), "re-delivery changes nothing: {again:?}");

    let listed = list(&peer).unwrap();
    assert_eq!(listed.len(), 1);
    let mirror = listed[0].mirror.as_ref().expect("marked as mirrored");
    assert_eq!(mirror.home_peer_id, HOME);
    assert_eq!(mirror.home_name, "Desk");
    assert_eq!(listed[0].envelope.envelope_version, 1);
    assert_eq!(
        list_acts(&peer, &CharterActFilter::default())
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn a_mirror_never_enters_the_peers_own_charter_tables() {
    let (home, _) = home_with_charter();
    let peer = peer();
    apply(&peer, HOME, "Desk", &payload(&home, 1000.0)).unwrap();
    // The router, the sweep and the re-read read these; a mirrored mandate
    // must stay invisible to them.
    assert!(mandates::list(&peer).unwrap().is_empty());
    assert!(mandates::get(&peer, "c1").unwrap().is_none());
    assert!(charter_acts::list(&peer, &CharterActFilter::default())
        .unwrap()
        .is_empty());
}

#[test]
fn latest_send_wins_and_an_older_snapshot_changes_nothing() {
    let (home, _) = home_with_charter();
    let peer = peer();
    apply(&peer, HOME, "Desk", &payload(&home, 1000.0)).unwrap();
    mandates::suspend(&home, "c1", None).unwrap();
    let newer = payload(&home, 2000.0);
    let applied = apply(&peer, HOME, "Desk", &newer).unwrap();
    assert!(applied.summary_updated);
    assert_eq!(applied.new_acts.len(), 1, "only the suspend act is new");
    assert_eq!(get(&peer, "c1").unwrap().unwrap().status, "suspended");

    // An older snapshot arriving late (out of order) does not roll it back.
    let mut stale = newer.clone();
    stale.sent_at_ms = 1500.0;
    stale.charter.status = "active".into();
    assert!(!apply(&peer, HOME, "Desk", &stale).unwrap().summary_updated);
    assert_eq!(get(&peer, "c1").unwrap().unwrap().status, "suspended");
}

#[test]
fn an_act_moves_only_from_standing_to_reverted() {
    let (home, _) = home_with_charter();
    let peer = peer();
    let act = steward_act(&home, "r1");
    apply(&peer, HOME, "Desk", &payload(&home, 1000.0)).unwrap();
    mandates::revert(&home, &act.id, None).unwrap();
    let applied = apply(&peer, HOME, "Desk", &payload(&home, 2000.0)).unwrap();
    assert_eq!(applied.newly_reverted, 1);
    assert_eq!(applied.new_acts.len(), 1, "the revert act itself");
    let stored = get_act(&peer, &act.id).unwrap().unwrap();
    assert!(stored.reverted_at.is_some());

    // A replay of the pre-revert snapshot cannot un-revert it.
    let mut old = payload(&home, 3000.0);
    for a in &mut old.acts {
        a.reverted_at = None;
    }
    apply(&peer, HOME, "Desk", &old).unwrap();
    assert!(get_act(&peer, &act.id)
        .unwrap()
        .unwrap()
        .reverted_at
        .is_some());
}

#[test]
fn the_home_device_refuses_a_mirror_of_its_own_charter() {
    let (home, _) = home_with_charter();
    let echoed = payload(&home, 1000.0);
    owned_devices::register_owned_device(&home, "other", "group", "Laptop").unwrap();
    let err = apply(&home, "other", "Laptop", &echoed).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
}

#[test]
fn a_second_device_cannot_claim_a_mirrored_charter() {
    let (home, _) = home_with_charter();
    let peer = peer();
    owned_devices::register_owned_device(&peer, "imposter", "group", "Other").unwrap();
    apply(&peer, HOME, "Desk", &payload(&home, 1000.0)).unwrap();
    let err = apply(&peer, "imposter", "Other", &payload(&home, 2000.0)).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    assert_eq!(home_of(&peer, "c1").unwrap().unwrap().home_peer_id, HOME);
}

#[test]
fn a_stray_act_is_refused_before_anything_is_written() {
    let (home, _) = home_with_charter();
    let peer = peer();
    let mut p = payload(&home, 1000.0);
    p.acts[0].charter_id = "someone-else".into();
    assert!(apply(&peer, HOME, "Desk", &p).is_err());
    assert!(get(&peer, "c1").unwrap().is_none());
}

#[test]
fn unpairing_the_home_withdraws_its_mirror() {
    let (home, _) = home_with_charter();
    let peer = peer();
    apply(&peer, HOME, "Desk", &payload(&home, 1000.0)).unwrap();
    owned_devices::forget_owned_device(&peer, HOME).unwrap();
    assert!(list(&peer).unwrap().is_empty());
    assert!(get(&peer, "c1").unwrap().is_none());
    assert!(list_acts(&peer, &CharterActFilter::default())
        .unwrap()
        .is_empty());
}

#[test]
fn a_retired_mandate_is_a_tombstone_the_list_leaves_out() {
    let (home, _) = home_with_charter();
    let peer = peer();
    let mut p = payload(&home, 1000.0);
    p.charter.status = "retired".into();
    apply(&peer, HOME, "Desk", &p).unwrap();
    assert!(list(&peer).unwrap().is_empty());
    assert_eq!(get(&peer, "c1").unwrap().unwrap().status, "retired");
}

#[test]
fn the_act_filter_matches_the_home_semantics() {
    let (home, _) = home_with_charter();
    let peer = peer();
    steward_act(&home, "r1");
    apply(&peer, HOME, "Desk", &payload(&home, 1000.0)).unwrap();
    let steward = list_acts(
        &peer,
        &CharterActFilter {
            actor: Some(CharterActor::Steward),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(steward.len(), 1);
    assert_eq!(steward[0].item_id, "r1");
    let one = list_acts(
        &peer,
        &CharterActFilter {
            limit: Some(1),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(one.len(), 1);
}
