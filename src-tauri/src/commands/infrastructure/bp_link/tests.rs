//! bp link: the loopback rule, the reader id, the move bodies, the slug table
//! by root, the offline back-off, the Morning deck's query, and real HTTP round
//! trips against an in-test stand-in for bp's focus and morning routes (no bp
//! process is started).
//!
//! The `live_*` tests are `#[ignore]`d: they need a running bp (its demo, never
//! a real registry) at `BP_LIVE_BASE`, and FAIL without one. Run them with
//! `BP_LIVE_BASE=http://127.0.0.1:<port> npm run test:rust -- --ignored bp_link::tests::live`.

use std::time::{Duration, Instant};

use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use super::*;

#[test]
fn the_base_is_the_setting_held_to_loopback() {
    assert_eq!(loopback_base(None).unwrap(), "http://localhost:3010");
    assert_eq!(loopback_base(Some("  ")).unwrap(), "http://localhost:3010");
    assert_eq!(
        loopback_base(Some("http://127.0.0.1:3100/")).unwrap(),
        "http://127.0.0.1:3100"
    );
    assert_eq!(
        loopback_base(Some("http://[::1]:3010")).unwrap(),
        "http://[::1]:3010"
    );
    for bad in [
        "http://example.com:3010",
        "http://localhost.evil.test:3010",
        "http://192.168.1.5:3010",
        "ftp://localhost:3010",
        "http://localhost:3010/api",
        "http://user@localhost:3010",
        "not a url",
    ] {
        assert!(loopback_base(Some(bad)).is_err(), "{bad} must be refused");
    }
}

#[test]
fn a_window_makes_a_bp_reader_id() {
    assert_eq!(reader_id("main").unwrap(), "personas:main");
    assert!(reader_id("").is_err());
    assert!(reader_id("two words").is_err());
    assert!(reader_id(&"x".repeat(80)).is_err(), "over bp's 80");
}

#[test]
fn moves_say_who_and_follow_whoever_moves_never_publish() {
    assert_eq!(
        move_body(BpFocusOp::Hello, "personas:main"),
        json!({ "op": "hello", "reader": "personas:main", "surface": "personas", "label": "Personas" })
    );
    assert_eq!(move_body(BpFocusOp::Follow, "personas:main")["of"], "*");
    assert_eq!(
        move_body(BpFocusOp::Unfollow, "personas:main"),
        json!({ "op": "unfollow", "reader": "personas:main" })
    );
    assert_eq!(
        move_body(BpFocusOp::Forget, "personas:main"),
        json!({ "op": "forget", "reader": "personas:main" })
    );
    let ops: Vec<Value> =
        serde_json::from_str(r#"["hello","follow","unfollow","forget"]"#).unwrap();
    for op in ops {
        assert!(serde_json::from_value::<BpFocusOp>(op).is_ok());
    }
    assert!(
        serde_json::from_value::<BpFocusOp>(json!("publish")).is_err(),
        "Personas does not publish (G7)"
    );
}

#[test]
fn products_are_matched_by_root_never_by_folder_name() {
    let bp = vec![
        // a worktree registered under bp's slug for the product, not its folder name
        json!({ "slug": "personas", "name": "Personas", "root": "C:\\t\\hk-bp-ref-personas\\" }),
        // a renamed registration (/adopt-bp --slug)
        json!({ "slug": "pof-game", "name": "PoF", "root": "C:/Users/Kazda/kiro/pof" }),
        // bp knows it, Personas does not
        json!({ "slug": "kettle-live", "name": "Kettle", "root": "D:/sample/kettle" }),
        json!({ "name": "no slug: skipped" }),
    ];
    let personas = vec![
        ("p-1".to_string(), "c:/t/hk-bp-ref-personas".to_string()),
        ("p-2".to_string(), "C:\\Users\\kazda\\kiro\\pof".to_string()),
        ("p-3".to_string(), "C:/Users/kazda/kiro/other".to_string()),
    ];
    let t = link_products(&bp, &personas);
    assert_eq!(t.len(), 3);
    assert_eq!(
        (t[0].slug.as_str(), t[0].project_id.as_deref()),
        ("personas", Some("p-1"))
    );
    assert_eq!(
        (t[1].slug.as_str(), t[1].project_id.as_deref()),
        ("pof-game", Some("p-2"))
    );
    assert_eq!(
        (t[2].slug.as_str(), t[2].project_id.as_deref()),
        ("kettle-live", None),
        "Not in Personas"
    );
}

#[test]
fn offline_is_said_once_per_retry_window_not_every_second() {
    let base = "http://localhost:3010";
    let down = BpFocusRead {
        base: base.into(),
        online: false,
        view: None,
        error: Some("not running".into()),
        retry_in_ms: Some(5000),
    };
    let mut g = OfflineGate::default();
    let t0 = Instant::now();
    assert!(g.held(base, t0).is_none(), "nothing held before a failure");
    g.record(&down, t0);
    // the 1 Hz reads in the next 5 s are answered from the hold, counting down
    for s in 1..5u64 {
        let held = g.held(base, t0 + Duration::from_secs(s)).expect("held");
        assert!(!held.online);
        assert_eq!(
            held.retry_in_ms,
            Some(u32::try_from((5 - s) * 1000).unwrap())
        );
    }
    assert!(
        g.held(base, t0 + OFFLINE_RETRY).is_none(),
        "after 5 s a real attempt is due"
    );
    assert!(
        g.held("http://127.0.0.1:3100", t0 + Duration::from_secs(1))
            .is_none(),
        "another base is not held"
    );
    // a success on the same base ends the hold at once
    g.record(
        &BpFocusRead {
            online: true,
            error: None,
            retry_in_ms: None,
            ..down.clone()
        },
        t0 + Duration::from_secs(1),
    );
    assert!(g.held(base, t0 + Duration::from_secs(2)).is_none());
}

/// A stand-in for bp's focus route on an ephemeral loopback port; the caller
/// aborts the returned server task when done.
async fn stand_in() -> (String, tokio::task::JoinHandle<()>) {
    let view = json!({ "rev": 7, "shared": { "place": { "product": "kettle", "target": { "kind": "room", "id": "booking.core" } },
        "reader": "web:1", "surface": "web", "label": "Web", "at": "2026-10-30T10:00:00.000Z" }, "readers": [] });
    let v2 = view.clone();
    let deck = json!({ "since": "2026-10-30T00:00:00.000Z", "until": "2026-10-30T07:00:00.000Z", "products": [],
        "cards": [{ "id": "open", "kind": "open", "headline": "Good morning.", "lines": [], "tone": "calm" }] });
    let app = Router::new()
        .route(
            "/api/companion/morning",
            get(move |q: axum::extract::RawQuery| {
                let mut d = deck.clone();
                async move {
                    d["query"] = json!(q.0.unwrap_or_default());
                    Json(d)
                }
            }),
        )
        .route(
            "/api/session/focus",
            get(move || {
                let v = view.clone();
                async move { Json(v) }
            })
            .post(move |Json(b): Json<Value>| {
                let v = v2.clone();
                async move { Json(json!({ "moved": false, "echo": b, "view": v })) }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (format!("http://127.0.0.1:{}", addr.port()), server)
}

#[tokio::test]
async fn reads_the_shared_view_and_sends_a_move_over_loopback() {
    let (base, server) = stand_in().await;
    let http = reqwest::Client::new();
    let read = read_focus(&http, &base).await;
    assert!(read.online, "{:?}", read.error);
    assert_eq!(read.view.as_ref().unwrap()["rev"], 7);
    assert_eq!(
        read.view.as_ref().unwrap()["shared"]["place"]["target"]["kind"],
        "room"
    );
    let answer = match send_move(&http, &base, BpFocusOp::Follow, "personas:main").await {
        Ok(v) => v,
        Err(_) => panic!("the stand-in accepts every move"),
    };
    assert_eq!(answer["echo"]["op"], "follow");
    assert_eq!(answer["echo"]["of"], "*");
    assert_eq!(answer["echo"]["surface"], "personas");
    server.abort();
}

#[tokio::test]
async fn a_base_with_nothing_listening_reads_offline_and_then_holds() {
    // bind and drop: a loopback port nobody listens on
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::Client::new();
    let first = read_focus(&http, &base).await;
    assert!(!first.online);
    assert!(first.error.is_some());
    let t = Instant::now();
    let second = read_focus(&http, &base).await;
    assert!(!second.online);
    assert!(
        t.elapsed() < Duration::from_millis(200),
        "the hold answers at once, without knocking on bp"
    );
    assert!(second.retry_in_ms.unwrap() <= 5000);
}

#[tokio::test]
async fn a_hello_to_a_bp_that_is_down_is_offline_not_an_error() {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let base = format!("http://127.0.0.1:{port}");
    let http = reqwest::Client::new();
    let r = move_focus(&http, &base, BpFocusOp::Hello, "personas:main")
        .await
        .expect("down is not an error");
    assert!(!r.online);
    let t = Instant::now();
    let again = move_focus(&http, &base, BpFocusOp::Hello, "personas:main")
        .await
        .unwrap();
    assert!(
        !again.online && t.elapsed() < Duration::from_millis(200),
        "held, not retried"
    );
}

#[test]
fn the_morning_query_passes_iso_instants_only() {
    assert!(morning_query(None, None).unwrap().is_empty());
    assert!(morning_query(Some(" "), None).unwrap().is_empty());
    assert_eq!(
        morning_query(
            Some("2026-10-30T07:00:00.000Z"),
            Some("2026-10-31T06:12:00Z")
        )
        .unwrap(),
        vec![
            ("since", "2026-10-30T07:00:00.000Z".to_string()),
            ("opened", "2026-10-31T06:12:00Z".to_string())
        ]
    );
    for bad in [
        "yesterday",
        "2026-10-30&view=agent",
        "T07:00",
        &"1".repeat(41),
    ] {
        assert!(
            morning_query(Some(bad), None).is_err(),
            "{bad} must be refused"
        );
    }
}

#[tokio::test]
async fn reads_the_morning_deck_with_its_query_and_says_offline_when_down() {
    let (base, server) = stand_in().await;
    let http = reqwest::Client::new();
    let q = morning_query(Some("2026-10-30T00:00:00.000Z"), None).unwrap();
    let read = read_morning(&http, &base, &q).await;
    assert!(read.online, "{:?}", read.error);
    let deck = read.deck.unwrap();
    assert_eq!(deck["cards"][0]["kind"], "open");
    assert_eq!(deck["query"], "since=2026-10-30T00%3A00%3A00.000Z");
    server.abort();

    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let down = read_morning(&http, &format!("http://127.0.0.1:{port}"), &[]).await;
    assert!(!down.online && down.deck.is_none() && down.error.is_some());
}

// ---------------------------------------------------------------------------
// Live: against a running bp demo (BP_LIVE_BASE), never a real registry
// ---------------------------------------------------------------------------

fn live_base() -> String {
    let b = std::env::var("BP_LIVE_BASE").expect("BP_LIVE_BASE must name a running bp demo");
    loopback_base(Some(&b)).expect("BP_LIVE_BASE must be loopback")
}

/// bp's view lists this reader as live.
fn listed_live(view: &Value, reader: &str) -> bool {
    view["readers"]
        .as_array()
        .is_some_and(|rs| rs.iter().any(|r| r["id"] == reader && r["live"] == true))
}

/// Presence (S6 G4): a hello puts Personas on bp's reader list, labelled
/// "Personas", and with no further hello bp lets it go once its LIVE_MS (45 s)
/// has passed: what bp's chip shows 45 s after the tab is hidden.
#[tokio::test]
#[ignore = "needs a running bp demo at BP_LIVE_BASE"]
async fn live_presence_lists_personas_then_drops_it_45_s_after_the_last_hello() {
    let base = live_base();
    let http = reqwest::Client::new();
    let me = "personas:s6-presence";
    let hello = move_focus(&http, &base, BpFocusOp::Hello, me)
        .await
        .unwrap();
    assert!(hello.online);
    let v = read_focus(&http, &base).await.view.unwrap();
    let row = v["readers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == me)
        .cloned()
        .unwrap();
    assert_eq!(
        (
            row["label"].as_str(),
            row["surface"].as_str(),
            row["live"].as_bool()
        ),
        (Some("Personas"), Some("personas"), Some(true))
    );
    println!("t=0 s   listed: {row}");

    tokio::time::sleep(Duration::from_secs(40)).await;
    // 40 s idle: bp closed the pooled socket long ago; the read must still answer (one retry on a stale socket)
    let r = read_focus(&http, &base).await;
    let v = r
        .view
        .unwrap_or_else(|| panic!("bp answered nothing after 40 s idle: {:?}", r.error));
    assert!(
        listed_live(&v, me),
        "still listed 40 s after the last hello"
    );
    println!("t=40 s  still listed");

    tokio::time::sleep(Duration::from_secs(6)).await;
    let r = read_focus(&http, &base).await;
    let v = r
        .view
        .unwrap_or_else(|| panic!("bp answered nothing: {:?}", r.error));
    assert!(!listed_live(&v, me), "gone 46 s after the last hello: {v}");
    println!("t=46 s  gone from the live readers");
    let _ = move_focus(&http, &base, BpFocusOp::Forget, me).await;
}

/// Offline (S6 G4): with bp down, a 1 Hz reader is told "offline" at every
/// read, at once, and bp is knocked on only once per 5 s window: at 1 Hz the
/// next knock is the first tick after the window, 5 to 6 s after the last.
#[tokio::test]
#[ignore = "needs BP_LIVE_DOWN, a loopback base nothing listens on"]
async fn live_offline_knocks_once_every_5_s_at_1_hz() {
    let base = loopback_base(Some(&std::env::var("BP_LIVE_DOWN").expect("BP_LIVE_DOWN"))).unwrap();
    let http = reqwest::Client::new();
    let mut knocks: Vec<u64> = Vec::new();
    let t0 = Instant::now();
    for i in 0..13u64 {
        tokio::time::sleep_until(tokio::time::Instant::from_std(t0 + Duration::from_secs(i))).await;
        let t = Instant::now();
        let r = read_focus(&http, &base).await;
        assert!(!r.online);
        let fresh = r.retry_in_ms == Some(5000);
        if fresh {
            knocks.push(i);
        } else {
            assert!(
                t.elapsed() < Duration::from_millis(50),
                "a held answer is immediate"
            );
        }
        println!(
            "t={i:>2} s offline, {} ({} ms, retry in {:?} ms)",
            if fresh { "knocked" } else { "held" },
            t.elapsed().as_millis(),
            r.retry_in_ms
        );
    }
    println!("knocks at {knocks:?} s");
    assert!(
        knocks.len() >= 2 && knocks.len() <= 3,
        "13 reads, 2 or 3 knocks: {knocks:?}"
    );
    assert!(
        knocks.windows(2).all(|w| (5..=6).contains(&(w[1] - w[0]))),
        "5 to 6 s apart: {knocks:?}"
    );
}

/// The slug table (S6 G4): bp's products joined to a Personas project by
/// root, the demo's folder under another case and slashes included.
#[tokio::test]
#[ignore = "needs a running bp demo at BP_LIVE_BASE and BP_LIVE_ROOT"]
async fn live_products_join_a_personas_project_by_root() {
    let base = live_base();
    let root = std::env::var("BP_LIVE_ROOT").expect("BP_LIVE_ROOT: a demo product's root");
    let bp = get_json(&reqwest::Client::new(), &format!("{base}/api/products"))
        .await
        .unwrap();
    let bp = bp.as_array().cloned().unwrap();
    let personas = vec![(
        "proj-demo".to_string(),
        root.replace('/', "\\").to_uppercase(),
    )];
    let links = link_products(&bp, &personas);
    for l in &links {
        println!(
            "{:<14} {:<12} {}",
            l.slug,
            l.project_id.as_deref().unwrap_or("Not in Personas"),
            l.root
        );
    }
    assert_eq!(
        links
            .iter()
            .filter(|l| l.project_id.as_deref() == Some("proj-demo"))
            .count(),
        1
    );
    assert!(
        links.iter().any(|l| l.project_id.is_none()),
        "the other demo products are not in Personas"
    );
}
