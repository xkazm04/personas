//! `approval_exec_devices` — the two device ops. `remote_instruct` hands an
//! instruction to one of the operator's OTHER paired devices, where that
//! device's own Athena runs it as a normal turn; `remote_fleet_dispatch` sends
//! a whole fleet session there, which runs on its own branch, pushes it, and
//! comes back as a verified SHA.
//!
//! Part of the approval module family (split from the former approvals.rs god
//! file, 2026-07-24); shared imports and types live in `mod.rs`.
//!
//! ## The operator rule, and where it lives
//!
//! There is exactly ONE statement of the rule — [`gate_remote_instruct`] — and
//! both paths that could ever fire EITHER op go through it (the consent
//! question is "may I send work to that machine", whatever the work is):
//!
//! | autonomous mode | target        | outcome                              |
//! |-----------------|---------------|--------------------------------------|
//! | OFF             | HOME device   | approval card, operator clicks        |
//! | OFF             | any other     | REFUSED, with the reason              |
//! | ON              | HOME device   | auto-fires                            |
//! | ON              | any other     | auto-fires                            |
//!
//! Deliberately NOT an `AUTOAPPROVE_ALLOWLIST` entry: that list is a flat set
//! of action names with no mode-conditional or per-target form, so expressing
//! "only the home device, and only when the mode is off" through it is not
//! possible without inventing a second policy language. Instead
//! `auto_resolve_if_allowed` grows one dedicated arm that returns BEFORE the
//! allowlist check. The allowlist itself was retired on 2026-08-10 (under
//! autonomous mode every proposal now fires); what replaced the old
//! "asserted absent from the allowlist" test is [`DEVICE_GATED_ACTIONS`]: the
//! autopilot routes both ops into the device arm by that list, BEFORE its
//! generic fire-everything path, and
//! `device_ops_never_reach_the_generic_autopilot_path` pins it.
//!
//! The refusal half cannot be bypassed either, because it does not live in the
//! autopilot: [`execute_remote_instruct`] itself calls the gate, so the manual
//! Approve path enforces it too. A card created while the mode was on and
//! clicked after it was turned off is refused at the moment it fires, not at
//! the moment it was proposed. The gate reads the persisted autonomous-mode row
//! rather than trusting a flag passed down the call chain, so there is no
//! caller that can assert its way past it.

#[allow(unused_imports)]
use super::*;

use crate::db::models::{
    DevProject, FleetSessionJobPayload, OwnedDevice, RemoteJob, RemoteJobStatus, RemoteSessionMode,
};
use crate::db::repos::resources::owned_devices as devices_repo;

/// The ops that carry the mode-conditional device rule. The autopilot routes
/// every name here into [`auto_resolve_remote_instruct`] BEFORE its generic
/// auto-fire path, so neither can ever be fired by action name alone.
pub(crate) const DEVICE_GATED_ACTIONS: &[&str] = &["remote_instruct", "remote_fleet_dispatch"];

/// Is `action` one of the device-gated ops?
pub(crate) fn is_device_gated(action: &str) -> bool {
    DEVICE_GATED_ACTIONS.contains(&action)
}

/// What the rule says to do with one proposed `remote_instruct`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RemoteInstructGate {
    /// Autonomous mode is on: send it now, no card.
    Autofire,
    /// Manual mode, home device: file the card and wait for the click.
    NeedsApproval,
    /// Manual mode, some other device: do not send, and say why.
    Refused(String),
}

/// THE rule. Pure so it is trivially testable in all four combinations, and
/// single so there is only one place it can drift from.
pub(crate) fn gate_remote_instruct(autonomous: bool, target: &OwnedDevice) -> RemoteInstructGate {
    match (autonomous, target.is_home) {
        // Standing consent: the operator turned autonomous mode on, which is
        // exactly the "act without asking me" switch. Any paired device is fair
        // game — pairing is the trust boundary, and it was crossed by a human
        // confirming a fingerprint.
        (true, _) => RemoteInstructGate::Autofire,
        // No standing consent, but the home machine is the one the operator
        // treats as "mine, always on" — reaching it is the ordinary case, so it
        // gets a card rather than a refusal.
        (false, true) => RemoteInstructGate::NeedsApproval,
        // No standing consent and a device that is not home: refuse outright
        // rather than file a card. Sending work to a machine that may belong to
        // a different context (a work laptop, a family desktop) is not something
        // to normalize behind a one-click habit.
        (false, false) => RemoteInstructGate::Refused(format!(
            "With autonomous mode off I only send work to your home device. \
             \"{}\" is paired but is not the home device. Set it as home under \
             Settings > Devices, or turn autonomous mode on, if you meant it.",
            target.display_name
        )),
    }
}

/// Resolve the op's `device` parameter to a paired device.
///
/// Accepts, in order: an exact `peer_id`, the literal `"home"` (also the
/// default when the parameter is missing or blank), or a case-insensitive
/// display-name match. Name matching exists because Athena has no paired-device
/// digest in her prompt — she knows the name only because the operator said it
/// out loud, so "send it to my laptop" has to resolve.
pub(crate) fn resolve_remote_target(
    db: &crate::db::DbPool,
    params: &serde_json::Value,
) -> Result<OwnedDevice, AppError> {
    let requested = params
        .get("device")
        .or_else(|| params.get("peer_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let devices = devices_repo::list_owned_devices(db)?;
    if devices.is_empty() {
        return Err(AppError::Validation(
            "There are no paired devices yet. Pair one under Settings > Devices first.".into(),
        ));
    }

    if requested.is_empty() || requested.eq_ignore_ascii_case("home") {
        return devices.into_iter().find(|d| d.is_home).ok_or_else(|| {
            AppError::Validation(
                "No device is marked as home yet. Open Settings > Devices and set one.".into(),
            )
        });
    }

    if let Some(exact) = devices.iter().find(|d| d.peer_id == requested) {
        return Ok(exact.clone());
    }
    let mut by_name = devices
        .iter()
        .filter(|d| d.display_name.trim().eq_ignore_ascii_case(&requested));
    match (by_name.next(), by_name.next()) {
        (Some(one), None) => Ok(one.clone()),
        (Some(_), Some(_)) => Err(AppError::Validation(format!(
            "More than one paired device is called \"{requested}\". Name it by its device id instead."
        ))),
        _ => Err(AppError::NotFound(format!(
            "\"{requested}\" is not one of your paired devices. Paired: {}.",
            devices
                .iter()
                .map(|d| d.display_name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// The instruction text, validated. Kept separate so the autopilot arm can
/// reject a malformed proposal before it transitions the approval row.
fn instruction_of(params: &serde_json::Value) -> Result<String, AppError> {
    let text = params
        .get("instruction")
        .or_else(|| params.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err(AppError::Validation(
            "There is no instruction to send to the other device.".into(),
        ));
    }
    Ok(text)
}

/// The session prompt of a `remote_fleet_dispatch`, validated.
fn prompt_of(params: &serde_json::Value) -> Result<String, AppError> {
    let text = params
        .get("prompt")
        .or_else(|| params.get("objective"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    personas_core::validation::require_non_empty("prompt", &text)?;
    Ok(text)
}

/// `headless` (the default: nobody is watching that terminal) or `interactive`.
fn mode_of(params: &serde_json::Value) -> Result<RemoteSessionMode, AppError> {
    match params
        .get("mode")
        .and_then(|v| v.as_str())
        .map(|m| m.trim().to_ascii_lowercase())
        .as_deref()
    {
        None | Some("") | Some("headless") | Some("cli") => Ok(RemoteSessionMode::Headless),
        Some("interactive") | Some("fleet") => Ok(RemoteSessionMode::Interactive),
        Some(other) => Err(AppError::Validation(format!(
            "Unknown session mode '{other}' (expected 'headless' or 'interactive')."
        ))),
    }
}

/// Resolve the op's `project` on THIS device: an exact project id, else a
/// unique case-insensitive name. The payload carries its id, name and git
/// remote; the other device matches the remote first.
fn resolve_local_project(
    projects: &[DevProject],
    params: &serde_json::Value,
) -> Result<DevProject, AppError> {
    let requested = params
        .get("project")
        .or_else(|| params.get("project_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    personas_core::validation::require_non_empty("project", &requested)?;
    if let Some(p) = projects.iter().find(|p| p.id == requested) {
        return Ok(p.clone());
    }
    let mut by_name = projects
        .iter()
        .filter(|p| p.name.trim().eq_ignore_ascii_case(&requested));
    match (by_name.next(), by_name.next()) {
        (Some(one), None) => Ok(one.clone()),
        (Some(_), Some(_)) => Err(AppError::Validation(format!(
            "More than one project is called \"{requested}\". Name it by its id instead."
        ))),
        _ => Err(AppError::NotFound(format!(
            "\"{requested}\" is not a registered project on this device."
        ))),
    }
}

/// The payload a `remote_fleet_dispatch` sends. `branch` is left empty on
/// purpose: the one dispatch path mints it.
fn fleet_payload_of(
    projects: &[DevProject],
    params: &serde_json::Value,
) -> Result<FleetSessionJobPayload, AppError> {
    let prompt = prompt_of(params)?;
    let mode = mode_of(params)?;
    let project = resolve_local_project(projects, params)?;
    // A project with no git remote is refused by the ONE dispatch path
    // (`remote_exec::require_git_remote`), for this op and the picker alike.
    let github_url = project.github_url.clone().unwrap_or_default();
    Ok(FleetSessionJobPayload {
        project_id: project.id,
        github_url,
        project_name: project.name,
        prompt,
        mode,
        branch: String::new(),
        persona_id: params
            .get("persona_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    })
}

/// Execute an approved (or auto-fired) `remote_fleet_dispatch`: the same
/// device rule as `remote_instruct`, then the SAME dispatch path the "Run on"
/// picker uses (`commands::fleet::remote_exec::dispatch`).
pub(crate) async fn execute_remote_fleet_dispatch(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let projects = crate::db::repos::dev_tools::list_projects(&state.db, None)?;
    let payload = fleet_payload_of(&projects, params)?;
    let target = resolve_remote_target(&state.db, params)?;
    let autonomous = crate::commands::companion::chat::autonomous_mode_enabled(&state.db);
    if let RemoteInstructGate::Refused(reason) = gate_remote_instruct(autonomous, &target) {
        return Err(AppError::Forbidden(reason));
    }
    send_fleet_session(state, &target, payload).await
}

/// What Athena says after a send, from the job the transport returned. An
/// OFFLINE paired device is not an error any more: the job waits in the
/// outbox as `queued`, and "sent" would be a claim nobody can check yet.
#[cfg_attr(not(feature = "p2p"), allow(dead_code))]
fn sent_message(target: &OwnedDevice, job: &RemoteJob, what: &str) -> String {
    let name = &target.display_name;
    match job.status {
        RemoteJobStatus::Refused => format!(
            "\"{name}\" declined that. {}",
            job.refusal_reason.clone().unwrap_or_default()
        ),
        RemoteJobStatus::Queued => format!(
            "\"{name}\" is not reachable right now, so {what} is queued until {name} wakes. \
             It goes out on its own when the two devices see each other again."
        ),
        _ => format!(
            "Sent {what} to \"{name}\". It's running there now, and I'll tell you what comes back."
        ),
    }
}

/// Execute an approved (or auto-fired) `remote_instruct`.
pub(crate) async fn execute_remote_instruct(
    state: &State<'_, Arc<AppState>>,
    params: &serde_json::Value,
) -> Result<ExecuteResult, AppError> {
    let instruction = instruction_of(params)?;
    let target = resolve_remote_target(&state.db, params)?;
    let autonomous = crate::commands::companion::chat::autonomous_mode_enabled(&state.db);
    if let RemoteInstructGate::Refused(reason) = gate_remote_instruct(autonomous, &target) {
        return Err(AppError::Forbidden(reason));
    }
    send_instruction(state, &target, &instruction).await
}

/// The autonomous-mode arm for BOTH device ops (`remote_instruct` and
/// `remote_fleet_dispatch`, see [`DEVICE_GATED_ACTIONS`]), called from
/// `auto_resolve_if_allowed` BEFORE the generic auto-fire path.
///
/// Returns `Ok(true)` when the proposal was resolved here (fired, or fired and
/// failed), `Ok(false)` when it is left pending for a deliberate click — which
/// is what both `NeedsApproval` and `Refused` produce. A refused proposal stays
/// on the card rather than being silently dropped: the operator should see what
/// Athena wanted to do, and clicking Approve surfaces the same refusal from the
/// executor rather than sending anything.
pub(crate) async fn auto_resolve_remote_instruct(
    app: &tauri::AppHandle,
    approval: &crate::companion::dispatcher::CreatedApproval,
) -> Result<bool, AppError> {
    let state = app.state::<Arc<AppState>>();
    let params: serde_json::Value =
        serde_json::from_str(&approval.params_json).unwrap_or(serde_json::json!({}));

    // A proposal we cannot even resolve to a device is left pending rather than
    // auto-failed: the card names the target Athena meant, which is the useful
    // thing for the operator to see and correct.
    let Ok(target) = resolve_remote_target(&state.db, &params) else {
        tracing::info!(
            approval_id = %approval.id,
            "remote_instruct: target did not resolve — left pending for a user click"
        );
        return Ok(false);
    };
    let autonomous = crate::commands::companion::chat::autonomous_mode_enabled(&state.db);
    match gate_remote_instruct(autonomous, &target) {
        RemoteInstructGate::Autofire => {}
        RemoteInstructGate::NeedsApproval => return Ok(false),
        RemoteInstructGate::Refused(reason) => {
            tracing::info!(approval_id = %approval.id, %reason, "remote_instruct refused by the device rule");
            return Ok(false);
        }
    }

    // From here the manual path's shape, exactly: atomic pending→running, run,
    // finalize, log the outcome as an episode.
    let (action, params) = load_pending(&state, &approval.id)?;
    let executed = if action == "remote_fleet_dispatch" {
        execute_remote_fleet_dispatch(&state, &params).await
    } else {
        execute_remote_instruct(&state, &params).await
    };
    let (status_text, log) = match executed {
        Ok(r) => (APPROVAL_STATUS_APPROVED, r.message),
        Err(e) => {
            tracing::warn!(error = %e, action = %action, "companion: auto-fired device op failed");
            (
                APPROVAL_STATUS_APPROVED_FAILED,
                format!("Sorry, I couldn't reach that device. ({e})"),
            )
        }
    };
    finalize_approval(&state, &approval.id, status_text)?;
    log_action_episode(&state, &action, &log).await;
    Ok(true)
}

/// The transport half, in a build that HAS the transport.
///
/// `send_instruction` already fails typed and early — `Forbidden` when the peer
/// lost its `owned_devices` row between proposal and fire, `NetworkOffline`
/// when the device is asleep — and both messages already name the device and
/// the remedy. They are propagated unchanged rather than re-wrapped: a generic
/// "action failed" here is exactly the opaque toast the transport went out of
/// its way to avoid.
#[cfg(feature = "p2p")]
async fn send_instruction(
    state: &State<'_, Arc<AppState>>,
    target: &OwnedDevice,
    instruction: &str,
) -> Result<ExecuteResult, AppError> {
    let jobs = state
        .network
        .as_ref()
        .map(|net| net.remote_jobs.clone())
        .ok_or_else(|| {
            AppError::NetworkOffline(
                "The device link is not running yet. Try again in a moment.".into(),
            )
        })?;
    let job = jobs
        .send_instruction(&target.peer_id, None, instruction)
        .await?;
    Ok(ExecuteResult::message(sent_message(
        target,
        &job,
        "the request",
    )))
}

/// The fleet-session transport half: the ONE dispatch path.
#[cfg(feature = "p2p")]
async fn send_fleet_session(
    state: &State<'_, Arc<AppState>>,
    target: &OwnedDevice,
    payload: FleetSessionJobPayload,
) -> Result<ExecuteResult, AppError> {
    let project = payload.project_name.clone();
    let job =
        crate::commands::fleet::remote_exec::dispatch(state, &target.peer_id, payload).await?;
    let what = format!("the {project} session");
    Ok(ExecuteResult::message(sent_message(target, &job, &what)))
}

/// The transport half in a LITE build (`--features desktop`), where `p2p` and
/// therefore `AppState::network` do not exist.
///
/// The op is still registered, dispatched and constitutionally taught in this
/// build. That is on purpose: keeping `ALLOWED_ACTIONS`, the lifecycle match
/// and the constitution identical across feature sets means the dispatcher's
/// parity test and the autopilot's inverse test assert the SAME surface in both
/// builds, instead of a shape that only holds in one. The cost is a proposal
/// that fails with an honest sentence rather than one that is silently
/// impossible to make — a strictly better failure than an op Athena can emit
/// into a void.
#[cfg(not(feature = "p2p"))]
async fn send_instruction(
    _state: &State<'_, Arc<AppState>>,
    target: &OwnedDevice,
    _instruction: &str,
) -> Result<ExecuteResult, AppError> {
    Err(no_device_link(target))
}

/// The fleet-session transport half in a LITE build: the same honest sentence.
#[cfg(not(feature = "p2p"))]
async fn send_fleet_session(
    _state: &State<'_, Arc<AppState>>,
    target: &OwnedDevice,
    _payload: FleetSessionJobPayload,
) -> Result<ExecuteResult, AppError> {
    Err(no_device_link(target))
}

#[cfg(not(feature = "p2p"))]
fn no_device_link(target: &OwnedDevice) -> AppError {
    AppError::Validation(format!(
        "This build has no device link, so I can't reach \"{}\". \
         The full desktop build is the one that talks to your other devices.",
        target.display_name
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(name: &str, is_home: bool) -> OwnedDevice {
        OwnedDevice {
            peer_id: format!("peer-{name}"),
            device_group_id: "group-1".into(),
            display_name: name.into(),
            added_at: "2026-08-06T00:00:00Z".into(),
            last_synced_at: None,
            is_home,
            paired_at: None,
            public_key: None,
        }
    }

    /// All four cells of the operator rule, pinned. This IS the feature's
    /// consent model — a change to any row is a policy change, not a refactor.
    #[test]
    fn mode_off_home_files_an_approval_card() {
        assert_eq!(
            gate_remote_instruct(false, &device("Desktop", true)),
            RemoteInstructGate::NeedsApproval
        );
    }

    #[test]
    fn mode_off_non_home_is_refused_with_a_reason() {
        match gate_remote_instruct(false, &device("Work laptop", false)) {
            RemoteInstructGate::Refused(reason) => {
                assert!(reason.contains("Work laptop"), "name the device: {reason}");
                assert!(reason.contains("home"), "state the rule: {reason}");
                assert!(
                    reason.contains("Settings") || reason.contains("autonomous"),
                    "state a remedy: {reason}"
                );
            }
            other => panic!("a non-home device in manual mode must be refused, got {other:?}"),
        }
    }

    #[test]
    fn mode_on_home_autofires() {
        assert_eq!(
            gate_remote_instruct(true, &device("Desktop", true)),
            RemoteInstructGate::Autofire
        );
    }

    #[test]
    fn mode_on_non_home_autofires() {
        assert_eq!(
            gate_remote_instruct(true, &device("Work laptop", false)),
            RemoteInstructGate::Autofire
        );
    }

    // -- remote_fleet_dispatch --------------------------------------------

    /// The consent decision `execute_remote_fleet_dispatch` and the autopilot
    /// arm both make for a proposed fleet session: the SAME rule as
    /// `remote_instruct`, reached through the same routing.
    fn fleet_dispatch_gate(autonomous: bool, target: &OwnedDevice) -> RemoteInstructGate {
        assert!(is_device_gated("remote_fleet_dispatch"));
        gate_remote_instruct(autonomous, target)
    }

    #[test]
    fn fleet_dispatch_mode_off_home_files_an_approval_card() {
        assert_eq!(
            fleet_dispatch_gate(false, &device("Desktop", true)),
            RemoteInstructGate::NeedsApproval
        );
    }

    #[test]
    fn fleet_dispatch_mode_off_non_home_is_refused() {
        assert!(matches!(
            fleet_dispatch_gate(false, &device("Work laptop", false)),
            RemoteInstructGate::Refused(reason) if reason.contains("Work laptop")
        ));
    }

    #[test]
    fn fleet_dispatch_mode_on_home_autofires() {
        assert_eq!(
            fleet_dispatch_gate(true, &device("Desktop", true)),
            RemoteInstructGate::Autofire
        );
    }

    #[test]
    fn fleet_dispatch_mode_on_non_home_autofires() {
        assert_eq!(
            fleet_dispatch_gate(true, &device("Work laptop", false)),
            RemoteInstructGate::Autofire
        );
    }

    /// The successor of `remote_instruct_is_not_on_the_generic_allowlist`: the
    /// allowlist is gone, so what keeps a device op from firing by its name
    /// alone is the autopilot routing every one of them into the device arm.
    #[test]
    fn device_ops_never_reach_the_generic_autopilot_path() {
        for op in ["remote_instruct", "remote_fleet_dispatch"] {
            assert!(is_device_gated(op), "{op} must go through the device rule");
        }
        assert!(!is_device_gated("fleet_spawn"));
        assert!(!is_device_gated("remote_instruct "), "exact names only");
    }

    /// The git-remote refusal lives in the one dispatch path, so the op and
    /// the picker say the same thing.
    #[test]
    fn a_fleet_payload_needs_a_prompt_a_project_and_a_git_remote() {
        let db = crate::db::init_test_db().unwrap();
        let with_remote = crate::db::repos::dev_tools::create_project(
            &db,
            "Personas",
            "C:/personas",
            None,
            None,
            None,
            Some("https://github.com/o/personas"),
            None,
        )
        .unwrap();
        crate::db::repos::dev_tools::create_project(
            &db,
            "Scratch",
            "C:/scratch",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let projects = crate::db::repos::dev_tools::list_projects(&db, None).unwrap();

        let p = fleet_payload_of(
            &projects,
            &serde_json::json!({ "project": "personas", "prompt": " fix it " }),
        )
        .unwrap();
        assert_eq!(p.project_id, with_remote.id);
        assert_eq!(p.github_url, "https://github.com/o/personas");
        assert_eq!(p.prompt, "fix it");
        assert_eq!(
            p.mode,
            RemoteSessionMode::Headless,
            "headless is the default"
        );
        assert!(p.branch.is_empty(), "the dispatch path mints the branch");

        let p = fleet_payload_of(
            &projects,
            &serde_json::json!({ "project": with_remote.id, "prompt": "x", "mode": "interactive" }),
        )
        .unwrap();
        assert_eq!(p.mode, RemoteSessionMode::Interactive);

        let no_remote = fleet_payload_of(
            &projects,
            &serde_json::json!({ "project": "Scratch", "prompt": "x" }),
        )
        .unwrap();
        let refused =
            crate::commands::fleet::remote_exec::require_git_remote(&no_remote).unwrap_err();
        assert!(refused.to_string().contains("git remote"), "{refused}");
        assert!(
            fleet_payload_of(&projects, &serde_json::json!({ "project": "Personas" })).is_err()
        );
        assert!(fleet_payload_of(&projects, &serde_json::json!({ "prompt": "x" })).is_err());
        assert!(fleet_payload_of(
            &projects,
            &serde_json::json!({ "project": "Personas", "prompt": "x", "mode": "console" })
        )
        .is_err());
    }

    #[test]
    fn an_offline_device_is_queued_until_it_wakes_not_sent() {
        let target = device("Desk", false);
        let mut job = RemoteJob {
            id: "j".into(),
            direction: crate::db::models::RemoteJobDirection::Outbound,
            peer_id: "peer-Desk".into(),
            peer_display_name: "Desk".into(),
            kind: "fleet_session".into(),
            instruction: "go".into(),
            payload_json: None,
            receipt: None,
            status: RemoteJobStatus::Queued,
            summary: None,
            refusal_reason: None,
            last_seq: 0,
            created_at: "now".into(),
            updated_at: "now".into(),
            completed_at: None,
        };
        let queued = sent_message(&target, &job, "the request");
        assert!(queued.contains("queued until Desk wakes"), "{queued}");
        assert!(!queued.starts_with("Sent"), "{queued}");
        job.status = RemoteJobStatus::Running;
        assert!(sent_message(&target, &job, "the request").starts_with("Sent the request"));
        job.status = RemoteJobStatus::Refused;
        job.refusal_reason = Some("project_not_found".into());
        assert!(sent_message(&target, &job, "x").contains("project_not_found"));
    }

    #[test]
    fn an_instruction_is_required() {
        assert!(instruction_of(&serde_json::json!({})).is_err());
        assert!(instruction_of(&serde_json::json!({ "instruction": "   " })).is_err());
        assert_eq!(
            instruction_of(&serde_json::json!({ "instruction": " do it " })).unwrap(),
            "do it"
        );
        // `text` is accepted as an alias — the fleet ops use that key and the
        // model reaches for it.
        assert_eq!(
            instruction_of(&serde_json::json!({ "text": "do it" })).unwrap(),
            "do it"
        );
    }
}
