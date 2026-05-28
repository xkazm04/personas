//! Data assertions for the eval/certification reader against the committed
//! bundles in `docs/test/runs/`.
//!
//! Run with:
//!   cargo test --features desktop --test eval_runs_data
//!
//! These duplicate the `#[cfg(test)]` assertions inside `eval_runs.rs` as a
//! guaranteed-runnable integration test — the `--lib` test target can be
//! blocked by unrelated broken modules (see `render_plan_bindings_gen.rs`),
//! and these data checks are load-bearing for Phase A correctness.
//!
//! Resolution relies on `resolve_runs_dir()`'s walk-up from `current_exe()`
//! finding the repo-root `docs/test/runs`.

use app_lib::eval_runs::{cert_status, eval_run_detail, list_summaries};

#[test]
fn lists_at_least_twenty_runs_sorted_desc() {
    let runs = list_summaries();
    assert!(
        runs.len() >= 20,
        "expected >=20 run summaries, got {}",
        runs.len()
    );
    for w in runs.windows(2) {
        assert!(
            w[0].started_at >= w[1].started_at,
            "summaries not sorted newest-first"
        );
    }
}

#[test]
fn ai_bookkeeper_cert_streak_is_zero() {
    let cert = cert_status();
    // Match the SDLC2 cert team specifically — there is also a non-held-out
    // "SDLC — ai-bookkeeper" team that sorts first and has 0 held-out runs.
    let bk = cert
        .iter()
        .find(|c| c.team.contains("SDLC2") && c.team.contains("ai-bookkeeper"))
        .expect("SDLC2 ai-bookkeeper cert team present");
    assert_eq!(bk.streak, 0);
    assert!(!bk.certified);
    assert!(bk.held_out_runs >= 3, "got {}", bk.held_out_runs);
}

#[test]
fn judged_run_resolves_verdict_and_judge() {
    let detail = eval_run_detail("run-2026-05-26T22-35-40-ai_paralegal_citation_validator_adr")
        .expect("paralegal run loads");
    assert_eq!(detail.verdict.as_deref(), Some("PRODUCTION"));
    assert!(!detail.provisional);
    assert_eq!(detail.judge.expect("judge present").personas.len(), 5);
}

#[test]
fn doc_track_run_has_no_code_track_and_is_provisional() {
    let detail = eval_run_detail("run-2026-05-27T17-02-27-local_seo_parallel_utils")
        .expect("local_seo run loads");
    assert!(detail.code_track.is_none());
    assert!(detail.provisional);
}

#[test]
fn cert_run_lint_fails_and_increment_delivered() {
    let detail = eval_run_detail("run-2026-05-28T19-26-28-sdlc2_ai_bookkeeper_cert_3")
        .expect("cert-3 loads");
    let ct = detail.code_track.expect("code_track present");
    assert_eq!(ct.lint.and_then(|s| s.status).as_deref(), Some("fail"));
    assert_eq!(detail.verdict.as_deref(), Some("NOT-READY"));
    assert_eq!(
        detail.delivered_increment.and_then(|d| d.delivered),
        Some(true)
    );
}

#[test]
fn rejects_path_traversal() {
    assert!(eval_run_detail("../../etc/passwd").is_err());
    assert!(eval_run_detail("foo/bar").is_err());
}
