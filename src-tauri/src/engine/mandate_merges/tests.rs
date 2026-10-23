//! Close-out item 2: a merge a steward's worker made is written to the act log
//! once per branch, only on a mandate that let it merge, and the WP6 re-read
//! counts it.

use super::*;
use crate::db::models::{MandateSignInput, MergePolicy, RereadCode};
use crate::db::{init_test_db, init_test_user_db, PoolExt};
use std::cell::Cell;

/// A mandate `c1` on project `proj` at `rung`, signed with `policy`.
fn seed(rung: i64, policy: MergePolicy) -> DbPool {
    let pool = init_test_db().expect("test db");
    pool.conn("merge acts test")
        .unwrap()
        .execute(
            "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                VALUES ('steward','Steward','sp',1,datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
    pool.conn("merge acts test")
        .unwrap()
        .execute_batch(&format!(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('proj','Proj','/tmp/merge-acts');
             INSERT INTO persona_responsibilities
                (id, persona_id, title, domain, scope_rung, status, project_id, source,
                 created_at, updated_at)
             VALUES ('c1','steward','App master','software_engineering',{rung},'draft','proj',
                     'kp-hire',datetime('now'),datetime('now'));"
        ))
        .unwrap();
    mandates::sign(
        &pool,
        "c1",
        &MandateSignInput {
            merge_policy: policy,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    // Every act below is strictly newer than the signature the re-read counts from.
    std::thread::sleep(std::time::Duration::from_millis(5));
    pool
}

/// One code dispatch of `charter` onto `branch`, as the dispatch stamps it.
fn dispatch(pool: &DbPool, charter: &str, branch: &str) {
    let id = attention_ledger::insert_started(
        pool,
        "steward",
        Some(charter),
        "attention",
        Some("decide"),
    )
    .unwrap();
    let stats = serde_json::json!({ "charterId": charter, "branch": branch, "sessionId": "s1" });
    attention_ledger::complete(pool, &id, "acted", "", None, Some(&stats.to_string()), None)
        .unwrap();
}

fn merged(_root: &Path, branch: &str, _main: Option<&str>, _since: i64) -> Option<MergeEvidence> {
    Some(MergeEvidence {
        branch: branch.to_string(),
        main: "main".into(),
        tip: format!("tip-of-{branch}"),
    })
}

fn merge_acts(pool: &DbPool) -> Vec<CharterAct> {
    charter_acts::list(
        pool,
        &crate::db::models::CharterActFilter {
            item_kind: Some(ACT_KIND_MERGE.into()),
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn one_merge_writes_one_steward_act_and_the_same_merge_again_writes_nothing() {
    let pool = seed(3, MergePolicy::GateGreen);
    dispatch(&pool, "c1", "autopilot/parser");
    // The same branch dispatched twice (a retry) is still one merge.
    dispatch(&pool, "c1", "autopilot/parser");

    let first = merge_sweep_with(&pool, chrono::Utc::now(), &merged);
    assert_eq!(first.len(), 1, "{first:?}");
    let act = &first[0];
    assert_eq!(act.charter_id, "c1");
    assert_eq!(act.item_kind, "merge");
    assert_eq!(act.item_id, "autopilot/parser");
    assert_eq!(act.actor, CharterActor::Steward);
    assert!(!act.reversible);
    let shown: serde_json::Value =
        serde_json::from_str(act.shown_json.as_deref().unwrap()).unwrap();
    assert_eq!(shown["tip"], "tip-of-autopilot/parser");

    // Detected again on the next sweep: no new row, and no git reading spent.
    let probes = Cell::new(0);
    let counting = |r: &Path, b: &str, m: Option<&str>, s: i64| {
        probes.set(probes.get() + 1);
        merged(r, b, m, s)
    };
    assert!(merge_sweep_with(&pool, chrono::Utc::now(), &counting).is_empty());
    assert_eq!(probes.get(), 0, "a recorded branch costs no git");
    // And through the door directly: once per branch.
    assert!(record_merge(
        &pool,
        "c1",
        &merged(Path::new("."), "autopilot/parser", None, 0).unwrap()
    )
    .unwrap()
    .is_none());
    assert_eq!(merge_acts(&pool).len(), 1);

    // The re-read counts it.
    let t = charter_acts::tallies(&pool).unwrap().remove("c1").unwrap();
    assert_eq!(t.merges_since_read, 1);
}

#[test]
fn enough_steward_merges_since_the_read_ask_for_a_reread() {
    let pool = seed(3, MergePolicy::GateGreen);
    for i in 0..personas_engine::mandate_reread::MERGES_SINCE_READ {
        dispatch(&pool, "c1", &format!("autopilot/b{i}"));
    }
    // Repeated sweeps add nothing past the first that found them.
    let mut total = 0;
    for _ in 0..3 {
        total += merge_sweep_with(&pool, chrono::Utc::now(), &merged).len();
    }
    assert_eq!(
        total as i64,
        personas_engine::mandate_reread::MERGES_SINCE_READ
    );
    let user_db = init_test_user_db().unwrap();
    let mut list = mandates::list(&pool).unwrap();
    crate::engine::mandate_reread_view::annotate(&pool, &user_db, &mut list);
    let reread = list
        .into_iter()
        .find(|m| m.charter_id == "c1")
        .and_then(|m| m.reread)
        .expect("the merges ask for a re-read");
    assert_eq!(reread.code, RereadCode::Merges);
}

#[test]
fn a_merge_the_mandate_did_not_let_the_steward_make_is_not_a_steward_act() {
    // Rung 3 but merge policy `never`: the worker opened the branch and asked,
    // so a merged branch is the operator's merge.
    let pool = seed(3, MergePolicy::Never);
    dispatch(&pool, "c1", "autopilot/parser");
    assert!(merge_sweep_with(&pool, chrono::Utc::now(), &merged).is_empty());
    // Rung 2 never merges either.
    let pool = seed(2, MergePolicy::GateGreen);
    dispatch(&pool, "c1", "autopilot/parser");
    assert!(merge_sweep_with(&pool, chrono::Utc::now(), &merged).is_empty());
    assert!(merge_acts(&pool).is_empty());
}

#[test]
fn no_charter_no_row_and_an_unmerged_or_old_branch_writes_nothing() {
    let pool = seed(3, MergePolicy::GateGreen);
    // A dispatch row naming a charter that does not exist.
    dispatch(&pool, "ghost", "autopilot/ghost");
    assert!(merge_sweep_with(&pool, chrono::Utc::now(), &merged).is_empty());
    assert!(record_merge(
        &pool,
        "ghost",
        &merged(Path::new("."), "x", None, 0).unwrap()
    )
    .unwrap()
    .is_none());

    // A branch git does not read as merged.
    dispatch(&pool, "c1", "autopilot/open");
    let unmerged = |_: &Path, _: &str, _: Option<&str>, _: i64| None;
    assert!(merge_sweep_with(&pool, chrono::Utc::now(), &unmerged).is_empty());

    // A dispatch older than the lookback is not read at all.
    let later = chrono::Utc::now() + chrono::Duration::days(LOOKBACK_DAYS + 1);
    assert!(merge_sweep_with(&pool, later, &merged).is_empty());
    assert!(merge_acts(&pool).is_empty());
}
