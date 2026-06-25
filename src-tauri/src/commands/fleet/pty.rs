//! PTY spawn + I/O multiplexing for Fleet sessions.
//!
//! Uses `portable-pty` (wezterm) which wraps ConPTY on Windows and
//! `posix_openpt` on Unix behind one API.
//!
//! Ownership:
//! - `master` and `writer` → registry (for resize / write_input).
//! - `reader` → moved into a tokio blocking task that emits chunks.
//! - `child` → moved into a tokio blocking task that waits + marks exit.
//!
//! The two background tasks own their handles directly so they never need
//! to look anything up via the registry while blocked on I/O.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::engine::event_registry::event_name;

use super::registry::{now_ms, registry, FleetSessionInner, OutputRing, OUTPUT_RING_CAP};
use super::types::FleetSessionState;

/// MCP wiring artefacts created at spawn time. Returned so we can hand
/// them to the cmd builder and the reaper (which cleans up the temp
/// file on session exit).
struct McpSpawn {
    /// Absolute path to the per-session mcp.json. Empty Option when
    /// MCP couldn't be wired (local_http not yet started, or write
    /// failed) — caller proceeds without `--mcp-config`.
    config_path: Option<PathBuf>,
}

/// `fleet-session-output` event payload.
#[derive(Serialize, Clone)]
struct OutputPayload<'a> {
    session_id: &'a str,
    chunk: String,
}

/// `fleet-session-exited` event payload.
#[derive(Serialize, Clone)]
struct ExitedPayload<'a> {
    session_id: &'a str,
    exit_code: Option<i32>,
}

/// `fleet-registry-changed` event payload.
#[derive(Serialize, Clone)]
struct RegistryChangedPayload<'a> {
    kind: &'a str,
    session_id: &'a str,
}

/// Max bytes kept for a captured terminal title (titles are short summaries).
const MAX_TITLE_BYTES: usize = 256;

/// Incremental scanner for OSC window/icon-title sequences
/// (`ESC ] {0|1|2} ; <utf8 title> (BEL | ESC \)`). Claude Code retitles the
/// terminal with a live task summary; we capture the latest title to label the
/// session. Byte-at-a-time, with state persisted across PTY reads, so a title
/// split mid-chunk still assembles.
#[derive(Default)]
struct OscTitleScanner {
    state: OscScanState,
    params: Vec<u8>,
    title: Vec<u8>,
}

#[derive(Default, Clone, Copy)]
enum OscScanState {
    #[default]
    Ground,
    Esc,      // saw ESC (0x1b)
    Params,   // saw `ESC ]`, collecting Ps digits before `;`
    Title,    // collecting the title text
    TitleEsc, // saw ESC inside the title — possible ST terminator (`ESC \`)
}

impl OscTitleScanner {
    /// Feed a PTY chunk; return the MOST RECENT complete title found, if any.
    fn feed(&mut self, bytes: &[u8]) -> Option<String> {
        let mut latest: Option<String> = None;
        for &b in bytes {
            match self.state {
                OscScanState::Ground => {
                    if b == 0x1b {
                        self.state = OscScanState::Esc;
                    }
                }
                OscScanState::Esc => {
                    if b == b']' {
                        self.params.clear();
                        self.state = OscScanState::Params;
                    } else {
                        self.state = OscScanState::Ground;
                    }
                }
                OscScanState::Params => {
                    if b == b';' {
                        // Title OSC iff Ps ∈ {0,1,2} (icon / window title).
                        if matches!(self.params.as_slice(), b"0" | b"1" | b"2") {
                            self.title.clear();
                            self.state = OscScanState::Title;
                        } else {
                            self.state = OscScanState::Ground;
                        }
                    } else if self.params.len() < 4 && b.is_ascii_digit() {
                        self.params.push(b);
                    } else {
                        self.state = OscScanState::Ground;
                    }
                }
                OscScanState::Title => match b {
                    0x07 => {
                        latest = Some(self.take_title());
                        self.state = OscScanState::Ground;
                    }
                    0x1b => self.state = OscScanState::TitleEsc,
                    _ => {
                        if self.title.len() < MAX_TITLE_BYTES {
                            self.title.push(b);
                        }
                    }
                },
                OscScanState::TitleEsc => {
                    if b == b'\\' {
                        latest = Some(self.take_title());
                    }
                    self.state = OscScanState::Ground;
                }
            }
        }
        latest
    }

    fn take_title(&mut self) -> String {
        let s = String::from_utf8_lossy(&self.title).trim().to_string();
        self.title.clear();
        s
    }
}

#[cfg(test)]
mod osc_title_tests {
    use super::OscTitleScanner;

    #[test]
    fn captures_bel_terminated_title() {
        let mut s = OscTitleScanner::default();
        assert_eq!(s.feed(b"\x1b]0;Fixing the auth bug\x07"), Some("Fixing the auth bug".into()));
    }

    #[test]
    fn captures_st_terminated_window_title() {
        let mut s = OscTitleScanner::default();
        // OSC 2 (window title) terminated by ST (ESC \).
        assert_eq!(s.feed(b"\x1b]2;Running tests\x1b\\"), Some("Running tests".into()));
    }

    #[test]
    fn assembles_title_split_across_reads() {
        let mut s = OscTitleScanner::default();
        assert_eq!(s.feed(b"output\x1b]0;Edit"), None);
        assert_eq!(s.feed(b"ing files\x07more"), Some("Editing files".into()));
    }

    #[test]
    fn ignores_non_title_osc_and_plain_output() {
        let mut s = OscTitleScanner::default();
        // OSC 8 (hyperlink) is not a title; plain text yields nothing.
        assert_eq!(s.feed(b"\x1b]8;;https://x\x07hello world\n"), None);
    }

    #[test]
    fn keeps_only_the_latest_title_in_a_chunk() {
        let mut s = OscTitleScanner::default();
        assert_eq!(s.feed(b"\x1b]0;old\x07\x1b]0;new\x07"), Some("new".into()));
    }
}

/// Spawn a new Claude Code session in a PTY rooted at `cwd`.
///
/// Returns the freshly-minted internal `id` (UUID v4). The
/// `claude_session_id` will be `None` until the first SessionStart hook
/// fires — phase 4 wires that up.
///
/// # Errors
/// - `cwd` missing or not a directory
/// - a session is already active for the same `cwd`
/// - PTY allocation fails
/// - `claude` not on PATH
pub fn spawn_session(
    app: AppHandle,
    cwd: PathBuf,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    if !cwd.exists() {
        return Err(format!("cwd does not exist: {}", cwd.display()));
    }
    if !cwd.is_dir() {
        return Err(format!("cwd is not a directory: {}", cwd.display()));
    }
    // Multiple sessions per cwd are allowed — users routinely want 2-5
    // parallel claude runs on the same project (one drafting tests, one
    // refactoring, one running e2e). The hook router in hooks.rs handles
    // the bootstrap-window cwd ambiguity by preferring the most-recently-
    // spawned still-unbound session for cwd-based routing.

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(40),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    // We need the session id before building the command so MCP can
    // bind its session-token to the right Fleet session. Generating it
    // here (instead of after spawn) is safe — registry insertion still
    // happens after spawn_command, so a failed spawn doesn't leak an
    // entry into the registry.
    let id = uuid::Uuid::new_v4().to_string();

    // Deterministic Claude-session binding: for a FRESH spawn (not a
    // `--resume`, and the caller didn't pin one) we assign claude's session id
    // ourselves via `--session-id <uuid>` and pre-bind it on the registry row.
    // This eliminates the whole cwd-guessing binding race — hooks
    // (SessionStart/Stop/PreToolUse/Notification) then match by the KNOWN id
    // so state transitions (incl. Stop→Idle) work, the transcript is
    // `<uuid>.jsonl`, and N concurrent sessions in one cwd never cross-bind.
    let assigned_claude_session_id: Option<String> = {
        let has_resume = args.iter().any(|a| a == "--resume");
        let has_explicit = args.iter().any(|a| a == "--session-id");
        if has_resume || has_explicit {
            None
        } else {
            Some(uuid::Uuid::new_v4().to_string())
        }
    };

    // Wire MCP: mint a per-session token, write a per-session
    // mcp.json, return the path so we can inject `--mcp-config` into
    // the claude argv. Best-effort — a failure here doesn't abort the
    // spawn; the session just runs without Athena MCP tools.
    let mcp = build_mcp_spawn(&id);

    // Resolve the real `claude.exe` through the SAME canonical resolver the rest
    // of the app uses (engine::cli_process::resolve_claude_exe_windows): the
    // native installer (%USERPROFILE%\.local\bin) first, then the npm-global
    // layout, then PATH. ONE source of truth — Fleet must NOT keep a separate
    // lookup. Its old npm-only `claude.cmd` search stranded native-installer
    // machines (where the npm global was removed), so no session could spawn.
    let mut cmd = if cfg!(windows) {
        // Invoke the resolved `.exe` directly (never via `cmd.exe /c`): a real PE
        // binary lets portable-pty's CommandBuilder hand each arg to
        // CreateProcessW as its own argv entry with standard CRT quoting, so a
        // role spec carrying a quoted prompt (`--print "List files. Exit."`)
        // arrives intact instead of being re-split by an extra cmd.exe parse.
        let claude_exe = match crate::engine::cli_process::resolve_claude_exe_windows() {
            Some(p) => p,
            None => {
                return Err(
                    "fleet spawn: claude executable not found (checked the native \
                     installer %USERPROFILE%\\.local\\bin, the npm-global layout, and \
                     PATH) — install Claude Code from \
                     https://docs.anthropic.com/en/docs/claude-code"
                        .to_string(),
                );
            }
        };
        let mut c = CommandBuilder::new(&claude_exe);
        // Fleet sessions run unattended (orchestrated, often Athena-driven), so
        // permission prompts would just freeze them at AwaitingInput with no one
        // to answer. Skip them — the user opted into this for the fleet.
        c.arg("--dangerously-skip-permissions");
        if let Some(sid) = assigned_claude_session_id.as_deref() {
            c.arg("--session-id");
            c.arg(sid);
        }
        for a in &args {
            c.arg(a);
        }
        // `--mcp-config <configs...>` is VARIADIC — it greedily consumes every
        // following non-flag token. Emitted before the positional prompt it eats
        // the prompt as a bogus config path, so claude exits 1 ("MCP config file
        // not found: <cwd>/<prompt>") and the session dies on spawn — silently
        // breaking EVERY spawn-with-task (and with it Athena's orchestration,
        // since a dead session never reaches AwaitingInput). Emit it LAST, after
        // the caller's args, so its only operand is the path. (forward-slash
        // conversion avoids `--mcp-config` parsing a double-escaped Windows path
        // as inline JSON.)
        if let Some(p) = mcp.config_path.as_deref() {
            let p_fwd = p.display().to_string().replace('\\', "/");
            c.arg("--mcp-config");
            c.arg(p_fwd);
        }
        tracing::debug!(
            program = %claude_exe,
            args = ?args,
            "fleet spawn: direct claude.exe invocation"
        );
        c
    } else {
        let mut c = CommandBuilder::new("claude");
        c.arg("--dangerously-skip-permissions");
        if let Some(sid) = assigned_claude_session_id.as_deref() {
            c.arg("--session-id");
            c.arg(sid);
        }
        for a in &args {
            c.arg(a);
        }
        // Variadic `--mcp-config` must come LAST, after the positional prompt —
        // see the windows branch above for the full rationale.
        if let Some(p) = mcp.config_path.as_deref() {
            c.arg("--mcp-config");
            c.arg(p.as_os_str());
        }
        c
    };
    cmd.cwd(&cwd);
    // xterm-256color is what xterm.js natively understands.
    cmd.env("TERM", "xterm-256color");
    // Match the env contract used by the rest of the app's claude spawns
    // (companion/session.rs, brain/reflection.rs, etc.). This shuts off
    // telemetry chatter. We deliberately KEEP terminal-title rewriting ON (no
    // CLAUDE_CODE_DISABLE_TERMINAL_TITLE): Claude Code retitles the terminal with
    // a live task summary via OSC, which the reader loop captures
    // (`OscTitleScanner`) to give each session a distinct, meaningful header —
    // the same auto-title it shows in a real terminal. xterm.js parses OSC titles
    // natively, so they never leak as rendered text.
    // Critically we do NOT set ANTHROPIC_API_KEY — claude falls back to its
    // OAuth/keychain credentials, which is the monthly-subscription path. See
    // `companion/session.rs:783` for the canonical comment on why --bare +
    // API-key auth is the wrong choice for processes the user is signed into.
    cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn `claude` failed: {e}"))?;
    let child_pid = child.process_id();
    // Clone a kill handle BEFORE the child is moved into the reaper task, so
    // close/hibernate can terminate the process directly. Interactive `claude`
    // ignores stdin EOF, so dropping the PTY alone would leave a zombie shell.
    let killer = child.clone_killer();

    // Slave is no longer needed in our process — the child owns its own fd.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let now = now_ms();
    let project_label = cwd
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Shared output ring: the reader task pushes every PTY chunk here (always,
    // so the pipe never blocks) and forwards over IPC only while subscribed.
    let output = Arc::new(Mutex::new(OutputRing::new(OUTPUT_RING_CAP)));

    let inner = FleetSessionInner {
        id: id.clone(),
        // Pre-bound for fresh spawns (we passed `--session-id`); `None` for
        // resume/explicit, which bind via their own path.
        claude_session_id: assigned_claude_session_id,
        cwd: cwd.clone(),
        project_label,
        name: None,
        title: None,
        athena_active_until_ms: 0,
        args: args.clone(),
        cols,
        rows,
        state: FleetSessionState::Spawning,
        last_activity_ms: now,
        last_pty_output_ms: 0,
        last_grew_ms: 0,
        created_at_ms: now,
        child_pid,
        exit_code: None,
        state_reason: Some("PTY spawned".to_string()),
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(Some(writer)),
        hibernating: std::sync::atomic::AtomicBool::new(false),
        output: output.clone(),
        killer: Some(Mutex::new(killer)),
    };
    registry().insert(inner);

    // Notify the UI a new session showed up.
    emit_registry_changed(&app, "added", &id);

    // P1 — give the session a distinct, meaningful title from its task via a
    // cheap LLM call (the OSC title is just "Claude Code"). Spawn-with-task only;
    // a bare interactive session keeps its project label until it titles itself.
    if let Some(task) = super::naming::task_from_args(&args) {
        super::naming::name_session_from_task(app.clone(), id.clone(), task);
    }

    // Reader task — blocking I/O on its own thread. Owns the ring `Arc` so the
    // per-read hot path never touches the registry map lock.
    let app_reader = app.clone();
    let id_reader = id.clone();
    tokio::task::spawn_blocking(move || reader_loop(app_reader, id_reader, output, reader));

    // Reaper task — owns the child directly, waits, marks exit, emits.
    let app_reaper = app.clone();
    let id_reaper = id.clone();
    let mcp_config_for_reaper = mcp.config_path.clone();
    tokio::task::spawn_blocking(move || {
        reaper_loop(app_reaper, id_reaper.clone(), child);
        // Release MCP token + cancel blocking requests + clean up
        // the temp config file. These all need to happen exactly
        // once per session — coupling them to the reaper exit is
        // simpler than coordinating across the registry mark-exited
        // path.
        crate::companion::orchestration::mcp::release_session_tokens(&id_reaper);
        crate::companion::orchestration::mcp::pending::cancel_for_session(&id_reaper);
        if let Some(p) = mcp_config_for_reaper {
            if let Some(parent) = p.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    });

    Ok(id)
}

/// Mint an MCP session token and write a per-session `mcp.json` that
/// points the spawned claude at our localhost MCP endpoint. Returns
/// `McpSpawn { config_path: None }` if MCP can't be wired right now
/// (local_http server not yet started, write failed, etc) — callers
/// proceed without `--mcp-config` rather than failing the spawn.
fn build_mcp_spawn(fleet_session_id: &str) -> McpSpawn {
    let port = match crate::local_http::port() {
        Some(p) => p,
        None => {
            tracing::warn!(
                "fleet spawn: local_http port not yet bound — MCP wiring skipped"
            );
            return McpSpawn { config_path: None };
        }
    };

    let token = crate::companion::orchestration::mcp::mint_session_token(fleet_session_id);

    // Per-session subdir under tmp so the file is uniquely-named and
    // the parent can be removed on exit. Avoids stale configs piling
    // up across restarts.
    let dir = std::env::temp_dir().join(format!("fleet-mcp-{fleet_session_id}"));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        tracing::warn!(error = %e, "fleet spawn: temp dir creation failed — MCP wiring skipped");
        crate::companion::orchestration::mcp::release_session_tokens(fleet_session_id);
        return McpSpawn { config_path: None };
    }
    let config_path = dir.join("mcp.json");

    // The MCP HTTP transport spec lets us declare headers that the
    // client sends on every JSON-RPC call. We use that to carry the
    // per-session token — no per-request crypto, just a UUID lookup
    // on our side. Header name MUST match `mcp::SESSION_HEADER`
    // (case-insensitive per HTTP).
    let body = serde_json::json!({
        "mcpServers": {
            "athena": {
                "type": "http",
                "url": format!("http://127.0.0.1:{port}/mcp/rpc"),
                "headers": {
                    "X-Athena-Session": token
                }
            }
        }
    });
    let serialized = match serde_json::to_string_pretty(&body) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "fleet spawn: mcp.json serialise failed");
            crate::companion::orchestration::mcp::release_session_tokens(fleet_session_id);
            return McpSpawn { config_path: None };
        }
    };
    if let Err(e) = std::fs::write(&config_path, serialized) {
        tracing::warn!(error = %e, "fleet spawn: mcp.json write failed");
        crate::companion::orchestration::mcp::release_session_tokens(fleet_session_id);
        let _ = std::fs::remove_dir_all(&dir);
        return McpSpawn { config_path: None };
    }

    tracing::debug!(
        session_id = %fleet_session_id,
        path = %config_path.display(),
        "fleet spawn: MCP config wired"
    );
    McpSpawn { config_path: Some(config_path) }
}

/// Reader loop — blocks on `reader.read`, buffers every chunk into the ring,
/// and forwards over IPC ONLY while the session is subscribed. Exits on
/// EOF/error.
///
/// The decoupling is the whole point: a 16-CLI fleet with one focused terminal
/// emits one stream, not sixteen. Unwatched sessions still drain their PTY into
/// the bounded ring (so claude never blocks on a full pipe and memory stays
/// flat regardless of a 1M-token run), they just don't pay the
/// serialize→IPC→xterm-parse cost for output nobody is looking at.
fn reader_loop(
    app: AppHandle,
    session_id: String,
    ring: Arc<Mutex<OutputRing>>,
    mut reader: Box<dyn std::io::Read + Send>,
) {
    // 16 KiB (was 8) → fewer reads/emits per burst on fast 1M-token dumps.
    let mut buf = [0u8; 16384];
    // First byte of PTY output ⇒ claude is up (banner/prompt drawn). Promote
    // Spawning → Idle once, so the session isn't mislabeled never-attached
    // while it sits at a fresh prompt with no transcript/hook yet. We do NOT
    // bump activity on subsequent output — an interactive claude redraws the
    // PTY (cursor/status) even when idle, so that would defeat staleness; real
    // work is tracked via transcript growth + hooks.
    let mut alive_marked = false;
    // Throttled silence-tracker note: stamp `last_pty_output_ms` at most once
    // a second so the frozen-process stall check (stale.rs) has a fresh "the
    // PTY is still emitting" signal without per-chunk registry-lock churn.
    let mut last_output_note: Option<std::time::Instant> = None;
    // Captures Claude Code's OSC window-title (a live task summary) from the byte
    // stream so each session gets a distinct, meaningful header. State persists
    // across reads so a title split mid-chunk still assembles.
    let mut osc_title = OscTitleScanner::default();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                tracing::debug!(session_id = %session_id, "fleet PTY reader: EOF");
                break;
            }
            Ok(n) => {
                if !alive_marked {
                    alive_marked = true;
                    if registry().mark_alive(&session_id) {
                        emit_registry_changed(&app, "updated", &session_id);
                    }
                }
                if last_output_note.is_none_or(|t| t.elapsed().as_millis() >= 1000) {
                    last_output_note = Some(std::time::Instant::now());
                    registry().note_pty_output(&session_id);
                }
                // Always buffer (drains the PTY); learn whether to forward —
                // both under one short ring lock, no registry-map contention.
                let subscribed = {
                    let mut r = ring.lock().unwrap_or_else(|e| e.into_inner());
                    r.push(&buf[..n]);
                    r.is_subscribed()
                };
                if subscribed {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(
                        event_name::FLEET_SESSION_OUTPUT,
                        OutputPayload {
                            session_id: &session_id,
                            chunk,
                        },
                    );
                }
                // Capture Claude Code's live OSC terminal title (a task summary).
                // Emits a registry-changed only on a real title change.
                if let Some(title) = osc_title.feed(&buf[..n]) {
                    if registry().set_title(&session_id, &title) {
                        emit_registry_changed(&app, "updated", &session_id);
                    }
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                tracing::warn!(session_id = %session_id, error = %e, "fleet PTY reader: error");
                break;
            }
        }
    }
}

/// Reaper loop — owns the child handle directly. Waits for exit, marks
/// state, emits events.
fn reaper_loop(
    app: AppHandle,
    session_id: String,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
) {
    let exit_code = match child.wait() {
        Ok(status) => {
            if status.success() {
                Some(0i32)
            } else {
                // ExitStatus::exit_code is u32 on Windows and is frequently an
                // NTSTATUS (e.g. 0xC0000142 STATUS_DLL_INIT_FAILED when a
                // console child can't initialize). REINTERPRET the bits as i32
                // rather than saturating to i32::MAX — the old saturation threw
                // the real code away and rendered every abnormal exit as the
                // meaningless "code 2147483647", which is exactly why an exit
                // read as "vanished without warning". The bit pattern round-
                // trips back to the OS code (`as u32`) for display.
                let code: u32 = status.exit_code();
                Some(code as i32)
            }
        }
        Err(e) => {
            tracing::warn!(session_id = %session_id, error = %e, "fleet child wait failed");
            None
        }
    };

    // Always log WHY a session ended. Previously the reaper logged nothing on a
    // normal-looking exit, so an abnormal death (crash / spawn-time
    // STATUS_DLL_INIT_FAILED) left no breadcrumb at all.
    match exit_code {
        Some(0) => tracing::debug!(session_id = %session_id, "fleet session exited cleanly"),
        Some(c) => tracing::warn!(
            session_id = %session_id,
            code = c,
            code_hex = %format!("0x{:08X}", c as u32),
            "fleet session exited with a non-zero code"
        ),
        None => tracing::warn!(
            session_id = %session_id,
            "fleet session exited with no status (signal / crash)"
        ),
    }

    // Hibernation path: the operator killed the process to free it, not a real
    // death. `hibernate` already set state = Hibernated; leave it there, don't
    // emit Exited, and skip exit reconciliation (the conversation lives on and
    // can be resumed). The MCP/temp-file cleanup in the spawning task still
    // runs — the process really is gone.
    if registry().is_hibernating(&session_id) {
        tracing::debug!(session_id = %session_id, "fleet reaper: child exited for hibernation");
        // Confirmed gone — now drop the PID record (hibernate kept it so
        // process_scan tracked the live process through the kill→exit window).
        registry().clear_child_pid(&session_id);
        emit_registry_changed(&app, "updated", &session_id);
        return;
    }

    registry().mark_exited(&session_id, exit_code);
    let _ = app.emit(
        event_name::FLEET_SESSION_EXITED,
        ExitedPayload {
            session_id: &session_id,
            exit_code,
        },
    );
    emit_registry_changed(&app, "updated", &session_id);

    // Update operative memory directly. The JS bridge in
    // useFleetCompanionBridge.ts ALSO writes here on the next tick,
    // but a fast-exit session can race the frontend store priming
    // (findSession returns undefined because the 'added' setTimeout
    // hasn't fired yet) and the JS update silently bails. Doing it
    // from the reaper too means dispatched_by_athena reconciliation
    // happens even when the frontend bridge missed the event.
    //
    // Both calls are idempotent:
    //   - synthesize_session_summary stamps SessionRef.summary and
    //     escalates the op to Failed for non-zero exits; calling
    //     twice writes the same summary string.
    //   - record_session_event with Exited is a state upsert.
    //   - reconcile_if_dispatched checks op.completion_summary.is_none()
    //     before doing anything, so the second caller no-ops.
    //
    // The JS path still owns episode writes (the brain bridge has
    // the pool reference); this path owns operative-memory state.
    rust_reconcile_after_exit(&app, &session_id, exit_code);
}

fn rust_reconcile_after_exit(app: &AppHandle, session_id: &str, exit_code: Option<i32>) {
    let mem = crate::companion::orchestration::operative_memory::memory();
    let _ = mem.synthesize_session_summary(session_id, exit_code);

    // Use the registry's stored project_label + cwd so the operative-
    // memory upsert lands on the right SessionRef even when the
    // session was never bound (claude exited before SessionStart).
    let (project_label, cwd) = registry()
        .lookup_meta(session_id)
        .unwrap_or_else(|| ("unknown".to_string(), String::new()));
    mem.record_session_event(
        session_id,
        None,
        &project_label,
        &cwd,
        super::types::FleetSessionState::Exited,
    );

    // Hand off to the cross-session reconciler — same code path the
    // frontend bridge takes through companion_record_fleet_event.
    if let Some(state) = app.try_state::<std::sync::Arc<crate::AppState>>() {
        crate::commands::companion::fleet_bridge::reconcile_if_dispatched_public(
            &state.user_db,
            app,
            session_id,
        );
    }

    // D7 — exited session has updated state + the reconciler may have
    // synthesized + mutated. Nudge the live-ops strip.
    crate::companion::orchestration::emit_digest_changed(app);
}

/// Emit a registry-changed event from a Tauri command.
pub fn emit_registry_changed(app: &AppHandle, kind: &str, session_id: &str) {
    let _ = app.emit(
        event_name::FLEET_REGISTRY_CHANGED,
        RegistryChangedPayload { kind, session_id },
    );
}
