//! The contest preview route — SECURITY-SENSITIVE, read this before changing it.
//!
//! `GET /contest-preview/<token>/<projectId>/<contestId>/<rel path>` on the
//! in-app loopback server (`local_http`, bound to `127.0.0.1`). It serves the
//! owner's view of a contest's LLM-written variants into a sandboxed iframe
//! (`sandbox="allow-scripts"`, NO `allow-same-origin`, so the page runs in an
//! opaque origin and cannot reach the app).
//!
//! Why a path token instead of the server's shared secret: a variant loads
//! its own relative assets (`style.css`, `../data/x.js`), which only works if
//! the credential is part of the PATH (a query string does not survive a
//! relative URL). And the server-wide secret must never be handed to
//! LLM-written code — it unlocks `/dev-tools` and the Fleet hooks. So this
//! prefix is on `local_http::auth::SELF_AUTHENTICATED_PREFIXES` and checks its
//! own, narrower credential:
//!
//! - **Token.** Random per boot, held only in memory, never persisted or
//!   logged; required on every request and compared in constant time. It
//!   grants READ access to files under contest arenas and nothing else.
//! - **Containment.** The project id resolves to its registered root through
//!   the DB. Only files under the canonicalised
//!   `<root>/.contest/arena/<contestId>/` are served: every path segment is
//!   rejected if empty, `.`, `..`, or carrying `:` / NUL (drive letters, ADS),
//!   and the canonicalised target (symlinks resolved) must `starts_with` the
//!   canonicalised contest dir — so no traversal or symlink escape.
//! - **GET only** (axum answers HEAD for a GET route; anything else is 405).
//! - **Headers.** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
//!   and `Referrer-Policy: no-referrer` so a variant that loads a CDN script does
//!   not leak the token in a `Referer`. No CORS header is ever sent, so an
//!   opaque-origin page cannot read a response it fetches.
//! - **Scroll reporter.** Every `index.html` response gets a ~10-line script
//!   injected before `</body>` (appended when absent) that posts
//!   `{type:'contest-preview-scroll', scrollX, scrollY, docW, docH}` to the
//!   parent on load / scroll / resize (throttled), so pins can be
//!   document-relative.
//!
//! The `Host` allowlist (DNS-rebinding defence) still applies to this prefix.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use axum::body::Body;
use axum::extract::{Path as AxPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use tauri::{AppHandle, Manager};

use super::arena;

/// The mount prefix (also on `local_http::auth::SELF_AUTHENTICATED_PREFIXES`).
pub const PREFIX: &str = "contest-preview";

/// Largest file the route serves.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

/// The per-boot token. Random, in memory only.
pub fn preview_token() -> &'static str {
    static TOKEN: OnceLock<String> = OnceLock::new();
    TOKEN.get_or_init(|| {
        format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        )
    })
}

/// Constant-time string equality (no early return on the first difference).
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8 | u8::from(a.len() != b.len());
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

/// Percent-encode one path segment (everything but RFC 3986 unreserved).
fn encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            // A URL percent-escape (never SQL), written into the String.
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

/// The loopback URL of `<arena>/<contestId>/<rel>` for the owner's preview.
/// `None` until the loopback server has bound.
pub fn preview_url(project_id: &str, contest_id: &str, rel: &str) -> Option<String> {
    let port = crate::local_http::port()?;
    Some(preview_url_on(
        port,
        preview_token(),
        project_id,
        contest_id,
        rel,
    ))
}

fn preview_url_on(port: u16, token: &str, project_id: &str, contest_id: &str, rel: &str) -> String {
    let rel_enc: Vec<String> = rel
        .split('/')
        .filter(|s| !s.is_empty())
        .map(encode_segment)
        .collect();
    format!(
        "http://127.0.0.1:{port}/{PREFIX}/{token}/{}/{}/{}",
        encode_segment(project_id),
        encode_segment(contest_id),
        rel_enc.join("/")
    )
}

/// Why a request was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    BadToken,
    BadPath,
    NotFound,
    Escape,
    TooLarge,
}

impl Refusal {
    fn status(&self) -> StatusCode {
        match self {
            Refusal::BadToken => StatusCode::UNAUTHORIZED,
            Refusal::BadPath => StatusCode::BAD_REQUEST,
            Refusal::NotFound => StatusCode::NOT_FOUND,
            Refusal::Escape => StatusCode::FORBIDDEN,
            Refusal::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        }
    }
}

/// Resolve `rel` under `contest_dir`, refusing anything that is not a regular
/// file inside it after canonicalisation.
pub fn resolve_contained(contest_dir: &Path, rel: &str) -> Result<PathBuf, Refusal> {
    let segments: Vec<&str> = rel.split(['/', '\\']).collect();
    if segments.is_empty() {
        return Err(Refusal::BadPath);
    }
    for seg in &segments {
        if seg.is_empty() || *seg == "." || *seg == ".." || seg.contains(':') || seg.contains('\0')
        {
            return Err(Refusal::BadPath);
        }
    }
    let base = std::fs::canonicalize(contest_dir).map_err(|_| Refusal::NotFound)?;
    let mut joined = base.clone();
    for seg in &segments {
        joined.push(seg);
    }
    let target = std::fs::canonicalize(&joined).map_err(|_| Refusal::NotFound)?;
    if !target.starts_with(&base) {
        return Err(Refusal::Escape);
    }
    let meta = std::fs::metadata(&target).map_err(|_| Refusal::NotFound)?;
    if !meta.is_file() {
        return Err(Refusal::NotFound);
    }
    if meta.len() > MAX_BYTES {
        return Err(Refusal::TooLarge);
    }
    Ok(target)
}

fn content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "md" | "txt" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        _ => "application/octet-stream",
    }
}

/// The scroll reporter injected into every `index.html`.
const SCROLL_REPORTER: &str = "<script>(function(){var t=0;function r(){t=0;try{\
var d=document.documentElement,b=document.body;parent.postMessage({type:'contest-preview-scroll',\
scrollX:window.scrollX,scrollY:window.scrollY,docW:Math.max(d.scrollWidth,b?b.scrollWidth:0),\
docH:Math.max(d.scrollHeight,b?b.scrollHeight:0)},'*')}catch(e){}}\
function s(){if(!t)t=setTimeout(r,100)}\
addEventListener('load',r);addEventListener('scroll',s,{passive:true});addEventListener('resize',s);r()})();</script>";

/// Insert the reporter before the LAST `</body` (case-insensitive), else append.
pub fn inject_scroll_reporter(html: &[u8]) -> Vec<u8> {
    let needle = b"</body";
    let pos = html
        .windows(needle.len())
        .rposition(|w| w.eq_ignore_ascii_case(needle));
    let mut out = Vec::with_capacity(html.len() + SCROLL_REPORTER.len());
    match pos {
        Some(i) => {
            out.extend_from_slice(&html[..i]);
            out.extend_from_slice(SCROLL_REPORTER.as_bytes());
            out.extend_from_slice(&html[i..]);
        }
        None => {
            out.extend_from_slice(html);
            out.extend_from_slice(SCROLL_REPORTER.as_bytes());
        }
    }
    out
}

/// Resolve a project id to its registered root path (`None` = unknown).
pub type RootResolver = Arc<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;

#[derive(Clone)]
pub struct PreviewState {
    token: String,
    resolve_root: RootResolver,
}

fn refuse(r: Refusal) -> Response {
    (r.status(), "").into_response()
}

async fn serve(State(st): State<PreviewState>, AxPath(rest): AxPath<String>) -> Response {
    let rest = rest.trim_start_matches('/');
    let mut parts = rest.splitn(4, '/');
    let (Some(token), Some(project_id), Some(contest_id), Some(rel)) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return refuse(Refusal::NotFound);
    };
    // The credential first: nothing touches the DB or the disk without it.
    if !ct_eq(token, &st.token) {
        return refuse(Refusal::BadToken);
    }
    if !arena::is_safe_slug(project_id) || !arena::is_safe_slug(contest_id) {
        return refuse(Refusal::BadPath);
    }
    let resolver = st.resolve_root.clone();
    let pid = project_id.to_string();
    let root = match tokio::task::spawn_blocking(move || resolver(&pid)).await {
        Ok(Some(root)) => root,
        _ => return refuse(Refusal::NotFound),
    };
    let contest_dir = arena::arena_root(&root).join(contest_id);
    let target = match resolve_contained(&contest_dir, rel) {
        Ok(t) => t,
        Err(r) => return refuse(r),
    };
    let bytes = match tokio::fs::read(&target).await {
        Ok(b) => b,
        Err(_) => return refuse(Refusal::NotFound),
    };
    let is_index = target
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("index.html"));
    let body = if is_index {
        inject_scroll_reporter(&bytes)
    } else {
        bytes
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type(&target))
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(Body::from(body))
        .unwrap_or_else(|_| refuse(Refusal::NotFound))
}

/// The router with an injected token and resolver (tests drive this).
pub fn router_with(token: String, resolve_root: RootResolver) -> Router {
    Router::new()
        .route("/{*rest}", get(serve))
        .with_state(PreviewState {
            token,
            resolve_root,
        })
}

/// The production router: the per-boot token, and project roots from the DB.
pub fn router(app: AppHandle) -> Router {
    let resolve: RootResolver = Arc::new(move |project_id: &str| {
        let state = app.try_state::<Arc<crate::AppState>>()?;
        crate::db::repos::dev_tools::get_project_by_id(&state.db, project_id)
            .ok()
            .map(|p| PathBuf::from(p.root_path))
    });
    router_with(preview_token().to_string(), resolve)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arena_fixture() -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("proj");
        let dir = arena::arena_root(&root).join("c1");
        std::fs::create_dir_all(dir.join("entries/s1/variant-1")).unwrap();
        std::fs::write(
            dir.join("entries/s1/variant-1/index.html"),
            "<html><body><p>hi</p></BODY></html>",
        )
        .unwrap();
        std::fs::write(dir.join("entries/s1/variant-1/app.js"), "1").unwrap();
        // A secret outside the contest dir, beside it.
        std::fs::write(arena::arena_root(&root).join("secret.txt"), "s").unwrap();
        std::fs::create_dir_all(arena::arena_root(&root).join("c1-other")).unwrap();
        std::fs::write(arena::arena_root(&root).join("c1-other/x.txt"), "x").unwrap();
        (tmp, root)
    }

    #[test]
    fn containment_rejects_traversal_absolute_and_drive_forms() {
        let (_tmp, root) = arena_fixture();
        let dir = arena::arena_root(&root).join("c1");
        assert!(resolve_contained(&dir, "entries/s1/variant-1/index.html").is_ok());
        assert!(resolve_contained(&dir, "entries\\s1\\variant-1\\app.js").is_ok());
        for bad in [
            "../secret.txt",
            "entries/../../secret.txt",
            "entries/s1/./variant-1/app.js",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "C:\\Windows\\win.ini",
            "entries//s1",
            "",
            "entries/s1/variant-1/app.js:stream",
            "entries/s1/variant-1/",
        ] {
            assert_eq!(resolve_contained(&dir, bad), Err(Refusal::BadPath), "{bad}");
        }
        assert_eq!(resolve_contained(&dir, "nope.html"), Err(Refusal::NotFound));
        // A directory is not a file.
        assert_eq!(resolve_contained(&dir, "entries"), Err(Refusal::NotFound));
    }

    #[cfg(unix)]
    #[test]
    fn containment_rejects_a_symlink_escape() {
        let (_tmp, root) = arena_fixture();
        let dir = arena::arena_root(&root).join("c1");
        std::os::unix::fs::symlink(
            arena::arena_root(&root).join("secret.txt"),
            dir.join("link"),
        )
        .unwrap();
        assert_eq!(resolve_contained(&dir, "link"), Err(Refusal::Escape));
    }

    #[cfg(windows)]
    #[test]
    fn containment_rejects_a_symlink_escape() {
        // Creating a symlink needs Developer Mode or elevation on Windows;
        // skip (loudly) when the OS refuses rather than pass vacuously.
        let (_tmp, root) = arena_fixture();
        let dir = arena::arena_root(&root).join("c1");
        let secret = arena::arena_root(&root).join("secret.txt");
        if std::os::windows::fs::symlink_file(&secret, dir.join("link")).is_err() {
            eprintln!("skipping: this account may not create symlinks");
            return;
        }
        assert_eq!(resolve_contained(&dir, "link"), Err(Refusal::Escape));
    }

    #[test]
    fn injects_before_the_last_body_close_or_appends() {
        let out =
            String::from_utf8(inject_scroll_reporter(b"<body>a</body><!-- </BODY> -->")).unwrap();
        assert!(out.contains("a</body><!-- <script>"));
        assert!(out.ends_with("</script></BODY> -->"));
        let out = String::from_utf8(inject_scroll_reporter(b"<p>no body</p>")).unwrap();
        assert!(out.starts_with("<p>no body</p><script>"));
        assert!(out.contains("contest-preview-scroll"));
    }

    #[test]
    fn preview_urls_encode_segments() {
        let u = preview_url_on(9, "tok", "p-1", "c1", "entries/a b/variant-1/index.html");
        assert_eq!(
            u,
            "http://127.0.0.1:9/contest-preview/tok/p-1/c1/entries/a%20b/variant-1/index.html"
        );
    }

    #[test]
    fn ct_eq_is_equality() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
        assert!(!ct_eq("", "a"));
    }

    async fn serve_fixture() -> (tempfile::TempDir, u16, tokio::task::JoinHandle<()>) {
        let (tmp, root) = arena_fixture();
        let resolver: RootResolver = Arc::new(move |pid: &str| (pid == "p1").then(|| root.clone()));
        let app = Router::new().nest(&format!("/{PREFIX}"), router_with("tok".into(), resolver));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        (tmp, port, handle)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    #[tokio::test]
    async fn the_route_serves_contained_files_and_refuses_everything_else() {
        let (_tmp, port, task) = serve_fixture().await;
        let base = format!("http://127.0.0.1:{port}/{PREFIX}");
        let get = |p: String| async move { client().get(p).send().await.unwrap() };

        let ok = get(format!("{base}/tok/p1/c1/entries/s1/variant-1/index.html")).await;
        assert_eq!(ok.status(), reqwest::StatusCode::OK);
        assert_eq!(
            ok.headers()["referrer-policy"].to_str().unwrap(),
            "no-referrer"
        );
        assert!(ok.headers().get("access-control-allow-origin").is_none());
        let body = ok.text().await.unwrap();
        assert!(
            body.contains("contest-preview-scroll"),
            "index.html gets the reporter"
        );

        let js = get(format!("{base}/tok/p1/c1/entries/s1/variant-1/app.js")).await;
        assert_eq!(js.status(), reqwest::StatusCode::OK);
        assert!(js.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/javascript"));
        assert_eq!(
            js.text().await.unwrap(),
            "1",
            "only index.html is rewritten"
        );

        // wrong / missing token
        let r = get(format!("{base}/nope/p1/c1/entries/s1/variant-1/app.js")).await;
        assert_eq!(r.status(), reqwest::StatusCode::UNAUTHORIZED);
        let r = get(format!("{base}/p1/c1/entries/s1/variant-1/app.js")).await;
        assert_eq!(r.status(), reqwest::StatusCode::UNAUTHORIZED);
        // percent-encoded traversal (the client may normalise %2E%2E itself;
        // either way it must never come back 200)
        let r = get(format!("{base}/tok/p1/c1/%2E%2E/secret.txt")).await;
        assert!(r.status().is_client_error(), "{}", r.status());
        let r = get(format!("{base}/tok/p1/c1/entries%2F..%2F..%2Fsecret.txt")).await;
        assert_eq!(r.status(), reqwest::StatusCode::BAD_REQUEST);
        let r = get(format!("{base}/tok/p1/c1/..%5Csecret.txt")).await;
        assert_eq!(r.status(), reqwest::StatusCode::BAD_REQUEST);
        // a contest id that walks up
        let r = get(format!("{base}/tok/p1/%2E%2E/secret.txt")).await;
        assert!(r.status().is_client_error(), "{}", r.status());
        // unknown project
        let r = get(format!("{base}/tok/p2/c1/entries/s1/variant-1/app.js")).await;
        assert_eq!(r.status(), reqwest::StatusCode::NOT_FOUND);
        // GET only
        let r = client()
            .post(format!("{base}/tok/p1/c1/entries/s1/variant-1/app.js"))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), reqwest::StatusCode::METHOD_NOT_ALLOWED);
        task.abort();
    }
}

#[cfg(test)]
mod registration_tests {
    #[test]
    fn the_prefix_is_self_authenticated_and_nothing_else_changed() {
        assert_eq!(
            crate::local_http::auth::SELF_AUTHENTICATED_PREFIXES,
            &["browser-bridge", super::PREFIX],
            "a new exemption is a security decision; review it"
        );
    }
}
