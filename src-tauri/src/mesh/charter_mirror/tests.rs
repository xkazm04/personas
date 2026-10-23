//! WP9 acceptance, below the wire: the home builds a mirror after every act
//! and envelope change, the peer stores it idempotently and never writes it,
//! a mirror queued while the peer was offline lands correctly later, and a
//! verdict decided on the peer is applied at home and mirrors back.

use super::*;
use crate::db::models::{
    CharterActor, MandateChange, MandateSignInput, MergePolicy, NewCharterAct, RemoteJobDirection,
};
use crate::db::{init_test_db, init_test_user_db, PoolExt};

const HOME_PEER: &str = "home-peer";
const PEER_NAME: &str = "Laptop";

fn home() -> DbPool {
    let pool = init_test_db().expect("home db");
    pool.conn("charter mirror test")
        .unwrap()
        .execute_batch(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
             INSERT INTO dev_projects (id, name, root_path)
                VALUES ('proj','Proj','/tmp/wp9-proj');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, source,
                 budget_monthly_usd, created_at, updated_at)
             VALUES ('c1', 'steward', 'App master for proj', 'software_engineering', 2, 'draft',
                     'proj', 'kp-hire', 5.0, datetime('now'), datetime('now'));",
        )
        .unwrap();
    pool
}

fn peer() -> DbPool {
    let pool = init_test_db().expect("peer db");
    owned_devices::register_owned_device(&pool, HOME_PEER, "group", "Desk").unwrap();
    pool
}

fn sign(home: &DbPool) -> CharterAct {
    mandates::sign(
        home,
        "c1",
        &MandateSignInput {
            decide_scopes: vec![],
            merge_policy: MergePolicy::Never,
            budget_monthly_usd: Some(20.0),
        },
        None,
    )
    .unwrap()
}

fn snap(home: &DbPool, at: f64) -> CharterMirrorPayload {
    let user_db = init_test_user_db().expect("user db");
    snapshot(home, &user_db, "c1", at)
        .unwrap()
        .expect("home builds a mirror of its own charter")
}

fn deliver(peer: &DbPool, payload: &CharterMirrorPayload) -> store::MirrorApplied {
    store::apply(peer, HOME_PEER, "Desk", payload).unwrap()
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
fn every_recorded_act_marks_its_charter_for_the_mirror() {
    note_act("wp9-dirty-probe");
    assert!(pump().dirty.lock().unwrap().contains("wp9-dirty-probe"));
}

#[test]
fn an_act_and_an_envelope_change_each_reach_the_next_mirror() {
    let home = home();
    let signed = sign(&home);
    let first = snap(&home, 1.0);
    assert_eq!(first.charter.envelope.envelope_version, 1);
    assert!(first.acts.iter().any(|a| a.id == signed.id));

    let amended = mandates::amend(
        &home,
        "c1",
        &MandateChange::SetBudget { usd: Some(40.0) },
        None,
    )
    .unwrap();
    let decided = steward_act(&home, "r1");
    let second = snap(&home, 2.0);
    assert_eq!(
        second.charter.envelope.envelope_version, 2,
        "the envelope change"
    );
    assert_eq!(second.charter.envelope.budget_monthly_usd, Some(40.0));
    for id in [&signed.id, &amended.id, &decided.id] {
        assert!(
            second.acts.iter().any(|a| &a.id == id),
            "act {id} rides along"
        );
    }
    assert!(
        second.charter.mirror.is_none(),
        "the home's own view is unmarked"
    );
}

#[test]
fn a_device_builds_no_mirror_of_a_charter_it_is_not_home_for() {
    let peer = peer();
    let user_db = init_test_user_db().unwrap();
    assert!(snapshot(&peer, &user_db, "c1", 1.0).unwrap().is_none());
}

#[test]
fn the_peer_applies_a_mirror_once_and_never_writes_it() {
    let home = home();
    sign(&home);
    let peer = peer();
    let p = snap(&home, 1.0);
    assert!(deliver(&peer, &p).changed());
    assert!(!deliver(&peer, &p).changed(), "re-delivery is a no-op");

    // The peer's own doors cannot reach a mirrored charter...
    let sign_here = mandates::sign(&peer, "c1", &MandateSignInput::default(), None);
    assert!(
        matches!(sign_here, Err(AppError::NotFound(_))),
        "{sign_here:?}"
    );
    assert!(mandates::suspend(&peer, "c1", None).is_err());
    // ...and the door gate sends the verdict home instead.
    let (home_of, seen) = home_route(&peer, "c1").unwrap().expect("routed home");
    assert_eq!(home_of.home_peer_id, HOME_PEER);
    assert_eq!(seen, 1);
    assert!(
        home_route(&home, "c1").unwrap().is_none(),
        "the home runs its doors itself"
    );
    // Nothing the peer's router reads holds it.
    assert!(mandates::list(&peer).unwrap().is_empty());
}

#[test]
fn a_mirror_is_refused_by_its_home_and_a_verdict_by_everyone_else() {
    let home = home();
    sign(&home);
    let peer = peer();
    let mirror = serde_json::to_string(&snap(&home, 1.0)).unwrap();
    let verdict = serde_json::to_string(&CharterVerdictPayload {
        charter_id: "c1".into(),
        verdict: CharterVerdict::Suspend,
        seen_envelope_version: 1,
    })
    .unwrap();
    assert!(matches!(
        admission(&home, REMOTE_JOB_KIND_CHARTER_MIRROR, &mirror).unwrap(),
        Admission::Refuse(_)
    ));
    assert_eq!(
        admission(&peer, REMOTE_JOB_KIND_CHARTER_MIRROR, &mirror).unwrap(),
        Admission::Accept
    );
    assert_eq!(
        admission(&home, REMOTE_JOB_KIND_CHARTER_VERDICT, &verdict).unwrap(),
        Admission::Accept
    );
    assert!(matches!(
        admission(&peer, REMOTE_JOB_KIND_CHARTER_VERDICT, &verdict).unwrap(),
        Admission::Refuse(_)
    ));
}

#[test]
fn mirrors_queued_while_the_peer_was_offline_land_in_any_order() {
    let home = home();
    sign(&home);
    let peer = peer();
    // The peer is offline: two mirrors wait in the home's outbox.
    let early = snap(&home, 1.0);
    let a = steward_act(&home, "r1");
    mandates::revert(&home, &a.id, None).unwrap();
    mandates::suspend(&home, "c1", None).unwrap();
    let late = snap(&home, 2.0);

    // Delivered newest first (a drained outbox racing a fresh send): the
    // older one changes nothing that matters.
    deliver(&peer, &late);
    deliver(&peer, &early);
    let mirrored = store::get(&peer, "c1").unwrap().unwrap();
    assert_eq!(mirrored.status, "suspended");
    let acts = store::list_acts(&peer, &CharterActFilter::default()).unwrap();
    assert_eq!(acts.len(), late.acts.len());
    assert!(acts
        .iter()
        .find(|x| x.id == a.id)
        .unwrap()
        .reverted_at
        .is_some());
}

#[test]
fn a_newer_mirror_cancels_the_queued_ones_it_covers() {
    let home = home();
    sign(&home);
    let early = snap(&home, 1.0);
    steward_act(&home, "r1");
    let late = snap(&home, 2.0);
    assert!(supersedes(&late, &early));
    assert!(
        !supersedes(&early, &late),
        "an older mirror covers nothing newer"
    );

    // The home's outbox, with the peer offline.
    owned_devices::register_owned_device(&home, "peer-x", "group", PEER_NAME).unwrap();
    let queue = |id: &str, p: &CharterMirrorPayload| {
        jobs_repo::create_outbound_with_payload(
            &home,
            id,
            "peer-x",
            PEER_NAME,
            REMOTE_JOB_KIND_CHARTER_MIRROR,
            "Mandate mirror: Proj",
            Some(&serde_json::to_string(p).unwrap()),
            RemoteJobStatus::Queued,
        )
        .unwrap()
    };
    queue("job-early", &early);
    queue("job-late", &late);
    assert_eq!(supersede_queued(&home, "peer-x", "job-late", &late), 1);
    let early_job = jobs_repo::get(&home, "job-early").unwrap().unwrap();
    assert_eq!(early_job.status, RemoteJobStatus::Cancelled);
    assert_eq!(early_job.direction, RemoteJobDirection::Outbound);
    let late_job = jobs_repo::get(&home, "job-late").unwrap().unwrap();
    assert_eq!(
        late_job.status,
        RemoteJobStatus::Queued,
        "the fresh one still goes"
    );
}

/// The home end of the wire, in process: applies what the peer sends and
/// answers with the receipt a real home would.
struct HomeInProcess {
    home: DbPool,
    last: Mutex<Option<(RemoteJob, String)>>,
}

#[async_trait::async_trait]
impl VerdictPort for HomeInProcess {
    async fn send(
        &self,
        _home: &str,
        payload: &CharterVerdictPayload,
    ) -> Result<RemoteJob, AppError> {
        let receipt = match apply_verdict(&self.home, PEER_NAME, payload) {
            Ok(act) => CharterVerdictReceipt {
                applied: true,
                outcome: Some(MandateActOutcome {
                    mandate: mandates::get(&self.home, &act.charter_id)?.unwrap(),
                    act,
                }),
                reason: None,
            },
            Err(e) => CharterVerdictReceipt {
                applied: false,
                outcome: None,
                reason: Some(refusal_for_peer(&e)),
            },
        };
        let job = RemoteJob {
            id: "verdict-job".into(),
            direction: RemoteJobDirection::Outbound,
            peer_id: HOME_PEER.into(),
            peer_display_name: "Desk".into(),
            kind: REMOTE_JOB_KIND_CHARTER_VERDICT.into(),
            instruction: format!("Mandate verdict: {}", payload.verdict.door()),
            status: if receipt.applied {
                RemoteJobStatus::Completed
            } else {
                RemoteJobStatus::Failed
            },
            summary: receipt.reason.clone(),
            refusal_reason: None,
            last_seq: 0,
            created_at: String::new(),
            updated_at: String::new(),
            completed_at: None,
            payload_json: Some(serde_json::to_string(payload)?),
            receipt: None,
            mesh_receipt: None,
        };
        *self.last.lock().unwrap() = Some((job.clone(), serde_json::to_string(&receipt)?));
        Ok(job)
    }
    fn reload(&self, _job_id: &str) -> Result<Option<RemoteJob>, AppError> {
        Ok(self.last.lock().unwrap().as_ref().map(|(j, _)| j.clone()))
    }
    fn receipt(&self, _job_id: &str) -> Result<Option<String>, AppError> {
        Ok(self.last.lock().unwrap().as_ref().map(|(_, r)| r.clone()))
    }
}

fn verdict(v: CharterVerdict, seen: i64) -> CharterVerdictPayload {
    CharterVerdictPayload {
        charter_id: "c1".into(),
        verdict: v,
        seen_envelope_version: seen,
    }
}

#[tokio::test]
async fn a_verdict_on_the_peer_is_applied_at_home_and_mirrors_back() {
    let home = home();
    sign(&home);
    let peer = peer();
    deliver(&peer, &snap(&home, 1.0));
    let (home_of, seen) = home_route(&peer, "c1").unwrap().unwrap();

    let port = HomeInProcess {
        home: home.clone(),
        last: Mutex::new(None),
    };
    let outcome = forward(
        &port,
        &home_of,
        verdict(CharterVerdict::Suspend, seen),
        VERDICT_WAIT,
    )
    .await
    .expect("applied at home");
    assert_eq!(outcome.mandate.status, "suspended");
    assert_eq!(
        outcome.mandate.mirror.as_ref().unwrap().home_peer_id,
        HOME_PEER
    );
    // The home recorded it, with the peer as the act's origin.
    let at_home = charter_acts::get(&home, &outcome.act.id).unwrap().unwrap();
    assert_eq!(at_home.origin_device.as_deref(), Some(PEER_NAME));
    assert_eq!(
        mandates::get(&home, "c1").unwrap().unwrap().status,
        "suspended"
    );
    // The peer wrote nothing of its own...
    assert!(charter_acts::list(&peer, &CharterActFilter::default())
        .unwrap()
        .is_empty());
    // ...and the act arrives with the next mirror, like any home act.
    deliver(&peer, &snap(&home, 2.0));
    assert_eq!(
        store::get(&peer, "c1").unwrap().unwrap().status,
        "suspended"
    );
    let mirrored = store::get_act(&peer, &outcome.act.id).unwrap().unwrap();
    assert_eq!(mirrored.origin_device.as_deref(), Some(PEER_NAME));
}

#[tokio::test]
async fn a_verdict_decided_on_a_stale_mirror_is_refused_at_home() {
    let home = home();
    sign(&home);
    let peer = peer();
    deliver(&peer, &snap(&home, 1.0));
    let (home_of, seen) = home_route(&peer, "c1").unwrap().unwrap();
    // The home moved on before the peer's verdict arrived.
    mandates::amend(
        &home,
        "c1",
        &MandateChange::SetBudget { usd: Some(9.0) },
        None,
    )
    .unwrap();

    let port = HomeInProcess {
        home: home.clone(),
        last: Mutex::new(None),
    };
    let err = forward(
        &port,
        &home_of,
        verdict(CharterVerdict::Suspend, seen),
        VERDICT_WAIT,
    )
    .await
    .unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    assert_eq!(
        mandates::get(&home, "c1").unwrap().unwrap().status,
        "active"
    );
}

#[test]
fn a_forwarded_revert_reaches_only_this_mandates_acts() {
    let home = home();
    sign(&home);
    let own = steward_act(&home, "r1");
    home.conn("charter mirror test")
        .unwrap()
        .execute_batch(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('proj2','Proj2','/tmp/wp9-proj2');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, source,
                 budget_monthly_usd, created_at, updated_at)
             VALUES ('c2', 'steward', 'App master for proj2', 'software_engineering', 2, 'draft',
                     'proj2', 'kp-hire', 5.0, datetime('now'), datetime('now'));",
        )
        .unwrap();
    let other = NewCharterAct {
        charter_id: "c2".into(),
        item_kind: "report".into(),
        item_id: "r2".into(),
        verdict: "read".into(),
        actor: CharterActor::Steward,
        scope: None,
        reversible: true,
        cost_usd: None,
        shown_json: None,
        origin_device: None,
    };
    let stranger = charter_acts::append(&home, &other).unwrap();
    let refused = apply_verdict(
        &home,
        PEER_NAME,
        &verdict(
            CharterVerdict::Revert {
                act_id: stranger.id.clone(),
            },
            1,
        ),
    );
    assert!(matches!(refused, Err(AppError::NotFound(_))), "{refused:?}");
    assert!(charter_acts::get(&home, &stranger.id)
        .unwrap()
        .unwrap()
        .reverted_at
        .is_none());
    let reverted = apply_verdict(
        &home,
        PEER_NAME,
        &verdict(
            CharterVerdict::Revert {
                act_id: own.id.clone(),
            },
            1,
        ),
    )
    .unwrap();
    assert_eq!(reverted.origin_device.as_deref(), Some(PEER_NAME));
    assert!(charter_acts::get(&home, &own.id)
        .unwrap()
        .unwrap()
        .reverted_at
        .is_some());
}

#[test]
fn a_mirrored_draft_joins_the_peers_sign_lane_and_holds_nothing() {
    use personas_engine::mandate_router::{DecisionLanesSnapshot, Lane};
    let home = home();
    let peer = peer();
    // A draft at home (never signed) mirrors to the peer.
    deliver(&peer, &snap(&home, 1.0));
    let mut lanes = DecisionLanesSnapshot {
        items: vec![],
        charters: vec![],
        failed_sources: vec![],
        generated_at: String::new(),
    };
    crate::engine::mandate_lanes::add_mirrored(&mut lanes, &store::list(&peer).unwrap());
    assert_eq!(lanes.items.len(), 1);
    assert_eq!(lanes.items[0].item_id, "mandate:c1");
    assert_eq!(lanes.items[0].lane, Lane::Sign);
    assert_eq!(lanes.charters.len(), 1);
    assert_eq!(
        lanes.charters[0].held, 0,
        "its items live on the home device"
    );

    // Signed at home: no Sign entry any more.
    sign(&home);
    deliver(&peer, &snap(&home, 2.0));
    let mut again = DecisionLanesSnapshot {
        items: vec![],
        charters: vec![],
        failed_sources: vec![],
        generated_at: String::new(),
    };
    crate::engine::mandate_lanes::add_mirrored(&mut again, &store::list(&peer).unwrap());
    assert!(again.items.is_empty());
}

/// Security close-out: a refused verdict's receipt carries the refusal on the
/// merits to the peer, never this device's internals (a database or pool
/// error names tables, paths and SQL).
#[test]
fn a_refused_verdict_tells_the_peer_why_on_the_merits_and_nothing_internal() {
    assert_eq!(
        refusal_for_peer(&AppError::Validation("The mandate changed.".into())),
        "The mandate changed."
    );
    assert_eq!(
        refusal_for_peer(&AppError::NotFound(
            "Act a1 is not an act of mandate c1".into()
        )),
        "Act a1 is not an act of mandate c1"
    );
    let internal = refusal_for_peer(&AppError::Internal(
        "no such column: decide_scopes in C:/Users/op/AppData/personas.db".into(),
    ));
    assert!(!internal.contains("decide_scopes"), "{internal}");
    assert!(!internal.contains("AppData"), "{internal}");

    // End to end: a keep whose reason is no re-read code is refused at home
    // and the peer reads the refusal, not an error dump.
    let home = home();
    sign(&home);
    let refused = apply_verdict(
        &home,
        PEER_NAME,
        &verdict(
            CharterVerdict::Keep {
                reason: "anything at all".into(),
            },
            1,
        ),
    )
    .unwrap_err();
    assert!(matches!(refused, AppError::Validation(_)), "{refused:?}");
    assert!(refusal_for_peer(&refused).contains("re-read"));
}
