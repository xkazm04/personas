//! Included from `scan_trust.rs` via `#[path]`.
use super::*;
use crate::repos::dev::ideas::{create_idea_deduped, get_idea_by_id, scan_dedup_key};
use crate::repos::dev::projects::create_project;

fn pool() -> DbPool {
    crate::init_test_db().expect("test db")
}

fn project(pool: &DbPool) -> String {
    create_project(pool, "Proj", "/tmp/proj", None, None, None, None, None)
        .unwrap()
        .id
}

/// A scan-sweep filing of `title` under `lens`, carrying a predicted verdict.
fn filed(pool: &DbPool, pid: &str, lens: &str, title: &str, predicted: &str) -> String {
    let key = scan_dedup_key(lens, None, title);
    let idea = create_idea_deduped(
        pool,
        pid,
        None,
        "scan_sweep",
        Some("technical"),
        title,
        None,
        None,
        Some(4),
        Some(8),
        Some(3),
        None,
        None,
        &key,
    )
    .unwrap()
    .expect("fresh row");
    let f = ScanFindingFields {
        lens: Some(lens.to_string()),
        size: Some("S".into()),
        predicted_verdict: Some(predicted.to_string()),
        ..Default::default()
    };
    record_scan_finding(pool, &idea.id, &f).unwrap();
    idea.id
}

/// A human verdict at a given instant (ordered, so the window is deterministic).
fn human(pool: &DbPool, id: &str, status: &str, at: &str) {
    crate::PoolExt::conn(pool, "test:scan_trust")
        .expect("conn")
        .execute(
            "UPDATE dev_ideas SET status = ?1, decided_by = 'Human', decided_at = ?2 WHERE id = ?3",
            params![status, at, id],
        )
        .unwrap();
}

fn at(i: usize) -> String {
    // Future-dated so every row is "after" any event appended during the test.
    format!("2999-01-01T00:00:{i:02}+00:00")
}

#[test]
fn the_contract_fields_round_trip_and_absent_stays_absent() {
    let pool = pool();
    let pid = project(&pool);
    let id = filed(&pool, &pid, "code-optimizer", "Slow list render", "accept");
    let idea = get_idea_by_id(&pool, &id).unwrap();
    assert_eq!(idea.lens.as_deref(), Some("code-optimizer"));
    assert_eq!(idea.predicted_verdict.as_deref(), Some("accept"));
    assert_eq!(idea.score, None, "unscored is None, never 0");
    assert_eq!(idea.band, "ranked");
    assert!(!idea.mvp);
    // The door normalised the native 1-10 scales once: 8 -> 4, 4 -> 2, 3 -> 2.
    assert_eq!(
        (idea.impact, idea.effort, idea.risk),
        (Some(4), Some(2), Some(2))
    );

    let f = ScanFindingFields {
        score: Some(40.5),
        score_parts: Some(r#"{"impact":8,"formula":"scan-score/1"}"#.into()),
        band: Some("reserve".into()),
        mvp: Some(true),
        mvp_rule: Some("top-score".into()),
        confidence: Some("medium".into()),
        ..Default::default()
    };
    record_scan_finding(&pool, &id, &f).unwrap();
    let idea = get_idea_by_id(&pool, &id).unwrap();
    assert_eq!(idea.score, Some(40.5));
    assert_eq!(idea.band, "reserve");
    assert!(idea.mvp);
    assert_eq!(
        idea.lens.as_deref(),
        Some("code-optimizer"),
        "absent keeps the stored value"
    );
}

#[test]
fn a_prediction_arriving_after_the_human_decided_is_not_recorded() {
    let pool = pool();
    let pid = project(&pool);
    let id = filed(&pool, &pid, "code-optimizer", "Thing", "accept");
    human(&pool, &id, "rejected", &at(1));
    let f = ScanFindingFields {
        predicted_verdict: Some("reject".into()),
        ..Default::default()
    };
    record_scan_finding(&pool, &id, &f).unwrap();
    assert_eq!(
        get_idea_by_id(&pool, &id)
            .unwrap()
            .predicted_verdict
            .as_deref(),
        Some("accept")
    );
}

#[test]
fn a_proof_maps_onto_verify_state_and_a_better_remeasured_not_better_is_reported() {
    let pool = pool();
    let pid = project(&pool);
    let id = filed(&pool, &pid, "code-optimizer", "Thing", "accept");
    let proof = |v: &str| ScanFindingFields {
        proof: Some(ProofReading {
            verdict: v.to_string(),
            json: format!(r#"{{"verdict":"{v}"}}"#),
        }),
        ..Default::default()
    };
    assert_eq!(
        record_scan_finding(&pool, &id, &proof("better")).unwrap(),
        ProofChange::None
    );
    let idea = get_idea_by_id(&pool, &id).unwrap();
    assert_eq!(idea.verify_state.as_deref(), Some("moved"));
    assert!(idea.verify_evidence.unwrap().contains("better"));
    assert_eq!(
        record_scan_finding(&pool, &id, &proof("not-better")).unwrap(),
        ProofChange::RemeasuredNotBetter
    );
    assert_eq!(
        get_idea_by_id(&pool, &id).unwrap().verify_state.as_deref(),
        Some("unchanged")
    );
    assert!(record_scan_finding(&pool, &id, &proof("maybe")).is_err());
}

#[test]
fn slices_ceilings_and_start_levels() {
    let pool = pool();
    let pid = project(&pool);
    let id = filed(&pool, &pid, "security-auditor", "Token in log", "accept");
    let idea = get_idea_by_id(&pool, &id).unwrap();
    let slice = slice_key(&idea);
    assert_eq!(slice, "technical|security-auditor|-|S");
    assert_eq!(ceiling_for_slice(&slice), 1);
    assert_eq!(
        start_for_slice(&slice),
        1,
        "technical starts at 2, capped at 1"
    );
    assert_eq!(start_for_slice("technical|code-optimizer|-|S"), 2);
    assert_eq!(start_for_slice("product|ux-reviewer|-|-"), 0);
    assert_eq!(ceiling_for_slice("product|monetization-advisor|money|-"), 1);
    assert_eq!(ceiling_for_slice("technical|-|-|-"), 3);
    assert_eq!(contract_category("user"), "product");
    assert_eq!(
        risk_class_for(Some("vault-credential-check")),
        Some("secret")
    );
    assert_eq!(risk_class_for(Some("unknown-lens")), None);
}

#[test]
fn a_legacy_row_takes_its_lens_from_the_dedup_key() {
    let pool = pool();
    let pid = project(&pool);
    let key = scan_dedup_key("code-optimizer", None, "Old one");
    let idea = create_idea_deduped(
        &pool,
        &pid,
        None,
        "scan_sweep",
        None,
        "Old one",
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
    assert_eq!(idea_lens(&idea).as_deref(), Some("code-optimizer"));
}

/// 20 agreeing human decisions promote; 19 do not; the event is appended once.
#[test]
fn twenty_agreeing_human_decisions_promote_one_level() {
    let pool = pool();
    let pid = project(&pool);
    let slice = "technical|code-optimizer|-|S";
    let mut last = String::new();
    for i in 0..19 {
        last = filed(
            &pool,
            &pid,
            "code-optimizer",
            &format!("Finding {i}"),
            "accept",
        );
        human(&pool, &last, "accepted", &at(i));
    }
    assert!(evaluate_promotion(&pool, &pid, slice, Some(&last))
        .unwrap()
        .is_none());
    let id = filed(&pool, &pid, "code-optimizer", "Finding 19", "accept");
    human(&pool, &id, "accepted", &at(19));
    let event = evaluate_promotion(&pool, &pid, slice, Some(&id))
        .unwrap()
        .expect("promoted");
    assert_eq!((event.from, event.to), (2, 3));
    assert_eq!(event.n, Some(20));
    assert_eq!(slice_level(&pool, &pid, slice).unwrap(), 3);
    // At the ceiling nothing further happens.
    assert!(evaluate_promotion(&pool, &pid, slice, None)
        .unwrap()
        .is_none());
}

#[test]
fn agreement_below_ninety_percent_does_not_promote() {
    let pool = pool();
    let pid = project(&pool);
    let slice = "technical|code-optimizer|-|S";
    for i in 0..20 {
        let id = filed(
            &pool,
            &pid,
            "code-optimizer",
            &format!("Finding {i}"),
            "accept",
        );
        // 3 of 20 disagree -> 0.85
        human(
            &pool,
            &id,
            if i < 3 { "rejected" } else { "accepted" },
            &at(i),
        );
    }
    assert!(evaluate_promotion(&pool, &pid, slice, None)
        .unwrap()
        .is_none());
    let report = trust_report(&pool, &pid, None).unwrap();
    let s = report.slices.iter().find(|s| s.slice == slice).unwrap();
    assert_eq!(s.n, 20);
    assert!((s.agreement.unwrap() - 0.85).abs() < 1e-9);
    assert_eq!(s.level, 2);
}

#[test]
fn a_demotion_drops_one_level_resets_the_window_and_floors_at_zero() {
    let pool = pool();
    let pid = project(&pool);
    let slice = "product|ux-reviewer|-|-";
    let e = demote_slice(&pool, &pid, slice, "reversal", None).unwrap();
    assert_eq!((e.from, e.to), (0, 0), "a 0 -> 0 event is the window reset");

    let slice = "technical|code-optimizer|-|S";
    let e = demote_slice(&pool, &pid, slice, "proof re-measured not-better", None).unwrap();
    assert_eq!((e.from, e.to), (2, 1));
    assert_eq!(slice_level(&pool, &pid, slice).unwrap(), 1);

    let report = trust_report(&pool, &pid, Some("technical|-|-|-")).unwrap();
    assert!(report
        .slices
        .iter()
        .any(|s| s.slice == "technical|-|-|-" && s.level == 2));
    assert_eq!(report.events.len(), 2);
    assert_eq!(report.events[0].reason, "proof re-measured not-better");
}

#[test]
fn decisions_list_newest_first_with_reason_and_lens_fallback() {
    let pool = pool();
    let pid = project(&pool);
    let a = filed(&pool, &pid, "code-optimizer", "A", "accept");
    let b = filed(&pool, &pid, "ux-reviewer", "B", "reject");
    // A legacy row: no lens column, lens only in its dedup key.
    let key = scan_dedup_key("code-optimizer", None, "Legacy");
    let c = create_idea_deduped(
        &pool,
        &pid,
        None,
        "scan_sweep",
        None,
        "Legacy",
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
    .unwrap()
    .id;
    let _undecided = filed(&pool, &pid, "code-optimizer", "Still pending", "accept");
    human(&pool, &a, "accepted", &at(1));
    human(&pool, &b, "rejected", &at(2));
    human(&pool, &c, "rejected", &at(3));
    crate::PoolExt::conn(&pool, "test:scan_trust")
        .expect("conn")
        .execute(
            "UPDATE dev_ideas SET rejection_reason = 'not worth it' WHERE id = ?1",
            params![c],
        )
        .unwrap();

    let all = list_scan_decisions(&pool, &pid, None, None, None).unwrap();
    let ids: Vec<&str> = all.decisions.iter().map(|d| d.idea_id.as_str()).collect();
    assert_eq!(ids, vec![c.as_str(), b.as_str(), a.as_str()]);
    assert_eq!(all.decisions[0].reason.as_deref(), Some("not worth it"));
    assert_eq!(all.decisions[0].verdict, "rejected");
    assert_eq!(all.decisions[2].verdict, "accepted");
    assert_eq!(all.decisions[0].decided_by.as_deref(), Some("Human"));

    let opt = list_scan_decisions(&pool, &pid, None, Some("code-optimizer"), None).unwrap();
    let ids: Vec<&str> = opt.decisions.iter().map(|d| d.idea_id.as_str()).collect();
    assert_eq!(
        ids,
        vec![c.as_str(), a.as_str()],
        "lens falls back to the dedup prefix"
    );
    assert_eq!(opt.decisions[0].lens.as_deref(), Some("code-optimizer"));

    let one = list_scan_decisions(&pool, &pid, None, None, Some(1)).unwrap();
    assert_eq!(one.decisions.len(), 1);

    let json = serde_json::to_value(&all).unwrap();
    let first = &json["decisions"][0];
    assert!(first.get("ideaId").is_some());
    assert!(first.get("contextId").is_none(), "absent keys are omitted");
}

#[test]
fn stamping_a_machine_decision_opens_a_veto_window_and_a_human_one_closes_it() {
    let pool = pool();
    let pid = project(&pool);
    let id = filed(&pool, &pid, "code-optimizer", "Thing", "accept");
    stamp_idea_decision(&pool, &id, MACHINE_SCAN_SWEEP).unwrap();
    let idea = get_idea_by_id(&pool, &id).unwrap();
    assert_eq!(idea.decided_by.as_deref(), Some(MACHINE_SCAN_SWEEP));
    assert!(idea.veto_until.unwrap() > idea.decided_at.unwrap());
    stamp_idea_decision(&pool, &id, "Human").unwrap();
    assert_eq!(get_idea_by_id(&pool, &id).unwrap().veto_until, None);
}
