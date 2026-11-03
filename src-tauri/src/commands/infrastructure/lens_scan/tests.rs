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
    // the registry's store.mjs creates v5 since its store.sql moved (2026-10); v4's columns are what these tests read
    assert!(
        init["user_version"].as_u64().is_some_and(|v| v >= 4),
        "store.mjs creates a v4 or later file: {init}"
    );
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
    assert!(snap.store_version >= 4);
}

/// The decision brief's two runtime facts, end to end through the real
/// `store.mjs`: an item filed with a v4 tier and risk class reads back typed
/// (the brief's `subjectOf` takes them from these rows), and a Decline taken on
/// a repeat carries `repeatNote`'s words into `decision_note` through the same
/// argv `lens_scan_decide` builds.
#[tokio::test]
#[ignore = "needs the ai-registry checkout and node"]
async fn v4_severity_reads_back_and_a_repeat_decline_keeps_its_note() {
    let (_g, root, ids) = store_with_proposals(1).await;
    let s = scripts();
    let run: Value = run_store(
        &s,
        &root,
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
    let p: Value = run_store(
        &s,
        &root,
        "propose",
        &[
            "--run",
            &run,
            "--feature",
            "card-payments",
            "--lens",
            "dev",
            "--title",
            "Add retry to checkout payment calls",
            "--kind",
            "fix",
            "--metric",
            "m",
            "--expected-delta",
            "1",
            "--tier",
            "2",
            "--risk-class",
            "money",
        ]
        .map(String::from),
    )
    .await
    .unwrap();
    let id = p["id"].as_str().unwrap().to_string();
    let snap = read_snapshot(&root).unwrap();
    assert!(snap.store_version >= 4);
    let row = snap
        .scan
        .proposals
        .iter()
        .find(|r| r["id"] == id.as_str())
        .unwrap();
    assert_eq!(row["tier"], serde_json::json!(2));
    assert_eq!(row["risk_class"], "money");
    let plain = snap
        .scan
        .proposals
        .iter()
        .find(|r| r["id"] == ids[0].as_str())
        .unwrap();
    assert!(!plain.contains_key("tier"), "an untriaged item omits tier");

    let note = r#"Repeats h4, declined 2026-10-10: "No retries until idempotency keys land.""#;
    let note = super::tooling::clean_note(Some(note)).unwrap();
    let args =
        super::tooling::store_args(&[id.clone()], "decline", "user:personas", note.as_deref());
    let r: LensScanDecideResult = run_store(&s, &root, "decide", &args).await.unwrap();
    assert_eq!(
        (r.decision.as_str(), r.decided.as_slice()),
        ("declined", [id.clone()].as_slice())
    );
    let snap = read_snapshot(&root).unwrap();
    let row = snap
        .scan
        .proposals
        .iter()
        .find(|r| r["id"] == id.as_str())
        .unwrap();
    assert_eq!(row["status"], "declined");
    assert_eq!(row["decided_by"], "user:personas");
    assert_eq!(row["decision_note"], note.unwrap().as_str());
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

// ---------------------------------------------------------------------------
// Live (S6 G6): Personas decides a Morning card through its own path, and bp's
// deck drops it. Needs a running bp DEMO at BP_LIVE_BASE and the root of one of
// its demo products at BP_LIVE_ROOT (its throwaway store, never a real one).
// ---------------------------------------------------------------------------

/// The deck's decision cards on one product: (proposal, recommend, note).
async fn live_decisions(base: &str, slug: &str) -> Vec<(String, Option<String>, Option<String>)> {
    let read =
        crate::commands::infrastructure::bp_link::read_morning(&reqwest::Client::new(), base, &[])
            .await;
    assert!(read.online, "bp must answer: {:?}", read.error);
    let deck = read.deck.unwrap();
    deck["cards"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["kind"] == "decision" && c["product"] == slug)
        .map(|c| {
            let d = &c["decision"];
            let s = |v: &Value| v.as_str().map(str::to_string);
            (
                s(&d["proposal"]).unwrap(),
                s(&d["brief"]["recommend"]),
                s(&d["brief"]["note"]),
            )
        })
        .collect()
}

fn live_env() -> (String, PathBuf, String) {
    let base = std::env::var("BP_LIVE_BASE").expect("BP_LIVE_BASE must name a running bp demo");
    let root =
        PathBuf::from(std::env::var("BP_LIVE_ROOT").expect("BP_LIVE_ROOT: a demo product's root"));
    let slug = std::env::var("BP_LIVE_SLUG").expect("BP_LIVE_SLUG: that product's bp slug");
    assert!(
        root.to_string_lossy()
            .replace('\\', "/")
            .contains("/.demo/"),
        "BP_LIVE_ROOT must be a bp demo product (under .demo/), never a real store"
    );
    (base, root, slug)
}

#[tokio::test]
#[ignore = "needs a running bp demo at BP_LIVE_BASE, BP_LIVE_ROOT and BP_LIVE_SLUG"]
async fn live_an_approve_in_personas_moves_the_store_and_bp_drops_the_card() {
    let (base, root, slug) = live_env();
    let before = live_decisions(&base, &slug).await;
    println!("deck before: {before:?}");
    let (id, _, _) = before
        .iter()
        .find(|(_, rec, _)| rec.is_none())
        .cloned()
        .expect("a decision card with no repeat on the deck");
    let args =
        super::tooling::store_args(std::slice::from_ref(&id), "approve", "user:personas", None);
    let r: LensScanDecideResult = run_store(&scripts(), &root, "decide", &args).await.unwrap();
    assert_eq!(r.decided, [id.clone()]);
    let snap = read_snapshot(&root).unwrap();
    let row = snap
        .scan
        .proposals
        .iter()
        .find(|p| p["id"] == id.as_str())
        .unwrap();
    assert_eq!(row["status"], "approved");
    println!("store: {id} -> {} by {}", row["status"], row["decided_by"]);
    let after = live_decisions(&base, &slug).await;
    println!("deck after:  {after:?}");
    assert!(
        after.iter().all(|(p, _, _)| p != &id),
        "bp's deck no longer shows {id}"
    );
}

#[tokio::test]
#[ignore = "needs a running bp demo at BP_LIVE_BASE, BP_LIVE_ROOT and BP_LIVE_SLUG"]
async fn live_a_decline_on_a_repeat_writes_the_briefs_note_and_bp_drops_the_card() {
    let (base, root, slug) = live_env();
    let before = live_decisions(&base, &slug).await;
    let (id, _, note) = before
        .iter()
        .find(|(_, rec, _)| rec.as_deref() == Some("decline"))
        .cloned()
        .expect("a repeat (recommend: decline) on the deck");
    let note = note.expect("a repeat carries the note a Decline writes");
    let args = super::tooling::store_args(
        std::slice::from_ref(&id),
        "decline",
        "user:personas",
        Some(&note),
    );
    let r: LensScanDecideResult = run_store(&scripts(), &root, "decide", &args).await.unwrap();
    assert_eq!(r.decided, [id.clone()]);
    let snap = read_snapshot(&root).unwrap();
    let row = snap
        .scan
        .proposals
        .iter()
        .find(|p| p["id"] == id.as_str())
        .unwrap();
    assert_eq!(
        (row["status"].as_str(), row["decision_note"].as_str()),
        (Some("declined"), Some(note.as_str()))
    );
    println!("store: {id} -> declined, note {note:?}");
    let after = live_decisions(&base, &slug).await;
    assert!(
        after.iter().all(|(p, _, _)| p != &id),
        "bp's deck no longer shows {id}"
    );
}

/// The harness driver's snapshot (scripts/style/page-harness/bpLiveDrive.mjs answers `lens_scan_snapshot` with it):
/// exactly what the command returns for the demo product at BP_LIVE_ROOT, written to BP_LIVE_DUMP.
#[test]
#[ignore = "needs BP_LIVE_ROOT (a bp demo product) and BP_LIVE_DUMP"]
fn live_dump_the_demo_snapshot() {
    let (_, root, _) = live_env();
    let out = PathBuf::from(
        std::env::var("BP_LIVE_DUMP").expect("BP_LIVE_DUMP: where to write the snapshot"),
    );
    let snap = read_snapshot(&root).unwrap();
    std::fs::write(&out, serde_json::to_string(&snap).unwrap()).unwrap();
    println!(
        "{} proposals, store v{} -> {}",
        snap.scan.proposals.len(),
        snap.store_version,
        out.display()
    );
}
