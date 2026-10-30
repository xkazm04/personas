//! Both scan-finding/1 doors (Seam A1 HTTP filing, A2 memory outbox) and the
//! L1 gate. Included from `scan_contract.rs` via `#[path]`.
use super::*;
use crate::commands::infrastructure::app_master_writeback::{
    file_backlog_idea, file_rated_backlog_idea, FileIdeaInput,
};
use crate::db::repos::dev_tools as repo;
use personas_db::init_test_db;

fn project(pool: &DbPool, root: &str) -> String {
    repo::create_project(pool, "Scan", root, None, None, None, None, None)
        .expect("project")
        .id
}

/// A scan-sweep filing as B1 sends it: camelCase, native 1-10, unhalved.
fn sweep_body(pid: &str, title: &str, lens: &str, category: &str) -> serde_json::Value {
    serde_json::json!({
        "projectId": pid,
        "title": title,
        "description": "d",
        "origin": "scan_sweep",
        "lens": lens,
        "category": category,
        "effort": 4, "impact": 8, "risk": 3,
        "impactWhy": "main path",
        "confidence": "medium",
        "score": 40.5,
        "scoreParts": {"impact": 8, "confidence_w": 0.75, "effort_div": 1.333, "risk_factor": 0.9, "formula": "scan-score/1"},
        "band": "ranked",
        "mvp": true,
        "mvpRule": "top-score",
        "predictedVerdict": "accept",
        "predictedWhy": "precedent: accepted a similar fix",
        "predictedBy": "scan-sweep@3:opus",
        "size": "S",
        "lane": "C", "result": "unmeasurable", "method": "probe", "gate": "none",
        "disposition": "backlog",
        "sweepRunId": "run-1"
    })
}

fn input(v: serde_json::Value) -> FileIdeaInput {
    serde_json::from_value(v).expect("FileIdeaInput parses")
}

#[test]
fn the_http_door_keeps_every_contract_field_and_normalises_once() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-a1");
    let filed = file_rated_backlog_idea(
        &pool,
        &input(sweep_body(&pid, "Slow list", "code-optimizer", "technical")),
    )
    .unwrap();
    let idea = filed.idea;
    assert_eq!(idea.scan_type, "scan_sweep");
    assert_eq!(
        idea.lens.as_deref(),
        Some("code-optimizer"),
        "the lens is kept"
    );
    // 1-10 normalised ONCE: impact 8 -> 4, effort 4 -> 2, risk 3 -> 2 (no doubling).
    assert_eq!(
        (idea.impact, idea.effort, idea.risk),
        (Some(4), Some(2), Some(2))
    );
    assert_eq!(
        idea.score,
        Some(40.5),
        "the producer's score is stored as given"
    );
    assert!(idea.score_parts.unwrap().contains("scan-score/1"));
    assert_eq!(idea.confidence.as_deref(), Some("medium"));
    assert_eq!(idea.band, "ranked");
    assert!(idea.mvp);
    assert_eq!(idea.predicted_verdict.as_deref(), Some("accept"));
    assert_eq!(idea.size.as_deref(), Some("S"));
    assert!(idea.routing.unwrap().contains("\"lane\":\"C\""));
    assert!(!filed.auto_decided);
    assert_eq!(
        filed.level,
        Some(2),
        "level is reported on every scan_sweep filing"
    );
    let json = serde_json::to_value(
        file_backlog_idea(
            &pool,
            &input(sweep_body(&pid, "Slow list", "code-optimizer", "technical")),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(json["autoDecided"], false);
    assert_eq!(json["level"], 2);
}

#[test]
fn snake_case_aliases_are_accepted() {
    let v = serde_json::json!({
        "project_id": "p", "title": "t", "impact_why": "w", "score_parts": {"a": 1},
        "mvp_rule": "override", "mvp_why": "w", "predicted_verdict": "reject",
        "predicted_why": "w", "predicted_by": "b", "sweep_run_id": "r", "auto_decide": true
    });
    let i = input(v);
    assert_eq!(i.impact_why.as_deref(), Some("w"));
    assert_eq!(i.predicted_verdict.as_deref(), Some("reject"));
    assert_eq!(i.sweep_run_id.as_deref(), Some("r"));
    assert_eq!(i.auto_decide, Some(true));
    assert!(i.score_parts.is_some());
}

#[test]
fn product_is_stored_as_user_and_read_back_as_product() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-cat");
    let filed = file_backlog_idea(
        &pool,
        &input(sweep_body(
            &pid,
            "Onboarding copy",
            "copy-auditor",
            "product",
        )),
    )
    .unwrap();
    assert_eq!(filed.idea.category, "user");
    assert_eq!(trust::slice_key(&filed.idea), "product|copy-auditor|-|S");
    assert_eq!(filed.level, Some(0));
}

#[test]
fn a_proof_lands_on_verify_state_and_a_bad_enum_is_refused() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-proof");
    let mut body = sweep_body(&pid, "Built one", "code-optimizer", "technical");
    let mut unread = body.clone();
    unread["proof"] = serde_json::json!({"metric": "ms", "verdict": "better", "control": "red"});
    assert!(
        file_backlog_idea(&pool, &input(unread)).is_err(),
        "a red control without control_value is refused"
    );
    body["proof"] = serde_json::json!({"metric": "ms", "verdict": "better", "control": "red", "control_value": 412});
    let idea = file_backlog_idea(&pool, &input(body)).unwrap().idea;
    assert_eq!(idea.verify_state.as_deref(), Some("moved"));
    assert!(idea
        .verify_evidence
        .unwrap()
        .contains("\"control\":\"red\""));

    let mut bad = sweep_body(&pid, "Bad one", "code-optimizer", "technical");
    bad["confidence"] = serde_json::json!("certain");
    assert!(file_backlog_idea(&pool, &input(bad)).is_err());
    let mut range = sweep_body(&pid, "Out of range", "code-optimizer", "technical");
    range["impact"] = serde_json::json!(11);
    assert!(file_rated_backlog_idea(&pool, &input(range)).is_err());
}

#[test]
fn a_carry_is_never_filed_for_a_decision() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-carry");
    let mut body = sweep_body(&pid, "Owed next round", "code-optimizer", "technical");
    body["disposition"] = serde_json::json!("carry");
    assert!(file_backlog_idea(&pool, &input(body)).is_err());
    assert!(repo::list_ideas(&pool, Some(&pid), None, None, None, None)
        .unwrap()
        .is_empty());
}

#[test]
fn auto_decide_at_l1_or_above_records_the_machine_verdict_with_a_veto_window() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-auto");
    let mut body = sweep_body(&pid, "Auto one", "code-optimizer", "technical");
    body["autoDecide"] = serde_json::json!(true);
    let filed = file_backlog_idea(&pool, &input(body)).unwrap();
    assert!(filed.auto_decided);
    assert_eq!(filed.level, Some(2));
    assert_eq!(filed.idea.status, "accepted");
    assert_eq!(filed.idea.decided_by.as_deref(), Some(MACHINE_SCAN_SWEEP));
    assert!(filed.idea.veto_until.is_some());

    // A product slice starts at L0: filed normally, never decided.
    let mut body = sweep_body(&pid, "Product one", "ux-reviewer", "product");
    body["autoDecide"] = serde_json::json!(true);
    let filed = file_backlog_idea(&pool, &input(body)).unwrap();
    assert!(!filed.auto_decided);
    assert_eq!(filed.level, Some(0));
    assert_eq!(filed.idea.status, "pending");

    // A defer is never machine-decided.
    let mut body = sweep_body(&pid, "Defer one", "code-optimizer", "technical");
    body["autoDecide"] = serde_json::json!(true);
    body["predictedVerdict"] = serde_json::json!("defer");
    let filed = file_backlog_idea(&pool, &input(body)).unwrap();
    assert!(!filed.auto_decided);
    assert_eq!(filed.idea.status, "pending");
}

#[test]
fn a_secret_lens_is_capped_at_l1_and_a_human_reversal_demotes_it_to_l0() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-veto");
    let mut body = sweep_body(&pid, "Token logged", "security-auditor", "technical");
    body["autoDecide"] = serde_json::json!(true);
    let filed = file_backlog_idea(&pool, &input(body)).unwrap();
    assert!(filed.auto_decided);
    assert_eq!(
        filed.level,
        Some(1),
        "technical starts at 2 but authz caps at 1"
    );

    // The human vetoes inside the window: the decision IPC, opposite verdict.
    apply_idea_verdict_cas(
        &pool,
        &filed.idea.id,
        IdeaVerdict::Reject {
            reason: Some("veto: not a real leak".into()),
        },
        "Human",
        Some("accepted"),
    )
    .unwrap();
    let idea = repo::get_idea_by_id(&pool, &filed.idea.id).unwrap();
    assert_eq!(idea.decided_by.as_deref(), Some("Human"));
    assert_eq!(idea.veto_until, None);
    let report = trust::trust_report(&pool, &pid, None).unwrap();
    let slice = report
        .slices
        .iter()
        .find(|s| s.slice == "technical|security-auditor|-|S")
        .expect("slice reported");
    assert_eq!(slice.level, 0);
    assert_eq!(report.events.len(), 1);
    assert!(report.events[0].reason.contains("inside the veto window"));

    // Now at L0, the next filing in that slice is not machine-decided.
    let mut body = sweep_body(&pid, "Another token", "security-auditor", "technical");
    body["autoDecide"] = serde_json::json!(true);
    let filed = file_backlog_idea(&pool, &input(body)).unwrap();
    assert!(!filed.auto_decided);
    assert_eq!(filed.level, Some(0));
}

#[test]
fn a_better_proof_re_measured_not_better_demotes_the_slice() {
    let pool = init_test_db().unwrap();
    let pid = project(&pool, "/tmp/scan-remeasure");
    let mut body = sweep_body(&pid, "Built", "code-optimizer", "technical");
    body["proof"] = serde_json::json!({"verdict": "better"});
    file_backlog_idea(&pool, &input(body.clone())).unwrap();
    body["proof"] = serde_json::json!({"verdict": "not-better"});
    let filed = file_backlog_idea(&pool, &input(body)).unwrap();
    assert_eq!(
        filed.level,
        Some(1),
        "demoted from the technical start of 2"
    );
}

#[test]
fn the_outbox_carries_the_same_fields_and_never_files_a_carry() {
    let pool = init_test_db().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_string_lossy().to_string();
    let pid = project(&pool, &root);
    std::fs::create_dir_all(dir.path().join(".personas")).unwrap();
    let lines = [
        r#"{"type":"finding","skill":"scan-sweep","lens":"error-handler","title":"Swallowed error","effort":2,"impact":9,"risk":2,"size":"S","result":"better","method":"probe","gate":"none","disposition":"backlog","category":"technical","impact_why":"silent data loss","confidence":"high","score":72.2,"score_parts":{"formula":"scan-score/1"},"band":"reserve","mvp":false,"predicted_verdict":"accept","predicted_why":"p","predicted_by":"scan-sweep@3","sweep_run_id":"run-9","proof":{"verdict":"inconclusive"}}"#,
        r#"{"type":"finding","skill":"scan-sweep","lens":"error-handler","title":"Owed next round","effort":2,"impact":5,"risk":2,"disposition":"carry"}"#,
    ];
    std::fs::write(
        dir.path().join(".personas").join("memory-outbox.jsonl"),
        lines.join("\n"),
    )
    .unwrap();

    let out = crate::commands::infrastructure::memory_ledger::ingest_outbox(&pool, &pid).unwrap();
    assert_eq!(out.findings_created, 1);
    assert_eq!(out.findings_carried, 1);
    let ideas = repo::list_ideas(&pool, Some(&pid), None, None, None, None).unwrap();
    assert_eq!(ideas.len(), 1, "the carry was not filed");
    let idea = &ideas[0];
    assert_eq!(idea.lens.as_deref(), Some("error-handler"));
    assert_eq!(idea.impact, Some(5), "9 on 1-10 -> 5");
    assert_eq!(idea.score, Some(72.2));
    assert_eq!(idea.band, "reserve");
    assert_eq!(idea.size.as_deref(), Some("S"));
    assert_eq!(idea.impact_why.as_deref(), Some("silent data loss"));
    assert_eq!(idea.verify_state.as_deref(), Some("pending"));
    let routing = idea.routing.clone().unwrap();
    assert!(routing.contains("\"result\":\"better\"") && routing.contains("\"method\":\"probe\""));
}
