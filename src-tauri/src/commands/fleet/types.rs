//! Shared DTOs for the Fleet plugin.
//!
//! Every type here is exported to TypeScript via `ts-rs` so the frontend
//! consumes the same shapes the Rust commands produce. Run
//! `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` after
//! changing any of these to regenerate `src/lib/bindings/Fleet*.ts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Lifecycle state of a tracked Claude Code session.
///
/// Driven by a union of three signals (in order of authority):
/// 1. Process exit (`Exited`) — PTY child reaper.
/// 2. Hook callbacks — `Notification` → `AwaitingInput`, `Stop` → `Idle`,
///    `PreToolUse` / `UserPromptSubmit` → `Running`.
/// 3. JSONL transcript mtime — fallback for `Stale` detection.
///
/// The variants are intentionally string-tagged so the frontend can render
/// them without an integer enum mapping. Keep names stable; they ship in
/// `FLEET_SESSION_STATE` event payloads and persisted decision logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FleetSessionState {
    /// PTY spawned, awaiting first SessionStart hook to bind the
    /// Claude-side `session_id`.
    Spawning,
    /// Claude is actively processing a turn — last hook seen was
    /// `PreToolUse` / `UserPromptSubmit`.
    Running,
    /// Claude has emitted a `Notification` hook (waiting for the user —
    /// permission prompt, idle nudge, plan-mode confirm).
    AwaitingInput,
    /// Claude has emitted `Stop` and is idle between turns. Distinct from
    /// `Stale` because the session is still responsive.
    Idle,
    /// No hook activity AND no JSONL writes for `STALE_AFTER_SECS` (see
    /// [`registry`]). Likely user walked away or session hung.
    Stale,
    /// Operator-initiated sleep: the PTY child was killed to free the process,
    /// but `claude_session_id` + `cwd` are retained so the conversation can be
    /// resurrected via `claude --resume`. NOT terminal — distinct from
    /// `Exited` (which is a real death). Set by `fleet_hibernate_session`.
    Hibernated,
    /// PTY child exited (clean or crash). Terminal state.
    Exited,
}

/// How a Fleet session's `claude` process is driven.
///
/// `Interactive` = a PTY child (ConPTY on Windows) rendering the full TUI —
/// what a human attaches an xterm to. `Headless` = `claude -p` with
/// stream-json stdio: no PTY, no TUI redraw loop (idle CPU ≈ 0), structured
/// events instead of escape sequences — the lane for Athena-driven background
/// sessions. Both persist the same transcript, fire the same hooks, and share
/// the state machine; a headless conversation can be Woken interactively.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FleetSessionMode {
    Interactive,
    Headless,
}

/// A tracked Claude Code session.
///
/// One per spawned PTY child. The `claude_session_id` is `None` until the
/// first `SessionStart` hook fires; we reconcile by `cwd` until then.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetSession {
    /// Stable internal id minted at spawn time (UUID v4 as string).
    pub id: String,
    /// Claude Code's own session id (from SessionStart hook). `None` while
    /// the session is `Spawning`.
    pub claude_session_id: Option<String>,
    /// Working directory the `claude` child was spawned in. Doubles as
    /// the project key (we group sessions by `project_label` derived from
    /// this path).
    pub cwd: String,
    /// Human-readable project label — last path segment of `cwd` by default,
    /// overrideable in settings.
    pub project_label: String,
    /// User-supplied per-session name. `None` by default; the UI shows it
    /// next to `project_label` when set so users can disambiguate
    /// multiple parallel sessions on the same project (e.g. "refactor",
    /// "tests", "smoke run"). Settable via `fleet_rename_session`.
    pub name: Option<String>,
    /// Live terminal title emitted by Claude Code via OSC (a summary of the
    /// current task), captured from the PTY stream. `None` until Claude sets one.
    /// The UI prefers this over `name` / `project_label` to label a tile, so each
    /// session reads distinctly instead of all showing the same project name.
    pub title: Option<String>,
    /// Extra CLI arguments passed to `claude` at spawn time. Empty by default.
    pub args: Vec<String>,
    /// How the process is driven — interactive PTY or headless stream-json.
    /// The UI never mounts an xterm for a headless session (there is no TTY);
    /// it renders the status block / insights and replies via `write_input`,
    /// which wraps text into a stream-json user message on this lane.
    pub mode: FleetSessionMode,
    /// Current lifecycle state. See [`FleetSessionState`].
    pub state: FleetSessionState,
    /// Wall-clock ms since UNIX epoch of the most recent activity signal
    /// (hook fired, PTY bytes, JSONL append). Frontend uses this for the
    /// "Xs ago" label and Stale detection cutoff.
    pub last_activity_ms: i64,
    /// When the PTY last produced ANY bytes — including idle status redraws
    /// (0 = never). Provenance signal for the state tooltip; total silence
    /// is what the frozen-process stall check keys on.
    pub last_pty_output_ms: i64,
    /// When the transcript (JSONL) last actually grew, per the staleness
    /// ticker's size polling (0 = not yet observed). Provenance signal.
    pub last_grew_ms: i64,
    /// Wall-clock ms since UNIX epoch when the PTY was spawned.
    pub created_at_ms: i64,
    /// PID of the `claude` child. `None` after exit.
    pub child_pid: Option<u32>,
    /// Exit code if `state == Exited`. `None` for unclean exits (crash / signal).
    pub exit_code: Option<i32>,
    /// Free-form last-state-change reason — surfaced as a tooltip on the
    /// status badge. e.g. "Notification: permission requested", "Stop hook".
    pub state_reason: Option<String>,
    /// True while Athena has actively taken this session's `AwaitingInput`
    /// ticket and is reasoning about it (a short self-expiring window set by
    /// `orchestrate_on_awaiting`). Drives the light-blue "Athena's on it" tile
    /// affordance so her work is visible. Only meaningful while `AwaitingInput`;
    /// once she acts (→ `Running`) or the window lapses, it's `false`.
    pub athena_active: bool,
}

/// Snapshot of the full fleet registry — returned by `fleet_list_sessions`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetRegistrySnapshot {
    pub sessions: Vec<FleetSession>,
    /// Resolved port of the in-app HTTP server hosting `/fleet/hooks/*`.
    /// `0` if the server hasn't started yet (defensive — should never reach UI).
    pub hook_port: u16,
    /// Whether `~/.claude/settings.json` currently contains the fleet's
    /// hook entries (matched by the `_fleet: true` marker). Drives the
    /// settings-page install/uninstall banner.
    pub hooks_installed: bool,
}

/// Status of the fleet hook installation in `~/.claude/settings.json`.
///
/// Returned by `fleet_check_hooks`. `missing_events` lists the Claude
/// Code hook types we need but didn't find tagged with `_fleet: true` —
/// drives the "Re-install" CTA when the user manually edited the file.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FleetHookStatus {
    pub installed: bool,
    /// Hook event names present and tagged (`Stop`, `Notification`, etc.).
    pub present_events: Vec<String>,
    /// Hook event names we need but couldn't find.
    pub missing_events: Vec<String>,
    /// Resolved port the installed entries point at. Compared against
    /// the currently-bound port to detect stale installs after a restart.
    pub installed_port: Option<u16>,
    /// Whether the installed port matches the currently-bound port.
    pub port_matches: bool,
}

/// Inbound payload from a Claude Code hook POST. The hook event type is
/// in the URL path (`/fleet/hooks/:event`); the body carries CC's own
/// hook payload as opaque JSON. Every field is `Option` because CC ships
/// different shapes per hook type — we extract opportunistically.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct FleetHookEvent {
    /// Claude Code's session_id — primary key for hook routing.
    pub session_id: Option<String>,
    /// Working directory of the CC session. Used as a fallback key when
    /// `session_id` isn't bound yet (race: hook fires before our registry
    /// learns the id from SessionStart).
    pub cwd: Option<String>,
    /// Free-form payload — passed through to UI for diagnostics, never
    /// parsed for state transitions (use the URL path for that).
    #[serde(default)]
    pub raw: serde_json::Value,
}
