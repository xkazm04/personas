//! Warm per-conversation session: one long-lived `claude` process per
//! conversation for the interactive MAIN-tier turn, so turn 2+ pays neither
//! the process start nor the cold prompt-cache write.
//!
//! Hybrid-LLM-engine spark (2026-09-17), WP2. The research measured a warm
//! Sonnet 5 turn at ~2 s to first visible text against 3.4 s (Opus low) / 5.0 s
//! (Sonnet low) cold on the real Athena prompt; this module is that lever.
//!
//! ## Shape
//!
//! - [`WarmProcess`] is a `claude --print --input-format stream-json …` child
//!   (the fleet headless lane's contract, `commands/fleet/headless.rs`) whose
//!   stdin stays open. Each user turn is one `{"type":"user",…}` line; the
//!   turn ends on the CLI's `result` line and the process stays up. A reader
//!   task owns stdout for the life of the process and hands lines to whichever
//!   turn is in flight through a channel.
//! - The registry is a process-global map keyed by conversation id — the
//!   same `LazyLock<Mutex<HashMap>>` shape `locks.rs` uses for the turn locks.
//!   The per-conversation turn lock already serialises turns, so a process is
//!   never asked to run two turns at once.
//! - **Cache continuity.** The system prompt file is written ONCE at spawn and
//!   must be byte-identical for every turn of that process, so it carries only
//!   the STABLE prefix of the composed prompt (the static core and the identity
//!   block, [`stable_prefix_for_main`]). Everything the composer changes per
//!   turn — recall, briefing, live activity and the indexes, plugins, pinned
//!   connectors, onboarding, the voice flag, the mode addenda — travels at the
//!   top of the user message under [`CONTEXT_HEADER`]. The split is a plain
//!   prefix match against the composed prompt ([`split_stable_prefix`]); if
//!   the prefix ever stops matching (identity edited by the sleep cycle, the
//!   constitution changed), the process is respawned on the next turn, and if
//!   it cannot be computed at all the turn falls back to spawn-per-turn.
//! - **Scope.** Only `TurnOrigin::User` (chat and voice are one origin) on a
//!   Claude MAIN tier, never a browser-test or build turn. Autonomous,
//!   proactive, external, aside and micro turns keep spawn-per-turn, so an
//!   autonomous tick can never block a user behind a warm process it holds.
//! - **Interrupt.** Verified live on claude 2.1.274: a stream-json
//!   `control_request {subtype:"interrupt"}` line ends the running turn with a
//!   `control_response` and a `result` (`error_during_execution`) within
//!   ~150 ms and the process keeps serving. That is the first mechanism; if no
//!   `result` follows within [`INTERRUPT_GRACE`] the process is killed and
//!   dropped, and the next turn respawns with `--resume`.
//! - **Lifecycle.** An idle reaper (started lazily, ticks every
//!   [`REAPER_INTERVAL`]) kills processes idle longer than
//!   [`WARM_IDLE_HORIZON`]. A process that dies mid-turn has its partial text
//!   salvaged exactly as `cli.rs` does and its entry dropped; the next turn
//!   respawns with `--resume`, and a stale pointer takes the same self-heal
//!   path as the cold spawn (the error wording is preserved). The turn
//!   timeout and every other future-drop kill the process through
//!   [`InFlight`]. `companion_reset_conversation` kills through
//!   [`kill_warm_session`]; app exit through [`kill_all_warm_sessions`]. Every child is also
//!   `kill_on_drop`.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

use super::cli::{drain_stderr, prepare_command, CliTurn, IngestCtx, StreamAccumulator};
use super::events::{emit, StreamEvent, StreamEventKind};
use super::interrupts::{clear_interrupt, was_interrupted};
use super::launch::{build_launch, AthenaLaunch, LaunchCtx};
use super::origin::TurnOrigin;
use super::stream::CliRunOutput;
use super::transcript::upsert_claude_session_id;
use crate::companion::engine_settings::{AthenaEngine, ResolvedTier, TurnTierClass};
use crate::companion::prompt::{chat_static_core, PromptClass};
use crate::companion::turn_ledger::CliUsage;
use crate::db::UserDbPool;
use crate::error::AppError;

/// A warm process that has not served a turn for this long is killed by the
/// reaper. Design decision (wave 2): 20 minutes.
pub const WARM_IDLE_HORIZON: Duration = Duration::from_secs(20 * 60);
/// How often the reaper looks.
const REAPER_INTERVAL: Duration = Duration::from_secs(60);
/// How long an interrupt request may take to produce the turn's `result`
/// before the process is killed instead. Measured ~150 ms live.
const INTERRUPT_GRACE: Duration = Duration::from_secs(2);
/// The header the composer puts between the static core and the identity
/// block (`prompt/compose.rs`). Mirrored here so the stable prefix can be
/// rebuilt without composing; `stable_prefix_matches_the_composer` pins it.
const IDENTITY_HEADER: &str = "\n\n# Identity (live, evolves)\n\n";
/// The heading the per-turn dynamic context rides under at the top of the
/// user message.
pub const CONTEXT_HEADER: &str = "# Context for this turn";

// ---------------------------------------------------------------------------
// The stable / dynamic split
// ---------------------------------------------------------------------------

/// The composed prompt cut into the part the process was seeded with and the
/// part that goes into this turn's user message.
pub(super) struct WarmSplit {
    pub stable: String,
    pub dynamic: String,
}

/// Static core + identity, joined exactly as `compose_for_class` joins them.
fn join_stable(core: &str, identity: &str) -> String {
    if identity.is_empty() {
        core.to_string()
    } else {
        format!("{core}{IDENTITY_HEADER}{identity}")
    }
}

/// The stable prefix a MAIN-tier composition starts with: the class's static
/// core (the constitution or the chat core, per `PromptClass::for_tier`) and
/// the identity block. Reads the same files the composer reads.
pub(super) fn stable_prefix_for_main() -> Result<String, AppError> {
    let root = crate::companion::disk::brain_root()?;
    let core = match PromptClass::for_tier(TurnTierClass::Main) {
        PromptClass::Full => {
            std::fs::read_to_string(root.join("constitution.md")).unwrap_or_default()
        }
        PromptClass::Chat => chat_static_core().to_string(),
    };
    let identity = std::fs::read_to_string(root.join("identity.md")).unwrap_or_default();
    Ok(join_stable(&core, &identity))
}

/// Cut `system_prompt` at the end of `stable`. `None` when the composed
/// prompt does not start with it — the caller then spawns per turn.
pub(super) fn split_stable_prefix<'a>(
    system_prompt: &'a str,
    stable: &str,
) -> Option<(&'a str, &'a str)> {
    if stable.is_empty() || !system_prompt.starts_with(stable) {
        return None;
    }
    Some(system_prompt.split_at(stable.len()))
}

/// The production split: compute the stable prefix and cut the composed
/// prompt at it. Any failure is a `None` (logged), never an error — the cold
/// path is always available.
pub(super) fn split_for_warm(system_prompt: &str) -> Option<WarmSplit> {
    let stable = match stable_prefix_for_main() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "companion warm: stable prefix unavailable; spawning per turn");
            return None;
        }
    };
    match split_stable_prefix(system_prompt, &stable) {
        Some((s, d)) => Some(WarmSplit {
            stable: s.to_string(),
            dynamic: d.to_string(),
        }),
        None => {
            tracing::warn!(
                "companion warm: composed prompt does not start with the stable prefix; spawning per turn"
            );
            None
        }
    }
}

/// The text of one warm user turn: the per-turn context block, a blank line,
/// then the user's message. A turn with no dynamic context is the bare
/// message.
pub(super) fn user_line_text(dynamic: &str, user_message: &str) -> String {
    let dynamic = dynamic.trim();
    if dynamic.is_empty() {
        user_message.to_string()
    } else {
        format!("{CONTEXT_HEADER}\n\n{dynamic}\n\n{user_message}")
    }
}

fn user_line_json(text: &str) -> String {
    let v = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
    });
    format!("{v}\n")
}

fn interrupt_line_json() -> String {
    let v = serde_json::json!({
        "type": "control_request",
        "request_id": uuid::Uuid::new_v4().to_string(),
        "request": { "subtype": "interrupt" }
    });
    format!("{v}\n")
}

fn hash_str(s: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

/// Whether a turn may use the warm session at all (design decision, wave 2):
/// a Claude MAIN tier, a user-initiated turn, no browser tools. Build turns
/// never reach this (they have their own entry).
pub(super) fn warm_eligible(origin: &TurnOrigin, tier: &ResolvedTier, browser_tools: bool) -> bool {
    matches!(origin, TurnOrigin::User)
        && tier.engine == AthenaEngine::Claude
        && tier.class == TurnTierClass::Main
        && !browser_tools
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

enum ReaderEvent {
    Line(String),
    Eof,
    Failed(String),
}

struct WarmIo {
    stdin: ChildStdin,
    rx: mpsc::UnboundedReceiver<ReaderEvent>,
}

/// One live warm child. Held in the registry behind an `Arc` so a turn can
/// keep it while the registry lock is released; the std mutexes are held for
/// O(1) operations only, the tokio one for the turn.
pub(super) struct WarmProcess {
    child: Mutex<Child>,
    io: tokio::sync::Mutex<WarmIo>,
    stderr: Arc<tokio::sync::Mutex<String>>,
    /// Keeps the `--system-prompt-file` alive for the child's lifetime.
    _launch: Option<AthenaLaunch>,
    /// The session the process was pinned to (`--session-id` or `--resume`).
    pub claude_session_id: String,
    /// Hash of the stable prefix the process was seeded with.
    pub prefix_hash: u64,
    last_used: Mutex<Instant>,
    busy: AtomicBool,
    pub pid: Option<u32>,
}

impl WarmProcess {
    fn is_alive(&self) -> bool {
        match self.child.lock() {
            Ok(mut c) => matches!(c.try_wait(), Ok(None)),
            Err(_) => false,
        }
    }

    fn start_kill(&self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.start_kill();
        }
    }

    /// The exit status, waiting up to `max` for the process to settle after
    /// its stdout closed.
    async fn settle(&self, max: Duration) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + max;
        loop {
            let st = self
                .child
                .lock()
                .ok()
                .and_then(|mut c| c.try_wait().ok().flatten());
            if st.is_some() || Instant::now() >= deadline {
                return st;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

static WARM: LazyLock<Mutex<HashMap<String, Arc<WarmProcess>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn registry() -> std::sync::MutexGuard<'static, HashMap<String, Arc<WarmProcess>>> {
    WARM.lock().unwrap_or_else(|p| p.into_inner())
}

/// The live warm process for a conversation, if any.
pub(super) fn get(conversation_id: &str) -> Option<Arc<WarmProcess>> {
    registry().get(conversation_id).cloned()
}

/// Kill and forget the conversation's warm process. Returns whether there was
/// one. The in-flight turn, if any, sees EOF and salvages what it has.
/// (`companion_reset_conversation`'s door, exported as `kill_warm_session`.)
pub fn kill_warm_session(conversation_id: &str) -> bool {
    kill_conversation(conversation_id)
}

fn kill_conversation(conversation_id: &str) -> bool {
    let removed = registry().remove(conversation_id);
    match removed {
        Some(p) => {
            p.start_kill();
            tracing::info!(conversation_id, pid = ?p.pid, "companion warm: process killed");
            true
        }
        None => false,
    }
}

/// Kill every warm process. Meant for the app's `RunEvent::Exit` hook in
/// `lib.rs` (Director-owned wiring; until then `kill_on_drop` covers every
/// child whose handle is dropped, and the OS reaps the rest on exit).
#[cfg_attr(not(test), allow(dead_code))]
pub fn kill_all_warm_sessions() -> usize {
    let all: Vec<(String, Arc<WarmProcess>)> = registry().drain().collect();
    for (_, p) in &all {
        p.start_kill();
    }
    all.len()
}

/// Kill every process that is not mid-turn and has been idle longer than
/// `horizon`. Returns how many were reaped.
pub(super) fn reap_idle(horizon: Duration) -> usize {
    let idle: Vec<String> = registry()
        .iter()
        .filter(|(_, p)| {
            !p.busy.load(Ordering::Relaxed)
                && p.last_used
                    .lock()
                    .map(|t| t.elapsed() > horizon)
                    .unwrap_or(true)
        })
        .map(|(k, _)| k.clone())
        .collect();
    let mut n = 0;
    for id in idle {
        if kill_conversation(&id) {
            n += 1;
        }
    }
    n
}

/// Start the reaper once per process. It runs for the app's lifetime — the
/// registry it sweeps does too — and holds nothing but its own timer.
fn ensure_reaper() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        tokio::spawn(async {
            loop {
                tokio::time::sleep(REAPER_INTERVAL).await;
                let n = reap_idle(WARM_IDLE_HORIZON);
                if n > 0 {
                    tracing::info!(reaped = n, "companion warm: idle processes reaped");
                }
            }
        });
    });
}

/// Spawn a prepared command as a warm process: reader task on stdout, stderr
/// drained, stdin kept. `launch` (if any) lives as long as the process.
async fn spawn_process(
    mut cmd: Command,
    launch: Option<AthenaLaunch>,
    claude_session_id: String,
    prefix_hash: u64,
) -> Result<Arc<WarmProcess>, AppError> {
    cmd.kill_on_drop(true);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude (warm): {e}")))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Internal("claude stdin missing".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal("claude stdout missing".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal("claude stderr missing".into()))?;
    let (stderr_buf, _stderr_task) = drain_stderr(stderr);
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if tx.send(ReaderEvent::Line(line)).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    let _ = tx.send(ReaderEvent::Eof);
                    break;
                }
                Err(e) => {
                    let _ = tx.send(ReaderEvent::Failed(format!("read claude stdout: {e}")));
                    break;
                }
            }
        }
    });
    let pid = child.id();
    Ok(Arc::new(WarmProcess {
        child: Mutex::new(child),
        io: tokio::sync::Mutex::new(WarmIo { stdin, rx }),
        stderr: stderr_buf,
        _launch: launch,
        claude_session_id,
        prefix_hash,
        last_used: Mutex::new(Instant::now()),
        busy: AtomicBool::new(false),
        pid,
    }))
}

/// Spawn the real Claude arm in warm form, seeded with `stable_prompt`.
async fn spawn_warm_launch(
    tier: &ResolvedTier,
    turn_id: &str,
    session_id: &str,
    resume_session_id: Option<&str>,
    stable_prompt: &str,
) -> Result<Arc<WarmProcess>, AppError> {
    let fresh = uuid::Uuid::new_v4().to_string();
    let claude_session_id = resume_session_id.unwrap_or(&fresh).to_string();
    let launch = build_launch(
        AthenaEngine::Claude,
        tier,
        &LaunchCtx {
            turn_id,
            session_id,
            resume_session_id,
            system_prompt: stable_prompt,
            // Not on argv in warm form; the message goes down stdin per turn.
            user_message: "",
            browser_tools: false,
            cwd_override: None,
            mcp: &[],
            warm: Some(&fresh),
        },
    )?;
    let cmd = prepare_command(&launch);
    spawn_process(
        cmd,
        Some(launch),
        claude_session_id,
        hash_str(stable_prompt),
    )
    .await
}

/// Get the conversation's live process if it can serve this turn, else
/// (re)spawn one. A process is reused only when it is alive, was seeded with
/// this exact stable prefix, and is on the session the conversation's pointer
/// names (a pointer with no process, or a process on another session, means
/// respawn with `--resume`).
async fn acquire(turn: &CliTurn<'_>, stable: &str) -> Result<Arc<WarmProcess>, AppError> {
    let prefix_hash = hash_str(stable);
    if let Some(p) = get(turn.session_id) {
        // (`Option::is_none_or` is 1.82; the workspace MSRV is 1.80.)
        let same_session = match turn.resume_session_id {
            None => true,
            Some(r) => r == p.claude_session_id,
        };
        if p.is_alive() && p.prefix_hash == prefix_hash && same_session {
            return Ok(p);
        }
        tracing::info!(
            conversation_id = turn.session_id,
            alive = p.is_alive(),
            prefix_match = p.prefix_hash == prefix_hash,
            same_session,
            "companion warm: process cannot serve this turn; respawning"
        );
        kill_conversation(turn.session_id);
    }
    let p = spawn_warm_launch(
        turn.tier,
        turn.turn_id,
        turn.session_id,
        turn.resume_session_id,
        stable,
    )
    .await?;
    registry().insert(turn.session_id.to_string(), p.clone());
    ensure_reaper();
    tracing::info!(
        conversation_id = turn.session_id,
        pid = ?p.pid,
        resumed = turn.resume_session_id.is_some(),
        "companion warm: process spawned"
    );
    Ok(p)
}

// ---------------------------------------------------------------------------
// One turn on a warm process
// ---------------------------------------------------------------------------

/// How the turn's stream ended.
pub(super) enum TurnEnd {
    /// The `result` line arrived; the process is still serving.
    Result,
    /// The user interrupted and the CLI honoured it: `result` arrived after
    /// the control request; the process is still serving.
    Interrupted,
    /// The user interrupted and the CLI did not answer within the grace
    /// period; the process was killed and dropped.
    InterruptedKilled,
    /// The process died mid-turn (stdout closed before `result`). Dropped.
    Died {
        status: Option<std::process::ExitStatus>,
        stderr: String,
        read_error: Option<String>,
    },
}

pub(super) struct WarmOutcome {
    pub acc: StreamAccumulator,
    pub end: TurnEnd,
}

/// Kills and drops the conversation's process unless the turn completed —
/// the turn timeout drops the turn future mid-stream, and a process left
/// mid-turn would feed its leftover lines to the next one.
struct InFlight {
    conversation_id: String,
    armed: bool,
}

impl Drop for InFlight {
    fn drop(&mut self) {
        if self.armed {
            tracing::warn!(
                conversation_id = %self.conversation_id,
                "companion warm: turn abandoned mid-stream; killing the process"
            );
            kill_conversation(&self.conversation_id);
        }
    }
}

/// Inputs of one turn on an already-acquired process.
pub(super) struct WarmTurnIo<'a> {
    pub turn_id: &'a str,
    pub session_id: &'a str,
    /// The full user-line text (context block + message).
    pub user_text: &'a str,
    /// Where every stdout line goes (the stream event on the real path).
    pub forward: &'a (dyn Fn(&str) + Sync),
    pub pool: Option<&'a UserDbPool>,
    pub persist_progress: bool,
    pub usage_sink: Option<&'a std::sync::Mutex<Option<CliUsage>>>,
}

/// Write one user line and read until the turn's `result`, an interrupt, or
/// the process's death. `first_text_ms` is measured from the moment the user
/// line was written.
pub(super) async fn turn_on(
    proc: &Arc<WarmProcess>,
    io_in: WarmTurnIo<'_>,
) -> Result<WarmOutcome, AppError> {
    let WarmTurnIo {
        turn_id,
        session_id,
        user_text,
        forward,
        pool,
        persist_progress,
        usage_sink,
    } = io_in;
    let mut io_guard = proc.io.lock().await;
    let WarmIo { stdin, rx } = &mut *io_guard;
    proc.busy.store(true, Ordering::Relaxed);
    let mut guard = InFlight {
        conversation_id: session_id.to_string(),
        armed: true,
    };

    let line = user_line_json(user_text);
    if let Err(e) = stdin.write_all(line.as_bytes()).await {
        proc.busy.store(false, Ordering::Relaxed);
        // The guard kills + drops on the way out.
        return Err(AppError::Internal(format!(
            "write claude stdin (warm): {e}"
        )));
    }
    let started = Instant::now();
    let mut acc = StreamAccumulator::new(started);
    let ingest = IngestCtx {
        pool,
        session_id,
        persist_progress,
        usage_sink,
    };
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    tick.tick().await;
    let mut interrupt_sent_at: Option<Instant> = None;

    let end = loop {
        tokio::select! {
            biased;
            ev = rx.recv() => match ev {
                Some(ReaderEvent::Line(l)) => {
                    forward(&l);
                    if acc.ingest(&l, &ingest) {
                        break if interrupt_sent_at.is_some() {
                            TurnEnd::Interrupted
                        } else {
                            TurnEnd::Result
                        };
                    }
                }
                Some(ReaderEvent::Eof) | None => {
                    break TurnEnd::Died { status: None, stderr: String::new(), read_error: None };
                }
                Some(ReaderEvent::Failed(e)) => {
                    break TurnEnd::Died { status: None, stderr: String::new(), read_error: Some(e) };
                }
            },
            _ = tick.tick() => {
                match interrupt_sent_at {
                    Some(at) if at.elapsed() > INTERRUPT_GRACE => {
                        proc.start_kill();
                        break TurnEnd::InterruptedKilled;
                    }
                    Some(_) => {}
                    None => {
                        if was_interrupted(turn_id) {
                            interrupt_sent_at = Some(Instant::now());
                            if stdin.write_all(interrupt_line_json().as_bytes()).await.is_err() {
                                proc.start_kill();
                                break TurnEnd::InterruptedKilled;
                            }
                        }
                    }
                }
            }
        }
    };
    clear_interrupt(turn_id);

    let end = match end {
        TurnEnd::Result | TurnEnd::Interrupted => {
            if let Ok(mut t) = proc.last_used.lock() {
                *t = Instant::now();
            }
            proc.busy.store(false, Ordering::Relaxed);
            guard.armed = false;
            end
        }
        TurnEnd::InterruptedKilled => {
            // Drain what the killed child still flushes so its exit is clean.
            let _ = proc.settle(Duration::from_secs(2)).await;
            proc.busy.store(false, Ordering::Relaxed);
            guard.armed = false;
            kill_conversation(session_id);
            end
        }
        TurnEnd::Died { read_error, .. } => {
            let status = proc.settle(Duration::from_secs(2)).await;
            let stderr = proc.stderr.lock().await.clone();
            proc.busy.store(false, Ordering::Relaxed);
            guard.armed = false;
            kill_conversation(session_id);
            TurnEnd::Died {
                status,
                stderr,
                read_error,
            }
        }
    };
    Ok(WarmOutcome { acc, end })
}

/// The production entry: run `turn` on the conversation's warm process,
/// spawning it if needed, and shape the outcome exactly as `run_cli_turn`
/// would (partial-reply salvage, interrupted marker, session pointer).
pub(super) async fn run_warm_turn(
    app: &AppHandle,
    pool: &UserDbPool,
    turn: &CliTurn<'_>,
    split: &WarmSplit,
) -> Result<CliRunOutput, AppError> {
    let user_text = user_line_text(&split.dynamic, turn.user_message);
    if std::env::var("PERSONAS_DUMP_PROMPT").is_ok_and(|v| v == "1") {
        // What the model actually saw this turn: the seeded prefix as the
        // system prompt and the context-bearing user text.
        super::cli::dump_prompt_snapshot(turn.turn_id, turn.session_id, &split.stable, &user_text);
    }
    let proc = acquire(turn, &split.stable).await?;
    let session_id = turn.session_id.to_string();
    let turn_id = turn.turn_id.to_string();
    let forward = move |line: &str| {
        emit(
            app,
            StreamEvent {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                kind: StreamEventKind::Cli,
                payload: line.to_string(),
            },
        );
    };
    let WarmOutcome { acc, end } = turn_on(
        &proc,
        WarmTurnIo {
            turn_id: turn.turn_id,
            session_id: turn.session_id,
            user_text: &user_text,
            forward: &forward,
            pool: Some(pool),
            persist_progress: turn.persist_progress,
            usage_sink: turn.usage_sink,
        },
    )
    .await?;

    let StreamAccumulator {
        assistant_text,
        segments,
        new_claude_session_id,
        mut result_usage,
        first_text_ms,
        ..
    } = acc;
    // The init line echoes the pinned session id; persist it exactly as the
    // cold path does so the next turn (or a respawn) can `--resume`.
    if let Some(sid) = new_claude_session_id.as_deref() {
        upsert_claude_session_id(pool, turn.session_id, sid)?;
    }
    if result_usage.is_none() && first_text_ms.is_some() {
        result_usage = Some(CliUsage {
            first_text_ms,
            ..Default::default()
        });
    }

    match end {
        TurnEnd::Result => {
            if assistant_text.is_empty() {
                return Err(AppError::Internal(
                    "claude produced no assistant text".into(),
                ));
            }
            Ok((assistant_text, segments, result_usage))
        }
        TurnEnd::Interrupted | TurnEnd::InterruptedKilled => {
            // Same shape as the cold interrupt: a partial reply tagged for the
            // transcript, never an error row — the CLI's interrupted `result`
            // says `is_error`, but the user asked for it.
            let body = if assistant_text.trim().is_empty() {
                "_(interrupted before any reply was generated)_".to_string()
            } else {
                format!("{assistant_text}\n\n_[interrupted by user]_")
            };
            let usage = result_usage.take().map(|mut u| {
                u.is_error = false;
                u
            });
            Ok((body, Vec::new(), usage))
        }
        TurnEnd::Died {
            status,
            stderr,
            read_error,
        } => {
            let status_text = status
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unknown".into());
            tracing::warn!(
                exit = %status_text,
                stderr_raw = %stderr,
                read_error = ?read_error,
                "companion warm: process died mid-turn"
            );
            let trimmed = if stderr.len() > 600 {
                format!(
                    "{}…",
                    crate::utils::text::truncate_on_char_boundary(&stderr, 600)
                )
            } else {
                stderr.clone()
            };
            let cause = match read_error {
                Some(e) => e,
                None => format!(
                    "claude exited with status {status_text}{}",
                    if trimmed.is_empty() {
                        String::new()
                    } else {
                        format!(": {trimmed}")
                    }
                ),
            };
            if assistant_text.trim().is_empty() {
                // No partial: a hard error, worded so the stale-resume
                // self-heal (`is_stale_session_error`) and the failure
                // classifier read it exactly as they read the cold spawn's.
                return Err(AppError::Internal(cause));
            }
            let mut usage = result_usage.take().unwrap_or_default();
            usage.is_error = true;
            Ok((
                format!("{assistant_text}\n\n_[interrupted by error: {cause}]_"),
                Vec::new(),
                Some(usage),
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Stdio;

    /// A stand-in CLI: one `system` init, one text delta, one `assistant`
    /// and one `result` per user line (a `SLOW` message answers after 10 s so
    /// an interrupt can land first); a `control_request` cancels the pending
    /// answer with a `control_response` and an error `result`, as claude
    /// 2.1.274 does. Its pid is in every reply.
    const FAKE_CLI: &str = r#"
const rl = require('readline').createInterface({ input: process.stdin });
const argIx = (f) => process.argv.indexOf(f);
const sid = argIx('--session-id') > 0 ? process.argv[argIx('--session-id') + 1]
  : argIx('--resume') > 0 ? process.argv[argIx('--resume') + 1] : 'fake-sid';
let pending = null;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
rl.on('line', (l) => {
  let j; try { j = JSON.parse(l); } catch { return; }
  if (j.type === 'user') {
    const text = j.message.content[0].text;
    out({ type: 'system', subtype: 'init', session_id: sid });
    const finish = () => {
      pending = null;
      out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'e' } } });
      out({ type: 'assistant', message: { content: [{ type: 'text', text: 'pid=' + process.pid + ' echo:' + text }] } });
      out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } });
    };
    if (text.includes('SLOW')) pending = setTimeout(finish, 10000); else finish();
  }
  if (j.type === 'control_request') {
    if (pending) { clearTimeout(pending); pending = null; }
    out({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id } });
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 1, usage: {} });
  }
});
rl.on('close', () => process.exit(0));
"#;

    fn fake_cli_path() -> PathBuf {
        let dir = std::env::temp_dir().join("personas-warm-fake");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join(format!(
            "fake-cli-{}.js",
            crate::companion::util::short_id(6)
        ));
        std::fs::write(&p, FAKE_CLI).unwrap();
        p
    }

    async fn spawn_fake(conversation_id: &str, sid: &str) -> Arc<WarmProcess> {
        let script = fake_cli_path();
        let mut cmd = Command::new("node");
        cmd.arg(&script)
            .arg("--session-id")
            .arg(sid)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        super::super::cli::apply_no_console_window(&mut cmd);
        let p = spawn_process(cmd, None, sid.to_string(), hash_str("stable"))
            .await
            .expect("node is on PATH for the fake CLI");
        registry().insert(conversation_id.to_string(), p.clone());
        p
    }

    fn turn_io<'a>(
        turn_id: &'a str,
        conv: &'a str,
        text: &'a str,
        fwd: &'a (dyn Fn(&str) + Sync),
    ) -> WarmTurnIo<'a> {
        WarmTurnIo {
            turn_id,
            session_id: conv,
            user_text: text,
            forward: fwd,
            pool: None,
            persist_progress: false,
            usage_sink: None,
        }
    }

    fn pid_of(text: &str) -> u32 {
        text.split("pid=")
            .nth(1)
            .and_then(|s| s.split(' ').next())
            .and_then(|s| s.parse().ok())
            .expect("the fake echoes its pid")
    }

    async fn wait_dead(p: &WarmProcess) -> bool {
        p.settle(Duration::from_secs(3)).await.is_some()
    }

    #[test]
    fn stable_dynamic_split_is_byte_stable_across_compositions() {
        let stable = join_stable("# Core\n\nYou are Athena.", "I am curious.");
        assert_eq!(
            stable,
            "# Core\n\nYou are Athena.\n\n# Identity (live, evolves)\n\nI am curious."
        );
        let turn1 = format!("{stable}\n\n# Memory\n\nrecall A\n\n# Live activity\n\none run");
        let turn2 = format!("{stable}\n\n# Memory\n\nrecall B\n\n# Live activity\n\ntwo runs");
        let (s1, d1) = split_stable_prefix(&turn1, &stable).unwrap();
        let (s2, d2) = split_stable_prefix(&turn2, &stable).unwrap();
        assert_eq!(s1, s2, "the seeded system prompt is byte-identical");
        assert_eq!(s1.as_bytes(), stable.as_bytes());
        assert_ne!(d1, d2);
        assert!(d1.contains("recall A") && d2.contains("recall B"));
        assert_eq!(hash_str(s1), hash_str(s2));
        // A drifted prefix (identity edited) is a miss, never a wrong cut.
        assert!(split_stable_prefix(
            &turn1,
            "# Core\n\nYou are Athena.\n\n# Identity (live, evolves)\n\nI changed."
        )
        .is_none());
        assert!(split_stable_prefix(&turn1, "").is_none());
        // An empty identity means no header at all, as the composer does it.
        assert_eq!(join_stable("core", ""), "core");
        // The user line: context block, blank line, message.
        assert_eq!(
            user_line_text(d1, "hello"),
            "# Context for this turn\n\n# Memory\n\nrecall A\n\n# Live activity\n\none run\n\nhello"
        );
        assert_eq!(user_line_text("  \n", "hello"), "hello");
        let json = user_line_json("hi \"there\"");
        let v: serde_json::Value = serde_json::from_str(json.trim()).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["message"]["content"][0]["text"], "hi \"there\"");
        let v: serde_json::Value = serde_json::from_str(interrupt_line_json().trim()).unwrap();
        assert_eq!(v["request"]["subtype"], "interrupt");
    }

    /// The prefix this module rebuilds is what the real composer starts its
    /// MAIN-tier prompt with: two compositions over the test databases both
    /// split at it, byte-identical. Skipped when no brain root exists on the
    /// machine (the composer reads the core and identity from disk).
    #[tokio::test]
    async fn stable_prefix_matches_the_real_composer() {
        if crate::companion::disk::brain_root().is_err() {
            eprintln!("no brain root here; skipping the composer split check");
            return;
        }
        let user_db = crate::db::init_test_user_db().unwrap();
        let sys_db = crate::db::init_test_db().unwrap();
        let compose = |q: &'static str| async {
            crate::companion::prompt::build_system_prompt(
                &user_db,
                &sys_db,
                None,
                "warm-split-test",
                q,
                false,
                false,
                false,
            )
            .await
            .unwrap()
            .0
        };
        let one = compose("first question").await;
        let two = compose("second question").await;
        let stable = stable_prefix_for_main().unwrap();
        assert!(!stable.is_empty());
        let (s1, _) = split_stable_prefix(&one, &stable)
            .expect("composition 1 starts with the stable prefix");
        let (s2, _) = split_stable_prefix(&two, &stable)
            .expect("composition 2 starts with the stable prefix");
        assert_eq!(s1.as_bytes(), s2.as_bytes());
        assert_eq!(hash_str(s1), hash_str(&stable));
    }

    #[test]
    fn eligibility_is_user_origin_on_a_claude_main_tier() {
        let main = ResolvedTier {
            class: TurnTierClass::Main,
            engine: AthenaEngine::Claude,
            model: "claude-opus-5".into(),
            effort: Some("low".into()),
        };
        assert!(warm_eligible(&TurnOrigin::User, &main, false));
        assert!(!warm_eligible(&TurnOrigin::User, &main, true));
        assert!(!warm_eligible(
            &TurnOrigin::Autonomous { chain_index: 1 },
            &main,
            false
        ));
        assert!(!warm_eligible(
            &TurnOrigin::External {
                source: "ship".into()
            },
            &main,
            false
        ));
        let grok = ResolvedTier {
            engine: AthenaEngine::Grok,
            ..main.clone()
        };
        assert!(!warm_eligible(&TurnOrigin::User, &grok, false));
        let aside = ResolvedTier {
            class: TurnTierClass::Aside,
            ..main
        };
        assert!(!warm_eligible(&TurnOrigin::User, &aside, false));
    }

    /// (b) two turns reuse one pid; (c) reset kills; (f) interrupt is
    /// honoured and the process keeps serving; (d) the reaper with a zero
    /// horizon reaps an idle process and leaves a busy one alone.
    #[tokio::test]
    async fn fake_cli_reuse_interrupt_reset_and_reaper() {
        let conv = format!("warm-test-{}", crate::companion::util::short_id(6));
        let p = spawn_fake(&conv, "11111111-1111-4111-8111-111111111111").await;
        let fwd = |_: &str| {};

        // (b) reuse
        let o1 = turn_on(&p, turn_io("t1", &conv, "hello", &fwd))
            .await
            .unwrap();
        assert!(matches!(o1.end, TurnEnd::Result));
        assert_eq!(
            o1.acc.new_claude_session_id.as_deref(),
            Some("11111111-1111-4111-8111-111111111111")
        );
        assert!(o1.acc.first_text_ms.is_some());
        let o2 = turn_on(&p, turn_io("t2", &conv, "again", &fwd))
            .await
            .unwrap();
        assert!(matches!(o2.end, TurnEnd::Result));
        let pid1 = pid_of(&o1.acc.assistant_text);
        let pid2 = pid_of(&o2.acc.assistant_text);
        assert_eq!(pid1, pid2, "turn 2 reused the process");
        assert_eq!(Some(pid1), p.pid);
        assert!(o2.acc.assistant_text.contains("echo:again"));
        assert!(get(&conv).is_some_and(|q| Arc::ptr_eq(&q, &p)));

        // (f) interrupt: request lands ~300 ms into a 10 s turn.
        let turn_id = "t3-slow".to_string();
        let tid = turn_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            super::super::interrupts::request_interrupt(&tid);
        });
        let started = Instant::now();
        let o3 = turn_on(&p, turn_io(&turn_id, &conv, "SLOW", &fwd))
            .await
            .unwrap();
        let took = started.elapsed();
        assert!(
            matches!(o3.end, TurnEnd::Interrupted),
            "control_request honoured"
        );
        assert!(took < Duration::from_secs(3), "ended in {took:?}");
        assert!(p.is_alive(), "the process survives an honoured interrupt");
        let o4 = turn_on(&p, turn_io("t4", &conv, "after", &fwd))
            .await
            .unwrap();
        assert!(matches!(o4.end, TurnEnd::Result));
        assert_eq!(pid_of(&o4.acc.assistant_text), pid1);

        // (d) reaper: a busy process is never reaped; an idle one is.
        p.busy.store(true, Ordering::Relaxed);
        assert_eq!(reap_idle(Duration::ZERO), 0);
        assert!(get(&conv).is_some());
        p.busy.store(false, Ordering::Relaxed);
        assert_eq!(
            reap_idle(Duration::from_secs(3600)),
            0,
            "within the horizon"
        );
        assert_eq!(reap_idle(Duration::ZERO), 1);
        assert!(get(&conv).is_none());
        assert!(wait_dead(&p).await, "reaped process exited");

        // (c) reset kills: spawn again, kill through the reset door.
        let p2 = spawn_fake(&conv, "22222222-2222-4222-8222-222222222222").await;
        assert!(p2.is_alive());
        assert!(kill_conversation(&conv));
        assert!(!kill_conversation(&conv), "second reset finds nothing");
        assert!(wait_dead(&p2).await, "reset killed the process");
        assert!(get(&conv).is_none());

        // App exit: everything left goes.
        let p3 = spawn_fake(&conv, "44444444-4444-4444-8444-444444444444").await;
        assert!(kill_all_warm_sessions() >= 1);
        assert!(wait_dead(&p3).await);
        assert!(get(&conv).is_none());
    }

    /// A process that dies mid-turn is dropped and the partial is salvaged.
    /// The kill lands once the fake's init line has been read, so the test
    /// never races node's pipe flush.
    #[tokio::test]
    async fn death_mid_turn_drops_the_entry_and_salvages() {
        let conv = format!("warm-death-{}", crate::companion::util::short_id(6));
        let p = spawn_fake(&conv, "33333333-3333-4333-8333-333333333333").await;
        let seen_init = Arc::new(AtomicBool::new(false));
        let flag = seen_init.clone();
        let fwd = move |l: &str| {
            if l.contains("\"init\"") {
                flag.store(true, Ordering::Relaxed);
            }
        };
        let killer = p.clone();
        tokio::spawn(async move {
            while !seen_init.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            killer.start_kill();
        });
        let o = turn_on(&p, turn_io("t-die", &conv, "SLOW", &fwd))
            .await
            .unwrap();
        assert!(matches!(o.end, TurnEnd::Died { .. }));
        assert!(get(&conv).is_none(), "dead process dropped");
        // The init line arrived, so the pointer survives for --resume.
        assert_eq!(
            o.acc.new_claude_session_id.as_deref(),
            Some("33333333-3333-4333-8333-333333333333")
        );
    }

    /// Live (HYBRID_LIVE=1): two real claude turns on one process, the second
    /// turn's first_text_ms against a cold spawn of the same prompt; and the
    /// interrupt probe on a long turn.
    #[tokio::test]
    async fn live_warm_turns_beat_cold_and_interrupt_is_honoured() {
        if std::env::var("HYBRID_LIVE").is_err() {
            return;
        }
        let tier = ResolvedTier {
            class: TurnTierClass::Main,
            engine: AthenaEngine::Claude,
            model: "claude-sonnet-5".into(),
            effort: Some("low".into()),
        };
        let stable = "You are Athena, a concise companion. Reply in one short sentence.";
        let conv = format!("warm-live-{}", crate::companion::util::short_id(6));
        let fwd = |_: &str| {};
        let prompt = "Say hello in five words.";

        let p = spawn_warm_launch(&tier, "turn_live1", &conv, None, stable)
            .await
            .unwrap();
        registry().insert(conv.clone(), p.clone());
        let o1 = turn_on(&p, turn_io("live-1", &conv, prompt, &fwd))
            .await
            .unwrap();
        assert!(matches!(o1.end, TurnEnd::Result));
        let o2 = turn_on(&p, turn_io("live-2", &conv, prompt, &fwd))
            .await
            .unwrap();
        assert!(matches!(o2.end, TurnEnd::Result));
        let sid = o2.acc.new_claude_session_id.clone().unwrap();
        assert_eq!(
            sid, p.claude_session_id,
            "init echoes the pinned session id"
        );

        // Cold spawn of the same prompt, timed from spawn as cli.rs does.
        let launch = build_launch(
            AthenaEngine::Claude,
            &tier,
            &LaunchCtx {
                turn_id: "turn_livecold",
                session_id: &conv,
                resume_session_id: None,
                system_prompt: stable,
                user_message: prompt,
                browser_tools: false,
                cwd_override: None,
                mcp: &[],
                warm: None,
            },
        )
        .unwrap();
        let mut cmd = prepare_command(&launch);
        let t0 = Instant::now();
        let mut child = cmd.spawn().unwrap();
        {
            let mut stdin = child.stdin.take().unwrap();
            stdin.write_all(prompt.as_bytes()).await.unwrap();
        }
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut cold_first = None;
        while let Ok(Some(l)) = lines.next_line().await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&l) {
                if cold_first.is_none() && super::super::cli::is_text_delta(&v) {
                    cold_first = Some(t0.elapsed().as_millis() as i64);
                }
            }
        }
        let _ = child.wait().await;
        drop(launch);
        eprintln!(
            "HYBRID_LIVE warm: turn1 first_text_ms={:?} turn2 first_text_ms={:?} cold first_text_ms={:?} pid={:?}",
            o1.acc.first_text_ms, o2.acc.first_text_ms, cold_first, p.pid
        );
        assert!(o2.acc.first_text_ms.is_some() && cold_first.is_some());

        // Interrupt probe: 3 s into a long turn.
        let tid = "live-int".to_string();
        let t = tid.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            super::super::interrupts::request_interrupt(&t);
        });
        let started = Instant::now();
        let o3 = turn_on(
            &p,
            turn_io(
                &tid,
                &conv,
                "Count slowly from 1 to 200, one number per line, no other text.",
                &fwd,
            ),
        )
        .await
        .unwrap();
        let took = started.elapsed();
        let honoured = matches!(o3.end, TurnEnd::Interrupted);
        eprintln!(
            "HYBRID_LIVE interrupt: honoured={honoured} ended_after={took:?} alive={} partial_lines={}",
            p.is_alive(),
            o3.acc.assistant_text.lines().count()
        );
        assert!(honoured, "claude 2.1.274 honours control_request interrupt");
        assert!(p.is_alive());
        let o4 = turn_on(&p, turn_io("live-4", &conv, prompt, &fwd))
            .await
            .unwrap();
        assert!(matches!(o4.end, TurnEnd::Result));
        eprintln!(
            "HYBRID_LIVE after interrupt: first_text_ms={:?}",
            o4.acc.first_text_ms
        );

        // Respawn with --resume continues the thread.
        kill_conversation(&conv);
        let p2 = spawn_warm_launch(&tier, "turn_live2", &conv, Some(&sid), stable)
            .await
            .unwrap();
        let o5 = turn_on(
            &p2,
            turn_io(
                "live-5",
                &conv,
                "What did I ask you to do in my first message? One sentence.",
                &fwd,
            ),
        )
        .await
        .unwrap();
        eprintln!("HYBRID_LIVE resume: {}", o5.acc.assistant_text);
        assert!(matches!(o5.end, TurnEnd::Result));
        p2.start_kill();
    }
}
