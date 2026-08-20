//! `approval_exec_devices` — the `remote_instruct` op: Athena hands an
//! instruction to one of the operator's OTHER paired devices, where that
//! device's own Athena runs it as a normal turn.
//!
//! Part of the approval module family (split from the former approvals.rs god
//! file, 2026-07-24); shared imports and types live in `mod.rs`.
//!
//! ## The operator rule, and where it lives
//!
//! There is exactly ONE statement of the rule — [`gate_remote_instruct`] — and
//! both paths that could ever fire this op go through it:
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
//! allowlist check, and `remote_instruct` is asserted absent from the allowlist
//! (`remote_instruct_is_not_on_the_generic_allowlist`) so the generic path can
//! never pick it up if someone adds the name later.
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

use crate::db::models::OwnedDevice;
use crate::db::repos::resources::owned_devices as devices_repo;

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

/// The autonomous-mode arm for `remote_instruct`, called from
/// `auto_resolve_if_allowed` BEFORE the generic allowlist check.
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
    let (status_text, log) = match execute_remote_instruct(&state, &params).await {
        Ok(r) => (APPROVAL_STATUS_APPROVED, r.message),
        Err(e) => {
            tracing::warn!(error = %e, "companion: auto-fired remote_instruct failed");
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
    let name = &target.display_name;
    Ok(ExecuteResult::message(match job.status {
        crate::db::models::RemoteJobStatus::Refused => format!(
            "\"{name}\" declined that. {}",
            job.refusal_reason.unwrap_or_default()
        ),
        _ => format!("Sent to \"{name}\". It's running there now, and I'll tell you what it says."),
    }))
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
    Err(AppError::Validation(format!(
        "This build has no device link, so I can't reach \"{}\". \
         The full desktop build is the one that talks to your other devices.",
        target.display_name
    )))
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
