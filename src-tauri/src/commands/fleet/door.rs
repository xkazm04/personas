//! Fleet DOOR sessions (spark one-control): runs another tool hands to the
//! fleet through the `/fleet/enqueue` HTTP door (`local_http::fleet_door`)
//! and the `scripts/fleet/personas-run.mjs` shim, instead of spawning its own
//! `claude -p` beside the fleet.
//!
//! ## What makes a session a door session
//!
//! Only two origins may come through the door - [`DispatchOrigin::LensScan`]
//! and [`DispatchOrigin::AppMaster`] - and the door never mints any other.
//! The dispatch is an ordinary headless admission through `queue::admit`, so
//! the cap, the budgets and the five-hour window govern it like everything
//! else. What differs travels as MARKER ARGS in the dispatch's `args`, the
//! same way the engine markers do (`queue::engine_marker`), because `args` is
//! the one durable place a queued row keeps its dispatch:
//!
//! - [`OUTPUT_ARG`] `<text|stream-json>` - marks the session as a door session
//!   and names the output format its caller asked `claude` for.
//! - [`ENV_ARG`] `<KEY=VALUE>` (repeatable) - environment for the child,
//!   filtered again here through [`env_key_allowed`] whatever the row says.
//!
//! [`cli_args`] strips both before the argv is built; neither reaches `claude`.
//!
//! ## Why the output has its own file
//!
//! The registry's `OutputRing` is capped (`OUTPUT_RING_CAP`, 512 KiB) and it is
//! fed COOKED display lines, not the child's bytes: it cannot relay a run. A
//! door session's stdout is therefore teed, byte for byte, below the line
//! reader ([`Tee`]) into an append-only file under the app data dir,
//! `fleet-door/<sessionId>.out`, and `/fleet/sessions/{id}/output` serves that
//! file by offset. For `--output-format text` the file instead receives what
//! `claude -p --output-format text` prints: the closing `result` text and a
//! newline ([`on_result`]).
//!
//! ## One turn, then exit
//!
//! A door session's stdin is closed right after the seed, so `claude -p`
//! answers the one prompt and exits on its own with its own exit code - the
//! same lifecycle the caller's own `claude -p` had. It is never a one-shot
//! worker label (no completion-line settle, no 15-minute `awaiting_input`
//! park) and it is exempt from the silence sweep like a contest seat, because
//! a long silent tool call is normal for a lens-scan or a builder run and the
//! caller owns its own wall clock.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::AppState;

use super::queue::{self, Admission, DispatchOrigin, DispatchRequest};
use super::registry::{now_ms, registry, KillOutcome};
use super::types::{state_to_token, FleetSessionMode, FleetSessionState};

/// Marker naming a door session's output format. Never reaches the CLI.
pub const OUTPUT_ARG: &str = "--door-output";
/// Marker carrying one `KEY=VALUE` of the child's environment. Never reaches
/// the CLI.
pub const ENV_ARG: &str = "--door-env";
/// Every door session's run label starts with this, then the origin token,
/// then the caller's own label when it gave one.
pub const RUN_LABEL_PREFIX: &str = "fleet-door:";
/// The directory under the app data dir that holds the output files.
pub const DIR_NAME: &str = "fleet-door";
/// At most this many environment entries per run.
pub const MAX_ENV_ENTRIES: usize = 32;
/// At most this many bytes in one environment value.
pub const MAX_ENV_VALUE_LEN: usize = 4096;
/// The exact keys outside the two prefixes. `BP_JOB_ID` is bp's job id; the
/// other four are what the headless App Master's `workerEnv` sets on a
/// builder, and a builder that lost them would run an uncapped cargo on every
/// core (`CARGO_BUILD_JOBS`), cold-build a per-worktree target
/// (`CARGO_TARGET_DIR`), park on background waits
/// (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) and lose its run label
/// (`PERSONAS_RUN_LABEL`, also the shim's label). EXACT keys, never a family:
/// `CARGO_HOME` (a base key), `CARGO_REGISTRIES_*` (tokens) and every other
/// `CLAUDE_CODE_*` stay out.
const ENV_EXACT: [&str; 5] = [
    "BP_JOB_ID",
    "CARGO_BUILD_JOBS",
    "CARGO_TARGET_DIR",
    "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS",
    "PERSONAS_RUN_LABEL",
];
/// The two allowed key prefixes.
const ENV_PREFIXES: [&str; 2] = ["LENS_SCAN_", "APPMASTER_"];
/// The allowlist in words, for the door's refusal message.
pub const ENV_ALLOWLIST_TEXT: &str = concat!(
    "BP_JOB_ID, CARGO_BUILD_JOBS, CARGO_TARGET_DIR, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, ",
    "PERSONAS_RUN_LABEL, LENS_SCAN_* and APPMASTER_*"
);
/// How long an output file (and its capture record) is kept after it was
/// last written.
const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// How long after a session went terminal its output is called complete even
/// though the stdout pump never reported EOF (a grandchild holding the pipe,
/// or a pump that died). The headless reaper already waits 3 s for the pump.
const DRAIN_GRACE_MS: i64 = 5_000;
/// The reason stamped on a session its door caller cancelled.
pub const CANCEL_REASON: &str = "cancelled by its fleet-door caller";
/// The reason stamped on a session whose caller stopped polling.
pub const LEASE_REASON: &str =
    "cancelled: its fleet-door caller stopped polling (the personas-run shim was killed)";
/// How long a door session may go without its caller touching the door before
/// it is cancelled. The shim long-polls `/output` at most 30 s apart, so this
/// is four missed polls; the staleness ticker (30 s) checks it.
const LEASE_MS: i64 = 120_000;

/// The output format the caller asked `claude` for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DoorOutput {
    Text,
    StreamJson,
}

impl DoorOutput {
    pub fn token(self) -> &'static str {
        match self {
            DoorOutput::Text => "text",
            DoorOutput::StreamJson => "stream-json",
        }
    }

    pub fn parse(token: &str) -> Option<Self> {
        match token {
            "text" => Some(DoorOutput::Text),
            "stream-json" => Some(DoorOutput::StreamJson),
            _ => None,
        }
    }
}

/// The origin a door caller may name, by its exact token; `None` for every
/// other token. Deliberately NOT `DispatchOrigin::parse`, which reads an
/// unknown token as `Manual`.
pub fn door_origin(token: &str) -> Option<DispatchOrigin> {
    [DispatchOrigin::LensScan, DispatchOrigin::AppMaster]
        .into_iter()
        .find(|o| o.token() == token)
}

/// True for a row whose origin token is a door origin. Such a row is PINNED
/// to this device: a lens-scan run's `.ai/lens-scan/scan.db` is gitignored
/// and an App Master builder's worktree is local, so neither can travel with
/// a mesh move.
pub fn is_pinned_local(origin_token: Option<&str>) -> bool {
    origin_token.and_then(door_origin).is_some()
}

/// True for a door session's run label.
pub fn is_door_run_label(run_label: Option<&str>) -> bool {
    run_label.is_some_and(|l| l.trim_start().starts_with(RUN_LABEL_PREFIX))
}

/// The run label a door session carries: `fleet-door:<origin>[:<label>]`.
pub fn run_label_for(origin: DispatchOrigin, label: Option<&str>) -> String {
    match label.map(str::trim).filter(|l| !l.is_empty()) {
        Some(l) => format!("{RUN_LABEL_PREFIX}{}:{l}", origin.token()),
        None => format!("{RUN_LABEL_PREFIX}{}", origin.token()),
    }
}

/// May a door caller set this environment key on the child? The five
/// [`ENV_EXACT`] keys, `LENS_SCAN_*` and `APPMASTER_*`, spelled in
/// `[A-Z0-9_]` - nothing else.
pub fn env_key_allowed(key: &str) -> bool {
    let shaped = !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
    shaped && (ENV_EXACT.contains(&key) || ENV_PREFIXES.iter().any(|p| key.starts_with(p)))
}

/// What a door session carries beyond an ordinary headless dispatch, read
/// back from its args.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DoorSpec {
    pub output: DoorOutput,
    pub env: Vec<(String, String)>,
}

/// One validated door run, as the HTTP adapter hands it over.
#[derive(Clone, Debug)]
pub struct DoorRun {
    pub cwd: String,
    pub prompt: String,
    pub origin: DispatchOrigin,
    pub run_label: Option<String>,
    pub model: Option<String>,
    pub output: DoorOutput,
    pub session_id: Option<String>,
    pub env: Vec<(String, String)>,
}

/// The headless dispatch a door run becomes. Pure.
pub fn dispatch_request(run: &DoorRun) -> DispatchRequest {
    let mut extra = vec![OUTPUT_ARG.to_string(), run.output.token().to_string()];
    for (k, v) in &run.env {
        extra.push(ENV_ARG.to_string());
        extra.push(format!("{k}={v}"));
    }
    if let Some(m) = run.model.as_deref() {
        extra.push("--model".to_string());
        extra.push(m.to_string());
    }
    if let Some(s) = run.session_id.as_deref() {
        extra.push("--session-id".to_string());
        extra.push(s.to_string());
    }
    let who = match run.origin {
        DispatchOrigin::AppMaster => "app-master",
        _ => "lens-scan",
    };
    let label = run
        .run_label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    DispatchRequest {
        cwd: run.cwd.clone(),
        name: Some(who.to_string()),
        title: Some(match label {
            Some(l) => format!("{who}: {l}"),
            None => format!("{who} run"),
        }),
        args: queue::headless_args(&run.prompt, extra),
        mode: FleetSessionMode::Headless,
        run_label: Some(run_label_for(run.origin, label)),
        origin: run.origin,
        persona_id: None,
        goal_id: None,
        cycle_index: None,
        not_before_ms: None,
        profile: None,
    }
}

/// Admit a door run through the fleet's ONE door.
pub async fn enqueue(app: &AppHandle, run: DoorRun) -> Result<Admission, AppError> {
    if let Some(dir) = output_dir(app) {
        prune(&dir);
    }
    let admission = queue::admit(app, dispatch_request(&run)).await?;
    touch(&admission.session_id);
    Ok(admission)
}

// ---------------------------------------------------------------------------
// The caller's lease
// ---------------------------------------------------------------------------

/// When each live door session's caller last touched the door.
///
/// WHY: the shim cancels its session on SIGINT/SIGTERM, but on Windows the
/// callers end it with `taskkill /F` (lens-scan's `drive.mjs` timeout, bp's
/// kill) or a pid kill (the App Master), which no handler survives. A session
/// whose relay is gone would run to the end with nobody reading it, holding a
/// slot. Stdin closing cannot be the signal: both callers close stdin right
/// after writing the prompt.
fn leases() -> &'static Mutex<HashMap<String, i64>> {
    static LEASES: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();
    LEASES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The caller is still there.
pub fn touch(session_id: &str) {
    leases()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(session_id.to_string(), now_ms());
}

/// Which of `live` have outlived their lease. Forgets every session not in
/// `live`, and starts a lease for one it has never seen (a row that survived a
/// restart gets a full lease for its caller to reconnect). Pure over its map.
fn lapsed(map: &mut HashMap<String, i64>, live: &[String], now: i64) -> Vec<String> {
    map.retain(|id, _| live.contains(id));
    live.iter()
        .filter(|id| now - *map.entry((*id).clone()).or_insert(now) >= LEASE_MS)
        .cloned()
        .collect()
}

/// The staleness ticker's pass: cancel every live door session whose caller
/// stopped polling.
pub(super) fn lease_pass(app: &AppHandle, now: i64) {
    let live: Vec<String> = registry()
        .list_dto()
        .into_iter()
        .filter(|s| is_pinned_local(s.origin.as_deref()) && !is_final(s.state))
        .map(|s| s.id)
        .collect();
    let expired = lapsed(
        &mut leases().lock().unwrap_or_else(|e| e.into_inner()),
        &live,
        now,
    );
    for id in expired {
        leases()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        if let Err(e) = cancel_with_reason(app, &id, LEASE_REASON) {
            tracing::warn!(session_id = %id, error = %e, "fleet door: lease cancel failed");
        }
    }
}

// ---------------------------------------------------------------------------
// The child's environment
// ---------------------------------------------------------------------------

/// The inherited variables a door run keeps. A door run's environment is
/// BUILT, not edited (`credential-injection-into-child`): the spawn clears the
/// app's environment and passes only these, then the caller's allowlisted
/// [`DoorSpec::env`]. Any same-user process holding the local token can start
/// a door run, and the run is an agent with a shell, so whatever the app's
/// process carries (its bearer key, a provider key a user exported) must not
/// ride along. What is here is OS plumbing, the user's own directories, the
/// toolchain homes a build or test inside the run looks for, and proxy / CA
/// settings - paths and switches, never a credential. A run that fails for a
/// missing variable gets that variable added HERE, with a comment.
const BASE_ENV_KEYS: &[&str] = &[
    // OS plumbing (Windows names; lookups are case-insensitive there).
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "OS",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "COMPUTERNAME",
    "TEMP",
    "TMP",
    "PROGRAMDATA",
    "ALLUSERSPROFILE",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    // The user, and where their configuration lives (claude reads its
    // subscription login from here).
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "USERNAME",
    "USERDOMAIN",
    "USER",
    "LOGNAME",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "TMPDIR",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_GIT_BASH_PATH",
    // Locale and terminal.
    "LANG",
    "LC_ALL",
    "TERM",
    "TZ",
    "SHELL",
    // Toolchain homes.
    "CARGO_HOME",
    "RUSTUP_HOME",
    "NVM_HOME",
    "NVM_SYMLINK",
    "VOLTA_HOME",
    "PNPM_HOME",
    "JAVA_HOME",
    "GOPATH",
    "GOROOT",
    // Network: proxies and an extra CA bundle.
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
];

/// The base environment of a door run: each [`BASE_ENV_KEYS`] entry the app's
/// own environment has.
pub(super) fn base_env() -> Vec<(&'static str, OsString)> {
    BASE_ENV_KEYS
        .iter()
        .filter_map(|&k| std::env::var_os(k).map(|v| (k, v)))
        .collect()
}

/// The WHOLE environment of a door run, which the headless spawn sets on a
/// cleared command (`env_clear` then `envs`): the plumbing [`base_env`]
/// names, the traffic switch, then the caller's allowlisted [`DoorSpec::env`].
/// Pure over the app's environment, so the tests read exactly what the child
/// gets without spawning anything.
pub(super) fn child_env(spec: &DoorSpec) -> Vec<(OsString, OsString)> {
    let mut env: Vec<(OsString, OsString)> =
        base_env().into_iter().map(|(k, v)| (k.into(), v)).collect();
    env.push((
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
        "1".into(),
    ));
    env.extend(spec.env.iter().map(|(k, v)| (k.into(), v.into())));
    env
}

/// The door spec in a dispatch's args, or `None` for any other session.
pub(super) fn spec_of(args: &[String]) -> Option<DoorSpec> {
    let mut output = None;
    let mut env = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if a == OUTPUT_ARG || a == ENV_ARG {
            if let Some(v) = args.get(i + 1) {
                if a == OUTPUT_ARG {
                    output = DoorOutput::parse(v);
                } else if let Some((k, val)) = v.split_once('=') {
                    if env_key_allowed(k) && env.len() < MAX_ENV_ENTRIES {
                        env.push((k.to_string(), val.to_string()));
                    }
                }
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    output.map(|output| DoorSpec { output, env })
}

/// `args` without the door markers (and their values): what may reach the
/// CLI.
pub(super) fn cli_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if a == OUTPUT_ARG || a == ENV_ARG {
            i += 2;
            continue;
        }
        out.push(args[i].clone());
        i += 1;
    }
    out
}

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

/// One door session's capture. `file` is dropped (closed) at EOF so the file
/// can be pruned later on Windows.
struct Capture {
    output: DoorOutput,
    file: Option<File>,
    closed: bool,
    error: Option<String>,
    result_error: Option<bool>,
    touched_ms: i64,
}

impl Capture {
    fn write(&mut self, bytes: &[u8]) {
        if self.error.is_some() || bytes.is_empty() {
            return;
        }
        if let Some(f) = self.file.as_mut() {
            if let Err(e) = f.write_all(bytes) {
                // A relay that silently lost bytes would be worse than a
                // failed one: record it, and the door reports the run failed.
                tracing::error!(error = %e, "fleet door: output capture write failed");
                self.error = Some(format!("output capture write failed: {e}"));
            }
        }
        self.touched_ms = now_ms();
    }
}

fn captures() -> &'static Mutex<HashMap<String, Capture>> {
    static CAPTURES: OnceLock<Mutex<HashMap<String, Capture>>> = OnceLock::new();
    CAPTURES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `<app data dir>/fleet-door`, the dir the boot actually used (a
/// `PERSONAS_DATA_DIR` override included). `None` before the app state exists.
pub fn output_dir(app: &AppHandle) -> Option<PathBuf> {
    app.try_state::<Arc<AppState>>()
        .map(|s| s.leadership.app_data_dir().join(DIR_NAME))
}

/// The output file of one session. The id is a registry id this module minted
/// a row for; the HTTP adapter checks it is one before it builds a path.
pub fn output_path(dir: &Path, session_id: &str) -> PathBuf {
    dir.join(format!("{session_id}.out"))
}

/// Create (truncate) the session's output file and start its capture record.
/// Called BEFORE the child is spawned, so a run whose output cannot be kept
/// fails at spawn instead of running blind.
pub(super) fn open_capture(
    app: &AppHandle,
    session_id: &str,
    output: DoorOutput,
) -> Result<(), String> {
    let dir = output_dir(app).ok_or("fleet door: the app data dir is not available yet")?;
    open_capture_in(&dir, session_id, output)
}

fn open_capture_in(dir: &Path, session_id: &str, output: DoorOutput) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("fleet door: could not create {}: {e}", dir.display()))?;
    let path = output_path(dir, session_id);
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| format!("fleet door: could not open {}: {e}", path.display()))?;
    captures().lock().unwrap_or_else(|e| e.into_inner()).insert(
        session_id.to_string(),
        Capture {
            output,
            file: Some(file),
            closed: false,
            error: None,
            result_error: None,
            touched_ms: now_ms(),
        },
    );
    Ok(())
}

/// The capture failed before the child existed (the spawn errored): close it
/// so a reader is not left waiting on a pump that never starts.
pub(super) fn abandon_capture(session_id: &str, why: &str) {
    let mut map = captures().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = map.get_mut(session_id) {
        c.file = None;
        c.closed = true;
        c.error.get_or_insert_with(|| why.to_string());
    }
}

/// Raw stdout bytes of a `stream-json` door session, in read order.
fn tee(session_id: &str, bytes: &[u8]) {
    let mut map = captures().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = map.get_mut(session_id) {
        if c.output == DoorOutput::StreamJson {
            c.write(bytes);
        }
    }
}

/// The turn's closing `result` event: remember whether it was an error and,
/// for a `text` session, write what `claude -p --output-format text` prints -
/// the result text and a newline.
pub(super) fn on_result(session_id: &str, event: &serde_json::Value) {
    let mut map = captures().lock().unwrap_or_else(|e| e.into_inner());
    let Some(c) = map.get_mut(session_id) else {
        return;
    };
    let is_error = event
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| event.get("subtype").and_then(|s| s.as_str()) != Some("success"));
    c.result_error = Some(is_error);
    if c.output == DoorOutput::Text {
        if let Some(text) = event.get("result").and_then(|r| r.as_str()) {
            c.write(text.as_bytes());
            c.write(b"\n");
        }
    }
}

/// The stdout pump reached EOF: every byte the child wrote is in the file.
pub(super) fn close_capture(session_id: &str) {
    let mut map = captures().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = map.get_mut(session_id) {
        if let Some(mut f) = c.file.take() {
            let _ = f.flush();
        }
        c.closed = true;
        c.touched_ms = now_ms();
    }
}

/// A reader that hands every byte it reads to the session's capture before
/// the line reader above it sees it. Below `BufReader`, so the capture sees
/// the child's bytes exactly once, in order, whatever the line reader then
/// does with them (trimming, skipping blank lines, stopping at bad UTF-8).
pub(super) struct Tee<R> {
    inner: R,
    session_id: Option<String>,
}

impl<R> Tee<R> {
    /// `session_id` is `Some` only for a door session.
    pub(super) fn new(inner: R, session_id: Option<String>) -> Self {
        Self { inner, session_id }
    }
}

impl<R: Read> Read for Tee<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if let Some(id) = self.session_id.as_deref() {
            tee(id, &buf[..n]);
        }
        Ok(n)
    }
}

/// Delete output files untouched for [`RETENTION`] and forget their capture
/// records. Best effort; called on each enqueue, which bounds both.
fn prune(dir: &Path) {
    let cutoff = now_ms() - RETENTION.as_millis() as i64;
    captures()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|_, c| !c.closed || c.touched_ms >= cutoff);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("out") {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age > RETENTION);
        if old {
            let _ = std::fs::remove_file(&path);
        }
    }
}

// ---------------------------------------------------------------------------
// What the door reads back
// ---------------------------------------------------------------------------

/// `GET /fleet/sessions/{id}`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorStatus {
    pub session_id: String,
    /// The registry's own state token.
    pub state: String,
    pub origin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admitted_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at_ms: Option<i64>,
    /// The output is complete AND the state is final: nothing will change.
    pub ended: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
    /// Set when the output capture lost bytes; the run must be read as failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_error: Option<String>,
}

/// What the status of a session is built from - pure, for the tests.
#[derive(Debug, Clone)]
struct StatusFacts {
    state: FleetSessionState,
    exit_code: Option<i32>,
    last_activity_ms: i64,
    capture_closed: Option<bool>,
    result_error: Option<bool>,
}

/// A door session is over once its process is gone: exited, expired in the
/// queue, or hibernated (killed to free a slot).
fn is_final(state: FleetSessionState) -> bool {
    matches!(
        state,
        FleetSessionState::Exited | FleetSessionState::Expired | FleetSessionState::Hibernated
    )
}

/// Final state, and every byte the child wrote is in the file (or the pump
/// never reported EOF within [`DRAIN_GRACE_MS`] of the end).
fn ended(f: &StatusFacts, now: i64) -> bool {
    is_final(f.state)
        && match f.capture_closed {
            // Never spawned (cancelled or expired while queued), or the app
            // restarted under it: there is no pump to wait for.
            None => true,
            Some(true) => true,
            Some(false) => now - f.last_activity_ms >= DRAIN_GRACE_MS,
        }
}

/// The process's own exit code when it has one; otherwise the closing
/// `result` event's verdict (a session killed after it answered).
fn exit_code(f: &StatusFacts) -> Option<i32> {
    if !is_final(f.state) {
        return None;
    }
    f.exit_code
        .or_else(|| f.result_error.map(|e| if e { 1 } else { 0 }))
}

/// The door's own read of one of ITS sessions. `Forbidden` for a session the
/// door did not start - this route never reports on anyone else's work.
pub fn status(session_id: &str) -> Result<DoorStatus, AppError> {
    let dto = registry()
        .dto_of(session_id)
        .ok_or_else(|| AppError::NotFound(format!("fleet session {session_id}")))?;
    let origin = dto
        .origin
        .as_deref()
        .filter(|t| door_origin(t).is_some())
        .ok_or_else(|| {
            AppError::Forbidden(format!(
                "session {session_id} was not started through the fleet door"
            ))
        })?
        .to_string();
    // Every read of the door is the caller saying it is still there.
    touch(session_id);
    let (capture_closed, result_error, capture_error) = {
        let map = captures().lock().unwrap_or_else(|e| e.into_inner());
        match map.get(session_id) {
            Some(c) => (Some(c.closed), c.result_error, c.error.clone()),
            None => (None, None, None),
        }
    };
    let facts = StatusFacts {
        state: dto.state,
        exit_code: dto.exit_code,
        last_activity_ms: dto.last_activity_ms,
        capture_closed,
        result_error,
    };
    let fin = is_final(dto.state);
    Ok(DoorStatus {
        session_id: dto.id,
        state: state_to_token(dto.state).to_string(),
        origin,
        exit_code: exit_code(&facts),
        admitted_at_ms: dto.queued_at_ms.or(Some(dto.created_at_ms)),
        ended_at_ms: fin.then_some(dto.last_activity_ms),
        ended: ended(&facts, now_ms()),
        state_reason: dto.state_reason,
        capture_error,
    })
}

/// One read of a session's output.
#[derive(Debug, Clone)]
pub struct OutputChunk {
    pub bytes: Vec<u8>,
    pub next: u64,
    /// No byte will ever follow `next`, and the status is final.
    pub ended: bool,
}

/// The largest chunk one read returns.
pub const MAX_CHUNK: usize = 1024 * 1024;

/// Read up to [`MAX_CHUNK`] bytes of the file from `from`. A missing file is
/// an empty one (a queued session has not started writing). `Validation` for
/// an offset past the end: the caller lost track of its own position.
fn read_from(path: &Path, from: u64) -> Result<(Vec<u8>, u64), AppError> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return if from == 0 {
                Ok((Vec::new(), 0))
            } else {
                Err(AppError::Validation(format!(
                    "offset {from} is past the end of the output (0 bytes)"
                )))
            };
        }
        Err(e) => return Err(AppError::Internal(format!("fleet door: open output: {e}"))),
    };
    let len = file
        .metadata()
        .map_err(|e| AppError::Internal(format!("fleet door: stat output: {e}")))?
        .len();
    if from > len {
        return Err(AppError::Validation(format!(
            "offset {from} is past the end of the output ({len} bytes)"
        )));
    }
    let want = ((len - from) as usize).min(MAX_CHUNK);
    let mut buf = vec![0u8; want];
    file.seek(SeekFrom::Start(from))
        .and_then(|_| file.read_exact(&mut buf))
        .map_err(|e| AppError::Internal(format!("fleet door: read output: {e}")))?;
    Ok((buf, len))
}

/// Long-poll a door session's output from byte `from`: returns as soon as
/// there are bytes, the run has ended, or `wait` has passed.
///
/// `ended` is computed BEFORE the file is read, so every byte written before
/// the run was seen as ended is in this read or a later one; and it is only
/// reported once the read reached the end of the file.
pub async fn read_output(
    app: &AppHandle,
    session_id: &str,
    from: u64,
    wait: Duration,
) -> Result<OutputChunk, AppError> {
    let dir = output_dir(app)
        .ok_or_else(|| AppError::Internal("fleet door: app state not ready".into()))?;
    let path = output_path(&dir, session_id);
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        let was_ended = status(session_id)?.ended;
        let p = path.clone();
        let (bytes, len) = tokio::task::spawn_blocking(move || read_from(&p, from))
            .await
            .map_err(|e| AppError::Internal(format!("fleet door: output read task: {e}")))??;
        let next = from + bytes.len() as u64;
        if !bytes.is_empty() || was_ended || tokio::time::Instant::now() >= deadline {
            return Ok(OutputChunk {
                ended: was_ended && next == len,
                bytes,
                next,
            });
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// `POST /fleet/sessions/{id}/cancel`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOutcome {
    pub session_id: String,
    /// `false` when the session had already ended.
    pub cancelled: bool,
    pub state: String,
}

/// Cancel one of the door's own sessions: a queued row leaves the queue
/// (`Queued -> Exited`), a live one is killed through its own kill handle
/// (the reaper then records the exit). Never touches anyone else's session.
pub fn cancel(app: &AppHandle, session_id: &str) -> Result<CancelOutcome, AppError> {
    cancel_with_reason(app, session_id, CANCEL_REASON)
}

fn cancel_with_reason(
    app: &AppHandle,
    session_id: &str,
    reason: &str,
) -> Result<CancelOutcome, AppError> {
    let before = status(session_id)?;
    let cancelled = if before.state == state_to_token(FleetSessionState::Queued)
        && queue::cancel_dispatch_with_reason(app, session_id, reason).is_ok()
    {
        true
    } else if is_final_token(&status(session_id)?.state) {
        false
    } else {
        // Live (or promoted between the read and the cancel above).
        registry().set_state_reason(session_id, reason);
        let outcome = registry().close_pty_handles_reporting(session_id);
        if let Some(e) = outcome.failure() {
            super::pty::emit_registry_changed(app, "updated", session_id);
            return Err(AppError::Internal(format!(
                "fleet door: kill requested, child still alive: {e} (session {session_id})"
            )));
        }
        super::debug_log::lifecycle(session_id, "cancelled", reason);
        super::pty::emit_registry_changed(app, "updated", session_id);
        matches!(outcome, KillOutcome::Killed)
    };
    Ok(CancelOutcome {
        session_id: session_id.to_string(),
        cancelled,
        state: status(session_id)?.state,
    })
}

fn is_final_token(token: &str) -> bool {
    super::types::token_to_state(token).is_some_and(is_final)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(output: DoorOutput) -> DoorRun {
        DoorRun {
            cwd: "C:/code/personas".into(),
            prompt: "/lens-scan measure dev".into(),
            origin: DispatchOrigin::LensScan,
            run_label: Some("bp nightly".into()),
            model: Some("opus".into()),
            output,
            session_id: Some("0f6b3c3e-0000-4000-8000-000000000001".into()),
            env: vec![("BP_JOB_ID".into(), "job-1".into())],
        }
    }

    /// The base environment carries plumbing, never a credential: none of the
    /// strips the headless spawn applies, nothing of the app's own, and no
    /// key the caller sets itself.
    #[test]
    fn the_base_environment_carries_no_credential() {
        let shaped = |k: &str| {
            let u = k.to_ascii_uppercase();
            ["KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL"]
                .iter()
                .any(|w| u.contains(w))
                || u.starts_with("ANTHROPIC_")
                || u.starts_with("PERSONAS_")
        };
        for &k in BASE_ENV_KEYS {
            assert!(!shaped(k), "{k} looks like a credential");
            assert!(
                !crate::engine::cli_process::CLI_SUBSCRIPTION_RESERVED_ENV.contains(&k),
                "{k} is stripped for subscription auth"
            );
            assert!(
                !super::super::pty::CLAUDE_NESTING_ENV.contains(&k),
                "{k} is a nesting variable"
            );
            assert!(!env_key_allowed(k), "{k} is the caller's to set");
        }
    }

    #[test]
    fn the_dispatch_carries_the_markers_and_the_cli_never_sees_them() {
        let req = dispatch_request(&run(DoorOutput::StreamJson));
        assert_eq!(req.origin, DispatchOrigin::LensScan);
        assert_eq!(
            req.run_label.as_deref(),
            Some("fleet-door:lens_scan:bp nightly")
        );
        assert!(matches!(req.mode, FleetSessionMode::Headless));
        let spec = spec_of(&req.args).expect("a door spec");
        assert_eq!(spec.output, DoorOutput::StreamJson);
        assert_eq!(spec.env, vec![("BP_JOB_ID".into(), "job-1".into())]);
        let cli = cli_args(&req.args);
        assert!(!cli.iter().any(|a| a == OUTPUT_ARG || a == ENV_ARG));
        assert!(!cli.iter().any(|a| a == "BP_JOB_ID=job-1"));
        assert!(cli.windows(2).any(|w| w[0] == "--model" && w[1] == "opus"));
        assert!(cli.windows(2).any(|w| w[0] == "--session-id"));
        assert!(spec_of(&queue::headless_args("x", vec![])).is_none());
    }

    #[test]
    fn a_row_cannot_smuggle_an_env_key_past_the_allowlist() {
        let args: Vec<String> = [
            OUTPUT_ARG,
            "text",
            ENV_ARG,
            "PATH=C:/evil",
            ENV_ARG,
            "LENS_SCAN_ROOT=C:/code",
            ENV_ARG,
            "no-equals",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let spec = spec_of(&args).expect("a door spec");
        assert_eq!(spec.output, DoorOutput::Text);
        assert_eq!(spec.env, vec![("LENS_SCAN_ROOT".into(), "C:/code".into())]);
    }

    #[test]
    fn env_keys_are_the_three_families_only() {
        // The exact set: five named keys plus the two families.
        for ok in [
            "BP_JOB_ID",
            "CARGO_BUILD_JOBS",
            "CARGO_TARGET_DIR",
            "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS",
            "PERSONAS_RUN_LABEL",
            "LENS_SCAN_CLAUDE_BIN",
            "APPMASTER_RUN",
        ] {
            assert!(env_key_allowed(ok), "{ok}");
        }
        assert_eq!(
            ENV_EXACT,
            [
                "BP_JOB_ID",
                "CARGO_BUILD_JOBS",
                "CARGO_TARGET_DIR",
                "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS",
                "PERSONAS_RUN_LABEL",
            ]
        );
        assert_eq!(ENV_PREFIXES, ["LENS_SCAN_", "APPMASTER_"]);
        for bad in [
            "",
            "PATH",
            "BP_JOB_IDX",
            "bp_job_id",
            "LENS_SCAN-X",
            "ANTHROPIC_API_KEY",
            "APPMASTER_RUN=1",
            "CLAUDE_CODE_ENTRYPOINT",
            // Neighbours of the four exact keys: never a family.
            "CARGO_HOME",
            "CARGO_BUILD_JOBSX",
            "CARGO_BUILD_TARGET",
            "CARGO_TARGET_DIR_X",
            "CARGO_REGISTRIES_CRATES_IO_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_PRINT_BG_WAIT_CEILING",
            "PERSONAS_RUN_ORIGIN",
            "PERSONAS_API_KEY",
            "PERSONAS_RUN_LABEL_X",
            "cargo_build_jobs",
        ] {
            assert!(!env_key_allowed(bad), "{bad}");
        }
        // No allowed exact key is one the spawn strips or a nesting variable.
        for &k in &ENV_EXACT {
            assert!(!crate::engine::cli_process::CLI_SUBSCRIPTION_RESERVED_ENV.contains(&k));
            assert!(!super::super::pty::CLAUDE_NESTING_ENV.contains(&k));
        }
    }

    /// An App Master builder's row carries its four build keys through the
    /// door into the spawned command's environment, beside the base plumbing,
    /// and nothing the row was not allowed to carry.
    #[test]
    fn an_app_master_row_s_build_keys_reach_the_spawned_env() {
        let mut r = run(DoorOutput::StreamJson);
        r.origin = DispatchOrigin::AppMaster;
        r.env = vec![
            ("APPMASTER_RUN_ID".into(), "night-1".into()),
            ("CARGO_BUILD_JOBS".into(), "6".into()),
            (
                "CARGO_TARGET_DIR".into(),
                "C:/code/personas/src-tauri/target".into(),
            ),
            ("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS".into(), "0".into()),
            ("PERSONAS_RUN_LABEL".into(), "appmaster:pof:b1".into()),
        ];
        let mut args = dispatch_request(&r).args;
        // A row edited behind the door's back cannot add a key either.
        args.push(ENV_ARG.into());
        args.push("CARGO_HOME=C:/evil".into());
        args.push(ENV_ARG.into());
        args.push("CLAUDE_CODE_OAUTH_TOKEN=stolen".into());
        let spec = spec_of(&args).expect("a door spec");

        let built = child_env(&spec);
        let envs: HashMap<String, String> = built
            .iter()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.to_string_lossy().into_owned(),
                )
            })
            .collect();
        assert_eq!(envs.len(), built.len(), "no key is set twice");
        let val = |k: &str| envs.get(k).cloned();
        assert_eq!(val("CARGO_BUILD_JOBS").as_deref(), Some("6"));
        assert_eq!(
            val("CARGO_TARGET_DIR").as_deref(),
            Some("C:/code/personas/src-tauri/target")
        );
        assert_eq!(
            val("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS").as_deref(),
            Some("0")
        );
        assert_eq!(
            val("PERSONAS_RUN_LABEL").as_deref(),
            Some("appmaster:pof:b1")
        );
        assert_eq!(val("APPMASTER_RUN_ID").as_deref(), Some("night-1"));
        assert_eq!(
            val("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC").as_deref(),
            Some("1")
        );
        assert_eq!(val("CLAUDE_CODE_OAUTH_TOKEN"), None);
        assert_eq!(val("PERSONAS_API_KEY"), None, "the app's bearer key never");
        // Nothing else new: every entry is a base key, the traffic switch, or
        // one of the row's allowed keys.
        let row: Vec<&str> = spec.env.iter().map(|(k, _)| k.as_str()).collect();
        for k in envs.keys() {
            assert!(
                BASE_ENV_KEYS.contains(&k.as_str())
                    || k == "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"
                    || row.contains(&k.as_str()),
                "{k} reached the child's env"
            );
        }
        assert_eq!(
            val("CARGO_HOME"),
            std::env::var("CARGO_HOME").ok(),
            "CARGO_HOME is the base env's, never the row's"
        );
    }

    #[test]
    fn only_the_two_door_origins_are_pinned_local() {
        assert!(is_pinned_local(Some("lens_scan")));
        assert!(is_pinned_local(Some("app_master")));
        for other in DispatchOrigin::ALL {
            if !matches!(other, DispatchOrigin::LensScan | DispatchOrigin::AppMaster) {
                assert!(!is_pinned_local(Some(other.token())), "{other:?}");
            }
        }
        assert!(!is_pinned_local(None));
        assert!(!is_pinned_local(Some("lens-scan")));
    }

    fn facts(state: FleetSessionState, closed: Option<bool>) -> StatusFacts {
        StatusFacts {
            state,
            exit_code: None,
            last_activity_ms: 1_000,
            capture_closed: closed,
            result_error: None,
        }
    }

    #[test]
    fn a_run_ends_when_its_process_is_gone_and_its_output_drained() {
        // Live: never ended, whatever the pump says.
        assert!(!ended(
            &facts(FleetSessionState::Running, Some(true)),
            1_000
        ));
        // Exited, pump still draining: wait, up to the grace.
        assert!(!ended(
            &facts(FleetSessionState::Exited, Some(false)),
            1_500
        ));
        assert!(ended(
            &facts(FleetSessionState::Exited, Some(false)),
            1_000 + DRAIN_GRACE_MS
        ));
        assert!(ended(&facts(FleetSessionState::Exited, Some(true)), 1_000));
        // Cancelled or expired in the queue: nothing was ever spawned.
        assert!(ended(&facts(FleetSessionState::Expired, None), 1_000));
        assert!(!ended(&facts(FleetSessionState::Queued, None), 1_000));
    }

    #[test]
    fn the_exit_code_is_the_process_s_then_the_result_s() {
        let mut f = facts(FleetSessionState::Exited, Some(true));
        f.exit_code = Some(3);
        f.result_error = Some(false);
        assert_eq!(exit_code(&f), Some(3));
        f.exit_code = None;
        assert_eq!(exit_code(&f), Some(0));
        f.result_error = Some(true);
        assert_eq!(exit_code(&f), Some(1));
        f.result_error = None;
        assert_eq!(exit_code(&f), None);
        f.state = FleetSessionState::Running;
        f.exit_code = Some(0);
        assert_eq!(exit_code(&f), None, "no exit code while live");
    }

    #[test]
    fn a_lease_lapses_only_for_a_live_session_its_caller_left() {
        let mut map = HashMap::new();
        let live = vec!["a".to_string(), "b".to_string()];
        map.insert("a".to_string(), 0);
        map.insert("gone".to_string(), 0);
        // "b" was never seen: it starts a lease now rather than lapsing.
        assert_eq!(lapsed(&mut map, &live, LEASE_MS - 1), Vec::<String>::new());
        assert!(!map.contains_key("gone"), "a final session is forgotten");
        assert_eq!(lapsed(&mut map, &live, LEASE_MS), vec!["a".to_string()]);
        map.insert("a".to_string(), LEASE_MS);
        assert_eq!(
            lapsed(&mut map, &live, 2 * LEASE_MS - 1),
            vec!["b".to_string()]
        );
    }

    #[test]
    fn the_tee_captures_every_byte_and_the_text_mode_writes_the_result() {
        let dir = tempfile::tempdir().unwrap();
        // stream-json: the raw bytes, blank lines and a split multi-byte char included.
        let raw =
            "{\"type\":\"system\"}\n\n{\"type\":\"result\",\"result\":\"h\u{e9}\u{1F600}\"}\n";
        open_capture_in(dir.path(), "s-raw", DoorOutput::StreamJson).unwrap();
        let mut tee = Tee::new(raw.as_bytes(), Some("s-raw".into()));
        let mut sink = Vec::new();
        let mut small = [0u8; 3];
        loop {
            let n = tee.read(&mut small).unwrap();
            if n == 0 {
                break;
            }
            sink.extend_from_slice(&small[..n]);
        }
        close_capture("s-raw");
        assert_eq!(sink, raw.as_bytes());
        let on_disk = std::fs::read(output_path(dir.path(), "s-raw")).unwrap();
        assert_eq!(on_disk, raw.as_bytes());

        // text: only the closing result and a newline.
        open_capture_in(dir.path(), "s-text", DoorOutput::Text).unwrap();
        let mut tee = Tee::new(raw.as_bytes(), Some("s-text".into()));
        std::io::copy(&mut tee, &mut std::io::sink()).unwrap();
        on_result(
            "s-text",
            &serde_json::json!({"type":"result","subtype":"success","is_error":false,"result":"done \u{2713}"}),
        );
        close_capture("s-text");
        let text = std::fs::read(output_path(dir.path(), "s-text")).unwrap();
        assert_eq!(text, "done \u{2713}\n".as_bytes());

        let (bytes, len) = read_from(&output_path(dir.path(), "s-raw"), 4).unwrap();
        assert_eq!(len, raw.len() as u64);
        assert_eq!(bytes, &raw.as_bytes()[4..]);
        assert!(read_from(&output_path(dir.path(), "s-raw"), len + 1).is_err());
        assert_eq!(
            read_from(&output_path(dir.path(), "missing"), 0).unwrap().1,
            0
        );
    }
}
