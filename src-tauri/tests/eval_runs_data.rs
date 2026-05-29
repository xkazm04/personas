//! Data assertions for the eval/certification reader against the keep-local
//! run archive (docs/tests/autonomy-eval/runs/ or legacy docs/test/runs/).
//!
//! Run with:
//!   cargo test --features desktop --test eval_runs_data
//!
//! The run bundles are git-ignored (keep-local policy), so they're present in a
//! dev checkout but ABSENT in a fresh CI checkout — every assertion that needs
//! data SKIPS gracefully when the archive is empty. Path resolution relies on
//! `resolve_runs_dir()`'s walk-up from `current_exe()`.

use app_lib::eval_runs::{cert_status, eval_run_detail, list_summaries};

#[test]
fn summaries_sorted_newest_first() {
    let runs = list_summaries();
    for w in runs.windows(2) {
        assert!(w[0].started_at >= w[1].started_at, "summaries not sorted newest-first");
    }
}

#[test]
fn sdlc2_ai_bookkeeper_is_certified() {
    let cert = cert_status();
    if cert.is_empty() {
        return; // keep-local archive absent (CI)
    }
    let Some(bk) = cert
        .iter()
        .find(|c| c.team.contains("SDLC2") && c.team.contains("ai-bookkeeper"))
    else {
        return;
    };
    assert!(bk.held_out_runs >= 3, "got {}", bk.held_out_runs);
    // master certified this team: cert-4/5/6 PRODUCTION → trailing streak 3.
    assert_eq!(bk.streak, 3, "expected certified streak 3");
    assert!(bk.certified);
    assert_eq!(bk.latest_verdict.as_deref(), Some("PRODUCTION"));
}

#[test]
fn detail_loads_for_a_present_run() {
    let Some(first) = list_summaries().into_iter().find(|r| r.has_scorecard) else {
        return;
    };
    let detail = eval_run_detail(&first.run_id).expect("detail loads");
    assert!(detail.verdict.is_some());
}

#[test]
fn rejects_path_traversal() {
    assert!(eval_run_detail("../../etc/passwd").is_err());
    assert!(eval_run_detail("foo/bar").is_err());
}
