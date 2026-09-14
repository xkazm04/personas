//! Shared plumbing for ephemeral one-shot Claude CLI calls used by the
//! brain's backend computations (consolidation, reflection, recall
//! synthesis). Each of these spawns a fresh `claude -p -` process, pipes
//! a focused prompt on stdin, collects the streamed assistant-text
//! deltas, and returns the assembled text (or a JSON envelope parsed by
//! the caller) — no `--resume`, no system-prompt file, no UI streaming.
//!
//! ## Every leg through here is metered (L1a)
//!
//! Until 2026-08-08 this module drained stdout for assistant-text deltas and
//! **threw the terminal `result` event away**, so the seven legs below reached
//! neither spend ledger: not `companion_turn` (no user-db handle here) and not
//! `dev_llm_spend` (nothing wrote it). Their cost was invisible in both, which
//! mattered because this is exactly the machinery the L1 sleep cycle runs on —
//! the cycle's own price could not be measured
//! (`docs/plans/athena-longevity.md`, Part I §7).
//!
//! So [`call_claude_text`] now takes a `UserDbPool` and writes one
//! `companion_turn` row per invocation with `origin='maintenance'` and the
//! [`leg`] name in `trigger_kind`. There is deliberately **no unmetered public
//! entry point**: a future leg cannot be added without a pool, which is the
//! structural version of the rule rather than a comment asking for it.
//!
//! One row per invocation, success or failure. A leg whose CLI ran fine but
//! whose *reply* failed to parse (`extract_json_span`, an empty reflection)
//! still has exactly one row, flagged however the CLI itself reported: the row
//! records the CLI leg that was paid for, and the caller's parse verdict is a
//! separate concern — the same split `cli_text_tracked` has always had.
//!
//! The row shape and the failure taxonomy are NOT re-implemented here. They
//! come from `turn_ledger::{record_cli_leg, record_failed_leg}`, shared with
//! `athena_reaction`'s headless decision legs, and the `result`-event parser is
//! `turn_ledger::CliUsage::from_line` — the same one the tracked path feeds
//! every stdout line to. Two parsers or two row shapes would drift, and both
//! feed one `companion_get_health` number.
//!
//! ## Why this module exists
//!
//! Three call sites (`consolidation::call_claude_oneshot`,
//! `reflection::call_claude_oneshot`, `recall_synthesis::call_claude_oneshot`)
//! independently implemented the same ~120-line spawn/stdin/stdout-delta
//! collect/stderr-buffer/wait/timeout sequence, plus `extract_assistant_text`,
//! `strip_code_fence`, `preview`, and a tolerant first-`{`/last-`}` JSON-span
//! extraction. They drifted: `recall_synthesis::preview` sliced a
//! multi-byte UTF-8 string at a raw byte index with no char-boundary
//! backoff (`&s[..n]`), which can panic; `recall_synthesis::strip_code_fence`
//! required a closing fence while `consolidation`'s tolerated a missing
//! one. All three call sites now share this single implementation.
//!
//! ## Liveness supervision, not a flat timeout (G18, 2026-09-08)
//!
//! Until 2026-09-08 the whole drain sat inside one `timeout(call_timeout, …)`
//! and a call that outlived it died with `"{label} timed out after {d:?}"`.
//! That is a **duration** rule, and duration is the wrong question. Two dead
//! App Master decisions made the case: one at the old flat 180 s, one at the
//! 480 s that replaced it, the second leaving `persona_executions` row
//! `0cea3b9a` at `status=running` with `log_file_path` NULL, zero cost and zero
//! output — a spawn that produced *nothing at all*, killed by a clock that was
//! measuring the wrong thing. Raising the number would not have saved it, and a
//! genuinely long call was being punished for the same reason.
//!
//! The operator's rule: *"we should be supportive to longrunning tasks … design
//! a mechanism which would healthcheck CLI and abort/resume if appears in dead
//! end or inactive. We can send probes with 1min period for example and let
//! tasks do their job in their pace."*
//!
//! So: **a call may run as long as it is producing.** The supervisor stamps the
//! instant of the last stdout OR stderr line of any kind, and every
//! [`LIVENESS_PROBE_INTERVAL`] asks two questions — has anything arrived inside
//! [`LIVENESS_IDLE_LIMIT`], and is the child still alive. It aborts only on a
//! genuine dead end, and [`AbortReason`] names which one, in the error text and
//! therefore in the ledger:
//!
//! | Abort | Meaning |
//! |---|---|
//! | [`AbortReason::Silent`] | not one line for the idle window — the call is inactive |
//! | [`AbortReason::ChildExited`] | the process is gone and no result ever came |
//! | [`AbortReason::NoOutput`] | it ran to completion and emitted not a single line |
//! | [`AbortReason::Backstop`] | the absolute ceiling, reached while still producing |
//!
//! The honesty is the point: the flat-timeout message is what made today's
//! problem visible at all, and an abort that does not say WHICH dead end it was
//! would be a step backwards.
//!
//! The `backstop` argument every caller still passes is the last of those — an
//! absolute anti-runaway ceiling, not a latency budget. For the seven
//! latency-sensitive legs (briefing, tours, the night shift…) it is deliberately
//! close to their old flat value, so their behaviour is unchanged; for the App
//! Master decision it is hours, because that call has no user waiting on it.
//!
//! ## A usage limit is not a dead end
//!
//! An account that has hit its cap has not stalled and has not failed — it is
//! *paused*, and the difference is actionable: there is a reset time. Detected
//! with `personas_engine::parser::{is_session_limit_error, parse_usage_limit}`
//! (the engine's ONE detector, never a second one here) and returned as
//! [`OneshotOutcome::UsageLimited`], which the App Master decision path turns
//! into a paused ledger row and a re-arm at the reset rather than a fallback.
//!
//! ## `kill_on_drop`
//!
//! `tokio::process::Child` does **not** kill the child process on drop by
//! default (unlike `std::process::Child`). The abort branches below
//! `?`-return before `child.wait()`, which used to drop the `Child` and
//! leak a live `claude.exe` (plus its in-flight model call) per abandoned
//! invocation. This is fixed two ways, belt-and-suspenders: the spawned
//! `Command` has `.kill_on_drop(true)` set before `spawn()`, and every abort
//! branch additionally calls `child.kill().await` explicitly so the reap is
//! deterministic rather than relying purely on drop.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::time::Instant;

use crate::companion::session::base_cli_invocation;
use crate::companion::turn_ledger::{self, CliUsage};
use crate::db::UserDbPool;
use crate::error::AppError;

/// The maintenance legs that run through this module, as the low-cardinality
/// tokens written to `companion_turn.trigger_kind`.
///
/// One token per leg, used for BOTH the ledger label and the error-message tag
/// — so `GROUP BY origin, trigger_kind` and a `tracing` line can never name the
/// same leg two different ways. Snake_case because these are query keys, not
/// prose.
pub mod leg {
    pub const CONSOLIDATION: &str = "consolidation";
    pub const REFLECTION: &str = "reflection";
    /// Its one call site (`recall_synthesis::call_claude_oneshot`) is
    /// `ml`-gated and the shipping build has no `ml`, so on that build this
    /// really is unused — like the rest of that module, which carries the same
    /// dead-code warnings today. Named here anyway so the leg has a token the
    /// moment the vector lane compiles, rather than a string invented later
    /// that fails to match this one.
    #[cfg_attr(not(feature = "ml"), allow(dead_code))]
    pub const RECALL_SYNTHESIS: &str = "recall_synthesis";
    pub const BRIEFING: &str = "briefing";
    pub const NIGHT_PLANNER: &str = "night_planner";
    pub const NIGHT_UNATTENDED: &str = "night_unattended";
    pub const TOURS: &str = "tours";
    /// Phase A of the sleep cycle: conversation → candidate facts/procedurals.
    /// The cycle's dominant cost, and the reason L1a metered this module at all
    /// — `GROUP BY trigger_kind` over `origin='maintenance'` is what makes "what
    /// does a night of sleep cost" an answerable question.
    pub const CYCLE_COMPRESS: &str = "cycle_compress";
    /// Phase B of the sleep cycle: supersede / contradiction judgement over the
    /// active fact set.
    pub const CYCLE_RECONCILE: &str = "cycle_reconcile";
    /// The App Master's wake decision (`engine::subscription::attention_decide`):
    /// one bounded call per wake that picks which of a persona's charters move
    /// its project. Metered here like every other leg so "what does an
    /// autonomous persona cost to THINK, before it costs anything to act" is a
    /// `GROUP BY trigger_kind` away.
    pub const APP_MASTER_DECISION: &str = "app_master_decision";
}

/// How often the supervisor asks "is this call still alive?".
///
/// The operator's own suggested period. It is the granularity of both liveness
/// questions (silence and a vanished child), so a dead end is noticed within
/// one probe of becoming one. The absolute backstop is NOT checked here — it
/// has its own exact deadline, so a leg with a 75 s backstop still dies at 75 s
/// rather than at the next minute boundary.
pub const LIVENESS_PROBE_INTERVAL: Duration = Duration::from_secs(60);

/// How long a call may produce NOTHING before it is declared a dead end.
///
/// Five probes. Long enough that a model thinking hard between tool calls is
/// never mistaken for a stall — the longest observed gap between stream-json
/// lines on a healthy decision is seconds — and short enough that a wedged
/// spawn is reaped inside a single attention tick (300 s) rather than holding
/// its slot until somebody notices.
pub const LIVENESS_IDLE_LIMIT: Duration = Duration::from_secs(5 * 60);

/// Why a supervised call was aborted. One variant per dead end, because the
/// abort message is the only thing a ledger row carries and "timed out" was
/// exactly the message that hid the real fault for two whole decisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AbortReason {
    /// Not one stdout or stderr line for [`LIVENESS_IDLE_LIMIT`].
    Silent { idle: Duration },
    /// A probe found the process gone while stdout was still open — it died
    /// without ever producing a result.
    ChildExited { code: Option<i32>, ran: Duration },
    /// It ran to completion and emitted not a single line. The shape of the
    /// 2026-09-08 dead decision: a spawn that produced nothing at all.
    NoOutput { ran: Duration },
    /// The absolute ceiling, reached while the call was still producing. The
    /// only abort that is about duration, and it exists solely so a runaway
    /// cannot live forever.
    Backstop { limit: Duration },
}

impl AbortReason {
    /// The sentence that reaches the error and the ledger. Always names WHICH
    /// dead end, and never the word "timeout" unless duration is genuinely what
    /// fired.
    pub fn describe(&self, label: &str) -> String {
        match self {
            Self::Silent { idle } => format!(
                "{label} aborted: no output for {}s — the call was not producing \
                 (liveness probe every {}s; a call may run as long as it streams)",
                idle.as_secs(),
                LIVENESS_PROBE_INTERVAL.as_secs()
            ),
            Self::ChildExited { code, ran } => format!(
                "{label} aborted: the CLI process exited ({}) after {}s without producing a \
                 result",
                code.map(|c| format!("code {c}"))
                    .unwrap_or("signalled".into()),
                ran.as_secs()
            ),
            Self::NoOutput { ran } => format!(
                "{label} aborted: the CLI produced no output at all in {}s — the spawn \
                 reached no model call",
                ran.as_secs()
            ),
            Self::Backstop { limit } => format!(
                "{label} aborted: the absolute backstop of {}s was reached while the call was \
                 still producing",
                limit.as_secs()
            ),
        }
    }
}

/// What a supervised call ended as. Three outcomes, not two: a usage limit is
/// neither a success nor a dead end, and collapsing it into either is what made
/// an account cap look like a stalled CLI.
#[derive(Debug, Clone)]
pub enum OneshotOutcome {
    /// The assembled assistant text.
    Text(String),
    /// The account hit its usage cap. Carries the reset time when the provider
    /// stated one — parsed by the engine's own
    /// `personas_engine::parser::parse_usage_limit`, never a second detector.
    UsageLimited(UsageLimitPause),
}

/// A usage-limit stop, with everything a caller needs to schedule a resume.
#[derive(Debug, Clone)]
pub struct UsageLimitPause {
    /// Window (the rolling ~5-hour cap) or Weekly.
    pub scope: personas_core::error_taxonomy::UsageLimitScope,
    /// When the limit resets, when the provider said so. `None` means the
    /// message carried no timestamp — callers must say so rather than inventing
    /// one.
    pub resets_at: Option<chrono::DateTime<chrono::Utc>>,
    /// A bounded preview of the text this was read from, so a ledger row can be
    /// checked against what the CLI actually said.
    pub detail: String,
}

/// The ONE `Command::new` in this module: a fully piped child with the
/// desktop-heap guard and the deterministic reap already applied.
///
/// Factored out for two reasons that point the same way. Tokio does NOT kill
/// children on drop by default (unlike `std::process::Child`), and every abort
/// branch in [`supervise`] `?`-returns before `wait()` — dropping the `Child`
/// and leaking a live `claude.exe` plus its in-flight model call. `kill_on_drop`
/// is the primary guard here; the explicit `child.kill().await` at each abort is
/// the belt-and-suspenders backstop. And the supervision tests drive their fake
/// producer through this same helper rather than opening a second spawn door —
/// so this module has exactly one process-creation site, which is what
/// `process-spawn-outside-chokepoint` counts and what a reader has to audit.
fn piped_command(program: &str, args: &[String], cwd: &std::path::Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // No console window on Windows (desktop-heap / 0xC0000142 guard).
    crate::companion::session::apply_no_console_window(&mut cmd);
    cmd.kill_on_drop(true);
    cmd
}

/// Spawn a one-shot `claude -p -` call, pipe `prompt` as stdin, collect
/// the streamed assistant-text deltas, **record the spend**, and return the
/// assembled text.
///
/// `leg` is one of the [`leg`] constants: it tags the ledger row
/// (`companion_turn.trigger_kind`, with `origin='maintenance'`) and is folded
/// into error messages so failures are traceable back to the caller.
///
/// Metering is best-effort and never changes the call's result — an insert
/// failure is a `tracing::warn!` inside the ledger, and a leg whose CLI emitted
/// no `result` event records a row with NULL usage. What must not happen is a
/// leg with no row at all; that was the state this replaced.
///
/// No `--resume`, no system-prompt file (callers put everything in the
/// user prompt for total control), no stream events to the UI — this is
/// a backend computation, not a chat turn.
/// `backstop` is the ABSOLUTE ceiling, not a latency budget — see the module
/// header. Liveness ([`LIVENESS_IDLE_LIMIT`]) is what normally ends a stalled
/// call; this is the anti-runaway backstop underneath it.
pub async fn call_claude_text(
    pool: &UserDbPool,
    prompt: &str,
    model: &str,
    leg: &str,
    backstop: Duration,
) -> Result<String, AppError> {
    match call_claude_outcome(pool, prompt, model, leg, backstop).await? {
        OneshotOutcome::Text(text) => Ok(text),
        // A caller that did not ask for the typed outcome still must not be
        // told a usage cap was a stall. `RateLimited` is the AppError variant
        // whose whole job is "come back later", and the reset time rides in the
        // message so the row is readable.
        OneshotOutcome::UsageLimited(pause) => Err(AppError::RateLimited(format!(
            "{leg}: the account's usage limit was reached{}",
            match pause.resets_at {
                Some(t) => format!(" — resets at {}", t.to_rfc3339()),
                None => " — the CLI did not state a reset time".to_string(),
            }
        ))),
    }
}

/// The same call, with the usage-limit outcome kept typed.
///
/// The App Master decision path uses this one: a paused account and a dead CLI
/// need opposite responses (wait for the reset vs degrade to the fallback
/// lane), and only a typed outcome can tell them apart.
pub async fn call_claude_outcome(
    pool: &UserDbPool,
    prompt: &str,
    model: &str,
    leg: &str,
    backstop: Duration,
) -> Result<OneshotOutcome, AppError> {
    match run_oneshot(prompt, model, leg, backstop).await {
        Ok(run) => {
            // `timed_out` is always false on this path: unlike
            // `athena_reaction::cli_text_inner` (whose 180s cap returns `Ok`
            // with a partial blob), an abort here `?`-returns below, so it
            // arrives as an `Err` and is classified by `record_failed_leg`.
            // There is no clean-looking aborted row to guard against.
            //
            // A usage-limited leg IS metered: the CLI ran, and whatever it
            // reported before hitting the cap was paid for.
            turn_ledger::record_cli_leg(
                pool,
                turn_ledger::ORIGIN_MAINTENANCE,
                leg,
                model,
                run.usage,
                false,
            );
            Ok(run.outcome)
        }
        Err(e) => {
            turn_ledger::record_failed_leg(pool, turn_ledger::ORIGIN_MAINTENANCE, leg, model, &e);
            Err(e)
        }
    }
}

/// What one maintenance leg produced: its outcome plus the terminal `result`
/// event's usage (`None` when the CLI emitted none, which is what a crashed or
/// very old CLI looks like).
#[derive(Debug)]
struct OneshotRun {
    outcome: OneshotOutcome,
    usage: Option<CliUsage>,
}

/// The supervision parameters, together, so a test can compress the clock
/// without the production path ever seeing anything but the real constants.
#[derive(Debug, Clone, Copy)]
struct Supervision {
    probe_interval: Duration,
    idle_limit: Duration,
    backstop: Duration,
}

impl Supervision {
    /// The shipping rule: probe every minute, abort after five silent probes,
    /// with the caller's absolute ceiling underneath.
    fn production(backstop: Duration) -> Self {
        Self {
            probe_interval: LIVENESS_PROBE_INTERVAL,
            idle_limit: LIVENESS_IDLE_LIMIT,
            backstop,
        }
    }
}

/// Spawn + drain. Split from [`call_claude_text`] so the ledger write has
/// exactly one success path and one failure path to wrap, rather than being
/// threaded through every `?` in the body.
async fn run_oneshot(
    prompt: &str,
    model: &str,
    label: &str,
    backstop: Duration,
) -> Result<OneshotRun, AppError> {
    let cwd = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let (cmd_program, mut argv) = base_cli_invocation();
    argv.extend([
        "-p".into(),
        "-".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--dangerously-skip-permissions".into(),
        "--exclude-dynamic-system-prompt-sections".into(),
        "--model".into(),
        model.to_string(),
    ]);

    let mut cmd = piped_command(&cmd_program, &argv, &cwd);
    cmd.env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    // Subscription-only — never the API account.
    crate::engine::cli_process::force_subscription_auth(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Internal(format!("spawn claude ({label}): {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Internal(format!("write stdin ({label}): {e}")))?;
        drop(stdin);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Internal(format!("claude stdout missing ({label})")))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Internal(format!("claude stderr missing ({label})")))?;

    supervise(
        &mut child,
        stdout,
        stderr,
        label,
        Supervision::production(backstop),
    )
    .await
}

/// Drain the child under liveness supervision.
///
/// Split from [`run_oneshot`] so the whole rule is testable against a fake
/// producer with a compressed clock: everything above this point is spawning
/// `claude`, everything below is the supervision the operator asked for.
///
/// Never returns while the child is still running: every exit path either
/// observed stdout EOF or killed the child explicitly first.
async fn supervise(
    child: &mut Child,
    stdout: ChildStdout,
    stderr: ChildStderr,
    label: &str,
    rule: Supervision,
) -> Result<OneshotRun, AppError> {
    let started = Instant::now();
    let deadline = started + rule.backstop;

    // The liveness clock, shared with the stderr reader. Milliseconds since
    // `started`, as an atomic: a stderr line is activity just as much as a
    // stdout line (a CLI reporting progress or a retry on stderr is alive), and
    // a lock-free stamp keeps the reader task free of anything held across an
    // await.
    let last_line_ms = Arc::new(AtomicU64::new(0));
    let touch = |clock: &AtomicU64| {
        clock.store(
            u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
            Ordering::Relaxed,
        );
    };

    let stderr_buf = Arc::new(tokio::sync::Mutex::new(String::new()));
    let stderr_handle = {
        let buf = stderr_buf.clone();
        let clock = last_line_ms.clone();
        let base = started;
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                clock.store(
                    u64::try_from(base.elapsed().as_millis()).unwrap_or(u64::MAX),
                    Ordering::Relaxed,
                );
                let mut g = buf.lock().await;
                if !g.is_empty() {
                    g.push('\n');
                }
                g.push_str(&line);
            }
        })
    };

    // Reuse the streaming JSON parser to extract assistant text deltas.
    let mut assistant_text = String::new();
    let mut usage: Option<CliUsage> = None;
    let mut stdout_lines: u64 = 0;
    // The first stdout line that looks like an account usage cap. Kept verbatim
    // so `parse_usage_limit` sees exactly what the CLI wrote.
    let mut limit_line: Option<String> = None;
    let mut reader = BufReader::new(stdout).lines();

    let mut probe = tokio::time::interval_at(started + rule.probe_interval, rule.probe_interval);
    probe.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let abort: Option<AbortReason> = loop {
        tokio::select! {
            // Biased so a line that is already buffered always wins a probe
            // scheduled for the same instant — a call must never be declared
            // silent while its own output is sitting in the reader.
            biased;
            line = reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        touch(&last_line_ms);
                        stdout_lines += 1;
                        if let Some(delta) = extract_assistant_text(&line) {
                            assistant_text.push_str(&delta);
                        }
                        // The terminal `result` event carries this leg's real
                        // cost / token usage / duration. Draining stdout without
                        // reading it is what made every maintenance leg
                        // free-looking for 77 days. Same parser the tracked
                        // headless path feeds — one implementation, no drift.
                        if let Some(u) = CliUsage::from_line(&line) {
                            usage = Some(u);
                        }
                        // The model's own words are never the provider's
                        // signal: an App Master that writes "the session limit
                        // that killed last wake's dispatch" in its decision is
                        // reporting on a limit, not hitting one. Three real
                        // dispatch decisions became one-hour pauses on
                        // 2026-09-09 because this scan read the assistant
                        // line. Only non-assistant stream lines (result,
                        // system, bare text) can carry the cap.
                        if limit_line.is_none()
                            && line_can_carry_the_cap(&line)
                            && personas_engine::parser::is_session_limit_error(&line)
                        {
                            limit_line = Some(line);
                        }
                    }
                    // EOF: the CLI closed stdout. The normal end of every
                    // healthy call.
                    Ok(None) => break None,
                    Err(e) => {
                        let _ = child.kill().await;
                        return Err(AppError::Internal(format!(
                            "read stdout ({label}): {e}"
                        )));
                    }
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                break Some(AbortReason::Backstop { limit: rule.backstop });
            }
            _ = probe.tick() => {
                let idle = started.elapsed()
                    - Duration::from_millis(last_line_ms.load(Ordering::Relaxed));
                if idle >= rule.idle_limit {
                    break Some(AbortReason::Silent { idle });
                }
                // Alive but quiet is fine; GONE is not. `try_wait` reaps
                // without blocking, and a child that has exited while stdout is
                // still held open (a grandchild inherited the pipe) would
                // otherwise keep this loop parked until the backstop.
                if let Ok(Some(status)) = child.try_wait() {
                    break Some(AbortReason::ChildExited {
                        code: status.code(),
                        ran: started.elapsed(),
                    });
                }
                tracing::debug!(
                    leg = label,
                    idle_secs = idle.as_secs(),
                    elapsed_secs = started.elapsed().as_secs(),
                    lines = stdout_lines,
                    "oneshot liveness probe: still producing"
                );
            }
        }
    };

    if let Some(reason) = abort {
        // Deterministic reap: don't rely purely on kill_on_drop-on-drop
        // ordering — kill explicitly before surfacing the abort.
        let _ = child.kill().await;
        stderr_handle.abort();
        return Err(AppError::Internal(reason.describe(label)));
    }

    let _ = stderr_handle.await;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Internal(format!("await claude ({label}): {e}")))?;
    let stderr_text = stderr_buf.lock().await.clone();

    // A usage cap is checked BEFORE the exit code, because a capped CLI exits
    // non-zero and reporting it as "claude exited 1" is exactly the collapse
    // this outcome exists to prevent.
    if let Some(pause) = detect_usage_limit(limit_line.as_deref(), &stderr_text, &assistant_text) {
        return Ok(OneshotRun {
            outcome: OneshotOutcome::UsageLimited(pause),
            usage,
        });
    }

    if !status.success() {
        return Err(AppError::Internal(format!(
            "claude {label} exited {}: {}",
            status.code().map(|c| c.to_string()).unwrap_or("?".into()),
            stderr_text
        )));
    }

    // Ran to completion and said nothing whatsoever. This is the shape of the
    // 2026-09-08 dead decision — zero cost, no log file, no output — and it is
    // a dead end, not an empty success: returning `Ok("")` here would hand the
    // caller a parse failure that blames the model for a spawn that never
    // reached one.
    if stdout_lines == 0 {
        return Err(AppError::Internal(
            AbortReason::NoOutput {
                ran: started.elapsed(),
            }
            .describe(label),
        ));
    }

    Ok(OneshotRun {
        outcome: OneshotOutcome::Text(assistant_text),
        usage,
    })
}

/// Read a usage-limit pause out of whatever the call produced.
///
/// Three sources in priority order — the stdout line that tripped
/// `is_session_limit_error`, then stderr, then the assembled assistant text —
/// because the CLI has put this message in all three over time. The PARSING is
/// never re-implemented: `personas_engine::parser::parse_usage_limit` owns both
/// the pipe-delimited unix stamp and the "resets 3am" window form, and a second
/// detector here is exactly the two-predicates-one-vocabulary drift that file
/// documents against itself.
fn detect_usage_limit(
    stdout_line: Option<&str>,
    stderr_text: &str,
    assistant_text: &str,
) -> Option<UsageLimitPause> {
    // When the CLI surfaces the cap AS assistant text, that notice is the whole
    // reply. A reply of any length that merely mentions a limit is the model
    // talking about one, and pausing on it throws the decision away (G35).
    let assistant_notice = if assistant_text.trim().chars().count() <= LIMIT_NOTICE_MAX_CHARS {
        assistant_text
    } else {
        ""
    };
    for source in [stdout_line.unwrap_or(""), stderr_text, assistant_notice] {
        if source.is_empty() {
            continue;
        }
        if let Some(info) = personas_engine::parser::parse_usage_limit(source) {
            return Some(UsageLimitPause {
                scope: info.scope,
                resets_at: info.resets_at,
                detail: preview(source.trim(), 300),
            });
        }
    }
    None
}

/// The longest a provider's limit notice gets when it arrives as the assistant
/// text. Anything longer is a reply that talks about limits, not a cap.
const LIMIT_NOTICE_MAX_CHARS: usize = 200;

/// Whether a stdout line can be the PROVIDER speaking about a cap, as opposed
/// to the model speaking about one. A bare non-JSON line can (the CLI's
/// classic `Claude AI usage limit reached|<ts>`). A stream-json event can only
/// when the CLI itself marks it an error: measured against the captured corpus,
/// a capped turn arrives as `"is_error":true` with the reason in `result`.
/// Every other event — the assistant line, and the successful `result` line
/// that repeats the whole reply under `result` — carries the model's words,
/// and the second of those is what paused three decisions at 17:15 after the
/// first fix had covered only the assistant line (G35b).
fn line_can_carry_the_cap(line: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(line) {
        Err(_) => true,
        Ok(v) => v
            .get("is_error")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}

/// Strip stream-json wrapping and pull text deltas. Matches the
/// extractor on the frontend (extractAssistantText in CompanionPanel).
pub fn extract_assistant_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let blocks = v.get("message")?.get("content")?.as_array()?;
    let mut out = String::new();
    for b in blocks {
        if b.get("type").and_then(|x| x.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Strip a leading/trailing markdown code fence (```` ```json ```` or
/// ```` ``` ````) if present. Tolerant of a missing closing fence —
/// Claude sometimes truncates or omits it despite explicit instructions
/// not to fence at all; being lenient here can only help, never hurt.
pub fn strip_code_fence(s: &str) -> Option<&str> {
    let mut s = s;
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else {
        let rest = s.strip_prefix("```")?;
        s = rest;
    }
    let s = s.trim_start_matches('\n');
    if let Some(end) = s.rfind("```") {
        Some(s[..end].trim())
    } else {
        Some(s.trim())
    }
}

/// Truncate `s` to at most `n` bytes for error-message previews,
/// backing off to the nearest earlier char boundary so multi-byte UTF-8
/// text is never sliced mid-codepoint (which would panic).
pub fn preview(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        let mut end = n;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// Find the first `{` and last `}` in `text` to be tolerant of a
/// preface/suffix or code fence Claude added despite instructions not
/// to. `context_label` is folded into error messages (e.g.
/// `"consolidation reply"`, `"recall synthesis reply"`).
pub fn extract_json_span<'a>(text: &'a str, context_label: &str) -> Result<&'a str, AppError> {
    let trimmed = text.trim();
    let raw = strip_code_fence(trimmed).unwrap_or(trimmed);
    let start = raw.find('{').ok_or_else(|| {
        AppError::Internal(format!(
            "{context_label} missing JSON object; got: {}",
            preview(raw, 200)
        ))
    })?;
    let end = raw.rfind('}').ok_or_else(|| {
        AppError::Internal(format!(
            "{context_label} missing closing `}}`; got: {}",
            preview(raw, 200)
        ))
    })?;
    if end <= start {
        return Err(AppError::Internal(format!(
            "{context_label} has no valid JSON span; got: {}",
            preview(raw, 200)
        )));
    }
    Ok(&raw[start..=end])
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Liveness supervision (G18) ─────────────────────────────────────────
    //
    // Driven against a FAKE producer — a shell one-liner with piped stdio —
    // rather than the real CLI, and with a compressed clock: the production
    // rule is "probe every 60 s, abort after 5 silent probes", the tests run
    // "probe every 150 ms, abort after ~4 s of silence". The property being
    // asserted is the RULE, not the constants; the constants are pinned
    // separately in `the_shipping_constants_are_probes_not_a_deadline`.

    /// The idle window the fake-clock tests run with. Comfortably above the
    /// cold start of `powershell`/`sh`, which is otherwise indistinguishable
    /// from a silent call and would make these flaky.
    const T_IDLE: Duration = Duration::from_secs(4);
    const T_PROBE: Duration = Duration::from_millis(150);

    fn test_rule(backstop: Duration) -> Supervision {
        Supervision {
            probe_interval: T_PROBE,
            idle_limit: T_IDLE,
            backstop,
        }
    }

    /// Spawn a shell one-liner with both pipes captured, through the module's
    /// own [`piped_command`] — never a second `Command::new`, which would be a
    /// new spawn door in a file whose whole point is that it has exactly one.
    ///
    /// Two spellings because this repo's test suite runs on Windows first and
    /// CI elsewhere; the SCRIPT is what each case varies.
    fn spawn_fake(win: &str, unix: &str) -> Child {
        let (program, args): (&str, Vec<String>) = if cfg!(windows) {
            (
                "powershell",
                vec![
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-Command".into(),
                    win.to_string(),
                ],
            )
        } else {
            ("sh", vec!["-c".into(), unix.to_string()])
        };
        let cwd = std::env::temp_dir();
        let mut child = piped_command(program, &args, &cwd)
            .spawn()
            .expect("the fake producer spawns");
        // Close stdin immediately: nothing writes to these fakes, and a pipe
        // left open is a way for a shell that DOES read stdin to hang.
        drop(child.stdin.take());
        child
    }

    async fn run_fake(win: &str, unix: &str, rule: Supervision) -> Result<OneshotRun, AppError> {
        let mut child = spawn_fake(win, unix);
        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");
        supervise(&mut child, stdout, stderr, "fake", rule).await
    }

    /// THE point of the whole change: a call that keeps producing is never
    /// aborted, however long it runs.
    ///
    /// This producer streams for ~6 s in slow drips — longer than its own idle
    /// window, and (scaled) the shape of the operator's "one line every 30
    /// seconds for far longer than any old timeout". Under the flat timeout it
    /// replaced, a budget shorter than the run killed it regardless of the fact
    /// that output was arriving the whole time.
    #[tokio::test]
    async fn a_producer_that_keeps_streaming_is_never_aborted() {
        let run = run_fake(
            "for($i=0;$i -lt 20;$i++){ Write-Output \"tick $i\"; Start-Sleep -Milliseconds 300 }",
            "i=0; while [ $i -lt 20 ]; do echo \"tick $i\"; sleep 0.3; i=$((i+1)); done",
            // A backstop DELIBERATELY shorter than the old 480 s and far longer
            // than this run: the run must survive on liveness alone.
            test_rule(Duration::from_secs(120)),
        )
        .await
        .expect("a producing call is alive");
        match run.outcome {
            OneshotOutcome::Text(_) => {}
            other => panic!("expected text, got {other:?}"),
        }
    }

    /// Silence — not duration — is what ends a call.
    #[tokio::test]
    async fn a_silent_producer_is_aborted_and_the_error_names_silence() {
        let err = run_fake(
            "Start-Sleep -Seconds 30",
            "sleep 30",
            test_rule(Duration::from_secs(600)),
        )
        .await
        .expect_err("a call producing nothing is a dead end");
        let msg = err.to_string();
        assert!(msg.contains("no output for"), "{msg}");
        assert!(msg.contains("not producing"), "{msg}");
        assert!(
            !msg.contains("timed out"),
            "the abort must name silence, not duration: {msg}"
        );
        assert!(msg.contains("fake"), "the leg is named: {msg}");
    }

    /// The 2026-09-08 shape: the process ran, exited cleanly, and produced
    /// nothing at all. `Ok("")` would hand the caller a parse failure that
    /// blames the model for a spawn that never reached one.
    #[tokio::test]
    async fn a_producer_that_exits_without_output_is_aborted_and_says_so() {
        let err = run_fake("exit 0", "exit 0", test_rule(Duration::from_secs(600)))
            .await
            .expect_err("no output is not an empty success");
        let msg = err.to_string();
        assert!(msg.contains("produced no output at all"), "{msg}");
        assert!(msg.contains("reached no model call"), "{msg}");
    }

    /// A usage limit is a THIRD outcome — neither success nor abort — and it
    /// carries the reset time the engine's own parser found.
    #[tokio::test]
    async fn a_usage_limit_on_stderr_returns_the_typed_pause_with_its_reset() {
        // A reset inside the parser's own trust window (future, under 8 days).
        let reset = chrono::Utc::now() + chrono::Duration::hours(3);
        let ts = reset.timestamp();
        let win = format!(
            "[Console]::Error.WriteLine('Claude AI usage limit reached|{ts}'); \
             Write-Output 'starting'; exit 1"
        );
        let unix = format!("echo 'Claude AI usage limit reached|{ts}' 1>&2; echo starting; exit 1");
        let run = run_fake(&win, &unix, test_rule(Duration::from_secs(600)))
            .await
            .expect("a usage limit is not an error");
        let pause = match run.outcome {
            OneshotOutcome::UsageLimited(p) => p,
            other => panic!("expected a usage-limit pause, got {other:?}"),
        };
        assert_eq!(
            pause.resets_at.map(|t| t.timestamp()),
            Some(ts),
            "the provider's own reset time survives to the caller"
        );
        assert_eq!(
            pause.scope,
            personas_core::error_taxonomy::UsageLimitScope::Window
        );
        assert!(
            pause.detail.contains("usage limit reached"),
            "{:?}",
            pause.detail
        );
    }

    /// A usage limit exits NON-ZERO, so the order of the two checks is
    /// load-bearing: read the cap first, or every paused account is reported as
    /// `claude fake exited 1`.
    #[tokio::test]
    async fn a_usage_limit_is_read_before_the_exit_code() {
        let run = run_fake(
            "[Console]::Error.WriteLine('5-hour limit reached'); Write-Output 'x'; exit 1",
            "echo '5-hour limit reached' 1>&2; echo x; exit 1",
            test_rule(Duration::from_secs(600)),
        )
        .await
        .expect("a non-zero exit under a usage cap is still a pause");
        assert!(matches!(run.outcome, OneshotOutcome::UsageLimited(_)));
    }

    /// A non-zero exit with no usage cap keeps its old error, unchanged.
    #[tokio::test]
    async fn an_ordinary_non_zero_exit_still_reports_the_exit_code() {
        let err = run_fake(
            "[Console]::Error.WriteLine('boom'); Write-Output 'x'; exit 3",
            "echo boom 1>&2; echo x; exit 3",
            test_rule(Duration::from_secs(600)),
        )
        .await
        .expect_err("a real failure is still a failure");
        let msg = err.to_string();
        assert!(msg.contains("exited 3"), "{msg}");
        assert!(msg.contains("boom"), "stderr rides along: {msg}");
    }

    /// The backstop is the ONE duration rule left, and it says so.
    #[tokio::test]
    async fn the_backstop_aborts_a_runaway_and_names_itself_as_the_backstop() {
        let err = run_fake(
            "for($i=0;$i -lt 200;$i++){ Write-Output \"tick $i\"; Start-Sleep -Milliseconds 100 }",
            "i=0; while [ $i -lt 200 ]; do echo \"tick $i\"; sleep 0.1; i=$((i+1)); done",
            // Producing steadily, so silence never fires: only the backstop can
            // end this.
            test_rule(Duration::from_secs(2)),
        )
        .await
        .expect_err("a runaway cannot live forever");
        let msg = err.to_string();
        assert!(msg.contains("absolute backstop of 2s"), "{msg}");
        assert!(msg.contains("still producing"), "{msg}");
    }

    /// Every abort reason names WHICH dead end. `ChildExited` is the probe's
    /// own guard and is awkward to provoke portably, so its wording is pinned
    /// here beside the other three.
    #[test]
    fn every_abort_reason_names_its_own_dead_end() {
        let cases = [
            (
                AbortReason::Silent {
                    idle: Duration::from_secs(300),
                },
                "no output for 300s",
            ),
            (
                AbortReason::ChildExited {
                    code: Some(1),
                    ran: Duration::from_secs(12),
                },
                "exited (code 1) after 12s without producing a result",
            ),
            (
                AbortReason::NoOutput {
                    ran: Duration::from_secs(4),
                },
                "produced no output at all in 4s",
            ),
            (
                AbortReason::Backstop {
                    limit: Duration::from_secs(7200),
                },
                "absolute backstop of 7200s",
            ),
        ];
        for (reason, expected) in cases {
            let msg = reason.describe("app_master_decision");
            assert!(msg.contains(expected), "{reason:?} -> {msg}");
            assert!(msg.starts_with("app_master_decision aborted:"), "{msg}");
            // The word that hid the real fault for two whole decisions.
            assert!(!msg.contains("timed out"), "{msg}");
        }
    }

    /// The shipping rule, pinned: probes, not a deadline.
    #[test]
    fn the_shipping_constants_are_probes_not_a_deadline() {
        assert_eq!(LIVENESS_PROBE_INTERVAL, Duration::from_secs(60));
        assert_eq!(
            LIVENESS_IDLE_LIMIT.as_secs() / LIVENESS_PROBE_INTERVAL.as_secs(),
            5,
            "the idle window must be several probes long, so one late line \
             never looks like a stall"
        );
    }

    /// The detector never re-implements the parse — it asks the engine, which
    /// handles both the pipe-delimited stamp and the window wording.
    #[test]
    fn the_usage_limit_detector_reads_all_three_sources() {
        let ts = (chrono::Utc::now() + chrono::Duration::hours(2)).timestamp();
        // stdout line
        let p = detect_usage_limit(Some(&format!("Claude AI usage limit reached|{ts}")), "", "")
            .expect("stdout");
        assert_eq!(p.resets_at.map(|t| t.timestamp()), Some(ts));
        // stderr, window wording with no timestamp
        let p = detect_usage_limit(None, "5-hour limit reached ∙ resets 3am", "").expect("stderr");
        assert!(p.resets_at.is_none(), "no stamp is honestly no stamp");
        // assistant text
        assert!(detect_usage_limit(None, "", "weekly limit reached").is_some());
        // and nothing that isn't one
        assert!(detect_usage_limit(None, "rate limit exceeded, retrying", "").is_none());
        assert!(detect_usage_limit(None, "", "").is_none());
    }

    /// G35, 2026-09-09: three App Masters decided `{"dispatch":[...]}` and one
    /// reason said "the session limit that killed last wake's dispatch has
    /// reset". The detector read the model's words as the provider's and turned
    /// each decision into an hour of silence. A reply that MENTIONS a limit is
    /// not a limit notice; a limit notice is short and is the whole reply.
    #[test]
    fn a_decision_that_talks_about_a_limit_is_not_a_limit() {
        let decision = format!(
            "{{\"dispatch\":[{{\"charterId\":\"resp_1\",\"reason\":\"The session limit that              killed last wake's dispatch has reset; the delivery batch is the highest-value              item and the usage limit projection leaves room for it.\"}}],\"asks\":[],\"say\":\"{}\"}}",
            "x".repeat(120)
        );
        assert!(decision.chars().count() > LIMIT_NOTICE_MAX_CHARS);
        assert!(
            detect_usage_limit(None, "", &decision).is_none(),
            "assistant text"
        );
        // The same words inside the assistant stream line do not become the
        // stdout limit line either.
        let line = serde_json::json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [{"type": "text", "text": decision}]}
        })
        .to_string();
        assert!(!line_can_carry_the_cap(&line));
        assert!(
            personas_engine::parser::is_session_limit_error(&line),
            "the vocabulary is there"
        );
        // G35b: the successful `result` event repeats the reply under `result`
        // with a different key order; it is still the model's words.
        let result_line = serde_json::json!({
            "duration_api_ms": 36069, "stop_reason": "end_turn", "type": "result",
            "subtype": "success", "is_error": false, "result": decision
        })
        .to_string();
        assert!(!line_can_carry_the_cap(&result_line));
        // The provider's own verdict does carry it, in both shapes it has used.
        assert!(line_can_carry_the_cap(
            r#"{"type":"result","subtype":"success","is_error":true,"result":"You've hit your limit · resets 7pm"}"#
        ));
        assert!(line_can_carry_the_cap(
            "Claude AI usage limit reached|1736187600"
        ));
        // A short notice, arriving as the whole assistant text, still pauses.
        assert!(detect_usage_limit(None, "", "Claude AI usage limit reached|1736187600").is_some());
    }

    #[test]
    fn strip_code_fence_tolerates_missing_closing_fence() {
        let s = "```json\n{\"a\":1}";
        assert_eq!(strip_code_fence(s), Some("{\"a\":1}"));
    }

    #[test]
    fn strip_code_fence_strips_closing_fence_when_present() {
        let s = "```json\n{\"a\":1}\n```";
        assert_eq!(strip_code_fence(s), Some("{\"a\":1}"));
    }

    #[test]
    fn strip_code_fence_returns_none_when_absent() {
        assert_eq!(strip_code_fence("{\"a\":1}"), None);
    }

    #[test]
    fn preview_returns_whole_string_when_short() {
        assert_eq!(preview("hello", 10), "hello");
    }

    #[test]
    fn preview_truncates_ascii() {
        assert_eq!(preview("hello world", 5), "hello…");
    }

    #[test]
    fn preview_does_not_panic_on_multibyte_boundary() {
        // "café" — 'é' is 2 bytes (0xC3 0xA9), so byte index 4 lands
        // mid-codepoint. Must not panic and must back off to a valid
        // char boundary.
        let s = "café résumé";
        let out = preview(s, 4);
        assert!(out.starts_with("caf"));
    }

    #[test]
    fn extract_json_span_tolerates_preface_and_suffix() {
        let s = "Here is the result:\n{\"x\":1}\nthanks";
        let span = extract_json_span(s, "test reply").unwrap();
        assert_eq!(span, "{\"x\":1}");
    }

    #[test]
    fn extract_json_span_errors_on_missing_object() {
        let s = "no json here";
        assert!(extract_json_span(s, "test reply").is_err());
    }

    #[test]
    fn extract_assistant_text_extracts_text_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#;
        assert_eq!(extract_assistant_text(line), Some("hi".to_string()));
    }

    #[test]
    fn extract_assistant_text_ignores_non_assistant_lines() {
        let line = r#"{"type":"system","message":{}}"#;
        assert_eq!(extract_assistant_text(line), None);
    }
}
