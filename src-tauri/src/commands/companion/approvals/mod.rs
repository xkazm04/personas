//! Approval queue + action executors. Phase 3 ships a small, deliberately
//! constrained action set (run_persona, resolve_human_review) that maps to
//! existing Tauri command bodies — no new privileged surface beyond what
//! the rest of the app already exposes.
//!
//! Flow:
//!   1. Athena emits `{"op": "propose_action", ...}` in her reply.
//!   2. `dispatcher::dispatch` strips the line, creates a `companion_approval`
//!      row with status='pending'.
//!   3. UI renders an approval card with the rationale + params.
//!   4. User clicks Approve → `companion_approve_action` here →
//!      status='running' → action executor → outcome appended as an episode →
//!      status='approved' or status='approved_failed' when the executor fails
//!      after approval.
//!   5. User clicks Reject → `companion_reject_action` → status='rejected'
//!      and an episode is logged with the rejection reason.
//!
//! Pending rows are also inserted by non-Athena producers (backlog_triage,
//! incident_diagnosis, night_plan, and the management API's KP bridge —
//! `POST /api/kp/persona-requests` → action `kp_hire_request`); they reuse
//! the same `{action, params, rationale}` payload shape and flow above.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::companion::brain::episodic::{self, EpisodeRole};
use crate::companion::session::DEFAULT_SESSION_ID;
use crate::db::models::ManualReviewStatus;
use crate::db::repos::communication::manual_reviews as manual_repo;
use crate::error::AppError;
use crate::ipc_auth;
use crate::AppState;

const APPROVAL_STATUS_PENDING: &str = "pending";
const APPROVAL_STATUS_APPROVED: &str = "approved";
const APPROVAL_STATUS_APPROVED_FAILED: &str = "approved_failed";
const APPROVAL_STATUS_RUNNING: &str = "running";
const APPROVAL_STATUS_REJECTED: &str = "rejected";

/// Consent-freshness window for pending approvals, as a SQLite `datetime`
/// modifier. A pending approval has no expiry of its own, so without this an
/// approval could be listed and acted on long after its target is gone (a stale
/// consent surface). Approvals older than this are hidden from the list and
/// refused at act-time.
const APPROVAL_FRESHNESS_WINDOW: &str = "-24 hours";

// ── Tauri-facing types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub id: String,
    pub action: String,
    pub rationale: String,
    pub params_json: String,
    pub human_review_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalOutcome {
    pub id: String,
    pub status: String,
    pub message: String,
    /// Optional client-side action the frontend should perform after the
    /// approval lands. UI-only operations (route navigation, prefill) emit
    /// these instead of a backend execute. The frontend's ApprovalCard
    /// dispatches them via the appropriate Zustand store.
    pub client_action: Option<ClientAction>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientAction {
    /// Switch the sidebar to the given top-level section.
    Navigate { route: String },
    /// Phase F: prefill the persona creation wizard with `intent` (and
    /// optionally a name), then optionally auto-click launch. The
    /// frontend writes a slot in the system store and navigates to
    /// `personas`; UnifiedMatrixEntry consumes the slot on mount.
    ///
    /// `mode` selects the build strategy when `auto_launch` is true:
    ///   - `Some("interactive")` or `None` → ask-the-user gate flow.
    ///   - `Some("one_shot")` → autonomous build; the frontend opens
    ///     a read-only Glyph view and waits for the terminal
    ///     notification rather than driving the questionnaire.
    ///     `companion_session_id` links the build back to the chat that
    ///     originated it so the BuildWatcher job can post the result message
    ///     into that chat's episode log on terminal phase.
    // Field-level casing has to be declared per variant: the enum-level
    // `rename_all` above renames the VARIANTS (the `type` tag), not their
    // fields, so without this `auto_launch` / `companion_session_id` went over
    // IPC in snake_case while the TS `ClientAction` reads `autoLaunch` /
    // `companionSessionId` — the flag silently read as `undefined`.
    #[serde(rename_all = "camelCase")]
    PrefillPersonaCreate {
        intent: String,
        name: Option<String>,
        auto_launch: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        companion_session_id: Option<String>,
    },
    /// Phase F: open a specific tab inside the Companion plugin. Used
    /// by `compose_dashboard` (tab="dashboard") so the user lands on
    /// the rendered result without manually navigating. Tab values
    /// match `CompanionPluginTab` on the frontend
    /// (`setup` | `memory` | `voice` | `dashboard`).
    OpenCompanionTab { tab: String },
    /// Phase G — open an external URL in the user's default browser. Used by
    /// `open_test_env` to launch a dev project's configured test-environment
    /// URL. The frontend dispatches this via `openExternalUrl()` (the
    /// validated `open_external_url` Tauri command, http/https only), keeping
    /// URL-opening on the same path as the Dev Tools UI button.
    OpenExternalUrl { url: String },
}

/// Internal: each `execute_*` returns this so we can build either a
/// pure-message outcome (run_persona, etc.) or one carrying a client
/// action (open_route).
pub(crate) struct ExecuteResult {
    pub(crate) message: String,
    pub(crate) client_action: Option<ClientAction>,
}

impl ExecuteResult {
    pub(crate) fn message(message: String) -> Self {
        Self {
            message,
            client_action: None,
        }
    }
}

// ── module family (split 2026-07-24; every file names its `approval_` role) ─
// Glob re-exports keep the public path surface identical to the former
// single-file module: `commands::companion::approvals::<item>` still resolves
// for lib.rs generate_handler, session.rs, fleet_bridge.rs and tests.
mod app_master_hire;
mod approval_autopilot;
mod approval_exec_canvas;
mod approval_exec_core;
mod approval_exec_dev;
mod approval_exec_devices;
mod approval_exec_fleet;
mod approval_exec_knowledge;
mod approval_exec_night;
mod approval_exec_ship;
mod approval_lifecycle;

// The App master hire module is private, but the kp reporter needs ONE thing
// from it: how a seeded KPI's `measure_config` carries kp's `kpiKey`. Re-export
// that single reader rather than duplicating the JSON pointer at the read site
// — two spellings of one envelope is how a rollup starts silently reporting
// zero objectives.
pub use app_master_hire::measure_config_kpi_key as app_master_measure_config_kpi_key;
pub use approval_autopilot::*;
pub(crate) use approval_exec_canvas::*;
pub(crate) use approval_exec_core::*;
pub(crate) use approval_exec_dev::*;
pub(crate) use approval_exec_devices::*;
pub use approval_exec_fleet::*;
pub(crate) use approval_exec_knowledge::*;
pub(crate) use approval_exec_night::*;
pub use approval_exec_ship::*;
pub use approval_lifecycle::*;
