//! Registry-backed tests: the real `store.mjs` creates and migrates a throwaway
//! store, `run_store` drives it exactly as the commands do, and the read side
//! (`personas_db::repos::dev::lens_scan`) reads what it wrote.
//!
//! They are `#[ignore]` because they need the ai-registry checkout and node
//! (CI has neither). Run them with
//! `npm run test:rust -- --ignored lens_scan::tests`; a missing prerequisite
//! FAILS them (it does not skip), so a green run proves they ran.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

use super::tooling::{locate_scripts_from, run_store, LensScanScripts};
use crate::db::models::{LensScanDecideResult, LensScanTriageResult};
use crate::db::repos::dev::lens_scan::{read_snapshot, store_dir, store_file};
use crate::error::AppError;

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn scripts() -> LensScanScripts {
    locate_scripts_from(
        Path::new("C:/no-such-product-root"),
        std::env::var_os("AI_REGISTRY_DIR").map(PathBuf::from),
        dirs::home_dir(),
    )
    .or_else(|| {
        // the sibling checkout the personas manifest names (`registry.local: ../ai-registry`)
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
        locate_scripts_from(repo, None, None)
    })
    .expect("lens-scan must be installed for these tests (ai-registry checkout or ~/.claude/skills/lens-scan)")
}

/// `<tmp>/.ai/lens-scan/scan.db` created by `store.mjs init`, with one done
/// run holding `n` proposals (ids returned in order).
async fn store_with_proposals(n: usize) -> (Scratch, PathBuf, Vec<String>) {
    let tmp = std::env::temp_dir().join(format!("ls_store_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(store_dir(&tmp)).unwrap();
    let guard = Scratch(tmp.clone());
    let s = scripts();
    let init: Value = run_store(&s, &tmp, "init", &[]).await.unwrap();
    assert_eq!(init["user_version"], 3, "store.mjs creates a v3 file");
    let run: Value = run_store(
        &s,
        &tmp,
        "run-start",
        &[
            "--phase".into(),
            "propose".into(),
            "--lenses".into(),
            "dev".into(),
        ],
    )
    .await
    .unwrap();
    let run = run["id"].as_str().unwrap().to_string();
    let mut ids = Vec::new();
    for i in 0..n {
        let p: Value = run_store(
            &s,
            &tmp,
            "propose",
            &[
                "--run",
                &run,
                "--feature",
                "f",
                "--lens",
                "dev",
                "--title",
                &format!("item {i}"),
                "--kind",
                "fix",
                "--metric",
                "m",
                "--expected-delta",
                "1",
            ]
            .map(String::from),
        )
        .await
        .unwrap();
        ids.push(p["id"].as_str().unwrap().to_string());
    }
    let _: Value = run_store(
        &s,
        &tmp,
        "run-end",
        &["--run".into(), run, "--status".into(), "done".into()],
    )
    .await
    .unwrap();
    (guard, tmp, ids)
}

/// A TEST-ONLY writable connection to the throwaway file, to stand in for the
/// execute run that lens-scan alone would perform (set a status directly).
fn force_status(root: &Path, id: &str, status: &str) {
    let conn = Connection::open(store_file(root)).unwrap();
    conn.execute(
        "UPDATE proposals SET status = ?2 WHERE id = ?1",
        rusqlite::params![id, status],
    )
    .unwrap();
}

#[tokio::test]
#[ignore = "needs the ai-registry checkout and node"]
async fn decide_goes_through_store_mjs_and_is_compare_and_set() {
    let (_g, root, ids) = store_with_proposals(2).await;
    let s = scripts();
    let args = super::tooling::store_args(
        &[ids[0].clone(), "nope".into()],
        "approve",
        "user:tester",
        Some("looks right"),
    );
    let r: LensScanDecideResult = run_store(&s, &root, "decide", &args).await.unwrap();
    assert_eq!(
        (r.decision.as_str(), r.by.as_str()),
        ("approved", "user:tester")
    );
    assert_eq!(r.decided, [ids[0].clone()]);
    assert_eq!(r.skipped.len(), 1);
    assert_eq!(r.skipped[0].id, "nope");
    assert_eq!(r.skipped[0].status, "not-found");

    // the same item again: already approved, so it is skipped, not re-decided
    let args = super::tooling::store_args(&[ids[0].clone()], "decline", "user:other", None);
    let r: LensScanDecideResult = run_store(&s, &root, "decide", &args).await.unwrap();
    assert!(r.decided.is_empty());
    assert_eq!(r.skipped[0].status, "approved");

    // the read side sees the write, signed with the caller's identity
    let snap = read_snapshot(&root).unwrap();
    let row = snap
        .scan
        .proposals
        .iter()
        .find(|p| p["id"] == ids[0].as_str())
        .unwrap();
    assert_eq!(row["status"], "approved");
    assert_eq!(row["decided_by"], "user:tester");
    assert_eq!(row["decision_note"], "looks right");
    assert_eq!(snap.store_version, 3);
}

#[tokio::test]
#[ignore = "needs the ai-registry checkout and node"]
async fn reopen_with_no_prior_triage_is_skipped_no_prior_status() {
    let (_g, root, ids) = store_with_proposals(1).await;
    // accepted by some path that recorded no triage (triaged_from stays NULL)
    force_status(&root, &ids[0], "accepted");
    let s = scripts();
    let args = super::tooling::store_args(&[ids[0].clone()], "reopen", "user:tester", None);
    let r: LensScanTriageResult = run_store(&s, &root, "triage", &args).await.unwrap();
    assert_eq!(r.decision, "reopened");
    assert!(r.triaged.is_empty());
    assert_eq!(r.skipped.len(), 1);
    assert_eq!(r.skipped[0].status, "accepted");
    assert_eq!(r.skipped[0].reason.as_deref(), Some("no-prior-status"));
}

#[tokio::test]
#[ignore = "needs the ai-registry checkout and node"]
async fn accept_then_reopen_round_trips_through_triaged_from() {
    let (_g, root, ids) = store_with_proposals(1).await;
    force_status(&root, &ids[0], "done");
    let s = scripts();
    let accept = super::tooling::store_args(&[ids[0].clone()], "accept", "user:tester", None);
    let r: LensScanTriageResult = run_store(&s, &root, "triage", &accept).await.unwrap();
    assert_eq!(r.decision, "accepted");
    assert_eq!(r.triaged, [ids[0].clone()]);
    let snap = read_snapshot(&root).unwrap();
    let row = &snap.scan.proposals[0];
    assert_eq!(row["status"], "accepted");
    assert_eq!(
        row["triaged_from"], "done",
        "the v3 column is read by presence"
    );
    assert_eq!(row["triaged_by"], "user:tester");

    let reopen = super::tooling::store_args(&[ids[0].clone()], "reopen", "user:tester", None);
    let r: LensScanTriageResult = run_store(&s, &root, "triage", &reopen).await.unwrap();
    assert_eq!(r.decision, "reopened");
    assert_eq!(r.triaged, [ids[0].clone()]);
    assert_eq!(
        read_snapshot(&root).unwrap().scan.proposals[0]["status"],
        "done"
    );
}

#[tokio::test]
#[ignore = "needs the ai-registry checkout and node"]
async fn bad_input_is_a_validation_error() {
    let (_g, root, ids) = store_with_proposals(1).await;
    let s = scripts();
    let bad = [
        "--ids",
        ids[0].as_str(),
        "--decision",
        "bogus",
        "--by",
        "user:t",
    ]
    .map(String::from);
    let err = run_store::<LensScanTriageResult>(&s, &root, "triage", &bad)
        .await
        .unwrap_err();
    assert!(
        matches!(&err, AppError::Validation(m) if m.contains("--decision must be one of")),
        "{err:?}"
    );
}
