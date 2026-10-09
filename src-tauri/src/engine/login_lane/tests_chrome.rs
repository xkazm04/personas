//! Live-Chrome tests: a real headless Chrome on a throwaway profile against a
//! tiny loopback HTTP server. They need Chrome installed (`where chrome` /
//! the standard install path); on a machine without it they fail loudly with
//! `ChromeMissing` rather than passing vacuously.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

use super::*;

fn serve(mut s: TcpStream, port: u16) {
    let mut buf = [0u8; 4096];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let first = req.lines().next().unwrap_or("").to_string();
    let path = first.split(' ').nth(1).unwrap_or("/").to_string();
    let has_cookie = req
        .lines()
        .any(|l| l.to_lowercase().starts_with("cookie:") && l.contains("lane=1"));
    let (status, extra, body) = match path.as_str() {
        "/title" => (
            "200 OK",
            String::new(),
            "<title>lane-title</title><body>hello lane body</body>".to_string(),
        ),
        "/cookie" if has_cookie => ("200 OK", String::new(), "<body>cookie:lane=1</body>".into()),
        "/cookie" => (
            "200 OK",
            "Set-Cookie: lane=1; Max-Age=86400; Path=/\r\n".to_string(),
            "<body>cookie:none</body>".into(),
        ),
        "/redir" => (
            "302 Found",
            format!("Location: http://127.0.0.2:{port}/landed\r\n"),
            String::new(),
        ),
        "/landed" => ("200 OK", String::new(), "<body>LANDED-OFF-LIST</body>".into()),
        "/ui" => (
            "200 OK",
            String::new(),
            "<body><button id=b onclick=\"document.getElementById('o').textContent='clicked'\">Continue with Email</button>\
             <input id=i oninput=\"document.getElementById('o').textContent='typed:'+this.value\">\
             <div id=o>idle</div></body>"
                .to_string(),
        ),
        _ => ("404 Not Found", String::new(), String::new()),
    };
    let resp = format!(
        "HTTP/1.1 {status}\r\n{extra}Content-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = s.write_all(resp.as_bytes());
}

/// Accept loop on its own thread. The loop never ends by design (the process
/// exiting is its shutdown), so there is nothing to join; instead a panic in
/// `serve` is caught and reported, so a dead fixture server shows up as a
/// named failure rather than as a mysterious connect error in the test.
fn serve_in_background(l: TcpListener, port: u16) {
    std::thread::spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            for s in l.incoming().flatten() {
                serve(s, port);
            }
        }));
        if outcome.is_err() {
            eprintln!("lane test fixture server on port {port} panicked");
        }
    });
}

/// Serve on 127.0.0.1:0 (and, best effort, the same port on 127.0.0.2 so the
/// redirect test lands on a real off-list origin). Returns the port.
fn spawn_server() -> u16 {
    let l = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = l.local_addr().expect("addr").port();
    serve_in_background(l, port);
    if let Ok(l2) = TcpListener::bind(("127.0.0.2", port)) {
        serve_in_background(l2, port);
    }
    port
}

fn url(port: u16, path: &str) -> String {
    format!("http://127.0.0.1:{port}{path}")
}

/// Count Chrome processes whose command line mentions `marker` (the profile
/// directory name, which only this test's Chrome carries).
#[cfg(not(windows))]
fn chrome_procs(marker: &str) -> usize {
    let out = std::process::Command::new("ps")
        .args(["-eww", "-o", "args="])
        .output()
        .expect("ps");
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| l.contains(marker))
        .count()
}

/// Count chrome.exe processes whose command line mentions `marker`.
#[cfg(windows)]
fn chrome_procs(marker: &str) -> usize {
    // The marker travels in the environment, never spliced into the script
    // text, so the shell vehicle's argument is a literal.
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like ('*' + $env:LANE_MARKER + '*') } | Measure-Object).Count",
        ])
        .env("LANE_MARKER", marker)
        .output()
        .expect("powershell");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .unwrap_or(usize::MAX)
}

fn port_closed(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().expect("addr"),
        Duration::from_millis(500),
    )
    .is_err()
}

/// Poll until no Chrome for this profile remains and the DevTools port is shut.
fn assert_gone(profile: &Path, port: u16) {
    let marker = profile
        .file_name()
        .expect("name")
        .to_string_lossy()
        .to_string();
    let end = Instant::now() + Duration::from_secs(10);
    loop {
        let n = chrome_procs(&marker);
        if n == 0 && port_closed(port) {
            return;
        }
        assert!(
            Instant::now() < end,
            "chrome left behind: {n} procs, port closed={}",
            port_closed(port)
        );
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[tokio::test]
async fn reads_title_and_text_drives_the_page_then_leaves_nothing() {
    let srv = spawn_server();
    let tmp = tempfile::tempdir().expect("tmp");
    let mut s = launch(tmp.path(), LaneMode::Headless)
        .await
        .expect("launch");
    let port = s.port();

    s.navigate(&url(srv, "/title")).await.expect("nav");
    assert_eq!(s.current_url().await.expect("url"), url(srv, "/title"));
    let title = s.cdp.evaluate("document.title").await.expect("title");
    assert_eq!(title, "lane-title");
    assert!(s
        .page_text()
        .await
        .expect("text")
        .contains("hello lane body"));

    s.navigate(&url(srv, "/ui")).await.expect("nav ui");
    assert!(!s.click_text("no such button").await.expect("click"));
    assert!(s.click_text("continue with email").await.expect("click"));
    assert!(s.wait_for_text("clicked", 3000).await.expect("wait"));
    assert!(!s.fill("input.missing", "x").await.expect("fill"));
    assert!(s.fill("#i", "fake-secret-123").await.expect("fill"));
    assert!(s
        .wait_for_text("typed:fake-secret-123", 3000)
        .await
        .expect("wait"));

    // Timeout path: a needle that never appears returns Ok(false).
    assert!(!s.wait_for_text("never-there", 600).await.expect("wait"));

    s.close().await.expect("close");
    assert_gone(tmp.path(), port);
}

#[tokio::test]
async fn refuses_off_list_urls_and_off_list_redirects_then_drop_kills_chrome() {
    let srv = spawn_server();
    let tmp = tempfile::tempdir().expect("tmp");
    let mut s = launch(tmp.path(), LaneMode::Headless)
        .await
        .expect("launch");
    let port = s.port();

    let e = s
        .navigate("https://evil.example/login")
        .await
        .expect_err("refused");
    assert_eq!(e.reason, ReloginReason::Other);
    assert_eq!(e.detail, "origin refused");
    let e = s
        .navigate("file:///C:/Windows/win.ini")
        .await
        .expect_err("refused");
    assert_eq!(e.detail, "origin refused");

    // 302 to 127.0.0.2 (not on the allowlist): the landing is refused and the
    // page is parked on about:blank.
    let e = s
        .navigate(&url(srv, "/redir"))
        .await
        .expect_err("redirect refused");
    assert_eq!(e.reason, ReloginReason::Other);
    assert!(
        e.detail == "origin refused" || e.detail == "navigation failed",
        "{}",
        e.detail
    );
    assert_eq!(s.current_url().await.expect("url"), "about:blank");

    // Drop without close.
    drop(s);
    assert_gone(tmp.path(), port);
}

#[tokio::test]
async fn profile_keeps_cookies_across_two_launches() {
    let srv = spawn_server();
    let tmp = tempfile::tempdir().expect("tmp");

    let mut s = launch(tmp.path(), LaneMode::Headless)
        .await
        .expect("launch 1");
    s.navigate(&url(srv, "/cookie")).await.expect("nav");
    assert!(s.page_text().await.expect("text").contains("cookie:none"));
    let port = s.port();
    s.close().await.expect("close");
    assert_gone(tmp.path(), port);

    let mut s = launch(tmp.path(), LaneMode::Headless)
        .await
        .expect("launch 2");
    s.navigate(&url(srv, "/cookie")).await.expect("nav");
    assert!(s.page_text().await.expect("text").contains("cookie:lane=1"));
    let port = s.port();
    s.close().await.expect("close");
    assert_gone(tmp.path(), port);
}

#[tokio::test]
async fn real_chrome_profile_is_refused_before_launch() {
    let Some(lad) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let real = Path::new(&lad)
        .join("Google")
        .join("Chrome")
        .join("User Data");
    let e = launch(&real, LaneMode::Headless)
        .await
        .err()
        .expect("refused");
    assert_eq!(e.reason, ReloginReason::Other);
}
