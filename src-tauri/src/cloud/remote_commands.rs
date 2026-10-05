//! Phase 2: approval-gated remote run requests.
//!
//! The web dashboard inserts a `pending_commands` row (a *request* to run a
//! persona). This module polls those rows for THIS device and surfaces each to
//! the desktop user as an explicit approval prompt — it NEVER auto-executes.
//! On approval the persona runs **locally** via `execute_persona_inner` (the
//! same path as a normal run), and the result syncs back up through the Phase-1a
//! writer. Credentials and execution never leave the device; the web only ever
//! sent a `persona_id` + prompt.
//!
//! ## Queue verbs (this wave)
//!
//! The web can also *ask* to act on the fleet dispatch queue it reads out of
//! `synced_fleet_queue`. Those asks are the same shape and ride the same lane:
//! a `pending_commands` row whose `command_type` is one of [`QUEUE_VERBS`],
//! polled here, surfaced to the operator, and executed only on approval
//! through the fleet's own already-validated commands. Three rules hold:
//!
//! 1. **Through the gate, not around it.** A queue verb is a REQUEST. There is
//!    no second path that executes one directly and no auto-approval - not for
//!    `queue_cancel`, which looks harmless and is not (cancelling the head of
//!    a night shift's queue is a real act).
//! 2. **The grant is scoped, never total.** Exactly three verbs, each naming
//!    one row (or, for a reorder, an explicit list of rows that already exist
//!    in the queue). **Dispatching NEW work from the web is deliberately NOT
//!    here.** Reordering, lane-assigning and cancelling act on work the
//!    operator already admitted; dispatch mints work, chooses a `cwd` and
//!    spends money, and that is a different and much larger grant that needs
//!    its own design (an allowlist of roots at minimum). `run_persona`
//!    predates this module's rules and is the one creating verb; it is not a
//!    precedent for widening the queue lane.
//! 3. **Ungated is not unrecorded.** Every resolution writes back to the row -
//!    `completed`, `failed`, `rejected` or `expired` - including a refusal of
//!    a verb this build does not understand.
//!
//! ### A verb names a SESSION ID, never a rank
//!
//! The half-second problem decides this and there is only one defensible
//! answer. A rank is a *position in a list that renumbers on every mutation*:
//! a reorder, a promotion, a cancel, a lane assignment and a band claim each
//! densely renumber the whole queue. Between the web client reading rank 4 and
//! the operator approving the request - a window bounded only by the one-hour
//! expiry - rank 4 can be a different session, and the approval prompt would
//! be telling the operator the truth about a row that no longer exists at that
//! position. A session id is the row's stable identity; it is what every
//! surface in the app already holds, and if the row has left the queue by
//! approval time the fleet's own commands refuse it by id with a real error
//! instead of acting on an innocent neighbour. This is settled; do not
//! re-open it.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use personas_macros::requires;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::cloud::sync::client::SyncClient;
use crate::cloud::sync::cursor;
use crate::db::DbPool;
use crate::error::AppError;
use crate::AppState;

/// Commands already surfaced to the UI this session, so the 15s poll doesn't
/// re-emit the same prompt every tick.
static SURFACED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Requests older than this (without resolution) are auto-expired so a stale
/// prompt can't pop days later.
fn expiry_window() -> chrono::Duration {
    chrono::Duration::hours(1)
}

/// Raw `pending_commands` row (subset we select).
#[derive(Debug, Clone, Deserialize)]
struct CommandRow {
    id: String,
    persona_id: Option<String>,
    command_type: String,
    prompt: Option<String>,
    status: String,
    requested_at: String,
}

/// Approval-prompt payload sent to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommand {
    pub id: String,
    pub persona_id: String,
    pub persona_name: Option<String>,
    pub command_type: String,
    pub prompt: Option<String>,
    pub requested_at: String,
}

/// The closed set of queue verbs this build understands, as they appear in
/// `pending_commands.command_type`. Adding one here is the whole extension
/// point - there is no parallel table and no dynamic registry.
const QUEUE_VERBS: &[&str] = &["queue_reorder", "queue_set_lane", "queue_cancel"];

/// `run_persona` plus the queue verbs - everything this desktop will surface.
/// Anything else is refused and recorded (see [`refuse_unknown`]).
fn is_known_command_type(t: &str) -> bool {
    t == "run_persona" || QUEUE_VERBS.contains(&t)
}

/// The `command_type=in.(…)` term for the list query, built from the constants
/// above so the URL cannot drift from [`is_known_command_type`].
fn known_types_filter() -> String {
    let mut all = vec!["run_persona"];
    all.extend_from_slice(QUEUE_VERBS);
    format!("command_type=in.({})", all.join(","))
}

/// A queue verb's parameters, carried as JSON in the row's existing `prompt`
/// column.
///
/// `pending_commands` lives in Supabase and this repo holds no migration for
/// it (the remote schema is, as the sync golden path records, nowhere) - so a
/// new column is not a change this package can make safely. `prompt` is
/// already a free-text column the web fills, so the payload rides there and
/// the table shape is untouched. The discriminant stays `command_type`,
/// exactly as the brief requires.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueuePayload {
    /// `queue_set_lane` / `queue_cancel`: the one row the verb names.
    #[serde(default)]
    session_id: Option<String>,
    /// `queue_reorder`: the queue's new order, head first.
    #[serde(default)]
    session_ids: Option<Vec<String>>,
    /// `queue_set_lane`: 1-based lane, or `null` to clear. Validated by
    /// `fleet_queue_set_lane`, which owns what a legal lane is.
    #[serde(default)]
    lane: Option<u32>,
}

fn parse_queue_payload(prompt: Option<&str>) -> Result<QueuePayload, AppError> {
    let raw = prompt.unwrap_or_default().trim();
    // The shared vocabulary, not a hand-written sentence: `require_non_empty`
    // is the repo's one emptiness refusal and keeps the field name attached to
    // the failure (`command-input-validation`).
    personas_core::validation::require_non_empty("queue request payload", raw)?;
    serde_json::from_str(raw)
        .map_err(|e| AppError::Validation(format!("Queue request payload is not valid: {e}")))
}

const SELECT: &str = "select=id,persona_id,command_type,prompt,status,requested_at";

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn is_expired(requested_at: &str) -> bool {
    match chrono::DateTime::parse_from_rfc3339(requested_at) {
        Ok(t) => {
            chrono::Utc::now().signed_duration_since(t.with_timezone(&chrono::Utc))
                > expiry_window()
        }
        Err(_) => false,
    }
}

async fn read_token(state: &Arc<AppState>) -> Option<String> {
    let auth = state.auth.read().await;
    auth.access_token
        .as_ref()
        .map(|s| s.expose_secret().to_string())
}

fn persona_name(pool: &DbPool, id: &str) -> Option<String> {
    crate::db::repos::core::personas::get_by_id(pool, id)
        .ok()
        .map(|p| p.name)
}

/// PATCH a command row's status (+ optional extra fields), best-effort.
async fn set_command_status(client: &SyncClient, id: &str, status: &str, extra: serde_json::Value) {
    let mut body = json!({ "status": status, "updated_at": now() });
    if let (Some(obj), Some(extra_obj)) = (body.as_object_mut(), extra.as_object()) {
        for (k, v) in extra_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
    let _ = client
        .patch(&format!("pending_commands?id=eq.{id}"), &body)
        .await;
}

fn to_remote(c: CommandRow, pool: &DbPool) -> RemoteCommand {
    let persona_id = c.persona_id.unwrap_or_default();
    let name = if persona_id.is_empty() {
        None
    } else {
        persona_name(pool, &persona_id)
    };
    RemoteCommand {
        id: c.id,
        persona_id,
        persona_name: name,
        command_type: c.command_type,
        prompt: c.prompt,
        requested_at: c.requested_at,
    }
}

/// One poll pass: surface new pending run-requests for this device, expire stale ones.
async fn poll_once(app: &AppHandle, state: &Arc<AppState>) -> Result<(), AppError> {
    let jwt = match read_token(state).await {
        Some(t) => t,
        None => return Ok(()),
    };
    let client = SyncClient::new(jwt)?;
    let pool = state.db.clone();
    let device = cursor::resolve_device_id(&pool);

    let path = format!(
        "pending_commands?status=eq.pending&target_device_id=eq.{device}&order=requested_at.asc&{SELECT}"
    );
    let cmds: Vec<CommandRow> = client.get(&path).await?;

    let mut surfaced = SURFACED.lock().await;
    for c in cmds {
        if is_expired(&c.requested_at) {
            let _ = client
                .patch(
                    // Device- and status-scoped, like every other write to this
                    // table. The fetch above already filtered by device, so this
                    // is defence in depth against the row moving underneath the
                    // loop — but it is also the difference between a write that
                    // is scoped and a write that merely happens to be given
                    // scoped input. `status=eq.pending` additionally stops the
                    // expiry from overwriting a command the user resolved while
                    // the poll was in flight.
                    &format!(
                        "pending_commands?id=eq.{}&target_device_id=eq.{device}&status=eq.pending",
                        c.id
                    ),
                    &json!({ "status": "expired", "resolved_at": now(), "updated_at": now() }),
                )
                .await;
            continue;
        }
        // An unknown command_type is REFUSED AND RECORDED, never ignored and
        // never defaulted. Until this wave the loop `continue`d, which left a
        // newer web build's request sitting `pending` until the one-hour
        // expiry swept it - the web could not tell "this desktop will not do
        // that" from "nobody is home", and the desktop's authority over which
        // verbs exist was expressed as silence. Rejecting says it out loud and
        // leaves the reason on the row.
        if !is_known_command_type(&c.command_type) {
            tracing::warn!(
                command_type = %c.command_type,
                id = %c.id,
                "remote command: unsupported verb, refusing"
            );
            let _ = client
                .patch(
                    &format!(
                        "pending_commands?id=eq.{}&target_device_id=eq.{device}&status=eq.pending",
                        c.id
                    ),
                    &json!({
                        "status": "rejected",
                        "error_message": format!(
                            "unsupported_command_type: this desktop does not implement `{}`",
                            c.command_type
                        ),
                        "resolved_at": now(),
                        "updated_at": now(),
                    }),
                )
                .await;
            continue;
        }
        if surfaced.contains(&c.id) {
            continue;
        }
        surfaced.insert(c.id.clone());
        let _ = app.emit("remote-command-pending", to_remote(c, &pool));
    }
    Ok(())
}

/// Spawn the 15s poll loop. Leader-gated + sync-enabled-gated, so it only runs
/// on one instance and only when the user has opted into cloud sync.
pub fn spawn_poll_loop(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(12)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(15));
        loop {
            ticker.tick().await;
            if !state.leadership.is_leader() || !cursor::is_enabled(&state.db) {
                continue;
            }
            if let Err(e) = poll_once(&app, &state).await {
                tracing::warn!(error = %e, "remote-command poll failed");
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// List the pending run-requests targeted at this device (for the approval UI
/// to render on mount / refresh). Returns empty when not signed in.
#[tauri::command]
#[requires(privileged)]
pub async fn remote_command_list_pending(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RemoteCommand>, AppError> {
    let jwt = match read_token(&state).await {
        Some(t) => t,
        None => return Ok(vec![]),
    };
    let client = SyncClient::new(jwt)?;
    let pool = state.db.clone();
    let device = cursor::resolve_device_id(&pool);
    let types = known_types_filter();
    let path = format!(
        "pending_commands?status=eq.pending&{types}&target_device_id=eq.{device}&order=requested_at.asc&{SELECT}"
    );
    let cmds: Vec<CommandRow> = client.get(&path).await?;
    Ok(cmds
        .into_iter()
        .filter(|c| !is_expired(&c.requested_at))
        .map(|c| to_remote(c, &pool))
        .collect())
}

/// Validate that a remote-command `id` is a canonical UUID before it is
/// interpolated into a PostgREST query path. PostgREST treats `&`, `=`, and
/// `eq.` as structured query syntax, so an unvalidated `id` (e.g.
/// `x&status=eq.pending`) would let a caller widen the WHERE clause of a
/// tenant-scoped GET/PATCH under the user's own JWT — mass-reject, status
/// spoofing, or appending a permissive filter to defeat per-device scoping. A
/// parsed UUID contains only hex + hyphens, so it cannot carry that syntax.
fn validate_command_id(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AppError::Validation("Invalid remote command id".into()))
}

/// Approve a remote run-request: run the persona locally and write the result
/// (execution id) back to the command row. Requires a live Google session.
#[tauri::command]
#[requires(cloud)]
pub async fn remote_command_approve(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<String, AppError> {
    validate_command_id(&id)?;
    let jwt = read_token(&state)
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let client = SyncClient::new(jwt)?;

    // Scope the fetch to THIS device. The id is a listable UUID, not a per-device
    // capability token, and RLS only scopes rows to the tenant — not the device.
    // Without this filter a multi-device user could approve a run targeted at
    // device B and have it execute on device A (wrong sandbox / local creds /
    // working tree). A wrong-device row simply won't return → "not found".
    let device = cursor::resolve_device_id(&state.db);
    let cmds: Vec<CommandRow> = client
        .get(&format!(
            "pending_commands?id=eq.{id}&target_device_id=eq.{device}&{SELECT}"
        ))
        .await?;
    let cmd = cmds
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Validation("Remote command not found".into()))?;
    if cmd.status != "pending" {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }
    // Refuse an unknown verb BEFORE the claim, so a request this build cannot
    // honour is never moved out of `pending` into `executing` and stranded
    // there. The reject is recorded, not silent.
    if !is_known_command_type(&cmd.command_type) {
        // Device- and status-scoped, like the poll loop's refusal and unlike
        // `set_command_status`, which filters on the id alone. A refusal is a
        // terminal write on a row that is still `pending`, so it carries the
        // same two terms every other terminal write in this file carries.
        let _ = client
            .patch(
                &format!(
                    "pending_commands?id=eq.{id}&target_device_id=eq.{device}&status=eq.pending"
                ),
                &json!({
                    "status": "rejected",
                    "error_message": format!(
                        "unsupported_command_type: this desktop does not implement `{}`",
                        cmd.command_type
                    ),
                    "resolved_at": now(),
                    "updated_at": now(),
                }),
            )
            .await;
        return Err(AppError::Validation(format!(
            "This desktop does not implement `{}`",
            cmd.command_type
        )));
    }

    // Claim the command, don't just announce it.
    //
    // The `cmd.status != "pending"` check above is necessary and NOT
    // sufficient: it reads the status, decides in Rust, and until 2026-08-16
    // the write that followed carried no status filter. Two concurrent
    // approvals of one request both read `pending`, both passed the check, and
    // both reached the agent — two runs, two bills, one request. Reproduced
    // against the real shape before fixing.
    //
    // `status=eq.pending` in the FILTER is what makes this exclusive, and the
    // returned row count is what tells this caller whether it won. Losing is a
    // normal outcome, not an error condition, so it reports the same message a
    // late click already got.
    let claimed = client
        .patch_returning_count(
            // `target_device_id` belongs here too, and was missing from the
            // first version of this claim (2026-08-16, same day): the status
            // term makes the claim exclusive between two clicks on THIS device,
            // and the device term is what keeps device A from claiming a command
            // targeted at device B. They guard different things and the fetch
            // above carries both.
            &format!("pending_commands?id=eq.{id}&target_device_id=eq.{device}&status=eq.pending"),
            &json!({ "status": "executing", "updated_at": now() }),
        )
        .await?;
    if claimed == 0 {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }

    // Execute, by verb. `run_persona` runs locally through the same path a
    // normal run takes; a queue verb goes through the fleet's own command,
    // which owns its validation (a legal lane, a row that is still queued, the
    // dense re-rank and the `queue-changed` emit). Nothing here reimplements
    // any of that, and nothing here reaches the queue's internals directly.
    let outcome = match cmd.command_type.as_str() {
        "run_persona" => {
            let persona_id = cmd
                .persona_id
                .ok_or_else(|| AppError::Validation("Request is missing a persona".into()))?;
            crate::commands::execution::executions::execute_persona_inner(
                state.inner(),
                app,
                persona_id,
                None,
                cmd.prompt,
                None,
                None,
                None,
                false,
            )
            .await
            .map(|exec| exec.id)
        }
        verb => run_queue_verb(&app, state.clone(), verb, cmd.prompt.as_deref()).await,
    };

    match outcome {
        Ok(result_id) => {
            set_command_status(
                &client,
                &id,
                "completed",
                // `execution_id` stays the result field for a run; a queue verb
                // has no execution, so it reports the row it acted on under
                // `result_ref` and leaves `execution_id` null.
                if cmd.command_type == "run_persona" {
                    json!({ "execution_id": result_id, "resolved_at": now() })
                } else {
                    json!({ "result_ref": result_id, "resolved_at": now() })
                },
            )
            .await;
            Ok(result_id)
        }
        Err(e) => {
            set_command_status(
                &client,
                &id,
                "failed",
                json!({ "error_message": e.to_string(), "resolved_at": now() }),
            )
            .await;
            Err(e)
        }
    }
}

/// Execute one approved queue verb through the fleet's own public commands.
///
/// Every verb names a **session id**, never a rank - see the module doc. Each
/// returns the id (or a short description, for a reorder) that is recorded on
/// the resolved row.
///
/// Reached only from [`remote_command_approve`], after the operator approved
/// and after the compare-and-set claim won. There is no other caller and there
/// must not be one: a second entry point is a second gate to keep honest.
async fn run_queue_verb(
    app: &AppHandle,
    state: State<'_, Arc<AppState>>,
    command_type: &str,
    prompt: Option<&str>,
) -> Result<String, AppError> {
    use crate::commands::fleet::{queue, queue_lanes};

    let payload = parse_queue_payload(prompt)?;
    let one_session = |p: &QueuePayload| -> Result<String, AppError> {
        let id = p.session_id.clone().unwrap_or_default();
        personas_core::validation::require_non_empty("sessionId", &id)?;
        Ok(id)
    };

    match command_type {
        "queue_reorder" => {
            let ids = payload.session_ids.clone().unwrap_or_default();
            if ids.len() < 2 {
                // A reorder of fewer than two rows is not an ordering - it is
                // either an empty payload or a no-op the web should not have
                // sent. Refusing says so rather than silently renumbering.
                return Err(AppError::Validation(
                    "Reorder must name at least two sessions".into(),
                ));
            }
            for id in &ids {
                personas_core::validation::require_non_empty("sessionIds[]", id)?;
            }
            // `fleet_queue_reorder` ignores ids that are not queued rows and
            // keeps unnamed queued rows after the named ones, so a stale list
            // from the web degrades to a partial reorder rather than acting on
            // the wrong rows.
            queue::fleet_queue_reorder(app.clone(), state, ids.clone()).await?;
            Ok(format!("reordered {} entries", ids.len()))
        }
        "queue_set_lane" => {
            let session_id = one_session(&payload)?;
            // An absent `lane` and an explicit `null` both mean "clear it" -
            // the one reading that cannot be mistaken for lane 0, which
            // `fleet_queue_set_lane` refuses outright.
            queue_lanes::fleet_queue_set_lane(app.clone(), state, session_id.clone(), payload.lane)
                .await?;
            Ok(session_id)
        }
        "queue_cancel" => {
            let session_id = one_session(&payload)?;
            queue::fleet_queue_cancel(app.clone(), state, session_id.clone()).await?;
            Ok(session_id)
        }
        // Unreachable in practice (the caller checks `is_known_command_type`
        // first) and still not a `_ => default`: a verb this build does not
        // understand is refused here too, so adding a name to `QUEUE_VERBS`
        // without a match arm fails loudly instead of silently no-opping.
        other => Err(AppError::Validation(format!(
            "unsupported_command_type: `{other}`"
        ))),
    }
}

/// Reject a remote run-request.
#[tauri::command]
#[requires(cloud)]
pub async fn remote_command_reject(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), AppError> {
    validate_command_id(&id)?;
    let jwt = read_token(&state)
        .await
        .ok_or_else(|| AppError::Auth("Not signed in".into()))?;
    let client = SyncClient::new(jwt)?;

    // Scope by device and by status, exactly as `remote_command_approve` does.
    //
    // Until 2026-08-16 this patched `pending_commands?id=eq.{id}` with neither
    // term. The approve path 85 lines above carries a four-line comment
    // explaining precisely why the device term is required — the id is a
    // listable UUID, not a per-device capability token, and row-level security
    // scopes to the tenant and not to the device — and reject, which resolves
    // the same row, did not carry it. A multi-device user could reject a request
    // targeted at another of their devices.
    //
    // The status term makes the write idempotent: rejecting something already
    // resolved changes nothing rather than overwriting a terminal state.
    let device = cursor::resolve_device_id(&state.db);
    let rejected = client
        .patch_returning_count(
            &format!("pending_commands?id=eq.{id}&target_device_id=eq.{device}&status=eq.pending"),
            &json!({ "status": "rejected", "resolved_at": now(), "updated_at": now() }),
        )
        .await?;
    if rejected == 0 {
        return Err(AppError::Validation(
            "This request is no longer pending".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_window_classification() {
        let old = (chrono::Utc::now() - chrono::Duration::hours(2)).to_rfc3339();
        let recent = (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339();
        assert!(is_expired(&old), "a 2h-old request should be expired");
        assert!(
            !is_expired(&recent),
            "a 5m-old request should not be expired"
        );
        // Unparseable timestamps must NOT be treated as expired (fail-safe:
        // a malformed requested_at shouldn't silently drop a real request).
        assert!(!is_expired("not-a-timestamp"));
    }

    /// The grant is a CLOSED set. This test is the record of what the web may
    /// ask for; widening it is a deliberate act that lands in a diff. Note
    /// what is absent: there is no verb that dispatches new work.
    #[test]
    fn the_queue_grant_is_three_verbs_and_no_dispatch() {
        assert_eq!(
            QUEUE_VERBS,
            &["queue_reorder", "queue_set_lane", "queue_cancel"]
        );
        for creating in [
            "queue_dispatch",
            "fleet_spawn",
            "queue_start_now",
            "run_shell",
        ] {
            assert!(
                !is_known_command_type(creating),
                "`{creating}` is a creating verb and must not be in the grant"
            );
        }
        assert!(is_known_command_type("run_persona"));
    }

    /// An unknown type never falls through to a default - neither in the
    /// poll's surface decision nor in the list query's filter.
    #[test]
    fn unknown_command_type_is_not_known_and_not_listed() {
        assert!(!is_known_command_type("queue_teleport"));
        assert!(!is_known_command_type(""));
        let f = known_types_filter();
        assert_eq!(
            f,
            "command_type=in.(run_persona,queue_reorder,queue_set_lane,queue_cancel)"
        );
        assert!(!f.contains("queue_teleport"));
    }

    /// The payload rides the existing `prompt` column as JSON, camelCase on
    /// the wire. Missing, blank and malformed all refuse rather than
    /// defaulting to an empty act.
    #[test]
    fn queue_payload_parses_the_web_contract() {
        let p = parse_queue_payload(Some(r#"{"sessionIds":["a","b"]}"#)).unwrap();
        assert_eq!(
            p.session_ids.as_deref(),
            Some(&["a".to_string(), "b".to_string()][..])
        );
        let p = parse_queue_payload(Some(r#"{"sessionId":"a","lane":3}"#)).unwrap();
        assert_eq!(p.session_id.as_deref(), Some("a"));
        assert_eq!(p.lane, Some(3));
        // An explicit null lane and an absent lane are the same fact: clear it.
        assert_eq!(
            parse_queue_payload(Some(r#"{"sessionId":"a","lane":null}"#))
                .unwrap()
                .lane,
            None
        );
        assert_eq!(
            parse_queue_payload(Some(r#"{"sessionId":"a"}"#))
                .unwrap()
                .lane,
            None
        );
        assert!(parse_queue_payload(None).is_err());
        assert!(parse_queue_payload(Some("   ")).is_err());
        assert!(parse_queue_payload(Some("not json")).is_err());
        // The emptiness refusal goes through the shared vocabulary, so the
        // field name survives into the message.
        let err = parse_queue_payload(Some("")).unwrap_err().to_string();
        assert!(
            err.contains("queue request payload"),
            "the refusal must name the field: {err}"
        );
    }
}
