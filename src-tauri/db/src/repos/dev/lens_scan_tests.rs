//! Tests for the lens-scan store reader.
//!
//! Included from `lens_scan.rs` via `#[path]` so `use super::*` reaches its
//! private items. The `dev_projects` side comes from `init_test_db()`. The
//! STORE files are throwaway SQLite files from `test_support::make_store`,
//! built from `lens_scan_fixtures/*.sql` (the column sets of lens-scan's v1,
//! v2 and v3 DDL). The registry-backed checks (a real `store.mjs` creating the
//! file) live with the command layer.

use super::*;
use crate::repos::dev::lens_scan::test_support::make_store;
use crate::repos::dev::projects::{create_project, set_enabled};
use rusqlite::params;

/// A throwaway directory removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("lens_scan_{tag}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        Self(dir)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn propose(conn: &Connection, id: &str, status: &str) {
    conn.execute(
        "INSERT INTO proposals (id, run_id, feature, lens, title, kind, status, created_at, updated_at) \
         VALUES (?1, 'r1', 'f', 'dev', 't', 'fix', ?2, ?3, ?3)",
        params![id, status, format!("2026-10-15T11:00:{id:0>2}Z")],
    )
    .expect("proposal");
}

fn product_dir(tag: &str) -> Scratch {
    Scratch::new(tag)
}

#[test]
fn a_v1_store_reads_with_packs_and_releases_empty_and_no_v2_columns() {
    let s = product_dir("v1");
    let conn = make_store(s.path(), 1);
    propose(&conn, "p1", "proposed");
    let (version, rows) = read_rows(&store_file(s.path())).unwrap();
    assert_eq!(version, 1);
    assert!(rows.packs.is_empty() && rows.releases.is_empty());
    assert_eq!(rows.proposals.len(), 1);
    let p = &rows.proposals[0];
    assert_eq!(p["status"], "proposed");
    for v2 in ["pack_id", "commit_sha", "release_id", "triaged_from"] {
        assert!(!p.contains_key(v2), "a v1 row has no {v2}");
    }
}

#[test]
fn columns_are_read_by_presence_across_v2_and_v3() {
    let s2 = product_dir("v2");
    let c2 = make_store(s2.path(), 2);
    propose(&c2, "p1", "done");
    c2.execute("UPDATE proposals SET pack_id = 'k-dev-1'", [])
        .unwrap();
    c2.execute(
        "INSERT INTO packs VALUES ('k-dev-1','dev',1,'pack/dev-1','main','abc',NULL,'open','2026-10-15T11:00:00Z','2026-10-15T11:00:00Z')",
        [],
    )
    .unwrap();
    let (v, rows) = read_rows(&store_file(s2.path())).unwrap();
    assert_eq!(v, 2);
    assert_eq!(rows.proposals[0]["pack_id"], "k-dev-1");
    assert!(!rows.proposals[0].contains_key("triaged_from"));
    assert_eq!(rows.packs.len(), 1);
    assert_eq!(rows.packs[0]["n"], 1);

    let s3 = product_dir("v3");
    let c3 = make_store(s3.path(), 3);
    propose(&c3, "p1", "accepted");
    c3.execute("UPDATE proposals SET triaged_from = 'done'", [])
        .unwrap();
    let (v, rows) = read_rows(&store_file(s3.path())).unwrap();
    assert_eq!(v, 3);
    assert_eq!(rows.proposals[0]["triaged_from"], "done");
}

#[test]
fn null_columns_are_omitted_never_null() {
    let s = product_dir("nulls");
    let conn = make_store(s.path(), 3);
    propose(&conn, "p1", "proposed");
    let (_, rows) = read_rows(&store_file(s.path())).unwrap();
    let p = &rows.proposals[0];
    // body, metric, size, risk ... are NULL in the fixture
    assert!(!p.contains_key("body") && !p.contains_key("risk"));
    for table in [&rows.runs, &rows.proposals] {
        for row in table.iter() {
            assert!(
                row.values().all(|v| !v.is_null()),
                "no null reaches the wire"
            );
        }
    }
    assert!(!rows.runs[0].contains_key("ended_at"));
}

#[test]
fn json_columns_are_parsed_and_held_to_their_shape() {
    let s = product_dir("json");
    let conn = make_store(s.path(), 3);
    conn.execute(
        "INSERT INTO runs (id, started_at, updated_at, phase, status, lenses, scope) VALUES \
         ('r2','2026-10-15T12:00:00Z','2026-10-15T12:00:00Z','measure','done','{not json','[1,2]'), \
         ('r3','2026-10-15T13:00:00Z','2026-10-15T13:00:00Z','measure','done','[\"a\",7,\"b\"]','{\"group\":\"X\"}')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO shots (id, run_id, feature, path, captured_at, report) VALUES \
         (1,'r1','f','shots/r1/a.png','2026-10-15T10:01:00Z','{\"errors\":0}'), \
         (2,'r1','f','shots/r1/b.png','2026-10-15T10:02:00Z','nope')",
        [],
    )
    .unwrap();
    let (_, rows) = read_rows(&store_file(s.path())).unwrap();
    // ordered by started_at, id
    assert_eq!(
        rows.runs
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["r1", "r2", "r3"]
    );
    assert_eq!(rows.runs[0]["lenses"], serde_json::json!(["dev", "sec"]));
    // malformed JSON in a lens list is bp's empty value: [] (the wire promises a string[])
    assert_eq!(rows.runs[1]["lenses"], serde_json::json!([]));
    // scope that is not an object is omitted
    assert!(!rows.runs[1].contains_key("scope"));
    // non-strings are dropped from a lens list; an object scope survives
    assert_eq!(rows.runs[2]["lenses"], serde_json::json!(["a", "b"]));
    assert_eq!(rows.runs[2]["scope"], serde_json::json!({"group": "X"}));
    assert_eq!(rows.shots[0]["report"], serde_json::json!({"errors": 0}));
    assert!(!rows.shots[1].contains_key("report"));
}

#[test]
fn activity_is_the_last_200_by_id_oldest_first() {
    let s = product_dir("activity");
    let conn = make_store(s.path(), 3);
    for i in 1..=250 {
        conn.execute(
            "INSERT INTO activity (id, run_id, at, kind, text) VALUES (?1, 'r1', '2026-10-15T10:00:00Z', 'note', 'x')",
            params![i],
        )
        .unwrap();
    }
    let (_, rows) = read_rows(&store_file(s.path())).unwrap();
    assert_eq!(rows.activity.len(), 200);
    assert_eq!(rows.activity[0]["id"], 51);
    assert_eq!(rows.activity[199]["id"], 250);
}

#[test]
fn proposals_and_measurements_keep_bps_order() {
    let s = product_dir("order");
    let conn = make_store(s.path(), 3);
    propose(&conn, "p2", "proposed");
    propose(&conn, "p1", "proposed");
    conn.execute(
        "UPDATE proposals SET created_at = '2026-10-15T09:00:00Z' WHERE id = 'p2'",
        [],
    )
    .unwrap();
    for (id, v) in [(9, 1.0), (3, 2.5)] {
        conn.execute(
            "INSERT INTO measurements (id, run_id, feature, lens, metric, value, measured_at) \
             VALUES (?1,'r1','f','dev','m',?2,'2026-10-15T10:00:00Z')",
            params![id, v],
        )
        .unwrap();
    }
    let (_, rows) = read_rows(&store_file(s.path())).unwrap();
    assert_eq!(rows.proposals[0]["id"], "p2", "by created_at, id");
    assert_eq!(rows.measurements[0]["id"], 3, "by id");
    assert_eq!(rows.measurements[0]["value"], 2.5);
}

#[test]
fn the_reader_cannot_write_and_sees_wal_pages_a_copy_would_miss() {
    let s = product_dir("wal");
    // `writer` stays open: its commits sit in scan.db-wal, not yet in scan.db
    let writer = make_store(s.path(), 3);
    propose(&writer, "p1", "proposed");
    let wal = store_dir(s.path()).join("scan.db-wal");
    assert!(
        std::fs::metadata(&wal)
            .map(|m| m.len() > 0)
            .unwrap_or(false),
        "the fixture must leave committed pages in the WAL for this to prove anything"
    );
    let (_, rows) = read_rows(&store_file(s.path())).unwrap();
    assert_eq!(
        rows.proposals.len(),
        1,
        "committed WAL pages are read in place"
    );

    let ro = open_read_only(&store_file(s.path())).unwrap();
    assert!(ro.execute("DELETE FROM proposals", []).is_err());
    assert!(ro
        .execute(
            "INSERT INTO runs (id, started_at, updated_at, phase, status, lenses) VALUES ('x','a','b','measure','done','[]')",
            []
        )
        .is_err());
    drop(writer);
}

fn project_at(pool: &DbPool, root: &Path, name: &str) -> String {
    create_project(
        pool,
        name,
        &root.to_string_lossy(),
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap()
    .id
}

#[test]
fn products_list_every_enabled_code_project_with_a_store() {
    let pool = crate::init_test_db().unwrap();
    // pof-like: v3 with a pack awaiting triage, an accepted item, an open release
    let a = product_dir("pa");
    let ca = make_store(a.path(), 3);
    ca.execute(
        "INSERT INTO packs VALUES ('k-dev-1','dev',1,'pack/dev-1','main','abc',NULL,'open','2026-10-15T11:00:00Z','2026-10-15T11:00:00Z')",
        [],
    )
    .unwrap();
    ca.execute(
        "INSERT INTO packs VALUES ('k-dev-2','dev',2,'pack/dev-2','main','abc',NULL,'triaged','2026-10-15T11:00:00Z','2026-10-15T11:00:00Z')",
        [],
    )
    .unwrap();
    for (id, status, pack) in [
        ("1", "done", Some("k-dev-1")),
        ("2", "failed", Some("k-dev-1")),
        ("3", "done", Some("k-dev-2")), // pack not open: not awaiting
        ("4", "accepted", None),
        ("5", "accepted", None),
        ("6", "proposed", None),
    ] {
        propose(&ca, id, status);
        ca.execute(
            "UPDATE proposals SET pack_id = ?2 WHERE id = ?1",
            params![id, pack],
        )
        .unwrap();
    }
    ca.execute(
        "UPDATE proposals SET release_id = 'rel-1.0.0' WHERE id = '5'",
        [],
    )
    .unwrap();
    ca.execute(
        "INSERT INTO releases (id, version, branch, status, created_at, updated_at) VALUES \
         ('rel-1.0.0','1.0.0','release/1.0.0','tagged','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'), \
         ('rel-1.1.0','1.1.0','release/1.1.0','pr-open','2026-10-14T00:00:00Z','2026-10-14T00:00:00Z')",
        [],
    )
    .unwrap();
    // devsecops-like: a v1 store
    let b = product_dir("pb");
    let cb = make_store(b.path(), 1);
    propose(&cb, "1", "proposed");
    propose(&cb, "2", "accepted");
    // a store that is not a database
    let c = product_dir("pc");
    std::fs::create_dir_all(store_dir(c.path())).unwrap();
    std::fs::write(
        store_file(c.path()),
        b"this is not sqlite, not even close, padded to a page....",
    )
    .unwrap();
    // no store at all, a disabled project, a non-code project
    let d = product_dir("pd");
    let e = product_dir("pe");
    make_store(e.path(), 3);
    let f = product_dir("pf");
    make_store(f.path(), 3);

    let id_a = project_at(&pool, a.path(), "Alpha");
    let id_b = project_at(&pool, b.path(), "Beta");
    let id_c = project_at(&pool, c.path(), "Gamma");
    project_at(&pool, d.path(), "Delta");
    let id_e = project_at(&pool, e.path(), "Epsilon");
    let id_f = project_at(&pool, f.path(), "Zeta");
    set_enabled(&pool, &id_e, false).unwrap();
    pool.get()
        .unwrap()
        .execute(
            "UPDATE dev_projects SET kind = 'registry' WHERE id = ?1",
            params![id_f],
        )
        .unwrap();

    let products = list_products(&pool).unwrap();
    let names: Vec<&str> = products.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["Alpha", "Beta", "Gamma"]);

    let alpha = &products[0];
    assert_eq!(alpha.project_id, id_a);
    assert_eq!(alpha.store_version, 3);
    assert_eq!(alpha.counts["done"], 2);
    assert_eq!(alpha.counts["accepted"], 2);
    assert_eq!(alpha.awaiting_triage, 2, "done+failed in OPEN packs only");
    assert_eq!(
        alpha.unreleased_accepted, 1,
        "one accepted item has a release"
    );
    assert_eq!(
        alpha.open_release,
        Some(LensScanOpenRelease {
            id: "rel-1.1.0".into(),
            status: "pr-open".into()
        })
    );
    assert_eq!(alpha.last_run_at.as_deref(), Some("2026-10-15T10:05:00Z"));
    assert!(alpha.error.is_none());

    let beta = &products[1];
    assert_eq!(beta.project_id, id_b);
    assert_eq!(beta.store_version, 1);
    assert_eq!((beta.awaiting_triage, beta.unreleased_accepted), (0, 1));
    assert!(beta.open_release.is_none());

    let gamma = &products[2];
    assert_eq!(gamma.project_id, id_c);
    assert!(
        gamma.error.is_some(),
        "a store that will not open is listed with the reason"
    );
    assert_eq!(gamma.store_version, 0);
}

fn measure(conn: &Connection, id: i64, feature: &str, lens: &str, metric: &str) {
    conn.execute(
        "INSERT INTO measurements (id, run_id, feature, lens, metric, value, measured_at) \
         VALUES (?1, 'r1', ?2, ?3, ?4, 1.0, '2026-10-15T10:01:00Z')",
        params![id, feature, lens, metric],
    )
    .expect("measurement");
}

#[test]
fn products_carry_bps_readiness_fields() {
    let pool = crate::init_test_db().unwrap();
    // full: a v3 map with three features and two of three lenses enabled, two distinct
    // facets read three times, and an events log
    let a = product_dir("ra");
    let ca = make_store(a.path(), 3);
    measure(&ca, 1, "f1", "dev", "loc");
    measure(&ca, 2, "f1", "dev", "loc");
    measure(&ca, 3, "f2", "sec", "cves");
    let dir_a = store_dir(a.path());
    std::fs::write(
        dir_a.join("app-structure.json"),
        r#"{"$schema":"app-structure/3","features":[{},{},{}],
            "lenses":[{"id":"dev"},{"id":"sec","enabled":true},{"id":"des","enabled":false},null]}"#,
    )
    .unwrap();
    std::fs::write(dir_a.join("events.jsonl"), "{}\n").unwrap();
    // a v2 context map (string version), nothing measured, no events
    let b = product_dir("rb");
    make_store(b.path(), 1);
    std::fs::write(
        store_dir(b.path()).join("app-structure.json"),
        r#"{"version":"2","features":[{}]}"#,
    )
    .unwrap();
    // no map at all; then a map that is not an object; then one of unknown version
    let c = product_dir("rc");
    make_store(c.path(), 3);
    let d = product_dir("rd");
    make_store(d.path(), 3);
    std::fs::write(store_dir(d.path()).join("app-structure.json"), "[1,2]").unwrap();
    let e = product_dir("re");
    make_store(e.path(), 3);
    std::fs::write(
        store_dir(e.path()).join("app-structure.json"),
        r#"{"$schema":"something-else","version":2}"#,
    )
    .unwrap();
    for (dir, name) in [(&a, "A"), (&b, "B"), (&c, "C"), (&d, "D"), (&e, "E")] {
        project_at(&pool, dir.path(), name);
    }

    let products = list_products(&pool).unwrap();
    let got: Vec<_> = products
        .iter()
        .map(|p| {
            (
                p.name.as_str(),
                p.has_map,
                p.map_version,
                p.features,
                p.lenses,
                p.measured_facets,
                p.has_events,
            )
        })
        .collect();
    assert_eq!(
        got,
        [
            ("A", true, Some(3), 3, 2, 2, true),
            ("B", true, Some(2), 1, 0, 0, false),
            ("C", false, None, 0, 0, 0, false),
            ("D", false, None, 0, 0, 0, false),
            ("E", true, None, 0, 0, 0, false),
        ]
    );
    // a broken map never reads as a store error
    assert!(products.iter().all(|p| p.error.is_none()));
    // unknown map version is omitted on the wire, never null
    let wire = serde_json::to_value(&products[4]).unwrap();
    assert!(wire.get("mapVersion").is_none());
    assert_eq!(wire["measuredFacets"], 0);
    assert_eq!(wire["hasMap"], true);
}

#[test]
fn project_root_refuses_an_unknown_project_and_a_project_with_no_store() {
    let pool = crate::init_test_db().unwrap();
    let bare = product_dir("bare");
    let id = project_at(&pool, bare.path(), "Bare");
    assert!(matches!(
        project_root(&pool, &id),
        Err(AppError::NotFound(_))
    ));
    assert!(project_root(&pool, "nope").is_err());
    make_store(bare.path(), 3);
    assert_eq!(project_root(&pool, &id).unwrap(), bare.path());
}

#[test]
fn snapshot_carries_structure_events_and_version() {
    let s = product_dir("snap");
    make_store(s.path(), 3);
    let dir = store_dir(s.path());
    // no map yet: null, and the store still reads
    let snap = read_snapshot(s.path()).unwrap();
    assert_eq!(snap.structure, Value::Null);
    assert_eq!(snap.events, "");
    assert_eq!(snap.store_version, 3);
    assert_eq!(snap.scan.runs.len(), 1);

    std::fs::write(
        dir.join("app-structure.json"),
        r#"{"$schema":"app-structure/3"}"#,
    )
    .unwrap();
    std::fs::write(dir.join("events.jsonl"), "{\"a\":1}\n").unwrap();
    let snap = read_snapshot(s.path()).unwrap();
    assert_eq!(snap.structure["$schema"], "app-structure/3");
    assert_eq!(snap.events, "{\"a\":1}\n");

    std::fs::write(dir.join("app-structure.json"), "{broken").unwrap();
    assert!(
        read_snapshot(s.path()).is_err(),
        "a malformed map is an error naming the file"
    );

    let none = product_dir("nostore");
    assert!(matches!(
        read_snapshot(none.path()),
        Err(AppError::NotFound(_))
    ));
}

#[test]
fn item_commits_gather_commit_sha_and_result_sha_and_match_by_prefix() {
    let s = product_dir("sha");
    let conn = make_store(s.path(), 3);
    propose(&conn, "1", "done");
    propose(&conn, "2", "done");
    propose(&conn, "3", "done");
    conn.execute(
        "UPDATE proposals SET commit_sha = 'ABCDEF1234567890' WHERE id = '1'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE proposals SET result_sha = 'abcdef9999999999' WHERE id = '2'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE proposals SET commit_sha = '1234567' WHERE id = '3'",
        [],
    )
    .unwrap();
    let shas = item_commits(s.path()).unwrap();
    assert_eq!(shas.len(), 3);
    assert_eq!(
        match_item_commit(&shas, "abcdef1"),
        CommitMatch::One("abcdef1234567890".into())
    );
    assert_eq!(match_item_commit(&shas, "abcdef0"), CommitMatch::None);
    // the store kept a short sha: a longer ask that starts with it still names the commit
    assert_eq!(
        match_item_commit(&shas, "1234567aaaaaaaa"),
        CommitMatch::One("1234567aaaaaaaa".into())
    );
    let two = vec!["abcdef1111".to_string(), "abcdef2222".to_string()];
    assert_eq!(
        match_item_commit(&two, "abcdef2"),
        CommitMatch::One("abcdef2222".into())
    );
    let amb = vec!["abcdef1111".to_string(), "abcdef1222".to_string()];
    assert_eq!(
        match_item_commit(&amb, "abcdef1"),
        CommitMatch::Ambiguous(2)
    );
}

/// The live probe: `LENS_SCAN_PROBE_ROOTS=<root>;<root>...` read-only, names and
/// counts only (never a row's content). Run with `-- --ignored --nocapture`.
#[test]
#[ignore = "reads the operator's real stores; set LENS_SCAN_PROBE_ROOTS"]
fn probe_live_stores() {
    let roots = std::env::var("LENS_SCAN_PROBE_ROOTS").expect("LENS_SCAN_PROBE_ROOTS");
    for root in roots.split(';').filter(|r| !r.trim().is_empty()) {
        let root = Path::new(root.trim());
        let name = root.file_name().and_then(|n| n.to_str()).unwrap_or("?");
        let snap = read_snapshot(root).unwrap_or_else(|e| panic!("{name}: {e}"));
        let s = &snap.scan;
        println!(
            "PROBE {name}: v{} structure={} events={}B runs={} measurements={} proposals={} activity={} shots={} coverage={} packs={} releases={}",
            snap.store_version,
            if snap.structure.is_null() { "absent" } else { "present" },
            snap.events.len(),
            s.runs.len(), s.measurements.len(), s.proposals.len(), s.activity.len(),
            s.shots.len(), s.coverage.len(), s.packs.len(), s.releases.len()
        );
        if snap.store_version == 1 {
            assert!(
                s.packs.is_empty() && s.releases.is_empty(),
                "{name}: a v1 store reads packs/releases empty"
            );
        }
        let json = serde_json::to_string(&snap).expect("snapshot serialises");
        println!("PROBE {name}: snapshot JSON {} bytes", json.len());
        let sum = summarize(&store_file(root)).unwrap_or_else(|e| panic!("{name}: {e}"));
        println!(
            "PROBE {name}: counts={:?} awaitingTriage={} unreleasedAccepted={} openRelease={:?} lastRunAt={:?}",
            sum.counts, sum.awaiting_triage, sum.unreleased_accepted, sum.open_release, sum.last_run_at
        );
    }
}
