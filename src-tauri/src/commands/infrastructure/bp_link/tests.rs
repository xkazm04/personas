//! bp link: the loopback rule, the reader id, the move bodies, the slug table
//! by root, the offline back-off, and one real HTTP round trip against an
//! in-test stand-in for bp's focus route (no bp process is started).

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
    let app = Router::new().route(
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
