//! Walk-through tests of the re-login run. No network, no real `claude`, no
//! real sites: a fake `claude` batch script, local fake pages served from
//! 127.0.0.1 (which the lane allows; `ALLOWED_HOSTS` is not widened), and a
//! real headless Chrome on throwaway profiles. They need Chrome installed and
//! Windows (the fake CLI is a `.cmd`); without Chrome they fail loudly with
//! `ChromeMissing` rather than passing vacuously.
//!
//! All of them hold `SERIAL`: the in-memory run state is process-wide.

#![cfg(windows)]

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use regex::Regex;
use zeroize::Zeroizing;

use crate::db::repos::fleet_claude_accounts as accounts_repo;
use crate::db::repos::fleet_claude_login as repo;
use crate::db::DbPool;
use crate::engine::login_lane::{ChromeSession, LaneError, LaneMode};
use personas_core::crypto::{decrypt_from_db, encrypt_for_db};

use super::super::oauth;
use super::cli::ClaudeCli;
use super::flows::{MailLogin, Timings, VaultReader};
use super::lane::{ChromeLauncher, LaneLauncher};
use super::orchestrator::{self, Begin, IdentitySource, ReloginEnv};
use super::{reset_states, state_of, ReloginPhase, ReloginReason, ReloginState};

static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const ACCOUNT_ID: &str = "acct-target-0001";
const OTHER_ID: &str = "acct-someone-else";
const EMAIL: &str = "target@example.test";
const CODE: &str = "123456";
const STALE_CODE: &str = "654321";
const MAIL_USER: &str = "mail-user@example.test";
const MAIL_PASS: &str = "fixture-mail-pass-hunter2";
const TOKEN: &str = "fixture-access-token-xyz";
const URL_SECRET: &str = "SECRET-STATE-9d8c";
const OLD_CREDS: &str = r#"{"claudeAiOauth":{"accessToken":"old-dead-token","refreshToken":"old-refresh","expiresAt":1}}"#;

// ── The fake web ────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scenario {
    Warm,
    Google,
    GoogleWrongAccount,
    SignedOut,
    EmailCode,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Proton {
    LoggedIn,
    LoginForm,
    SecondFactor,
}

struct Web {
    scenario: Scenario,
    proton: Proton,
    authorized: AtomicBool,
    code_requested: AtomicBool,
    code_verified: AtomicBool,
    proton_signed_in: AtomicBool,
    /// The accept loop and its connection threads, kept so none is detached.
    threads: Mutex<Vec<std::thread::JoinHandle<()>>>,
}

fn page(body: &str) -> (String, String, String) {
    (
        "200 OK".into(),
        String::new(),
        format!("<!doctype html><html><body>{body}</body></html>"),
    )
}

fn redirect(to: &str) -> (String, String, String) {
    (
        "302 Found".into(),
        format!("Location: {to}\r\n"),
        String::new(),
    )
}

const AUTHORIZE_PAGE: &str =
    "Authorize Claude Code<br>Claude Code would like to connect to your account<br>\
     <button onclick=\"fetch('/click').then(()=>{location='/callback'})\">Authorize</button>";

const LOGIN_PAGE: &str = "Welcome back<br>Continue with Google<br>Enter your email<br>\
     <input type=email name=email><br>\
     <button onclick=\"fetch('/request-code').then(()=>{location='/codepage'})\">Continue with email</button><br>\
     Verify your email address";

const CODE_PAGE: &str = "Check your email<br>We sent a verification code<br><input name=code><br>\
     <button onclick=\"fetch('/verify?code='+encodeURIComponent(document.querySelector('input').value)).then(()=>{location='/authorize'})\">Verify</button>";

const PROTON_LOGIN: &str = "Sign in<br>Email or username<br><input id=username><br>Password<br>\
     <input id=password type=password><br>\
     <button onclick=\"fetch('/proton/signin?u='+encodeURIComponent(document.getElementById('username').value)+'&p='+encodeURIComponent(document.getElementById('password').value)).then(()=>{location='/proton/inbox'})\">Sign in</button>";

impl Web {
    fn route(&self, path: &str, query: &HashMap<String, String>) -> (String, String, String) {
        match path {
            "/authorize" => match self.scenario {
                Scenario::Warm => page(AUTHORIZE_PAGE),
                Scenario::Google | Scenario::GoogleWrongAccount => redirect("/google"),
                Scenario::SignedOut => page("Welcome back<br>Continue with Google<br>Enter your email"),
                Scenario::EmailCode if self.code_verified.load(Ordering::SeqCst) => {
                    page(AUTHORIZE_PAGE)
                }
                Scenario::EmailCode => page(LOGIN_PAGE),
            },
            "/google" if self.scenario == Scenario::GoogleWrongAccount => page(
                "Choose an account<br>to continue to Claude<br><button>stranger@example.test</button>",
            ),
            "/google" => page(&format!(
                "Choose an account<br>to continue to Claude<br>\
                 <button onclick=\"location='/authorize_ok'\">{EMAIL}</button>\
                 <button>stranger@example.test</button>"
            )),
            "/authorize_ok" => page(AUTHORIZE_PAGE),
            "/callback" => page("You may close this tab"),
            "/click" => {
                self.authorized.store(true, Ordering::SeqCst);
                page("ok")
            }
            "/state" => {
                let s = if self.authorized.load(Ordering::SeqCst) {
                    "authorized"
                } else {
                    "waiting"
                };
                page(s)
            }
            "/request-code" => {
                self.code_requested.store(true, Ordering::SeqCst);
                page("ok")
            }
            "/codepage" => page(CODE_PAGE),
            "/verify" => {
                if query.get("code").map(String::as_str) == Some(CODE) {
                    self.code_verified.store(true, Ordering::SeqCst);
                }
                page("ok")
            }
            "/proton/login" => page(PROTON_LOGIN),
            "/proton/signin" => {
                if query.get("u").map(String::as_str) == Some(MAIL_USER)
                    && query.get("p").map(String::as_str) == Some(MAIL_PASS)
                {
                    self.proton_signed_in.store(true, Ordering::SeqCst);
                }
                page("ok")
            }
            "/proton/2fa" => page("Two-factor authentication<br>Enter the code from your authenticator app"),
            "/proton/inbox" => self.inbox(),
            _ => ("404 Not Found".into(), String::new(), String::new()),
        }
    }

    fn inbox(&self) -> (String, String, String) {
        let signed = self.proton_signed_in.load(Ordering::SeqCst);
        match (self.proton, signed) {
            (Proton::LoginForm | Proton::SecondFactor, false) => redirect("/proton/login"),
            (Proton::SecondFactor, true) => redirect("/proton/2fa"),
            _ => {
                let fresh = if self.code_requested.load(Ordering::SeqCst) {
                    format!("<div>Anthropic<br>Your Claude verification code is {CODE}</div>")
                } else {
                    String::new()
                };
                page(&format!(
                    "Inbox<br><div>Some Bank<br>Your code is 111111</div>{fresh}\
                     <div>Anthropic<br>Your Claude verification code is {STALE_CODE}</div>"
                ))
            }
        }
    }
}

fn serve(mut s: TcpStream, web: &Web) {
    let mut buf = [0u8; 8192];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let target = req
        .lines()
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .unwrap_or("/")
        .to_string();
    let (path, q) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let query: HashMap<String, String> = q
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| {
            (
                k.to_string(),
                urlencoding::decode(v)
                    .map(|c| c.into_owned())
                    .unwrap_or_default(),
            )
        })
        .collect();
    let (status, extra, body) = web.route(path, &query);
    let resp = format!(
        "HTTP/1.1 {status}\r\n{extra}Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = s.write_all(resp.as_bytes());
}

fn start_web(scenario: Scenario, proton: Proton) -> (u16, Arc<Web>) {
    let web = Arc::new(Web {
        scenario,
        proton,
        authorized: AtomicBool::new(false),
        code_requested: AtomicBool::new(false),
        code_verified: AtomicBool::new(false),
        proton_signed_in: AtomicBool::new(false),
        threads: Mutex::default(),
    });
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let w = web.clone();
    let accept = std::thread::spawn(move || {
        let mut conns = Vec::new();
        for stream in listener.incoming().flatten() {
            let w = w.clone();
            conns.push(std::thread::spawn(move || serve(stream, &w)));
        }
    });
    if let Ok(mut g) = web.threads.lock() {
        g.push(accept);
    }
    (port, web)
}

// ── The fake claude CLI ─────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum CliMode {
    /// Hand over the URL, wait for the authorize click, write credentials, exit 0.
    Completes,
    /// Hand over the URL, then exit 1.
    Exits1,
}

fn write_fake_cli(dir: &Path, port: u16, mode: CliMode) -> PathBuf {
    let creds = format!(
        r#"{{"claudeAiOauth":{{"accessToken":"{TOKEN}","refreshToken":"fixture-refresh","expiresAt":4102444800000,"subscriptionType":"max","rateLimitTier":"default_claude_max_5x"}}}}"#
    );
    let tail = match mode {
        CliMode::Exits1 => "exit /b 1\r\n".to_string(),
        CliMode::Completes => format!(
            "set n=0\r\n:loop\r\ncurl -s -o \"%CLAUDE_CONFIG_DIR%\\poll.txt\" http://127.0.0.1:{port}/state\r\n\
             findstr /c:\"authorized\" \"%CLAUDE_CONFIG_DIR%\\poll.txt\" >nul 2>&1\r\n\
             if %errorlevel%==0 goto ok\r\nset /a n+=1\r\nif %n% GEQ 120 exit /b 1\r\n\
             ping -n 2 127.0.0.1 >nul\r\ngoto loop\r\n:ok\r\n\
             > \"%CLAUDE_CONFIG_DIR%\\.credentials.json\" echo {creds}\r\nexit /b 0\r\n"
        ),
    };
    let script = format!(
        "@echo off\r\ncall \"%BROWSER%\" \"http://127.0.0.1:{port}/authorize?state={URL_SECRET}\"\r\n{tail}"
    );
    let path = dir.join("fake-claude.cmd");
    std::fs::write(&path, script).expect("write fake cli");
    path
}

// ── Seams ───────────────────────────────────────────────────────────────────

struct FixedIdentity {
    uuid: String,
}

#[async_trait]
impl IdentitySource for FixedIdentity {
    async fn profile(&self, access_token: &str) -> Result<oauth::Profile, ReloginReason> {
        assert_eq!(
            access_token, TOKEN,
            "the identity is asked about the CLI's token"
        );
        Ok(oauth::Profile {
            account_uuid: self.uuid.clone(),
            email: Some(EMAIL.to_string()),
            display_name: None,
            organization_uuid: None,
            organization_name: None,
        })
    }
}

struct FixtureVault(bool);

impl VaultReader for FixtureVault {
    fn mail_login(&self, credential_id: &str) -> Option<MailLogin> {
        assert_eq!(credential_id, "vault-1");
        self.0.then(|| MailLogin {
            user: Zeroizing::new(MAIL_USER.to_string()),
            pass: Zeroizing::new(MAIL_PASS.to_string()),
        })
    }
}

/// A launcher whose launch panics: the panic-observed test.
struct PanickingLauncher;

impl LaneLauncher for PanickingLauncher {
    type Session = ChromeSession;
    async fn launch(&self, _dir: &Path, _mode: LaneMode) -> Result<ChromeSession, LaneError> {
        panic!("injected launcher panic");
    }
}

fn fast() -> Timings {
    Timings {
        url_wait: Duration::from_secs(20),
        page_cap: Duration::from_secs(70),
        unknown_cap: Duration::from_secs(15),
        poll: Duration::from_millis(150),
        after_submit_cap: Duration::from_secs(15),
        cli_exit: Duration::from_secs(40),
        code_wait: Duration::from_secs(20),
        code_poll: Duration::from_millis(400),
        inbox_open: Duration::from_secs(15),
        settle: Duration::from_millis(150),
        login_grace: Duration::from_secs(2),
    }
}

// ── The harness ─────────────────────────────────────────────────────────────

struct Harness<L: LaneLauncher> {
    env: ReloginEnv<L>,
    web: Arc<Web>,
    events: Arc<Mutex<Vec<String>>>,
    _tmp: tempfile::TempDir,
}

struct Opts {
    scenario: Scenario,
    proton: Proton,
    cli: CliMode,
    identity: &'static str,
    inbox_linked: bool,
    vault: bool,
}

impl Opts {
    fn new(scenario: Scenario) -> Self {
        Self {
            scenario,
            proton: Proton::LoggedIn,
            cli: CliMode::Completes,
            identity: ACCOUNT_ID,
            inbox_linked: scenario == Scenario::EmailCode,
            vault: true,
        }
    }
}

fn seed(db: &DbPool, inbox_linked: bool) {
    let (ct, nonce) = encrypt_for_db(OLD_CREDS).expect("encrypt");
    accounts_repo::upsert(
        db,
        &accounts_repo::ClaudeAccountRow {
            id: ACCOUNT_ID.into(),
            email: EMAIL.into(),
            display_name: None,
            organization_uuid: None,
            organization_name: None,
            rate_limit_tier: None,
            subscription_type: Some("max".into()),
            slot: 1,
            creds_ciphertext: ct,
            creds_nonce: nonce,
            quarantine_reason: None,
            added_at_ms: 1,
            updated_at_ms: 1,
            last_switched_at_ms: None,
            last_usage_json: None,
            last_usage_at_ms: None,
        },
    )
    .expect("account");
    accounts_repo::set_quarantine(db, ACCOUNT_ID, Some("invalid_grant")).expect("quarantine");
    repo::upsert_profile(db, "claude-prof", "Claude profile", "ignored", None).expect("profile");
    repo::upsert_profile(
        db,
        "inbox-prof",
        "Inbox profile",
        "ignored",
        Some("vault-1"),
    )
    .expect("inbox profile");
    repo::set_link(
        db,
        &repo::AccountLinkRow {
            account_id: ACCOUNT_ID.into(),
            profile_key: Some("claude-prof".into()),
            code_inbox_profile_key: inbox_linked.then(|| "inbox-prof".to_string()),
            relogin_unattended: false,
        },
    )
    .expect("link");
}

fn harness_with<L: LaneLauncher>(o: &Opts, launcher: L) -> Harness<L> {
    let (port, web) = start_web(o.scenario, o.proton);
    let tmp = tempfile::tempdir().expect("tmp");
    let cli_path = write_fake_cli(tmp.path(), port, o.cli);
    let db = personas_db::init_test_db().expect("db");
    seed(&db, o.inbox_linked);
    let events: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = events.clone();
    let env = ReloginEnv {
        db,
        launcher,
        app_data: tmp.path().join("app-data"),
        temp_root: tmp.path().join("work"),
        cli: ClaudeCli {
            program: cli_path.display().to_string(),
            leading: Vec::new(),
        },
        identity: Arc::new(FixedIdentity {
            uuid: o.identity.to_string(),
        }),
        vault: Arc::new(FixtureVault(o.vault)),
        emit: Arc::new(move |s: &ReloginState| {
            if let Ok(mut g) = sink.lock() {
                g.push(serde_json::to_string(s).unwrap_or_default());
            }
        }),
        proton_url: format!("http://127.0.0.1:{port}/proton/inbox"),
        timings: fast(),
    };
    Harness {
        env,
        web,
        events,
        _tmp: tmp,
    }
}

fn harness(o: &Opts) -> Harness<ChromeLauncher> {
    harness_with(o, ChromeLauncher)
}

/// Capture this thread's tracing output (the tests run on one thread).
#[derive(Clone, Default)]
struct LogBuf(Arc<Mutex<Vec<u8>>>);

impl Write for LogBuf {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        if let Ok(mut g) = self.0.lock() {
            g.extend_from_slice(b);
        }
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogBuf {
    type Writer = LogBuf;
    fn make_writer(&'a self) -> LogBuf {
        self.clone()
    }
}

fn capture_logs() -> (LogBuf, tracing::subscriber::DefaultGuard) {
    let buf = LogBuf::default();
    let sub = tracing_subscriber::fmt()
        .with_writer(buf.clone())
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .finish();
    (buf, tracing::subscriber::set_default(sub))
}

impl<L: LaneLauncher> Harness<L> {
    /// Begin and run to the end, as the command does (minus the spawn).
    async fn run(&self) -> ReloginState {
        let Begin::Started(cx) =
            orchestrator::begin(&self.env.db, ACCOUNT_ID, "manual").expect("begin")
        else {
            panic!("expected the run to start");
        };
        orchestrator::run_supervised(&self.env, &cx).await;
        state_of(ACCOUNT_ID).expect("a settled state")
    }

    fn last_audit(&self) -> repo::ReloginRunRow {
        repo::recent_runs(&self.env.db, ACCOUNT_ID, 1)
            .expect("runs")
            .into_iter()
            .next()
            .expect("an audit row")
    }

    fn stored_token(&self) -> String {
        let row = accounts_repo::get(&self.env.db, ACCOUNT_ID)
            .expect("get")
            .expect("row");
        decrypt_from_db(&row.creds_ciphertext, &row.creds_nonce).expect("decrypt")
    }

    /// Every piece of text the run left behind, for the secrets scan.
    fn leftovers(&self, logs: &LogBuf) -> String {
        let events = self.events.lock().map(|g| g.join("\n")).unwrap_or_default();
        let runs = repo::recent_runs(&self.env.db, ACCOUNT_ID, 20).unwrap_or_default();
        let profiles = repo::list_profiles(&self.env.db).unwrap_or_default();
        let logs = logs
            .0
            .lock()
            .map(|g| String::from_utf8_lossy(&g).to_string())
            .unwrap_or_default();
        format!(
            "{events}\n{runs:?}\n{profiles:?}\n{:?}\n{logs}",
            state_of(ACCOUNT_ID)
        )
    }
}

fn assert_no_secrets(haystack: &str) {
    for secret in [
        CODE,
        STALE_CODE,
        MAIL_PASS,
        TOKEN,
        URL_SECRET,
        "fixture-refresh",
    ] {
        let re = Regex::new(&format!(r"\b{}\b", regex::escape(secret))).expect("regex");
        assert!(
            !re.is_match(haystack),
            "a secret ({}...) reached the run's output",
            &secret[..4]
        );
    }
}

fn assert_captured(h: &Harness<impl LaneLauncher>) {
    let row = accounts_repo::get(&h.env.db, ACCOUNT_ID)
        .expect("get")
        .expect("row");
    assert_eq!(
        row.quarantine_reason, None,
        "a fresh login clears the quarantine"
    );
    assert!(
        h.stored_token().contains(TOKEN),
        "the new credentials are stored"
    );
}

fn assert_untouched(h: &Harness<impl LaneLauncher>) {
    let row = accounts_repo::get(&h.env.db, ACCOUNT_ID)
        .expect("get")
        .expect("row");
    assert_eq!(row.quarantine_reason.as_deref(), Some("invalid_grant"));
    assert_eq!(
        h.stored_token(),
        OLD_CREDS,
        "the stored login was not replaced"
    );
    assert_eq!(
        accounts_repo::list(&h.env.db).expect("list").len(),
        1,
        "no other account row"
    );
}

fn assert_needs_you(state: &ReloginState, reason: ReloginReason) {
    assert_eq!(state.phase, ReloginPhase::NeedsYou, "state: {state:?}");
    assert_eq!(state.reason, Some(reason), "state: {state:?}");
}

// ── Walk-throughs ───────────────────────────────────────────────────────────

#[tokio::test]
async fn already_warm_profile_authorizes_and_captures_the_credential() {
    let _s = SERIAL.lock().await;
    reset_states();
    let (logs, _g) = capture_logs();
    let h = harness(&Opts::new(Scenario::Warm));

    // The live login: a sentinel the run must leave byte-identical.
    let live = tempfile::tempdir().expect("live");
    let live_dir = live.path().join(".claude");
    std::fs::create_dir_all(&live_dir).expect("live dir");
    let sentinel = r#"{"claudeAiOauth":{"accessToken":"LIVE-SENTINEL"}}"#;
    std::fs::write(live_dir.join(".credentials.json"), sentinel).expect("sentinel");
    let global = live.path().join(".claude.json");
    std::fs::write(&global, r#"{"oauthAccount":{"accountUuid":"live-uuid"}}"#).expect("global");
    let _env = EnvGuard::set("CLAUDE_CONFIG_DIR", &live_dir);

    let state = h.run().await;

    assert_eq!(state.phase, ReloginPhase::Done, "state: {state:?}");
    assert_captured(&h);
    let audit = h.last_audit();
    assert_eq!((audit.outcome.as_str(), audit.reason), ("done", None));
    let events = h.events.lock().expect("events").join("\n");
    assert!(events.contains("\"step\":\"opening_profile\""), "{events}");
    assert!(events.contains("\"step\":\"authorising\""), "{events}");
    assert!(events.contains("\"step\":\"saving\""), "{events}");
    assert_eq!(
        std::fs::read_to_string(live_dir.join(".credentials.json")).expect("read"),
        sentinel
    );
    assert_eq!(
        std::fs::read_to_string(&global).expect("read"),
        r#"{"oauthAccount":{"accountUuid":"live-uuid"}}"#
    );
    let profile = repo::get_profile(&h.env.db, "claude-prof")
        .expect("profile")
        .expect("row");
    assert_eq!(profile.last_result.as_deref(), Some("ok"));
    assert!(profile.last_warm_at_ms.is_some());
    // The temp config dir (which held the credentials) is gone.
    let left = std::fs::read_dir(&h.env.temp_root)
        .map(|d| d.count())
        .unwrap_or(0);
    assert_eq!(left, 0, "the run's temp dir was wiped");
    assert_no_secrets(&h.leftovers(&logs));
}

#[tokio::test]
async fn google_chooser_picks_the_matching_account() {
    let _s = SERIAL.lock().await;
    reset_states();
    let h = harness(&Opts::new(Scenario::Google));
    let state = h.run().await;
    assert_eq!(state.phase, ReloginPhase::Done, "state: {state:?}");
    assert_captured(&h);
}

#[tokio::test]
async fn google_chooser_without_the_account_needs_the_human() {
    let _s = SERIAL.lock().await;
    reset_states();
    let h = harness(&Opts::new(Scenario::GoogleWrongAccount));
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::ProfileCold);
    assert_untouched(&h);
    let audit = h.last_audit();
    assert_eq!(
        (audit.outcome.as_str(), audit.reason.as_deref()),
        ("needs_you", Some("profile_cold"))
    );
}

#[tokio::test]
async fn a_signed_out_profile_with_no_code_inbox_is_profile_cold() {
    let _s = SERIAL.lock().await;
    reset_states();
    let h = harness(&Opts::new(Scenario::SignedOut));
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::ProfileCold);
    assert_untouched(&h);
    let profile = repo::get_profile(&h.env.db, "claude-prof")
        .expect("profile")
        .expect("row");
    assert_eq!(profile.last_result.as_deref(), Some("profile_cold"));
    assert!(
        profile.last_warm_at_ms.is_none(),
        "a failure does not stamp a warm run"
    );
}

#[tokio::test]
async fn email_code_flow_types_the_fresh_code_from_the_fake_proton_inbox() {
    let _s = SERIAL.lock().await;
    reset_states();
    let (logs, _g) = capture_logs();
    let h = harness(&Opts::new(Scenario::EmailCode));
    let state = h.run().await;
    assert_eq!(state.phase, ReloginPhase::Done, "state: {state:?}");
    // The page only advances for the fresh code: the stale one in the inbox
    // (and the unrelated bank code) would have been refused.
    assert!(
        h.web.code_verified.load(Ordering::SeqCst),
        "the fresh code was typed"
    );
    assert_captured(&h);
    let events = h.events.lock().expect("events").join("\n");
    assert!(events.contains("\"step\":\"waiting_for_code\""), "{events}");
    assert_no_secrets(&h.leftovers(&logs));
}

#[tokio::test]
async fn email_code_flow_signs_in_to_proton_with_the_vault_login() {
    let _s = SERIAL.lock().await;
    reset_states();
    let (logs, _g) = capture_logs();
    let mut o = Opts::new(Scenario::EmailCode);
    o.proton = Proton::LoginForm;
    let h = harness(&o);
    let state = h.run().await;
    assert_eq!(state.phase, ReloginPhase::Done, "state: {state:?}");
    assert!(
        h.web.proton_signed_in.load(Ordering::SeqCst),
        "the vault login was typed"
    );
    assert!(h.web.code_verified.load(Ordering::SeqCst));
    assert_captured(&h);
    assert_no_secrets(&h.leftovers(&logs));
}

#[tokio::test]
async fn proton_second_factor_needs_the_human_and_requests_no_email() {
    let _s = SERIAL.lock().await;
    reset_states();
    let mut o = Opts::new(Scenario::EmailCode);
    o.proton = Proton::SecondFactor;
    let h = harness(&o);
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::ProtonSecondFactor);
    assert!(
        !h.web.code_requested.load(Ordering::SeqCst),
        "the inbox is checked BEFORE a sign-in email is requested"
    );
    assert_untouched(&h);
}

#[tokio::test]
async fn proton_logged_out_without_a_vault_login_needs_the_human() {
    let _s = SERIAL.lock().await;
    reset_states();
    let mut o = Opts::new(Scenario::EmailCode);
    o.proton = Proton::LoginForm;
    o.vault = false;
    let h = harness(&o);
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::ProtonLoggedOut);
    assert!(!h.web.code_requested.load(Ordering::SeqCst));
    assert_untouched(&h);
}

#[tokio::test]
async fn identity_mismatch_writes_nothing_and_says_so() {
    let _s = SERIAL.lock().await;
    reset_states();
    let mut o = Opts::new(Scenario::Warm);
    o.identity = OTHER_ID;
    let h = harness(&o);
    let before = accounts_repo::get(&h.env.db, ACCOUNT_ID)
        .expect("get")
        .expect("row");
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::IdentityMismatch);
    let after = accounts_repo::get(&h.env.db, ACCOUNT_ID)
        .expect("get")
        .expect("row");
    assert_eq!(before, after, "the stored row is byte-for-byte unchanged");
    assert_untouched(&h);
    assert!(accounts_repo::get(&h.env.db, OTHER_ID)
        .expect("get")
        .is_none());
    let audit = h.last_audit();
    assert_eq!(
        (audit.outcome.as_str(), audit.reason.as_deref()),
        ("failed", Some("identity_mismatch"))
    );
}

#[tokio::test]
async fn a_cli_that_exits_one_is_cli_failed() {
    let _s = SERIAL.lock().await;
    reset_states();
    let mut o = Opts::new(Scenario::Warm);
    o.cli = CliMode::Exits1;
    let h = harness(&o);
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::CliFailed);
    assert_untouched(&h);
    assert_eq!(h.last_audit().reason.as_deref(), Some("cli_failed"));
}

#[tokio::test]
async fn a_panic_in_the_run_is_observed_and_audited() {
    let _s = SERIAL.lock().await;
    reset_states();
    let h = harness_with(&Opts::new(Scenario::Warm), PanickingLauncher);
    let state = h.run().await;
    assert_needs_you(&state, ReloginReason::Other);
    let audit = h.last_audit();
    assert_eq!(
        (audit.outcome.as_str(), audit.reason.as_deref()),
        ("failed", Some("other"))
    );
    assert!(audit.finished_at_ms.is_some(), "the audit row was finished");
    assert!(!super::any_running(), "a dead run is not left Running");
    assert_untouched(&h);
}

// ── Refusals (no browser) ───────────────────────────────────────────────────

fn seeded_db() -> DbPool {
    let db = personas_db::init_test_db().expect("db");
    seed(&db, false);
    db
}

#[tokio::test]
async fn refusals_are_busy_rate_limited_and_not_linked_and_write_no_audit_row() {
    let _s = SERIAL.lock().await;
    reset_states();
    let db = seeded_db();

    // Rate limit: three starts inside the hour.
    for _ in 0..3 {
        repo::start_run(&db, ACCOUNT_ID, "manual").expect("run");
    }
    let Begin::Refused(s) = orchestrator::begin(&db, ACCOUNT_ID, "manual").expect("begin") else {
        panic!("expected a refusal");
    };
    assert_needs_you(&s, ReloginReason::RateLimited);
    assert_eq!(
        repo::recent_runs(&db, ACCOUNT_ID, 10).expect("runs").len(),
        3,
        "no audit row for a refusal"
    );

    // Busy: another account's run is going.
    reset_states();
    let db = seeded_db();
    super::set_state(ReloginState {
        account_id: OTHER_ID.into(),
        phase: ReloginPhase::Running,
        step: None,
        reason: None,
        trigger: "manual".into(),
        started_at_ms: 1,
    });
    let Begin::Refused(s) = orchestrator::begin(&db, ACCOUNT_ID, "manual").expect("begin") else {
        panic!("expected a refusal");
    };
    assert_needs_you(&s, ReloginReason::Busy);
    assert!(
        state_of(OTHER_ID).is_some_and(|o| o.phase == ReloginPhase::Running),
        "the running state is not clobbered"
    );

    // Not linked: no profile on the account.
    reset_states();
    repo::set_link(
        &db,
        &repo::AccountLinkRow {
            account_id: ACCOUNT_ID.into(),
            profile_key: None,
            code_inbox_profile_key: None,
            relogin_unattended: false,
        },
    )
    .expect("unlink");
    let Begin::Refused(s) = orchestrator::begin(&db, ACCOUNT_ID, "manual").expect("begin") else {
        panic!("expected a refusal");
    };
    assert_needs_you(&s, ReloginReason::ProfileNotLinked);

    // An unknown account is an error, not a state.
    assert!(orchestrator::begin(&db, "nobody", "manual").is_err());
    reset_states();
}

#[test]
fn profile_save_derives_the_dir_and_rejects_bad_keys() {
    let db = personas_db::init_test_db().expect("db");
    let app_data = tempfile::tempdir().expect("tmp");
    let list = super::save_profile(&db, app_data.path(), "work-1", " Work ", Some("vault-1"))
        .expect("save");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].label, "Work");
    assert_eq!(list[0].vault_credential_id.as_deref(), Some("vault-1"));
    let row = repo::get_profile(&db, "work-1").expect("get").expect("row");
    assert!(Path::new(&row.dir).starts_with(app_data.path().join("claude-login-profiles")));
    for bad in ["", "../x", "A", "a/b", "a b"] {
        assert!(
            super::save_profile(&db, app_data.path(), bad, "L", None).is_err(),
            "key {bad:?}"
        );
    }
    assert!(super::save_profile(&db, app_data.path(), "k", "  ", None).is_err());
}

/// Set an env var for one test and put it back.
struct EnvGuard {
    key: &'static str,
    prev: Option<std::ffi::OsString>,
}

impl EnvGuard {
    fn set(key: &'static str, value: &Path) -> Self {
        let prev = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}
