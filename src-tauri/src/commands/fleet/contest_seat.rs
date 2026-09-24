//! Contest seats as fleet sessions — the fleet half of the in-app Contest home.
//!
//! A /contest seat (a participant building variants, or a judge scoring them)
//! is ONE headless turn on one engine in one workspace. This module is the
//! door the contest driver (`commands/contest`) goes through to run one:
//!
//! - [`spawn_contest_seat`] admits the seat through `queue::admit` — the
//!   fleet's one admission door, no bypass — with origin `contest`, the run
//!   label `contest:<contestId>:<seatId>` (which makes it a ONE-SHOT worker:
//!   its single turn ending ends the session, and the process exits or is
//!   reaped) and the /contest skill's per-engine isolation (`engineCommand`).
//! - [`kill_contest_seat`] ends a seat through the fleet's own kill path (a
//!   queued seat is cancelled instead).
//! - [`contest_seat_outcome`] is how the driver reads a settled seat: the
//!   registry's state / exit code / reason, plus the [`SeatCapture`] this
//!   module keeps from the seat's own event stream — final assistant text,
//!   turns, cost, usage, errors — the fields `runs/<seat>/record.json` needs.
//!
//! The capture is in memory: it is fed by the headless stdout pump for every
//! contest-labelled session and read by the driver when the seat settles. A
//! seat that settled while the app was down has no capture (its process died
//! with the app anyway); the driver falls back to the registry outcome.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tauri::AppHandle;

use crate::commands::contest::types::{ContestEffort, ContestEngine};
use crate::error::AppError;
use personas_core::models::{EffortBand, MachineLoad, ResourceProfile};

use super::queue::{self, DispatchOrigin, DispatchRequest};
use super::registry::{registry, KillOutcome};
use super::types::{FleetSessionMode, FleetSessionState};

// ---------------------------------------------------------------------------
// The run label
// ---------------------------------------------------------------------------

/// Prefix of every contest seat's run label. The colon carries the same weight
/// it does in `app-master:` / `dev-runner:`: a human run somebody named
/// "contest notes" is never read as a seat.
pub const CONTEST_RUN_LABEL_PREFIX: &str = "contest:";

/// The run label of one seat: `contest:<contestId>:<seatId>`.
pub fn contest_run_label(contest_id: &str, seat_id: &str) -> String {
    format!(
        "{CONTEST_RUN_LABEL_PREFIX}{}:{}",
        contest_id.trim(),
        seat_id.trim()
    )
}

/// `(contestId, seatId)` from a seat's run label, `None` for anything else.
/// The contest id is a filesystem slug (no `:`), so the FIRST colon after the
/// prefix separates the two; both halves must be non-empty.
pub fn parse_contest_run_label(label: &str) -> Option<(&str, &str)> {
    let rest = label.trim_start().strip_prefix(CONTEST_RUN_LABEL_PREFIX)?;
    let (contest_id, seat_id) = rest.split_once(':')?;
    let (contest_id, seat_id) = (contest_id.trim(), seat_id.trim());
    (!contest_id.is_empty() && !seat_id.is_empty()).then_some((contest_id, seat_id))
}

/// True when a fleet session's run label marks it a contest seat.
pub fn is_contest_run_label(run_label: Option<&str>) -> bool {
    run_label.is_some_and(|l| parse_contest_run_label(l).is_some())
}

// ---------------------------------------------------------------------------
// Engine isolation — the /contest skill's `engineCommand`, fleet-shaped
// ---------------------------------------------------------------------------

fn engine_token(engine: ContestEngine) -> &'static str {
    match engine {
        ContestEngine::Claude => "claude",
        ContestEngine::Codex => super::headless::CODEX_ENGINE,
        ContestEngine::Grok => super::headless::GROK_ENGINE,
    }
}

/// The effort's wire token (`low` … `max`), as every CLI spells it.
pub fn effort_token(effort: ContestEffort) -> &'static str {
    match effort {
        ContestEffort::Low => "low",
        ContestEffort::Medium => "medium",
        ContestEffort::High => "high",
        ContestEffort::Xhigh => "xhigh",
        ContestEffort::Max => "max",
    }
}

/// The CLI flags a CLAUDE seat carries on top of the fleet's headless argv.
///
/// The skill's claude line is `-p --output-format json --model <m> --effort <e>
/// --permission-mode bypassPermissions --setting-sources project,local
/// --strict-mcp-config --no-session-persistence`. Four of those collide with
/// the fleet's own session handling and are dropped:
/// - `-p --output-format json` — the fleet runs `--print --input-format
///   stream-json --output-format stream-json --verbose` and reads events;
/// - `--permission-mode bypassPermissions` — the fleet passes the equivalent
///   `--dangerously-skip-permissions`;
/// - `--no-session-persistence` — the fleet pins `--session-id` and its
///   staleness ticker reads that transcript's growth.
///
/// `--name <seatId>` is added: a named session skips the fleet's LLM naming
/// call (`naming::args_supply_name`), and the seat id is the better tile label.
/// No `--mcp-config` follows: the headless lane skips the fleet MCP wiring for
/// a contest label, so `--strict-mcp-config` leaves the seat no MCP servers.
pub fn claude_seat_args(model: &str, effort: ContestEffort, seat_id: &str) -> Vec<String> {
    vec![
        "--model".to_string(),
        model.to_string(),
        "--effort".to_string(),
        effort_token(effort).to_string(),
        "--setting-sources".to_string(),
        "project,local".to_string(),
        "--strict-mcp-config".to_string(),
        "--name".to_string(),
        seat_id.to_string(),
    ]
}

/// The dispatch `args` for one seat: the prompt as the headless task, then the
/// engine's flags (claude) or its isolated engine marker (codex / grok, whose
/// argv the fleet lane builds: `headless::codex_worker_argv`,
/// `headless::grok_exec_argv` + `headless::GROK_ISOLATION_ENV`).
pub fn seat_dispatch_args(
    prompt: &str,
    engine: ContestEngine,
    model: &str,
    effort: ContestEffort,
    seat_id: &str,
) -> Vec<String> {
    match engine {
        ContestEngine::Claude => {
            queue::headless_args(prompt, claude_seat_args(model, effort, seat_id))
        }
        ContestEngine::Codex | ContestEngine::Grok => queue::engine_args(
            prompt,
            engine_token(engine),
            model,
            Some(effort_token(effort)),
            true,
        ),
    }
}

/// What a seat costs the fleet's budgets. Light on the machine (a seat writes
/// files; it runs no dev server). Plan units follow the effort — `low`/`medium`
/// the default band, `high`/`xhigh` large, `max` extra-large — and apply to
/// claude seats only: `queue::request_charge` zeroes the plan charge of a
/// codex or grok dispatch, which spends no Claude plan.
pub fn seat_profile(effort: ContestEffort) -> ResourceProfile {
    let band = match effort {
        ContestEffort::Low | ContestEffort::Medium => EffortBand::M,
        ContestEffort::High | ContestEffort::Xhigh => EffortBand::L,
        ContestEffort::Max => EffortBand::Xl,
    };
    ResourceProfile {
        machine: MachineLoad::Light,
        effort: band,
        ..ResourceProfile::default()
    }
}

// ---------------------------------------------------------------------------
// Spawn / kill
// ---------------------------------------------------------------------------

/// One seat to run.
#[derive(Clone, Debug)]
pub struct ContestSeatLaunch {
    /// The seat's workspace (`entries/<seatId>` for a participant, `judging/`
    /// for a judge). Must exist.
    pub cwd: PathBuf,
    /// The prompt `contest.mjs plan` returned for this seat, verbatim.
    pub prompt: String,
    pub engine: ContestEngine,
    pub model: String,
    pub effort: ContestEffort,
    /// `contest:<contestId>:<seatId>` — build it with [`contest_run_label`].
    pub run_label: String,
    /// Earliest start (epoch ms); the queue holds the seat until then.
    pub not_before_ms: Option<i64>,
}

/// Admit one seat through the fleet's one door. Returns the fleet session id
/// — the same id whether the seat started now or was queued. A missing CLI
/// fails here when the seat starts at once; a queued seat whose CLI is missing
/// fails at promotion, which leaves its row `exited` with the spawn error as
/// its reason (never a hang).
pub async fn spawn_contest_seat(
    app: &AppHandle,
    launch: ContestSeatLaunch,
) -> Result<String, AppError> {
    let Some((_, seat_id)) = parse_contest_run_label(&launch.run_label) else {
        return Err(AppError::Validation(format!(
            "contest seat run label must be `contest:<contestId>:<seatId>`, got `{}`",
            launch.run_label
        )));
    };
    personas_core::validation::require_non_empty("seat prompt", &launch.prompt)?;
    personas_core::validation::require_non_empty("seat model", &launch.model)?;
    if !launch.cwd.is_dir() {
        return Err(AppError::Validation(format!(
            "contest seat workspace is not a directory: {}",
            launch.cwd.display()
        )));
    }
    let seat_id = seat_id.to_string();
    let admission = queue::admit(
        app,
        DispatchRequest {
            cwd: launch.cwd.to_string_lossy().into_owned(),
            name: Some(seat_id.clone()),
            title: None,
            args: seat_dispatch_args(
                &launch.prompt,
                launch.engine,
                &launch.model,
                launch.effort,
                &seat_id,
            ),
            mode: FleetSessionMode::Headless,
            run_label: Some(launch.run_label.clone()),
            origin: DispatchOrigin::Contest,
            persona_id: None,
            goal_id: None,
            cycle_index: None,
            not_before_ms: launch.not_before_ms,
            profile: Some(seat_profile(launch.effort)),
        },
    )
    .await?;
    super::debug_log::lifecycle(
        &admission.session_id,
        "spawned",
        &format!(
            "contest seat · {} · {}",
            engine_token(launch.engine),
            launch.run_label
        ),
    );
    Ok(admission.session_id)
}

/// End a seat: a queued seat is cancelled (its row goes `exited`), a live one
/// is killed through its own kill handle — the path `fleet_kill_session`
/// uses. Killing a seat that already ended is a no-op success.
pub fn kill_contest_seat(app: &AppHandle, session_id: &str) -> Result<(), AppError> {
    match registry().session_state(session_id) {
        None => {
            return Err(AppError::NotFound(format!(
                "fleet session not found: {session_id}"
            )))
        }
        Some(FleetSessionState::Queued) => return queue::cancel_dispatch(app, session_id),
        Some(state) if is_settled_state(Some(state)) => return Ok(()),
        Some(_) => {}
    }
    let outcome = registry().close_pty_handles_reporting(session_id);
    super::pty::emit_registry_changed(app, "updated", session_id);
    match outcome {
        KillOutcome::NoSession => Err(AppError::NotFound(format!(
            "fleet session not found: {session_id}"
        ))),
        other => match other.failure() {
            Some(err) => {
                super::debug_log::lifecycle(session_id, "kill failed", err);
                Err(AppError::ProcessSpawn(format!(
                    "contest seat kill requested, child still alive: {err}"
                )))
            }
            None => {
                super::debug_log::lifecycle(session_id, "killed", "contest driver ended the seat");
                Ok(())
            }
        },
    }
}

// ---------------------------------------------------------------------------
// Reading a seat's state
// ---------------------------------------------------------------------------

/// The predicate a driver waits on for "the seat has stopped for good":
/// finished, exited (incl. a cancelled queue row), hibernated, or gone from
/// the registry. Use with `wait::wait_until_state`.
pub fn is_settled_state(state: Option<FleetSessionState>) -> bool {
    matches!(
        state,
        None | Some(
            FleetSessionState::Finished | FleetSessionState::Exited | FleetSessionState::Hibernated
        )
    )
}

/// The predicate for "the seat's run has begun" (it left the queue) — the
/// moment the per-seat ceiling starts counting. Settled counts too, so a seat
/// that failed at promotion does not leave the driver waiting.
pub fn is_started_state(state: Option<FleetSessionState>) -> bool {
    !matches!(state, Some(FleetSessionState::Queued))
}

/// What the contest driver reads once a seat settled.
#[derive(Clone, Debug, PartialEq)]
pub struct ContestSeatOutcome {
    /// `None` when the session is not in the registry.
    pub state: Option<FleetSessionState>,
    /// The process's exit code as the registry recorded it. `None` for a
    /// seat whose idle process the fleet reaped after its turn (the reap keeps
    /// the `finished` state and records no code), a crash, or a live seat.
    pub exit_code: Option<i32>,
    pub state_reason: Option<String>,
    /// What the seat's own event stream said; `None` when nothing was captured
    /// (a spawn that never produced output, or an app restart since).
    pub capture: Option<SeatCapture>,
}

impl ContestSeatOutcome {
    /// The exit the seat's record should carry: the recorded code, else — for
    /// a seat whose closing `result` was read but whose process was reaped —
    /// `0` for a clean result and `1` for an error result; `None` when neither
    /// is known.
    pub fn effective_exit(&self) -> Option<i32> {
        self.exit_code.or_else(|| {
            self.capture
                .as_ref()
                .filter(|c| c.result_seen)
                .map(|c| if c.is_error { 1 } else { 0 })
        })
    }
}

/// Read a seat's outcome. Never blocks on anything but the registry lock.
pub fn contest_seat_outcome(session_id: &str) -> ContestSeatOutcome {
    let (state, exit_code, state_reason) = match registry().session_outcome(session_id) {
        Some((state, exit, reason)) => (Some(state), exit, reason),
        None => (None, None, None),
    };
    ContestSeatOutcome {
        state,
        exit_code,
        state_reason,
        capture: seat_capture(session_id),
    }
}

// ---------------------------------------------------------------------------
// The capture
// ---------------------------------------------------------------------------

/// How much of one error line a capture keeps (the skill slices at 300).
const ERROR_MAX_CHARS: usize = 300;
/// How many stderr lines a capture keeps (the tail).
const STDERR_TAIL_LINES: usize = 20;
/// How many seats' captures are held at once; the oldest is dropped past it.
const CAPTURE_CAP: usize = 256;

/// What a seat's event stream said, normalised across the three engines the
/// way the skill's `parseClaude` / `parseGrok` / `parseCodex` read an envelope.
/// Absent means unknown (`None`), never `0`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeatCapture {
    /// `claude` | `codex` | `grok`.
    pub engine: String,
    /// The model the `system`/`init` event announced, when one did.
    pub model: Option<String>,
    /// The turn's final assistant text: the `result` event's own copy
    /// (claude, grok), else the last agent message (codex) / assistant text.
    pub final_text: Option<String>,
    /// `num_turns` (claude, grok) or the count of `turn.completed` (codex).
    pub turns: Option<u32>,
    /// `total_cost_usd` (claude, grok); codex reports none.
    pub cost_usd: Option<f64>,
    /// The engine's own usage object, verbatim.
    pub usage: Option<Value>,
    /// `modelUsage` (claude, grok), verbatim.
    pub model_usage: Option<Value>,
    pub duration_ms: Option<i64>,
    /// A closing `result` (claude, grok) or `turn.completed` (codex) was read.
    pub result_seen: bool,
    /// The closing result was an error.
    pub is_error: bool,
    /// Error lines in the skill's shape (`<subtype>: <text>` / the message),
    /// each clipped to 300 characters. Empty on a clean run.
    pub errors: Vec<String>,
    /// The last stderr lines, for a record whose run died without a result.
    pub stderr_tail: Vec<String>,
    /// Monotonic insertion order, for the capacity bound.
    seq: u64,
}

struct CaptureStore {
    map: HashMap<String, SeatCapture>,
    next_seq: u64,
}

fn store() -> &'static Mutex<CaptureStore> {
    static STORE: OnceLock<Mutex<CaptureStore>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(CaptureStore {
            map: HashMap::new(),
            next_seq: 0,
        })
    })
}

/// Run `f` on the session's capture, creating it on first sight. A poisoned
/// lock is recovered: this is a cache of readings.
fn with_capture(session_id: &str, engine: &str, f: impl FnOnce(&mut SeatCapture)) {
    let mut guard = store().lock().unwrap_or_else(|e| e.into_inner());
    let store = &mut *guard;
    if !store.map.contains_key(session_id) {
        if store.map.len() >= CAPTURE_CAP {
            if let Some(oldest) = store
                .map
                .iter()
                .min_by_key(|(_, c)| c.seq)
                .map(|(id, _)| id.clone())
            {
                store.map.remove(&oldest);
            }
        }
        store.next_seq += 1;
        store.map.insert(
            session_id.to_string(),
            SeatCapture {
                engine: engine.to_string(),
                seq: store.next_seq,
                ..SeatCapture::default()
            },
        );
    }
    if let Some(capture) = store.map.get_mut(session_id) {
        // A stderr line can arrive before the first stdout event; the engine
        // is learned from whichever pump names it.
        if capture.engine.is_empty() && !engine.is_empty() {
            capture.engine = engine.to_string();
        }
        f(capture);
    }
}

/// A copy of the session's capture, if one exists.
pub fn seat_capture(session_id: &str) -> Option<SeatCapture> {
    let guard = store().lock().unwrap_or_else(|e| e.into_inner());
    guard.map.get(session_id).cloned()
}

/// Drop a session's capture once its record is written.
pub fn forget_seat_capture(session_id: &str) {
    let mut guard = store().lock().unwrap_or_else(|e| e.into_inner());
    guard.map.remove(session_id);
}

/// Feed one RAW stdout event of a contest seat (before engine normalisation).
pub(super) fn observe_event(session_id: &str, engine: &str, event: &Value) {
    with_capture(session_id, engine, |c| fold_event(c, event));
}

/// Feed one stderr line of a contest seat.
pub(super) fn observe_stderr(session_id: &str, line: &str) {
    with_capture(session_id, "", |c| {
        c.stderr_tail.push(clip(line.trim(), ERROR_MAX_CHARS));
        if c.stderr_tail.len() > STDERR_TAIL_LINES {
            let excess = c.stderr_tail.len() - STDERR_TAIL_LINES;
            c.stderr_tail.drain(..excess);
        }
    });
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn non_empty_str(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The text blocks of an `assistant` message, joined. `None` when it carries
/// none.
fn assistant_text(event: &Value) -> Option<String> {
    let blocks = event.pointer("/message/content")?.as_array()?;
    let text = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Fold one raw event into a capture. Pure over its inputs — the unit tests
/// drive it with captured fixtures of all three engines.
pub(super) fn fold_event(c: &mut SeatCapture, event: &Value) {
    let Some(kind) = event.get("type").and_then(Value::as_str) else {
        return;
    };
    match kind {
        // claude / grok -------------------------------------------------
        "system" => {
            if let Some(m) = non_empty_str(event.get("model")) {
                c.model = Some(m);
            }
        }
        "assistant" => {
            if let Some(text) = assistant_text(event) {
                c.final_text = Some(text);
            }
        }
        "result" => {
            c.result_seen = true;
            let subtype = event
                .get("subtype")
                .and_then(Value::as_str)
                .unwrap_or("error");
            let is_error = event.get("is_error").and_then(Value::as_bool) == Some(true)
                || subtype != "success";
            c.is_error = is_error;
            let result_text = non_empty_str(event.get("result"));
            if let Some(text) = result_text.as_deref() {
                c.final_text = Some(text.to_string());
            }
            if is_error {
                let detail = result_text.unwrap_or_default();
                c.errors
                    .push(clip(&format!("{subtype}: {detail}"), ERROR_MAX_CHARS));
            }
            // grok carries the refusal's cause in its own `errors` array.
            if let Some(errs) = event.get("errors").and_then(Value::as_array) {
                for e in errs.iter().filter_map(Value::as_str) {
                    c.errors.push(clip(e, ERROR_MAX_CHARS));
                }
            }
            c.turns = event
                .get("num_turns")
                .and_then(Value::as_u64)
                .map(|n| n as u32);
            c.cost_usd = event.get("total_cost_usd").and_then(Value::as_f64);
            c.usage = event.get("usage").cloned();
            c.model_usage = event.get("modelUsage").cloned();
            c.duration_ms = event.get("duration_ms").and_then(Value::as_i64);
        }
        // codex -----------------------------------------------------------
        "item.completed" => {
            let item = event.get("item");
            if item.and_then(|i| i.get("type")).and_then(Value::as_str) == Some("agent_message") {
                if let Some(text) = non_empty_str(item.and_then(|i| i.get("text"))) {
                    c.final_text = Some(text);
                }
            }
        }
        "turn.completed" => {
            c.result_seen = true;
            c.turns = Some(c.turns.unwrap_or(0) + 1);
            if let Some(u) = event.get("usage") {
                c.usage = Some(u.clone());
            }
        }
        "turn.failed" | "error" => {
            let msg = event
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| event.pointer("/error/message").and_then(Value::as_str));
            if let Some(msg) = msg.filter(|m| !m.starts_with("Reconnecting")) {
                c.errors.push(clip(msg, ERROR_MAX_CHARS));
            }
            if kind == "turn.failed" {
                c.result_seen = true;
                c.is_error = true;
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_run_label_round_trips_and_rejects_lookalikes() {
        let label = contest_run_label("home-hero", "claude-opus_xhigh");
        assert_eq!(label, "contest:home-hero:claude-opus_xhigh");
        assert_eq!(
            parse_contest_run_label(&label),
            Some(("home-hero", "claude-opus_xhigh"))
        );
        assert!(is_contest_run_label(Some(&label)));
        for bad in [
            "contest notes",
            "contest:",
            "contest:x",
            "contest::seat",
            "app-master:x",
        ] {
            assert!(!is_contest_run_label(Some(bad)), "{bad}");
        }
        assert!(!is_contest_run_label(None));
    }

    fn value_of<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    }

    #[test]
    fn a_claude_seat_carries_the_isolation_flags_that_do_not_collide() {
        let opus = personas_core::model_ids::OPUS_CURRENT;
        let args = seat_dispatch_args(
            "read BRIEF.md",
            ContestEngine::Claude,
            opus,
            ContestEffort::Xhigh,
            "claude-opus_xhigh",
        );
        assert_eq!(value_of(&args, "--fleet-task"), Some("read BRIEF.md"));
        assert_eq!(value_of(&args, "--model"), Some(opus));
        assert_eq!(value_of(&args, "--effort"), Some("xhigh"));
        assert_eq!(value_of(&args, "--setting-sources"), Some("project,local"));
        assert!(args.iter().any(|a| a == "--strict-mcp-config"));
        assert_eq!(value_of(&args, "--name"), Some("claude-opus_xhigh"));
        // The flags that would fight the fleet's own session handling are gone.
        for dropped in [
            "-p",
            "--output-format",
            "--permission-mode",
            "--no-session-persistence",
            "--engine",
        ] {
            assert!(!args.iter().any(|a| a == dropped), "{dropped} in {args:?}");
        }
        // The naming lane reads `--name` and never mistakes a flag value for
        // the task.
        assert!(super::super::naming::args_supply_name(&args));
    }

    #[test]
    fn codex_and_grok_seats_carry_an_isolated_engine_marker() {
        for (engine, token) in [
            (ContestEngine::Codex, "codex"),
            (ContestEngine::Grok, "grok"),
        ] {
            let args = seat_dispatch_args("p", engine, "m-1", ContestEffort::High, "s");
            assert_eq!(value_of(&args, "--engine"), Some(token));
            assert_eq!(value_of(&args, "--model"), Some("m-1"));
            assert_eq!(value_of(&args, "--effort"), Some("high"));
            assert!(args.iter().any(|a| a == "--isolated"));
        }
    }

    #[test]
    fn codex_isolation_mirrors_the_skill() {
        let argv = super::super::headless::codex_worker_argv(
            std::path::Path::new("C:/arena/entries/codex-x_high"),
            "gpt-6-sol",
            Some("high"),
            true,
        );
        for flag in ["--ephemeral", "--ignore-user-config", "--ignore-rules"] {
            assert!(
                argv.iter().any(|a| a == flag),
                "{flag} missing from {argv:?}"
            );
        }
        assert_eq!(
            value_of(&argv, "-c"),
            Some("model_reasoning_effort=\"high\"")
        );
        assert_eq!(value_of(&argv, "-m"), Some("gpt-6-sol"));
        // Not isolated, no effort: the maintenance worker's argv, unchanged.
        let plain = super::super::headless::codex_worker_argv(
            std::path::Path::new("C:/wt"),
            "m",
            None,
            false,
        );
        assert_eq!(
            plain,
            super::super::headless::codex_exec_argv(std::path::Path::new("C:/wt"), "m")
        );
    }

    #[test]
    fn grok_argv_and_env_mirror_the_skill() {
        let cwd = std::path::Path::new("C:/arena/entries/grok-4.6_high");
        let argv = super::super::headless::grok_exec_argv(cwd, "grok-4.6", Some("high"), "go");
        assert_eq!(value_of(&argv, "-p"), Some("go"));
        assert_eq!(value_of(&argv, "-m"), Some("grok-4.6"));
        assert_eq!(value_of(&argv, "--effort"), Some("high"));
        assert_eq!(
            value_of(&argv, "--output-format"),
            Some("streaming-messages-json")
        );
        assert!(argv.iter().any(|a| a == "--always-approve"));
        assert_eq!(
            value_of(&argv, "--permission-mode"),
            Some("bypassPermissions")
        );
        assert_eq!(
            value_of(&argv, "--cwd"),
            Some(cwd.to_string_lossy().as_ref())
        );
        let env = super::super::headless::GROK_ISOLATION_ENV;
        assert!(env.contains(&("GROK_MEMORY", "0")));
        assert!(env.contains(&("GROK_AGENT_DASHBOARD", "0")));
    }

    #[test]
    fn the_seat_profile_charges_plan_by_effort_and_the_machine_lightly() {
        use super::super::budgets::Charge;
        let c = |e| Charge::from_profile(Some(&seat_profile(e)));
        assert_eq!(
            (c(ContestEffort::Low).machine, c(ContestEffort::Low).plan),
            (1, 2)
        );
        assert_eq!(c(ContestEffort::High).plan, 4);
        assert_eq!(c(ContestEffort::Xhigh).plan, 4);
        assert_eq!(c(ContestEffort::Max).plan, 8);
    }

    #[test]
    fn settled_and_started_predicates() {
        use FleetSessionState as S;
        assert!(is_settled_state(None));
        assert!(is_settled_state(Some(S::Finished)));
        assert!(is_settled_state(Some(S::Exited)));
        assert!(!is_settled_state(Some(S::Running)));
        assert!(!is_settled_state(Some(S::Idle)));
        assert!(!is_started_state(Some(S::Queued)));
        assert!(is_started_state(Some(S::Spawning)));
        assert!(is_started_state(None));
    }

    fn fold_all(engine: &str, lines: &str) -> SeatCapture {
        let mut c = SeatCapture {
            engine: engine.into(),
            ..SeatCapture::default()
        };
        for line in lines.lines().filter(|l| !l.trim().is_empty()) {
            fold_event(&mut c, &serde_json::from_str(line).unwrap());
        }
        c
    }

    #[test]
    fn a_measured_grok_run_folds_into_a_complete_capture() {
        // grok 1.0.40, `-p "Create hello.txt … reply DONE." -m grok-4.5 --effort
        // low --output-format streaming-messages-json`, captured 2026-09-24
        // (trimmed: the init event's tool/skill lists and the tool output).
        let c = fold_all("grok", include_str!("testdata/grok_tool_run.jsonl"));
        assert_eq!(c.model.as_deref(), Some("grok-4.5"));
        assert_eq!(c.final_text.as_deref(), Some("DONE"));
        assert_eq!(c.turns, Some(2));
        assert_eq!(c.cost_usd, Some(0.017020536));
        assert!(c.result_seen && !c.is_error);
        assert!(c.errors.is_empty());
        assert_eq!(c.usage.as_ref().unwrap()["output_tokens"], 123);
        assert!(c
            .model_usage
            .as_ref()
            .unwrap()
            .get("grok-4.5-build")
            .is_some());
        assert_eq!(c.duration_ms, Some(13872));
    }

    #[test]
    fn a_refused_grok_run_carries_its_cause_as_an_error() {
        // Same CLI, `-m no-such-model`: exit 1 and one error `result`.
        let c = fold_all("grok", include_str!("testdata/grok_refused_run.jsonl"));
        assert!(c.result_seen && c.is_error);
        assert_eq!(c.turns, Some(0));
        assert!(c.final_text.is_none());
        assert!(c
            .errors
            .iter()
            .any(|e| e.starts_with("error_during_execution")));
        assert!(c.errors.iter().any(|e| e.contains("unknown model id")));
        let outcome = ContestSeatOutcome {
            state: Some(FleetSessionState::Finished),
            exit_code: None,
            state_reason: None,
            capture: Some(c),
        };
        assert_eq!(outcome.effective_exit(), Some(1));
    }

    #[test]
    fn grok_events_normalise_onto_the_claude_stream_shape() {
        use super::super::headless::normalize_grok_event;
        let fixture = include_str!("testdata/grok_tool_run.jsonl");
        let events: Vec<Value> = fixture
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| normalize_grok_event(serde_json::from_str(l).unwrap()))
            .collect();
        let kinds: Vec<&str> = events.iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert_eq!(
            kinds,
            ["system", "assistant", "user", "assistant", "result"]
        );
        assert_eq!(events[0]["engine"], "grok");
        assert_eq!(events[4]["subtype"], "success");
        assert_eq!(events[4]["result"], "DONE");
        // A refusal gets its cause as the result text, so the settle says why.
        let last = include_str!("testdata/grok_refused_run.jsonl")
            .lines()
            .rfind(|l| !l.trim().is_empty())
            .unwrap();
        let refused = normalize_grok_event(serde_json::from_str(last).unwrap());
        assert_eq!(refused["type"], "result");
        assert!(refused["result"]
            .as_str()
            .unwrap()
            .contains("unknown model id"));
    }

    #[test]
    fn claude_and_codex_streams_fold_like_the_skill_parses_them() {
        // A real `claude -p --verbose --output-format stream-json` run
        // (claude-code 2.1.281, haiku, "Reply with exactly: PONG"), captured
        // 2026-09-24 and trimmed of its tool lists and local paths. It carries
        // a thinking-only assistant message and a `rate_limit_event` the fold
        // must step over.
        let claude = fold_all("claude", include_str!("testdata/claude_seat_run.jsonl"));
        assert_eq!(claude.final_text.as_deref(), Some("PONG"));
        assert_eq!((claude.turns, claude.cost_usd), (Some(1), Some(0.0166263)));
        assert!(claude.result_seen && !claude.is_error);
        assert!(claude.errors.is_empty());
        assert!(claude.model_usage.is_some());

        // The same CLI with an unknown `--model`: exit 1, a synthetic assistant
        // message, and a `result` that says `subtype: "success"` while
        // `is_error: true` - the skill's `parseClaude` treats either as an
        // error, and so does the fold.
        let refused = fold_all("claude", include_str!("testdata/claude_refused_run.jsonl"));
        assert!(refused.result_seen && refused.is_error);
        assert_eq!(refused.errors.len(), 1);
        assert!(refused.errors[0].starts_with("success: There's an issue with the selected model"));

        let codex = fold_all(
            "codex",
            r#"{"type":"thread.started","thread_id":"t"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"Variants written."}}
{"type":"error","message":"Reconnecting... 1/5"}
{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":2}}"#,
        );
        assert_eq!(codex.final_text.as_deref(), Some("Variants written."));
        assert_eq!(codex.turns, Some(1));
        assert_eq!(
            codex.cost_usd, None,
            "codex reports no cost: unknown, not 0"
        );
        assert!(
            codex.errors.is_empty(),
            "a reconnect notice is not an error"
        );
        assert!(codex.result_seen && !codex.is_error);

        let failed = fold_all(
            "codex",
            r#"{"type":"turn.failed","error":{"message":"You've hit your usage limit"}}"#,
        );
        assert!(failed.is_error);
        assert_eq!(
            failed.errors,
            vec!["You've hit your usage limit".to_string()]
        );
    }

    #[test]
    fn the_capture_store_keeps_the_stderr_tail_and_forgets_on_request() {
        let id = "test-capture-store-seat";
        observe_event(id, "grok", &json!({"type":"system","model":"grok-4.6"}));
        for i in 0..30 {
            observe_stderr(id, &format!("line {i}"));
        }
        let c = seat_capture(id).unwrap();
        assert_eq!(c.engine, "grok");
        assert_eq!(c.stderr_tail.len(), STDERR_TAIL_LINES);
        assert_eq!(c.stderr_tail.last().map(String::as_str), Some("line 29"));
        forget_seat_capture(id);
        assert!(seat_capture(id).is_none());
    }

    #[test]
    fn effective_exit_prefers_the_recorded_code() {
        let mut o = ContestSeatOutcome {
            state: Some(FleetSessionState::Exited),
            exit_code: Some(3),
            state_reason: None,
            capture: None,
        };
        assert_eq!(o.effective_exit(), Some(3));
        o.exit_code = None;
        assert_eq!(o.effective_exit(), None, "nothing known is null, not 0");
        o.capture = Some(SeatCapture {
            result_seen: true,
            ..SeatCapture::default()
        });
        assert_eq!(o.effective_exit(), Some(0));
    }
}
