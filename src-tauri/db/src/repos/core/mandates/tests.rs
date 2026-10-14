//! Tests for the mandate envelope doors and the act log.

use super::*;
use crate::init_test_db;
use crate::models::CharterActFilter;

fn seed(pool: &DbPool) {
    let conn = pool.conn("mandates test").unwrap();
    conn.execute_batch(
        "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
            VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'));
         INSERT INTO dev_projects (id, name, root_path)
            VALUES ('proj','Proj','/tmp/mandates-proj');",
    )
    .unwrap();
}

fn charter(pool: &DbPool, id: &str, status: &str, domain: &str) {
    pool.conn("mandates test")
        .unwrap()
        .execute(
            "INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, source,
                 budget_monthly_usd, created_at, updated_at)
             VALUES (?1, 'steward', 'App master for proj', ?3, 2, ?2, 'proj', 'kp-hire',
                     5.0, datetime('now'), datetime('now'))",
            params![id, status, domain],
        )
        .unwrap();
}

fn decision(charter_id: &str, item: &str, reversible: bool) -> NewCharterAct {
    NewCharterAct {
        charter_id: charter_id.into(),
        item_kind: "idea".into(),
        item_id: item.into(),
        verdict: "accepted".into(),
        actor: CharterActor::Steward,
        scope: Some(DecideScope::IdeaAccept),
        reversible,
        cost_usd: Some(0.02),
        shown_json: Some(r#"{"title":"Fix it"}"#.into()),
        origin_device: None,
    }
}

fn sign_input() -> MandateSignInput {
    MandateSignInput {
        decide_scopes: vec![
            DecideScope::ReportRead,
            DecideScope::IdeaAccept,
            DecideScope::ReportRead,
        ],
        merge_policy: MergePolicy::Never,
        budget_monthly_usd: Some(20.0),
    }
}

fn filter() -> CharterActFilter {
    CharterActFilter::default()
}

#[test]
fn signing_a_draft_activates_it_and_records_before_and_after() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "draft", MANDATE_DOMAIN);

    let act = sign(&pool, "c1", &sign_input(), None).unwrap();
    assert_eq!(act.envelope_version, 1);
    assert_eq!(act.item_kind, ACT_KIND_MANDATE);
    assert_eq!(act.item_id, "c1");
    assert_eq!(act.actor, CharterActor::Operator);
    assert!(act.reversible);
    assert!(act.shown_json.is_some(), "what was signed is recorded");
    let change = act.env_change.expect("an envelope act carries its change");
    assert_eq!(change.op, EnvelopeOp::Sign);
    assert_eq!(change.before.status, "draft");
    assert!(change.before.decide_scopes.is_empty());
    assert_eq!(change.after.status, "active");
    assert_eq!(
        change.after.decide_scopes,
        vec![DecideScope::IdeaAccept, DecideScope::ReportRead],
        "deduplicated, canonical order"
    );

    let m = get(&pool, "c1").unwrap().unwrap();
    assert_eq!(m.status, "active");
    assert_eq!(m.envelope.envelope_version, 1);
    assert_eq!(m.envelope.budget_monthly_usd, Some(20.0));
    assert_eq!(m.project_name.as_deref(), Some("Proj"));
    assert_eq!(m.steward_name.as_deref(), Some("Steward"));
    assert_eq!(m.load.acts_count, Some(1));
    assert_eq!(m.load.budget_usd, Some(20.0));
    assert_eq!(m.load.spend_used_usd, Some(0.0));
    assert_eq!(m.load.open_asks, Some(0));
    assert_eq!(list(&pool).unwrap().len(), 1);
}

#[test]
fn a_charter_with_default_columns_reads_as_an_unsigned_empty_envelope() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);
    let env = get_envelope(&pool, "c1").unwrap().unwrap();
    assert_eq!(
        env,
        MandateEnvelope {
            decide_scopes: vec![],
            merge_policy: MergePolicy::Never,
            budget_monthly_usd: Some(5.0),
            envelope_version: 0,
            kept_at_acts: None,
        }
    );
    assert!(!env.is_signed());
    assert_eq!(get_envelope(&pool, "missing").unwrap(), None);
}

#[test]
fn an_unknown_stored_scope_is_dropped_never_delegated() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);
    pool.conn("mandates test")
        .unwrap()
        .execute(
            "UPDATE persona_responsibilities
             SET decide_scopes = '[\"merge.anything\",\"dispatch\"]' WHERE id = 'c1'",
            [],
        )
        .unwrap();
    let env = get_envelope(&pool, "c1").unwrap().unwrap();
    assert_eq!(env.decide_scopes, vec![DecideScope::Dispatch]);
}

#[test]
fn a_draft_cannot_be_signed_active_beside_another_active_mandate() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c_old", "active", MANDATE_DOMAIN);
    charter(&pool, "c_new", "draft", MANDATE_DOMAIN);
    assert!(matches!(
        sign(&pool, "c_new", &sign_input(), None),
        Err(AppError::Validation(_))
    ));
    assert_eq!(
        get_envelope(&pool, "c_new")
            .unwrap()
            .unwrap()
            .envelope_version,
        0
    );
    // A non-mandate charter is refused outright.
    charter(&pool, "c_docs", "active", "docs");
    assert!(matches!(
        sign(&pool, "c_docs", &sign_input(), None),
        Err(AppError::Validation(_))
    ));
    assert!(matches!(get(&pool, "c_docs"), Err(AppError::Validation(_))));
    assert!(matches!(
        sign(&pool, "nope", &sign_input(), None),
        Err(AppError::NotFound(_))
    ));
    let mut bad = sign_input();
    bad.budget_monthly_usd = Some(f64::NAN);
    assert!(sign(&pool, "c_old", &bad, None).is_err());
}

#[test]
fn every_amendment_bumps_the_version_and_writes_an_act() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);

    let unsigned = amend(
        &pool,
        "c1",
        &MandateChange::WidenScope {
            scopes: vec![DecideScope::Dispatch],
        },
        None,
    );
    assert!(
        matches!(unsigned, Err(AppError::Validation(_))),
        "sign first"
    );

    sign(&pool, "c1", &sign_input(), None).unwrap();
    let changes = [
        MandateChange::WidenScope {
            scopes: vec![DecideScope::Dispatch],
        },
        MandateChange::NarrowScope {
            scopes: vec![DecideScope::ReportRead],
        },
        MandateChange::SetMergePolicy {
            policy: MergePolicy::GateGreen,
        },
        MandateChange::SetBudget { usd: None },
    ];
    for (i, c) in changes.iter().enumerate() {
        let act = amend(&pool, "c1", c, Some("peer-1")).unwrap();
        assert_eq!(act.envelope_version, 2 + i as i64);
        assert_eq!(act.origin_device.as_deref(), Some("peer-1"));
        let change = act.env_change.as_ref().unwrap();
        assert_eq!(change.op, EnvelopeOp::Amend);
        assert_eq!(change.change.as_ref(), Some(c));
    }
    let env = get_envelope(&pool, "c1").unwrap().unwrap();
    assert_eq!(env.envelope_version, 5);
    assert_eq!(
        env.decide_scopes,
        vec![DecideScope::IdeaAccept, DecideScope::Dispatch]
    );
    assert_eq!(env.merge_policy, MergePolicy::GateGreen);
    assert_eq!(env.budget_monthly_usd, None);
    assert_eq!(get(&pool, "c1").unwrap().unwrap().load.acts_count, Some(5));

    // A change that changes nothing is refused, not logged.
    assert!(amend(
        &pool,
        "c1",
        &MandateChange::SetMergePolicy {
            policy: MergePolicy::GateGreen
        },
        None
    )
    .is_err());
    assert!(amend(
        &pool,
        "c1",
        &MandateChange::WidenScope {
            scopes: vec![DecideScope::Dispatch]
        },
        None
    )
    .is_err());
    assert!(amend(
        &pool,
        "c1",
        &MandateChange::SetBudget { usd: Some(-1.0) },
        None
    )
    .is_err());
    assert_eq!(
        get_envelope(&pool, "c1").unwrap().unwrap().envelope_version,
        5
    );
    assert_eq!(get(&pool, "c1").unwrap().unwrap().load.acts_count, Some(5));
}

#[test]
fn suspend_and_resume_move_status_not_version() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);
    sign(&pool, "c1", &sign_input(), None).unwrap();

    let s = suspend(&pool, "c1", None).unwrap();
    assert_eq!(s.verdict, "suspended");
    assert_eq!(s.envelope_version, 1);
    assert_eq!(get(&pool, "c1").unwrap().unwrap().status, "suspended");
    assert!(suspend(&pool, "c1", None).is_err(), "already suspended");

    // Another mandate took the project while this one was suspended.
    charter(&pool, "c2", "active", MANDATE_DOMAIN);
    assert!(matches!(
        resume(&pool, "c1", None),
        Err(AppError::Validation(_))
    ));
    pool.conn("mandates test")
        .unwrap()
        .execute(
            "UPDATE persona_responsibilities SET status = 'retired' WHERE id = 'c2'",
            [],
        )
        .unwrap();
    let r = resume(&pool, "c1", None).unwrap();
    assert_eq!(r.verdict, "resumed");
    assert_eq!(get(&pool, "c1").unwrap().unwrap().status, "active");
    assert_eq!(
        get_envelope(&pool, "c1").unwrap().unwrap().envelope_version,
        1
    );
    assert!(resume(&pool, "c1", None).is_err(), "already active");
    // A retired mandate is out of every door.
    assert!(sign(&pool, "c2", &sign_input(), None).is_err());
    assert_eq!(
        list(&pool).unwrap().len(),
        1,
        "retired mandates are not listed"
    );
}

#[test]
fn decision_acts_append_list_and_revert() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);
    sign(&pool, "c1", &sign_input(), None).unwrap();

    let a = charter_acts::append(&pool, &decision("c1", "idea-1", true)).unwrap();
    assert_eq!(
        a.envelope_version, 1,
        "stamped from the charter, not the caller"
    );
    assert_eq!(a.scope.as_deref(), Some("idea.accept"));
    assert_eq!(a.cost_usd, Some(0.02));
    assert!(a.env_change.is_none());
    let b = charter_acts::append(&pool, &decision("c1", "idea-2", false)).unwrap();
    let mut router = decision("c1", "rev-1", true);
    router.actor = CharterActor::Router;
    router.item_kind = "review".into();
    charter_acts::append(&pool, &router).unwrap();
    assert!(matches!(
        charter_acts::append(&pool, &decision("ghost", "x", true)),
        Err(AppError::NotFound(_))
    ));
    let mut bad = decision("c1", "x", true);
    bad.shown_json = Some("{not json".into());
    assert!(charter_acts::append(&pool, &bad).is_err());

    let all = charter_acts::list(
        &pool,
        &CharterActFilter {
            charter_id: Some("c1".into()),
            ..filter()
        },
    )
    .unwrap();
    assert_eq!(all.len(), 4, "sign + three decisions");
    let by_actor = charter_acts::list(
        &pool,
        &CharterActFilter {
            actor: Some(CharterActor::Router),
            ..filter()
        },
    )
    .unwrap();
    assert_eq!(by_actor.len(), 1);
    let irreversible = charter_acts::list(
        &pool,
        &CharterActFilter {
            reversible: Some(false),
            ..filter()
        },
    )
    .unwrap();
    assert_eq!(
        irreversible
            .iter()
            .map(|x| x.id.as_str())
            .collect::<Vec<_>>(),
        vec![b.id.as_str()]
    );
    let by_item = charter_acts::list(
        &pool,
        &CharterActFilter {
            item_kind: Some("idea".into()),
            item_id: Some("idea-1".into()),
            ..filter()
        },
    )
    .unwrap();
    assert_eq!(by_item.len(), 1);

    // Reverting a decision records the revert and stamps the original.
    let rv = revert(&pool, &a.id, None).unwrap();
    assert_eq!(rv.item_kind, ACT_KIND_REVERT);
    assert_eq!(rv.item_id, a.id);
    assert_eq!(rv.actor, CharterActor::Operator);
    assert!(!rv.reversible);
    let a2 = charter_acts::get(&pool, &a.id).unwrap().unwrap();
    assert!(a2.reverted_at.is_some());
    assert_eq!(a2.revert_act_id.as_deref(), Some(rv.id.as_str()));
    let reverted = charter_acts::list(
        &pool,
        &CharterActFilter {
            reverted: Some(true),
            ..filter()
        },
    )
    .unwrap();
    assert_eq!(reverted.len(), 1);
    let standing = charter_acts::list(
        &pool,
        &CharterActFilter {
            reverted: Some(false),
            ..filter()
        },
    )
    .unwrap();
    assert_eq!(standing.len(), 4, "sign + b + router + the revert act");

    assert!(matches!(
        revert(&pool, &a.id, None),
        Err(CharterActRevertError::Refused(
            CharterActRevertRefusal::AlreadyReverted { .. }
        ))
    ));
    assert!(matches!(
        revert(&pool, &b.id, None),
        Err(CharterActRevertError::Refused(
            CharterActRevertRefusal::Irreversible { .. }
        ))
    ));
    assert!(
        matches!(
            revert(&pool, &rv.id, None),
            Err(CharterActRevertError::Refused(
                CharterActRevertRefusal::Irreversible { .. }
            ))
        ),
        "a revert is not itself revertible"
    );
    assert!(matches!(
        revert(&pool, "act_missing", None),
        Err(CharterActRevertError::Refused(
            CharterActRevertRefusal::NotFound { .. }
        ))
    ));
    // The irreversible refusal reaches the IPC boundary as Forbidden, and the
    // irreversible act is untouched.
    let boundary: AppError = revert(&pool, &b.id, None).unwrap_err().into();
    assert!(matches!(boundary, AppError::Forbidden(_)), "{boundary:?}");
    assert!(charter_acts::get(&pool, &b.id)
        .unwrap()
        .unwrap()
        .reverted_at
        .is_none());
}

#[test]
fn reverting_an_envelope_act_restores_it_unless_superseded() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);
    sign(&pool, "c1", &sign_input(), None).unwrap();
    let widen = amend(
        &pool,
        "c1",
        &MandateChange::WidenScope {
            scopes: vec![DecideScope::Dispatch],
        },
        None,
    )
    .unwrap();
    let policy = amend(
        &pool,
        "c1",
        &MandateChange::SetMergePolicy {
            policy: MergePolicy::GateGreen,
        },
        None,
    )
    .unwrap();

    // The widen was superseded by the policy change.
    assert!(matches!(
        revert(&pool, &widen.id, None),
        Err(CharterActRevertError::Refused(
            CharterActRevertRefusal::Superseded { .. }
        ))
    ));
    // The newest one restores, and bumps the version.
    let rv = revert(&pool, &policy.id, None).unwrap();
    assert_eq!(rv.envelope_version, 4);
    assert_eq!(rv.env_change.as_ref().unwrap().op, EnvelopeOp::Revert);
    let env = get_envelope(&pool, "c1").unwrap().unwrap();
    assert_eq!(env.merge_policy, MergePolicy::Never);
    assert!(env.decide_scopes.contains(&DecideScope::Dispatch));
    assert_eq!(env.envelope_version, 4);
    // Now the widen is the envelope again, so it can be reverted too.
    revert(&pool, &widen.id, None).unwrap();
    assert!(!get_envelope(&pool, "c1")
        .unwrap()
        .unwrap()
        .decide_scopes
        .contains(&DecideScope::Dispatch));

    // Reverting a suspend resumes without bumping the envelope.
    let s = suspend(&pool, "c1", None).unwrap();
    let before = get_envelope(&pool, "c1").unwrap().unwrap().envelope_version;
    revert(&pool, &s.id, None).unwrap();
    let m = get(&pool, "c1").unwrap().unwrap();
    assert_eq!(m.status, "active");
    assert_eq!(m.envelope.envelope_version, before);
}

#[test]
fn open_asks_count_only_this_projects_pending_app_master_asks() {
    let pool = init_test_db().unwrap();
    seed(&pool);
    charter(&pool, "c1", "active", MANDATE_DOMAIN);
    {
        let conn = pool.conn("mandates test").unwrap();
        for (id, status, ctx) in [
            (
                "r1",
                "pending",
                r#"{"source":"app_master_ask","projectId":"proj"}"#,
            ),
            ("r2", "pending", r#"{"source":"app_master_ask"}"#),
            (
                "r3",
                "pending",
                r#"{"source":"app_master_ask","projectId":"other"}"#,
            ),
            (
                "r4",
                "approved",
                r#"{"source":"app_master_ask","projectId":"proj"}"#,
            ),
            ("r5", "pending", r#"{"source":"director"}"#),
            ("r6", "pending", "not json"),
        ] {
            conn.execute(
                "INSERT INTO persona_manual_reviews
                    (id, persona_id, title, context_data, status, created_at, updated_at)
                 VALUES (?1, 'steward', 't', ?3, ?2, datetime('now'), datetime('now'))",
                params![id, status, ctx],
            )
            .unwrap();
        }
    }
    assert_eq!(get(&pool, "c1").unwrap().unwrap().load.open_asks, Some(2));
}
